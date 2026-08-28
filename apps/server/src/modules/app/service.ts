import { prisma } from "../../shared/prisma";
import { ConfigService } from "../config/service";

const SHARE_AUTO_DELETE_KEYS = [
  "shareAutoDeleteGraceDays",
  "shareAutoDeleteFirstWarningDays",
  "shareAutoDeleteSecondWarningDays",
];

export class AppService {
  private configService = new ConfigService();

  // Ensures secondWarningDays < firstWarningDays < graceDays, so the two staged
  // warning emails always land before the deletion deadline and in the right order.
  // `overrides` carries only the keys being changed in this request; any key not
  // present falls back to its currently-stored value.
  private async validateShareAutoDeleteConfig(overrides: Record<string, string>) {
    const resolve = async (key: string) => {
      if (overrides[key] !== undefined) return Number(overrides[key]);
      const config = await prisma.appConfig.findUnique({ where: { key } });
      return config ? Number(config.value) : NaN;
    };

    const [graceDays, firstWarningDays, secondWarningDays] = await Promise.all([
      resolve("shareAutoDeleteGraceDays"),
      resolve("shareAutoDeleteFirstWarningDays"),
      resolve("shareAutoDeleteSecondWarningDays"),
    ]);

    if ([graceDays, firstWarningDays, secondWarningDays].some((n) => Number.isNaN(n) || n < 0)) {
      throw new Error("Share auto-delete periods must be non-negative numbers");
    }

    if (!(secondWarningDays < firstWarningDays && firstWarningDays < graceDays)) {
      throw new Error(
        "Invalid share auto-delete periods: the second warning must be sooner than the first warning, and the first warning must be sooner than the deletion grace period"
      );
    }
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

  async getAllConfigs() {
    return prisma.appConfig.findMany({
      where: {
        key: {
          not: "jwtSecret",
        },
      },
      orderBy: {
        group: "asc",
      },
    });
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

    const config = await prisma.appConfig.findUnique({
      where: { key },
    });

    if (!config) {
      throw new Error("Configuration not found");
    }

    return prisma.appConfig.update({
      where: { key },
      data: { value },
    });
  }

  async bulkUpdateConfigs(updates: Array<{ key: string; value: string }>) {
    if (updates.some((update) => update.key === "jwtSecret")) {
      throw new Error("JWT Secret cannot be updated through this endpoint");
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

    return prisma.$transaction(
      updates.map((update) =>
        prisma.appConfig.update({
          where: { key: update.key },
          data: { value: update.value },
        })
      )
    );
  }
}
