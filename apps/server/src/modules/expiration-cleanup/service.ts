import { prisma } from "../../shared/prisma";
import { ConfigService } from "../config/service";
import { EmailService } from "../email/service";
import { FileService } from "../file/service";
import { FolderService } from "../folder/service";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const INITIAL_DELAY_MS = 60 * 1000; // let the app finish booting before the first pass

const SHARE_AUTO_DELETE_DEFAULTS: Array<{ key: string; value: string; type: string; group: string }> = [
  { key: "shareAutoDeleteEnabled", value: "false", type: "boolean", group: "storage" },
  { key: "shareAutoDeleteGraceDays", value: "21", type: "number", group: "storage" },
];

// Historical hardcoded warning-day pair, before the configurable schedule. Only
// read by ensureDeletionNotificationSchedule() to carry forward a pre-existing
// install's settings; no longer seeded for new installs.
const LEGACY_FIRST_WARNING_KEY = "shareAutoDeleteFirstWarningDays";
const LEGACY_SECOND_WARNING_KEY = "shareAutoDeleteSecondWarningDays";
const LEGACY_DEFAULT_FIRST_WARNING_DAYS = 14;
const LEGACY_DEFAULT_SECOND_WARNING_DAYS = 3;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function parseSentDays(value: string): number[] {
  return value
    ? value
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((n) => Number.isInteger(n))
    : [];
}

function hasSentDay(value: string, day: number): boolean {
  return parseSentDays(value).includes(day);
}

function appendSentDay(value: string, day: number): string {
  const days = parseSentDays(value);
  if (days.includes(day)) return value;
  return [...days, day].sort((a, b) => b - a).join(",");
}

/**
 * Periodically deletes shares and reverse-shares that have been expired (or,
 * for shares, have reached their max-views limit) for longer than the
 * configured grace period, after sending up to two staged warning emails to
 * the creator. Disabled by default via the `shareAutoDeleteEnabled` config.
 *
 * Deletion is conservative about shared storage: a file or folder is only
 * physically removed if it is not still referenced by any other, still-active
 * share (Palmr's File/Folder <-> Share relation is many-to-many, so the same
 * file can legitimately belong to several shares at once).
 */
export class ExpirationCleanupService {
  private configService = new ConfigService();
  private emailService = new EmailService();
  private fileService = new FileService();
  private folderService = new FolderService();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start() {
    if (this.timer) return;
    setTimeout(() => this.runCycle(), INITIAL_DELAY_MS);
    this.timer = setInterval(() => this.runCycle(), CLEANUP_INTERVAL_MS);
  }

  /**
   * Makes sure the storage.shareAutoDelete* configuration rows exist, even on
   * an installation that was already running before this feature shipped.
   * The container's startup script only re-copies infra/configs.json (which
   * drives re-seeding) into a brand-new database, so an existing deployment
   * upgraded in place would otherwise never receive these keys. Safe and
   * idempotent to call on every boot.
   */
  async ensureDefaultConfigs() {
    for (const config of SHARE_AUTO_DELETE_DEFAULTS) {
      const existing = await prisma.appConfig.findUnique({ where: { key: config.key } });
      if (!existing) {
        await prisma.appConfig.create({ data: config });
        console.log(`[ExpirationCleanup] Seeded missing configuration: ${config.key}`);
      }
    }
  }

  /**
   * One-time migration off the old hardcoded first/second warning-day pair onto
   * the configurable DeletionNotificationSchedule table. A non-empty schedule
   * table is treated as "already migrated" (or already configured by an admin),
   * so this is safe and cheap to call on every boot.
   *
   * - Fresh install: no legacy config rows exist, so it seeds the historical
   *   defaults (14 and 3 days) - identical out-of-the-box behavior to before.
   * - Existing install: reads whatever the admin had configured (default or
   *   customized) for the legacy keys and carries those exact values forward,
   *   and copies each share/reverse-share's legacy "warning already sent" flags
   *   onto the new `sentDeletionWarningDays` field so nobody gets a duplicate
   *   warning right after upgrading.
   */
  async ensureDeletionNotificationSchedule() {
    const existingCount = await prisma.deletionNotificationSchedule.count();
    if (existingCount > 0) return;

    const [legacyFirst, legacySecond] = await Promise.all([
      prisma.appConfig.findUnique({ where: { key: LEGACY_FIRST_WARNING_KEY } }),
      prisma.appConfig.findUnique({ where: { key: LEGACY_SECOND_WARNING_KEY } }),
    ]);

    const firstDays = legacyFirst ? Number(legacyFirst.value) : LEGACY_DEFAULT_FIRST_WARNING_DAYS;
    const secondDays = legacySecond ? Number(legacySecond.value) : LEGACY_DEFAULT_SECOND_WARNING_DAYS;

    const daysToSeed = Array.from(new Set([firstDays, secondDays].filter((n) => Number.isFinite(n) && n > 0)));

    if (daysToSeed.length > 0) {
      await prisma.deletionNotificationSchedule.createMany({
        data: daysToSeed.map((daysBeforeDeletion) => ({ daysBeforeDeletion, enabled: true })),
      });
      console.log(
        `[ExpirationCleanup] Seeded deletion notification schedule from ${
          legacyFirst || legacySecond ? "existing" : "default"
        } configuration: ${daysToSeed.join(", ")} day(s) before deletion`
      );
    }

    if (legacyFirst) {
      await this.carryForwardSentWarnings(firstDays, "deletionWarningFirstSentAt");
    }
    if (legacySecond) {
      await this.carryForwardSentWarnings(secondDays, "deletionWarningSecondSentAt");
    }
  }

  private async carryForwardSentWarnings(
    day: number,
    legacyField: "deletionWarningFirstSentAt" | "deletionWarningSecondSentAt"
  ) {
    if (!Number.isFinite(day) || day <= 0) return;

    const shares = await prisma.share.findMany({
      where: { [legacyField]: { not: null } },
      select: { id: true, sentDeletionWarningDays: true },
    });
    for (const share of shares) {
      const updated = appendSentDay(share.sentDeletionWarningDays, day);
      if (updated !== share.sentDeletionWarningDays) {
        await prisma.share.update({ where: { id: share.id }, data: { sentDeletionWarningDays: updated } });
      }
    }

    const reverseShares = await prisma.reverseShare.findMany({
      where: { [legacyField]: { not: null } },
      select: { id: true, sentDeletionWarningDays: true },
    });
    for (const reverseShare of reverseShares) {
      const updated = appendSentDay(reverseShare.sentDeletionWarningDays, day);
      if (updated !== reverseShare.sentDeletionWarningDays) {
        await prisma.reverseShare.update({
          where: { id: reverseShare.id },
          data: { sentDeletionWarningDays: updated },
        });
      }
    }
  }

  async runCycle() {
    if (this.running) return; // don't overlap if a previous run is still going
    this.running = true;

    try {
      const enabled = (await this.configService.getValue("shareAutoDeleteEnabled")) === "true";
      if (!enabled) return;

      const graceDays = Number(await this.configService.getValue("shareAutoDeleteGraceDays"));
      if (Number.isNaN(graceDays)) {
        console.error("[ExpirationCleanup] Invalid share auto-delete configuration, skipping this run");
        return;
      }

      const schedule = await prisma.deletionNotificationSchedule.findMany({
        where: { enabled: true },
        orderBy: { daysBeforeDeletion: "desc" },
      });
      const warningDays = schedule.map((entry) => entry.daysBeforeDeletion);

      await this.processShares(graceDays, warningDays);
      await this.processReverseShares(graceDays, warningDays);
    } catch (error) {
      console.error("[ExpirationCleanup] Cleanup cycle failed:", error);
    } finally {
      this.running = false;
    }
  }

  private async processShares(graceDays: number, warningDays: number[]) {
    const now = new Date();

    const candidates = await prisma.share.findMany({
      where: {
        OR: [{ expiration: { not: null } }, { maxViewsReachedAt: { not: null } }],
      },
      include: {
        files: { select: { id: true, objectName: true } },
        folders: { select: { id: true, objectName: true } },
        creator: { select: { email: true } },
      },
    });

    for (const share of candidates) {
      const triggerAt = share.expiration ?? share.maxViewsReachedAt;
      if (!triggerAt) continue;

      const deletionDeadline = addDays(triggerAt, graceDays);

      try {
        if (now >= deletionDeadline) {
          await this.deleteShare(share);
          continue;
        }

        for (const days of warningDays) {
          const warningAt = addDays(deletionDeadline, -days);
          if (now >= warningAt && !hasSentDay(share.sentDeletionWarningDays, days)) {
            await this.sendWarning(share, "share", deletionDeadline, days);
          }
        }
      } catch (error) {
        console.error(`[ExpirationCleanup] Failed processing share ${share.id}:`, error);
      }
    }
  }

  private async processReverseShares(graceDays: number, warningDays: number[]) {
    const now = new Date();

    const candidates = await prisma.reverseShare.findMany({
      where: { expiration: { not: null } },
      include: {
        files: { select: { id: true, objectName: true } },
        creator: { select: { email: true } },
      },
    });

    for (const reverseShare of candidates) {
      if (!reverseShare.expiration) continue;

      const deletionDeadline = addDays(reverseShare.expiration, graceDays);

      try {
        if (now >= deletionDeadline) {
          await this.deleteReverseShare(reverseShare);
          continue;
        }

        for (const days of warningDays) {
          const warningAt = addDays(deletionDeadline, -days);
          if (now >= warningAt && !hasSentDay(reverseShare.sentDeletionWarningDays, days)) {
            await this.sendWarning(reverseShare, "reverseShare", deletionDeadline, days);
          }
        }
      } catch (error) {
        console.error(`[ExpirationCleanup] Failed processing reverse share ${reverseShare.id}:`, error);
      }
    }
  }

  private async sendWarning(
    item: { id: string; name: string | null; creator?: { email: string } | null; sentDeletionWarningDays: string },
    type: "share" | "reverseShare",
    deadline: Date,
    daysRemaining: number
  ) {
    const email = item.creator?.email;
    if (email) {
      try {
        await this.emailService.sendExpirationDeletionWarning(
          email,
          item.name || "Unnamed",
          type,
          deadline,
          daysRemaining
        );
      } catch (error) {
        console.error(`[ExpirationCleanup] Failed to send warning email for ${type} ${item.id}:`, error);
      }
    }

    const updatedSentDays = appendSentDay(item.sentDeletionWarningDays, daysRemaining);
    if (type === "share") {
      await prisma.share.update({ where: { id: item.id }, data: { sentDeletionWarningDays: updatedSentDays } });
    } else {
      await prisma.reverseShare.update({ where: { id: item.id }, data: { sentDeletionWarningDays: updatedSentDays } });
    }
  }

  private async deleteShare(share: {
    id: string;
    name: string | null;
    securityId: string;
    files: { id: string; objectName: string }[];
    folders: { id: string; objectName: string }[];
  }) {
    for (const file of share.files) {
      const otherShareCount = await prisma.share.count({
        where: { id: { not: share.id }, files: { some: { id: file.id } } },
      });

      if (otherShareCount === 0) {
        await this.hardDeleteFile(file.id, file.objectName);
      }
    }

    for (const folder of share.folders) {
      await this.tryDeleteFolderTree(folder.id, share.id);
    }

    await prisma.$transaction(async (tx) => {
      await tx.share.update({
        where: { id: share.id },
        data: { files: { set: [] }, folders: { set: [] } },
      });
      await tx.share.delete({ where: { id: share.id } });
      await tx.shareSecurity.delete({ where: { id: share.securityId } }).catch(() => {
        // Already gone, nothing to do.
      });
    });

    console.log(`[ExpirationCleanup] Deleted expired share ${share.id} ("${share.name || "Unnamed"}")`);
  }

  private async deleteReverseShare(reverseShare: {
    id: string;
    name: string | null;
    files: { id: string; objectName: string }[];
  }) {
    for (const file of reverseShare.files) {
      try {
        await this.fileService.deleteObject(file.objectName);
      } catch (error) {
        console.error(`[ExpirationCleanup] Failed to delete storage object for file ${file.id}:`, error);
      }
    }

    await prisma.reverseShare.delete({ where: { id: reverseShare.id } });
    console.log(
      `[ExpirationCleanup] Deleted expired reverse share ${reverseShare.id} ("${reverseShare.name || "Unnamed"}")`
    );
  }

  private async hardDeleteFile(fileId: string, objectName: string) {
    try {
      await this.fileService.deleteObject(objectName);
    } catch (error) {
      console.error(`[ExpirationCleanup] Failed to delete storage object for file ${fileId}:`, error);
    }

    await prisma.file.delete({ where: { id: fileId } }).catch(() => {
      // Already gone (e.g. deleted concurrently by the user), nothing to do.
    });
  }

  /**
   * Recursively collects a folder and every descendant folder/file.
   */
  private async collectFolderTree(
    folderId: string
  ): Promise<{ folders: { id: string; objectName: string }[]; files: { id: string; objectName: string }[] }> {
    const folder = await prisma.folder.findUnique({
      where: { id: folderId },
      select: { id: true, objectName: true },
    });
    if (!folder) return { folders: [], files: [] };

    const files = await prisma.file.findMany({
      where: { folderId },
      select: { id: true, objectName: true },
    });
    const subfolders = await prisma.folder.findMany({
      where: { parentId: folderId },
      select: { id: true },
    });

    let allFolders = [folder];
    let allFiles = [...files];

    for (const subfolder of subfolders) {
      const subtree = await this.collectFolderTree(subfolder.id);
      allFolders = [...allFolders, ...subtree.folders];
      allFiles = [...allFiles, ...subtree.files];
    }

    return { folders: allFolders, files: allFiles };
  }

  /**
   * Deletes a shared folder and everything inside it, but only if nothing in
   * the whole subtree is still referenced by another, still-active share. If
   * any single file or subfolder is shared elsewhere too, the entire tree is
   * left untouched (only this expired share's own record is removed) rather
   * than risk deleting something another share still depends on.
   */
  private async tryDeleteFolderTree(folderId: string, currentShareId: string) {
    const tree = await this.collectFolderTree(folderId);
    if (tree.folders.length === 0) return; // already gone

    const folderIds = tree.folders.map((f) => f.id);
    const fileIds = tree.files.map((f) => f.id);

    const [foldersWithShares, filesWithShares] = await Promise.all([
      prisma.folder.findMany({
        where: { id: { in: folderIds } },
        select: { id: true, shares: { select: { id: true } } },
      }),
      fileIds.length > 0
        ? prisma.file.findMany({
            where: { id: { in: fileIds } },
            select: { id: true, shares: { select: { id: true } } },
          })
        : Promise.resolve([]),
    ]);

    const isExclusiveToCurrentShare = (shares: { id: string }[]) => shares.every((s) => s.id === currentShareId);

    const isFullyExclusive =
      foldersWithShares.every((f) => isExclusiveToCurrentShare(f.shares)) &&
      filesWithShares.every((f) => isExclusiveToCurrentShare(f.shares));

    if (!isFullyExclusive) {
      console.log(
        `[ExpirationCleanup] Folder ${folderId} (or something inside it) is still referenced by another share, skipping physical deletion`
      );
      return;
    }

    for (const file of tree.files) {
      try {
        await this.fileService.deleteObject(file.objectName);
      } catch (error) {
        console.error(`[ExpirationCleanup] Failed to delete storage object for file ${file.id}:`, error);
      }
    }

    for (const folder of tree.folders) {
      try {
        await this.folderService.deleteObject(folder.objectName);
      } catch (error) {
        console.error(`[ExpirationCleanup] Failed to delete storage object for folder ${folder.id}:`, error);
      }
    }

    // Deletes the top folder; descendant Folder/File rows cascade per schema
    // (their storage objects were already removed above).
    await prisma.folder.delete({ where: { id: folderId } }).catch(() => {
      // Already gone, nothing to do.
    });
  }
}
