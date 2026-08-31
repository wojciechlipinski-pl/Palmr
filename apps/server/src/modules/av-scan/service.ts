import NodeClam from "clamscan";

import { prisma } from "../../shared/prisma";
import { ConfigService } from "../config/service";
import { EmailService } from "../email/service";
import { FileService } from "../file/service";

const SCAN_INTERVAL_MS = 20 * 1000; // frequent: users are waiting on this to unblock downloads
const INITIAL_DELAY_MS = 15 * 1000;
const BATCH_SIZE = 10; // files scanned per table, per cycle

export const AV_SCAN_DEFAULTS: Array<{ key: string; value: string; type: string; group: string }> = [
  { key: "avScanEnabled", value: "false", type: "boolean", group: "storage" },
  { key: "avScanHost", value: "clamav", type: "string", group: "storage" },
  { key: "avScanPort", value: "3310", type: "number", group: "storage" },
  { key: "avScanActionOnInfection", value: "quarantine", type: "string", group: "storage" },
];

type ScannableFile = { id: string; name: string; objectName: string; userId: string; user: { email: string } };
type ScannableReverseShareFile = {
  id: string;
  name: string;
  objectName: string;
  reverseShare: { creator: { email: string } };
};

/**
 * Periodically scans newly-uploaded files for malware via a ClamAV daemon
 * (clamd) reachable over TCP, and gates downloads on the result. Disabled by
 * default via the `avScanEnabled` config, matching the pattern used by
 * ExpirationCleanupService.
 *
 * Scanning is necessarily asynchronous: uploads go through presigned S3
 * URLs (internal storage proxies through Node, external S3 does not), so
 * there is no single request lifecycle to hook a synchronous scan into.
 * Every new File/ReverseShareFile row starts out `scanStatus: "PENDING"`
 * (see prisma schema) and this poller picks it up on the next cycle.
 */
export class AvScanService {
  private configService = new ConfigService();
  private emailService = new EmailService();
  private fileService = new FileService();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private clamClient: NodeClam | null = null;
  private clamClientKey = "";

  start() {
    if (this.timer) return;
    setTimeout(() => this.runCycle(), INITIAL_DELAY_MS);
    this.timer = setInterval(() => this.runCycle(), SCAN_INTERVAL_MS);
  }

  /**
   * Makes sure the storage.avScan* configuration rows exist, even on an
   * installation that was already running before this feature shipped (the
   * container's startup script only re-seeds infra/configs.json into a
   * brand-new database). Safe and idempotent to call on every boot.
   */
  async ensureDefaultConfigs() {
    for (const config of AV_SCAN_DEFAULTS) {
      const existing = await prisma.appConfig.findUnique({ where: { key: config.key } });
      if (!existing) {
        await prisma.appConfig.create({ data: config });
        console.log(`[AvScan] Seeded missing configuration: ${config.key}`);
      }
    }
  }

  private async getClamClient(): Promise<NodeClam> {
    const host = await this.configService.getValue("avScanHost");
    const port = Number(await this.configService.getValue("avScanPort"));
    const key = `${host}:${port}`;

    if (this.clamClient && this.clamClientKey === key) {
      return this.clamClient;
    }

    const clam = await new NodeClam().init({
      clamdscan: {
        host,
        port,
        timeout: 120 * 1000,
        localFallback: false,
        active: true,
      },
      clamscan: { active: false },
      preference: "clamdscan",
    });

    this.clamClient = clam;
    this.clamClientKey = key;
    return clam;
  }

  async runCycle() {
    if (this.running) return; // don't overlap if a previous run is still going
    this.running = true;

    try {
      const enabled = (await this.configService.getValue("avScanEnabled")) === "true";
      if (!enabled) return;

      let clam: NodeClam;
      try {
        clam = await this.getClamClient();
      } catch (error) {
        console.error("[AvScan] Failed to initialize ClamAV client, skipping this cycle:", error);
        return;
      }

      await this.scanPendingFiles(clam);
      await this.scanPendingReverseShareFiles(clam);
    } catch (error) {
      console.error("[AvScan] Scan cycle failed:", error);
    } finally {
      this.running = false;
    }
  }

  private async scanPendingFiles(clam: NodeClam) {
    const pending: ScannableFile[] = await prisma.file.findMany({
      where: { scanStatus: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
      select: { id: true, name: true, objectName: true, userId: true, user: { select: { email: true } } },
    });

    for (const file of pending) {
      await this.scanFileRecord(clam, file);
    }
  }

  private async scanPendingReverseShareFiles(clam: NodeClam) {
    const pending: ScannableReverseShareFile[] = await prisma.reverseShareFile.findMany({
      where: { scanStatus: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
      select: {
        id: true,
        name: true,
        objectName: true,
        reverseShare: { select: { creator: { select: { email: true } } } },
      },
    });

    for (const file of pending) {
      await this.scanReverseShareFileRecord(clam, file);
    }
  }

  private async scanFileRecord(clam: NodeClam, file: ScannableFile) {
    // Claim it first so a slow scan (or a crash mid-scan) can't get picked up
    // twice by an overlapping cycle.
    const claimed = await prisma.file.updateMany({
      where: { id: file.id, scanStatus: "PENDING" },
      data: { scanStatus: "SCANNING" },
    });
    if (claimed.count === 0) return; // already claimed by another cycle

    try {
      const result = await this.scanObject(clam, file.objectName);

      if (result.isInfected) {
        const action = await this.configService.getValue("avScanActionOnInfection");
        await prisma.file.update({
          where: { id: file.id },
          data: { scanStatus: "INFECTED", scanResult: result.viruses.join(", ") || null, scannedAt: new Date() },
        });

        if (action === "delete") {
          await this.fileService.deleteObject(file.objectName).catch((error) => {
            console.error(`[AvScan] Failed to delete infected file object ${file.id}:`, error);
          });
          await prisma.file.delete({ where: { id: file.id } }).catch(() => {});
        }

        console.warn(`[AvScan] File ${file.id} ("${file.name}") is infected: ${result.viruses.join(", ")}`);
        await this.notifyInfection(
          file.user.email,
          file.name,
          result.viruses[0] || null,
          action as "quarantine" | "delete"
        );
      } else {
        await prisma.file.update({
          where: { id: file.id },
          data: { scanStatus: "CLEAN", scanResult: null, scannedAt: new Date() },
        });
      }
    } catch (error) {
      console.error(`[AvScan] Failed to scan file ${file.id}:`, error);
      await prisma.file
        .update({ where: { id: file.id }, data: { scanStatus: "ERROR", scannedAt: new Date() } })
        .catch(() => {});
    }
  }

  private async scanReverseShareFileRecord(clam: NodeClam, file: ScannableReverseShareFile) {
    const claimed = await prisma.reverseShareFile.updateMany({
      where: { id: file.id, scanStatus: "PENDING" },
      data: { scanStatus: "SCANNING" },
    });
    if (claimed.count === 0) return;

    try {
      const result = await this.scanObject(clam, file.objectName);

      if (result.isInfected) {
        const action = await this.configService.getValue("avScanActionOnInfection");
        await prisma.reverseShareFile.update({
          where: { id: file.id },
          data: { scanStatus: "INFECTED", scanResult: result.viruses.join(", ") || null, scannedAt: new Date() },
        });

        if (action === "delete") {
          await this.fileService.deleteObject(file.objectName).catch((error) => {
            console.error(`[AvScan] Failed to delete infected reverse-share file object ${file.id}:`, error);
          });
          await prisma.reverseShareFile.delete({ where: { id: file.id } }).catch(() => {});
        }

        console.warn(
          `[AvScan] Reverse-share file ${file.id} ("${file.name}") is infected: ${result.viruses.join(", ")}`
        );
        await this.notifyInfection(
          file.reverseShare.creator.email,
          file.name,
          result.viruses[0] || null,
          action as "quarantine" | "delete"
        );
      } else {
        await prisma.reverseShareFile.update({
          where: { id: file.id },
          data: { scanStatus: "CLEAN", scanResult: null, scannedAt: new Date() },
        });
      }
    } catch (error) {
      console.error(`[AvScan] Failed to scan reverse-share file ${file.id}:`, error);
      await prisma.reverseShareFile
        .update({ where: { id: file.id }, data: { scanStatus: "ERROR", scannedAt: new Date() } })
        .catch(() => {});
    }
  }

  private async scanObject(clam: NodeClam, objectName: string): Promise<{ isInfected: boolean; viruses: string[] }> {
    const stream = await this.fileService.getObjectStream(objectName);
    const result = await clam.scanStream(stream as any);
    return { isInfected: result.isInfected, viruses: result.viruses || [] };
  }

  private async notifyInfection(
    email: string,
    fileName: string,
    threatName: string | null,
    action: "quarantine" | "delete"
  ) {
    try {
      await this.emailService.sendInfectedFileNotification(email, fileName, threatName, action);
    } catch (error) {
      // SMTP disabled or misconfigured - the scan result is still recorded and
      // enforced, this notification is best-effort.
      console.error(`[AvScan] Failed to send infection notification to ${email}:`, error);
    }
  }
}
