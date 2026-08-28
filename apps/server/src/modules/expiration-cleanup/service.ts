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
  { key: "shareAutoDeleteFirstWarningDays", value: "14", type: "number", group: "storage" },
  { key: "shareAutoDeleteSecondWarningDays", value: "3", type: "number", group: "storage" },
];

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

type WarningField = "deletionWarningFirstSentAt" | "deletionWarningSecondSentAt";

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

  async runCycle() {
    if (this.running) return; // don't overlap if a previous run is still going
    this.running = true;

    try {
      const enabled = (await this.configService.getValue("shareAutoDeleteEnabled")) === "true";
      if (!enabled) return;

      const graceDays = Number(await this.configService.getValue("shareAutoDeleteGraceDays"));
      const firstWarningDays = Number(await this.configService.getValue("shareAutoDeleteFirstWarningDays"));
      const secondWarningDays = Number(await this.configService.getValue("shareAutoDeleteSecondWarningDays"));

      if ([graceDays, firstWarningDays, secondWarningDays].some((n) => Number.isNaN(n))) {
        console.error("[ExpirationCleanup] Invalid share auto-delete configuration, skipping this run");
        return;
      }

      await this.processShares(graceDays, firstWarningDays, secondWarningDays);
      await this.processReverseShares(graceDays, firstWarningDays, secondWarningDays);
    } catch (error) {
      console.error("[ExpirationCleanup] Cleanup cycle failed:", error);
    } finally {
      this.running = false;
    }
  }

  private async processShares(graceDays: number, firstWarningDays: number, secondWarningDays: number) {
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
      const firstWarningAt = addDays(deletionDeadline, -firstWarningDays);
      const secondWarningAt = addDays(deletionDeadline, -secondWarningDays);

      try {
        if (now >= deletionDeadline) {
          await this.deleteShare(share);
          continue;
        }

        if (now >= firstWarningAt && !share.deletionWarningFirstSentAt) {
          await this.sendWarning(share, "share", deletionDeadline, firstWarningDays, "deletionWarningFirstSentAt");
        }

        if (now >= secondWarningAt && !share.deletionWarningSecondSentAt) {
          await this.sendWarning(share, "share", deletionDeadline, secondWarningDays, "deletionWarningSecondSentAt");
        }
      } catch (error) {
        console.error(`[ExpirationCleanup] Failed processing share ${share.id}:`, error);
      }
    }
  }

  private async processReverseShares(graceDays: number, firstWarningDays: number, secondWarningDays: number) {
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
      const firstWarningAt = addDays(deletionDeadline, -firstWarningDays);
      const secondWarningAt = addDays(deletionDeadline, -secondWarningDays);

      try {
        if (now >= deletionDeadline) {
          await this.deleteReverseShare(reverseShare);
          continue;
        }

        if (now >= firstWarningAt && !reverseShare.deletionWarningFirstSentAt) {
          await this.sendWarning(
            reverseShare,
            "reverseShare",
            deletionDeadline,
            firstWarningDays,
            "deletionWarningFirstSentAt"
          );
        }

        if (now >= secondWarningAt && !reverseShare.deletionWarningSecondSentAt) {
          await this.sendWarning(
            reverseShare,
            "reverseShare",
            deletionDeadline,
            secondWarningDays,
            "deletionWarningSecondSentAt"
          );
        }
      } catch (error) {
        console.error(`[ExpirationCleanup] Failed processing reverse share ${reverseShare.id}:`, error);
      }
    }
  }

  private async sendWarning(
    item: { id: string; name: string | null; creator?: { email: string } | null },
    type: "share" | "reverseShare",
    deadline: Date,
    daysRemaining: number,
    field: WarningField
  ) {
    const email = item.creator?.email;
    if (email) {
      try {
        await this.emailService.sendExpirationDeletionWarning(email, item.name || "Unnamed", type, deadline, daysRemaining);
      } catch (error) {
        console.error(`[ExpirationCleanup] Failed to send warning email for ${type} ${item.id}:`, error);
      }
    }

    if (type === "share") {
      await prisma.share.update({ where: { id: item.id }, data: { [field]: new Date() } });
    } else {
      await prisma.reverseShare.update({ where: { id: item.id }, data: { [field]: new Date() } });
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
    console.log(`[ExpirationCleanup] Deleted expired reverse share ${reverseShare.id} ("${reverseShare.name || "Unnamed"}")`);
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

    const isExclusiveToCurrentShare = (shares: { id: string }[]) =>
      shares.every((s) => s.id === currentShareId);

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
