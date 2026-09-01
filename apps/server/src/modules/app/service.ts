import { prisma } from "../../shared/prisma";
import { ConfigService } from "../config/service";
import { EmailService } from "../email/service";
import {
  findInvalidPlaceholders,
  sanitizeEmailHtml,
  sanitizeEmailSubject,
  SHARE_NOTIFICATION_PLACEHOLDERS,
} from "../email/template";

const SHARE_AUTO_DELETE_KEYS = ["shareAutoDeleteGraceDays"];
const MAX_DELETION_WARNING_DAYS = 30;

const EMAIL_TEMPLATE_KEYS = ["shareNotificationEmailSubject", "shareNotificationEmailBody"];
const MAX_EMAIL_TEMPLATE_SUBJECT_LENGTH = 200;
const MAX_EMAIL_TEMPLATE_BODY_LENGTH = 50000;

// Secret-valued configs that must never round-trip to the browser in plaintext
// (see kyantech/Palmr#415). getAllConfigs() replaces their stored value with a
// fixed-length placeholder (never the real value or its real length); the
// update endpoints treat that same placeholder - or a blank submission - as
// "admin didn't change this field" and leave the stored value untouched,
// mirroring the existing "leave blank to keep current password" pattern used
// for user passwords.
const REDACTED_PASSWORD_KEYS = ["smtpPass"];
const REDACTED_PASSWORD_PLACEHOLDER = "••••••••";

export class AppService {
  private configService = new ConfigService();
  private emailService = new EmailService();

  // Rejects unknown `{placeholder}` tokens and oversized input, then strips any
  // markup the admin isn't allowed to inject into the outgoing HTML email.
  private sanitizeEmailTemplateValue(key: string, value: string): string {
    if (!value.trim()) {
      return "";
    }

    const invalidPlaceholders = findInvalidPlaceholders(value, SHARE_NOTIFICATION_PLACEHOLDERS);
    if (invalidPlaceholders.length > 0) {
      throw new Error(
        `Unknown placeholder(s) in email template: ${invalidPlaceholders.map((token) => `{${token}}`).join(", ")}`
      );
    }

    if (key === "shareNotificationEmailSubject") {
      if (value.length > MAX_EMAIL_TEMPLATE_SUBJECT_LENGTH) {
        throw new Error(`Email subject must be ${MAX_EMAIL_TEMPLATE_SUBJECT_LENGTH} characters or fewer`);
      }
      return sanitizeEmailSubject(value);
    }

    if (key === "shareNotificationEmailBody") {
      if (value.length > MAX_EMAIL_TEMPLATE_BODY_LENGTH) {
        throw new Error(`Email body must be ${MAX_EMAIL_TEMPLATE_BODY_LENGTH} characters or fewer`);
      }
      return sanitizeEmailHtml(value);
    }

    return value;
  }

  // Sends a sample "file shared with you" email to the requesting admin, using the
  // provided (unsaved) draft subject/body so they can preview changes before saving.
  // Falls back to the currently saved template, then the built-in default, for
  // whichever of the two is left blank - matching how the real send behaves.
  async sendShareNotificationTestEmail(
    adminUser: { id: string; email: string; firstName?: string | null; lastName?: string | null },
    draftSubject: string,
    draftBody: string
  ) {
    const subject = draftSubject ? this.sanitizeEmailTemplateValue("shareNotificationEmailSubject", draftSubject) : "";
    const body = draftBody ? this.sanitizeEmailTemplateValue("shareNotificationEmailBody", draftBody) : "";

    const senderName = [adminUser.firstName, adminUser.lastName].filter(Boolean).join(" ") || "Jane Doe";

    await this.emailService.sendShareNotification({
      to: adminUser.email,
      shareLink: "https://example.com/s/sample-share",
      shareName: "example-file.pdf",
      senderName,
      senderEmail: adminUser.email,
      expiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      message: "Hey! Here are the files we discussed.",
      fileCount: 3,
      templateOverride: { subject, body },
    });
  }

  // Ensures the grace period is non-negative and stays after every configured
  // notification day (so every warning still lands before deletion). `overrides`
  // carries only the keys being changed in this request; any key not present
  // falls back to its currently-stored value.
  private async validateShareAutoDeleteConfig(overrides: Record<string, string>) {
    const resolve = async (key: string) => {
      if (overrides[key] !== undefined) return Number(overrides[key]);
      const config = await prisma.appConfig.findUnique({ where: { key } });
      return config ? Number(config.value) : NaN;
    };

    const graceDays = await resolve("shareAutoDeleteGraceDays");

    if (Number.isNaN(graceDays) || graceDays < 0) {
      throw new Error("Share auto-delete grace period must be a non-negative number");
    }

    const schedules = await prisma.deletionNotificationSchedule.findMany();
    const maxScheduledDay = schedules.reduce((max, entry) => Math.max(max, entry.daysBeforeDeletion), 0);

    if (schedules.length > 0 && maxScheduledDay >= graceDays) {
      throw new Error(
        `The deletion grace period (${graceDays} days) must be greater than every configured notification day (largest is ${maxScheduledDay})`
      );
    }
  }

  // Rejects non-positive, oversized, or duplicate day values, and makes sure every
  // notification still lands before the configured deletion grace period.
  private async validateDeletionNotificationSchedule(entries: { daysBeforeDeletion: number; enabled: boolean }[]) {
    const graceDaysConfig = await prisma.appConfig.findUnique({ where: { key: "shareAutoDeleteGraceDays" } });
    const graceDays = graceDaysConfig ? Number(graceDaysConfig.value) : NaN;

    const seen = new Set<number>();
    for (const entry of entries) {
      if (!Number.isInteger(entry.daysBeforeDeletion) || entry.daysBeforeDeletion <= 0) {
        throw new Error("Each notification day must be a positive whole number");
      }
      if (entry.daysBeforeDeletion > MAX_DELETION_WARNING_DAYS) {
        throw new Error(`Notifications can be scheduled at most ${MAX_DELETION_WARNING_DAYS} days before deletion`);
      }
      if (seen.has(entry.daysBeforeDeletion)) {
        throw new Error(`Duplicate notification day: ${entry.daysBeforeDeletion}`);
      }
      seen.add(entry.daysBeforeDeletion);

      if (!Number.isNaN(graceDays) && entry.daysBeforeDeletion >= graceDays) {
        throw new Error(
          `Notification day ${entry.daysBeforeDeletion} must be less than the deletion grace period (${graceDays} days)`
        );
      }
    }
  }

  async getDeletionNotificationSchedules() {
    return prisma.deletionNotificationSchedule.findMany({ orderBy: { daysBeforeDeletion: "desc" } });
  }

  // Replaces the whole schedule at once - simplest correct semantics for a small,
  // admin-edited list (add/remove/edit rows client-side, save the resulting set).
  async replaceDeletionNotificationSchedules(entries: { daysBeforeDeletion: number; enabled: boolean }[]) {
    await this.validateDeletionNotificationSchedule(entries);

    return prisma.$transaction(async (tx) => {
      await tx.deletionNotificationSchedule.deleteMany({});
      if (entries.length > 0) {
        await tx.deletionNotificationSchedule.createMany({
          data: entries.map((entry) => ({
            daysBeforeDeletion: entry.daysBeforeDeletion,
            enabled: entry.enabled,
          })),
        });
      }
      return tx.deletionNotificationSchedule.findMany({ orderBy: { daysBeforeDeletion: "desc" } });
    });
  }

  async getAppInfo() {
    const [appName, appDescription, appLogo, firstUserAccess] = await Promise.all([
      this.configService.getValue("appName"),
      this.configService.getValue("appDescription"),
      this.configService.getValue("appLogo"),
      this.configService.getValue("firstUserAccess"),
    ]);

    return {
      appName,
      appDescription,
      appLogo,
      firstUserAccess: firstUserAccess === "true",
    };
  }

  async getSystemInfo() {
    return {
      storageProvider: "s3",
      s3Enabled: true,
    };
  }

  // Applied to every response path that echoes AppConfig rows back to the
  // browser (list, single update, bulk update) so a redacted field's
  // plaintext value can never leak, no matter which endpoint returned it.
  private redactConfig<T extends { key: string; value: string }>(config: T): T {
    if (!REDACTED_PASSWORD_KEYS.includes(config.key)) return config;
    return { ...config, value: config.value ? REDACTED_PASSWORD_PLACEHOLDER : "" };
  }

  async getAllConfigs() {
    const configs = await prisma.appConfig.findMany({
      where: {
        key: {
          not: "jwtSecret",
        },
      },
      orderBy: {
        group: "asc",
      },
    });

    return configs.map((config) => this.redactConfig(config));
  }

  async getPublicConfigs() {
    const sensitiveKeys = [
      "smtpHost",
      "smtpPort",
      "smtpUser",
      "smtpPass",
      "smtpSecure",
      "smtpNoAuth",
      "smtpTrustSelfSigned",
      "jwtSecret",
    ];

    return prisma.appConfig.findMany({
      where: {
        key: {
          notIn: sensitiveKeys,
        },
      },
      orderBy: {
        group: "asc",
      },
    });
  }

  async updateConfig(key: string, value: string) {
    if (key === "jwtSecret") {
      throw new Error("JWT Secret cannot be updated through this endpoint");
    }

    if (REDACTED_PASSWORD_KEYS.includes(key) && (value === "" || value === REDACTED_PASSWORD_PLACEHOLDER)) {
      const config = await prisma.appConfig.findUnique({ where: { key } });
      if (!config) {
        throw new Error("Configuration not found");
      }
      return this.redactConfig(config);
    }

    if (key === "passwordAuthEnabled") {
      if (value === "false") {
        const canDisable = await this.configService.validatePasswordAuthDisable();
        if (!canDisable) {
          throw new Error(
            "Password authentication cannot be disabled. At least one authentication provider must be active."
          );
        }
      }
    }

    if (SHARE_AUTO_DELETE_KEYS.includes(key)) {
      await this.validateShareAutoDeleteConfig({ [key]: value });
    }

    let sanitizedValue = value;
    if (EMAIL_TEMPLATE_KEYS.includes(key)) {
      sanitizedValue = this.sanitizeEmailTemplateValue(key, value);
    }

    const config = await prisma.appConfig.findUnique({
      where: { key },
    });

    if (!config) {
      throw new Error("Configuration not found");
    }

    const updated = await prisma.appConfig.update({
      where: { key },
      data: { value: sanitizedValue },
    });

    return this.redactConfig(updated);
  }

  async bulkUpdateConfigs(updates: Array<{ key: string; value: string }>) {
    if (updates.some((update) => update.key === "jwtSecret")) {
      throw new Error("JWT Secret cannot be updated through this endpoint");
    }

    // Drop redacted-password fields the admin left untouched (blank, or still
    // showing our placeholder) so they never overwrite the real stored value.
    updates = updates.filter(
      (update) =>
        !REDACTED_PASSWORD_KEYS.includes(update.key) ||
        (update.value !== "" && update.value !== REDACTED_PASSWORD_PLACEHOLDER)
    );

    if (updates.length === 0) {
      return [];
    }

    const passwordAuthUpdate = updates.find((update) => update.key === "passwordAuthEnabled");
    if (passwordAuthUpdate && passwordAuthUpdate.value === "false") {
      const canDisable = await this.configService.validatePasswordAuthDisable();
      if (!canDisable) {
        throw new Error(
          "Password authentication cannot be disabled. At least one authentication provider must be active."
        );
      }
    }

    const shareAutoDeleteUpdates = updates.filter((update) => SHARE_AUTO_DELETE_KEYS.includes(update.key));
    if (shareAutoDeleteUpdates.length > 0) {
      const overrides = shareAutoDeleteUpdates.reduce(
        (acc, update) => ({ ...acc, [update.key]: update.value }),
        {} as Record<string, string>
      );
      await this.validateShareAutoDeleteConfig(overrides);
    }

    const keys = updates.map((update) => update.key);
    const existingConfigs = await prisma.appConfig.findMany({
      where: { key: { in: keys } },
    });

    if (existingConfigs.length !== keys.length) {
      const existingKeys = existingConfigs.map((config) => config.key);
      const missingKeys = keys.filter((key) => !existingKeys.includes(key));
      throw new Error(`Configurations not found: ${missingKeys.join(", ")}`);
    }

    const sanitizedUpdates = updates.map((update) => ({
      key: update.key,
      value: EMAIL_TEMPLATE_KEYS.includes(update.key)
        ? this.sanitizeEmailTemplateValue(update.key, update.value)
        : update.value,
    }));

    const updated = await prisma.$transaction(
      sanitizedUpdates.map((update) =>
        prisma.appConfig.update({
          where: { key: update.key },
          data: { value: update.value },
        })
      )
    );

    return updated.map((config) => this.redactConfig(config));
  }
}
