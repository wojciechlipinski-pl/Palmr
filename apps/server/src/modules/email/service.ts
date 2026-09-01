import nodemailer from "nodemailer";

import { ConfigService } from "../config/service";
import { renderTemplate } from "./template";

interface SmtpConfig {
  smtpEnabled: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  smtpSecure?: string;
  smtpNoAuth?: string;
  smtpTrustSelfSigned?: string;
}

export class EmailService {
  private configService = new ConfigService();

  private async createTransporter() {
    const smtpEnabled = await this.configService.getValue("smtpEnabled");
    if (smtpEnabled !== "true") {
      return null;
    }

    const port = Number(await this.configService.getValue("smtpPort"));
    const smtpSecure = (await this.configService.getValue("smtpSecure")) || "auto";
    const smtpNoAuth = await this.configService.getValue("smtpNoAuth");
    const smtpTrustSelfSigned = await this.configService.getValue("smtpTrustSelfSigned");

    let secure = false;
    let requireTLS = false;

    if (smtpSecure === "ssl") {
      secure = true;
    } else if (smtpSecure === "tls") {
      requireTLS = true;
    } else if (smtpSecure === "none") {
      secure = false;
      requireTLS = false;
    } else if (smtpSecure === "auto") {
      if (port === 465) {
        secure = true;
      } else if (port === 587 || port === 25) {
        requireTLS = true;
      }
    }

    const transportConfig: any = {
      host: await this.configService.getValue("smtpHost"),
      port: port,
      secure: secure,
      requireTLS: requireTLS,
    };

    if (smtpSecure !== "none") {
      transportConfig.tls = {
        rejectUnauthorized: smtpTrustSelfSigned === "true" ? false : true,
      };
    }

    if (smtpNoAuth !== "true") {
      transportConfig.auth = {
        user: await this.configService.getValue("smtpUser"),
        pass: await this.configService.getValue("smtpPass"),
      };
    }

    return nodemailer.createTransport(transportConfig);
  }

  async testConnection(config?: SmtpConfig) {
    let smtpConfig: SmtpConfig;

    if (config) {
      smtpConfig = config;
    } else {
      smtpConfig = {
        smtpEnabled: await this.configService.getValue("smtpEnabled"),
        smtpHost: await this.configService.getValue("smtpHost"),
        smtpPort: await this.configService.getValue("smtpPort"),
        smtpUser: await this.configService.getValue("smtpUser"),
        smtpPass: await this.configService.getValue("smtpPass"),
        smtpSecure: (await this.configService.getValue("smtpSecure")) || "auto",
        smtpNoAuth: await this.configService.getValue("smtpNoAuth"),
        smtpTrustSelfSigned: await this.configService.getValue("smtpTrustSelfSigned"),
      };
    }

    if (smtpConfig.smtpEnabled !== "true") {
      throw new Error("SMTP is not enabled");
    }

    const port = Number(smtpConfig.smtpPort);
    const smtpSecure = smtpConfig.smtpSecure || "auto";
    const smtpNoAuth = smtpConfig.smtpNoAuth;

    let secure = false;
    let requireTLS = false;

    if (smtpSecure === "ssl") {
      secure = true;
    } else if (smtpSecure === "tls") {
      requireTLS = true;
    } else if (smtpSecure === "none") {
      secure = false;
      requireTLS = false;
    } else if (smtpSecure === "auto") {
      if (port === 465) {
        secure = true;
      } else if (port === 587 || port === 25) {
        requireTLS = true;
      }
    }

    const transportConfig: any = {
      host: smtpConfig.smtpHost,
      port: port,
      secure: secure,
      requireTLS: requireTLS,
    };

    if (smtpSecure !== "none") {
      transportConfig.tls = {
        rejectUnauthorized: smtpConfig.smtpTrustSelfSigned === "true" ? false : true,
      };
    }

    if (smtpNoAuth !== "true") {
      transportConfig.auth = {
        user: smtpConfig.smtpUser,
        pass: smtpConfig.smtpPass,
      };
    }

    const transporter = nodemailer.createTransport(transportConfig);

    try {
      await transporter.verify();
      return { success: true, message: "SMTP connection successful" };
    } catch (error: any) {
      throw new Error(`SMTP connection failed: ${error.message}`);
    }
  }

  async sendPasswordResetEmail(to: string, resetToken: string, origin: string) {
    const transporter = await this.createTransporter();
    if (!transporter) {
      throw new Error("SMTP is not enabled");
    }

    const fromName = await this.configService.getValue("smtpFromName");
    const fromEmail = await this.configService.getValue("smtpFromEmail");
    const appName = await this.configService.getValue("appName");

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: `${appName} - Password Reset Request`,
      html: `
        <h1>${appName} - Password Reset Request</h1>
        <p>Click the link below to reset your password:</p>
        <a href="${origin}/reset-password?token=${resetToken}">
          Reset Password
        </a>
        <p>This link will expire in 1 hour.</p>
      `,
    });
  }

  private defaultShareNotificationSubject(appName: string, shareTitle: string) {
    return `${appName} - ${shareTitle} shared with you`;
  }

  private defaultShareNotificationHtml(appName: string, sender: string, shareTitle: string, shareLink: string) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appName} - Shared Files</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; color: #333333;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); overflow: hidden; margin-top: 40px; margin-bottom: 40px;">
            <!-- Header -->
            <div style="background-color: #22B14C; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">${appName}</h1>
              <p style="margin: 2px 0 0 0; color: #ffffff; font-size: 16px; opacity: 0.9;">Shared Files</p>
            </div>

            <!-- Content -->
            <div style="padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <h2 style="margin: 0 0 12px 0; color: #1f2937; font-size: 24px; font-weight: 600;">Files Shared With You</h2>
                <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">
                  <strong style="color: #374151;">${sender}</strong> has shared <strong style="color: #374151;">"${shareTitle}"</strong> with you.
                </p>
              </div>

              <!-- CTA Button -->
              <div style="text-align: center; margin: 32px 0;">
                <a href="${shareLink}" style="display: inline-block; background-color: #22B14C; color: #ffffff; text-decoration: none; padding: 12px 24px; font-weight: 600; font-size: 16px; border: 2px solid #22B14C; border-radius: 8px; transition: all 0.3s ease;">
                  Access Shared Files
                </a>
              </div>

              <!-- Info Box -->
              <div style="background-color: #f9fafb; border-left: 4px solid #22B14C; padding: 16px 20px; margin-top: 32px;">
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.5;">
                  <strong>Important:</strong> This share may have an expiration date or view limit. Access it as soon as possible to ensure availability.
                </p>
              </div>
            </div>

            <!-- Footer -->
            <div style="background-color: #f9fafb; padding: 24px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                This email was sent by <strong>${appName}</strong>
              </p>
              <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 12px;">
                If you didn't expect this email, you can safely ignore it.
              </p>
              <p style="margin: 4px 0 0 0; color: #9ca3af; font-size: 10px;">
                Powered by <a href="https://kyantech.com.br" style="color: #9ca3af; text-decoration: none;">Kyantech Solutions</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `;
  }

  /**
   * Sends the "a file was shared with you" notification.
   *
   * `templateOverride` lets callers (the admin "send test email" action) preview an
   * unsaved draft subject/body instead of reading the persisted `shareNotificationEmail*`
   * config values. Normal share notifications omit it and use the saved config, which
   * falls back to the built-in default template (unchanged) when left empty.
   */
  async sendShareNotification(params: {
    to: string;
    shareLink: string;
    shareName?: string;
    senderName?: string;
    senderEmail?: string;
    expiration?: Date | null;
    message?: string;
    fileCount?: number;
    templateOverride?: { subject?: string; body?: string };
  }) {
    const { to, shareLink, shareName, senderName, senderEmail, expiration, message, fileCount, templateOverride } =
      params;

    const transporter = await this.createTransporter();
    if (!transporter) {
      throw new Error("SMTP is not enabled");
    }

    const fromName = await this.configService.getValue("smtpFromName");
    const fromEmail = await this.configService.getValue("smtpFromEmail");
    const appName = await this.configService.getValue("appName");

    const shareTitle = shareName || "Files";
    const sender = senderName || "Someone";

    let customSubject = templateOverride?.subject ?? "";
    let customBody = templateOverride?.body ?? "";

    if (!templateOverride) {
      customSubject = await this.configService.getValue("shareNotificationEmailSubject").catch(() => "");
      customBody = await this.configService.getValue("shareNotificationEmailBody").catch(() => "");
    }

    const defaultSubject = this.defaultShareNotificationSubject(appName, shareTitle);
    const defaultHtml = this.defaultShareNotificationHtml(appName, sender, shareTitle, shareLink);

    let subject = defaultSubject;
    let html = defaultHtml;

    if (customSubject.trim() || customBody.trim()) {
      const placeholderValues: Record<string, string> = {
        fileName: shareTitle,
        fileCount: String(fileCount ?? 0),
        senderName: sender,
        senderEmail: senderEmail || "",
        recipientEmail: to,
        expiryDate: expiration
          ? expiration.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
          : "No expiration date",
        downloadLink: shareLink,
        message: message || "",
        appName,
      };

      if (customSubject.trim()) {
        subject = renderTemplate(customSubject, placeholderValues);
      }
      if (customBody.trim()) {
        html = renderTemplate(customBody, placeholderValues);
      }
    }

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html,
    });
  }

  async sendReverseShareBatchFileNotification(
    recipientEmail: string,
    reverseShareName: string,
    fileCount: number,
    fileList: string,
    uploaderName: string
  ) {
    const transporter = await this.createTransporter();
    if (!transporter) {
      throw new Error("SMTP is not enabled");
    }

    const fromName = await this.configService.getValue("smtpFromName");
    const fromEmail = await this.configService.getValue("smtpFromEmail");
    const appName = await this.configService.getValue("appName");

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: recipientEmail,
      subject: `${appName} - ${fileCount} file${fileCount > 1 ? "s" : ""} uploaded to "${reverseShareName}"`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appName} - File Upload Notification</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; color: #333333;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); overflow: hidden; margin-top: 40px; margin-bottom: 40px;">
            <!-- Header -->
            <div style="background-color: #22B14C; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">${appName}</h1>
              <p style="margin: 2px 0 0 0; color: #ffffff; font-size: 16px; opacity: 0.9;">File Upload Notification</p>
            </div>
            
            <!-- Content -->
            <div style="padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <h2 style="margin: 0 0 12px 0; color: #1f2937; font-size: 24px; font-weight: 600;">New File Uploaded</h2>
                <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">
                  <strong style="color: #374151;">${uploaderName}</strong> has uploaded <strong style="color: #374151;">${fileCount} file${fileCount > 1 ? "s" : ""}</strong> to your reverse share <strong style="color: #374151;">"${reverseShareName}"</strong>.
                </p>
              </div>
              
              <!-- File List -->
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin: 32px 0; border-left: 4px solid #22B14C;">
                <p style="margin: 0 0 8px 0; color: #374151; font-size: 14px;"><strong>Files (${fileCount}):</strong></p>
                <ul style="margin: 0; padding-left: 20px; color: #6b7280; font-size: 14px; line-height: 1.5;">
                   ${fileList
                     .split(", ")
                     .map((file) => `<li style="margin: 4px 0;">${file}</li>`)
                     .join("")}
                 </ul>
              </div>
              
              <!-- Info Text -->
              <div style="text-align: center; margin-top: 32px;">
                <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                  You can now access and manage these files through your dashboard.
                </p>
              </div>
              
            </div>
            
            <!-- Footer -->
            <div style="background-color: #f9fafb; padding: 24px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                This email was sent by <strong>${appName}</strong>
              </p>
              <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 12px;">
                If you didn't expect this email, you can safely ignore it.
              </p>
              <p style="margin: 4px 0 0 0; color: #9ca3af; font-size: 10px;">
                Powered by <a href="https://kyantech.com.br" style="color: #9ca3af; text-decoration: none;">Kyantech Solutions</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
  }

  async sendExpirationDeletionWarning(
    to: string,
    itemName: string,
    itemType: "share" | "reverseShare",
    deletionDate: Date,
    daysRemaining: number
  ) {
    const transporter = await this.createTransporter();
    if (!transporter) {
      throw new Error("SMTP is not enabled");
    }

    const fromName = await this.configService.getValue("smtpFromName");
    const fromEmail = await this.configService.getValue("smtpFromEmail");
    const appName = await this.configService.getValue("appName");

    const title = itemName || "Unnamed";
    const formattedDate = deletionDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const itemLabel = itemType === "reverseShare" ? "reverse share" : "share";
    const daysLabel = daysRemaining === 1 ? "1 day" : `${daysRemaining} days`;

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: `${appName} - "${title}" will be deleted in ${daysLabel}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appName} - Deletion Warning</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; color: #333333;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); overflow: hidden; margin-top: 40px; margin-bottom: 40px;">
            <!-- Header -->
            <div style="background-color: #E4572E; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">${appName}</h1>
              <p style="margin: 2px 0 0 0; color: #ffffff; font-size: 16px; opacity: 0.9;">Deletion Warning</p>
            </div>

            <!-- Content -->
            <div style="padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <h2 style="margin: 0 0 12px 0; color: #1f2937; font-size: 24px; font-weight: 600;">Your ${itemLabel} will be deleted soon</h2>
                <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">
                  Your ${itemLabel} <strong style="color: #374151;">"${title}"</strong> has expired and, together with its files, is scheduled to be permanently deleted on <strong style="color: #374151;">${formattedDate}</strong> (in ${daysLabel}).
                </p>
              </div>

              <!-- Info Box -->
              <div style="background-color: #fff7ed; border-left: 4px solid #E4572E; padding: 16px 20px; margin-top: 8px;">
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.5;">
                  <strong>What you can do:</strong> if you still need these files, sign in and create a new share, extend the expiration, or download them before the deletion date. Files still referenced by another active share will not be affected.
                </p>
              </div>
            </div>

            <!-- Footer -->
            <div style="background-color: #f9fafb; padding: 24px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                This email was sent by <strong>${appName}</strong>
              </p>
              <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 12px;">
                This is an automated notice from your configured storage cleanup settings.
              </p>
              <p style="margin: 4px 0 0 0; color: #9ca3af; font-size: 10px;">
                Powered by <a href="https://kyantech.com.br" style="color: #9ca3af; text-decoration: none;">Kyantech Solutions</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
  }

  async sendShareDownloadNotification(
    to: string,
    fileName: string,
    shareName: string | null,
    ipAddress: string | null
  ) {
    const transporter = await this.createTransporter();
    if (!transporter) {
      throw new Error("SMTP is not enabled");
    }

    const fromName = await this.configService.getValue("smtpFromName");
    const fromEmail = await this.configService.getValue("smtpFromEmail");
    const appName = await this.configService.getValue("appName");

    const title = shareName || "your share";
    const when = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: `${appName} - "${fileName}" was downloaded`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appName} - Download Notification</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; color: #333333;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); overflow: hidden; margin-top: 40px; margin-bottom: 40px;">
            <div style="background-color: #16A34A; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">${appName}</h1>
              <p style="margin: 2px 0 0 0; color: #ffffff; font-size: 16px; opacity: 0.9;">Download Notification</p>
            </div>

            <div style="padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <h2 style="margin: 0 0 12px 0; color: #1f2937; font-size: 24px; font-weight: 600;">Your file was downloaded</h2>
                <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">
                  <strong style="color: #374151;">${fileName}</strong> from ${title} was downloaded on ${when}${
                    ipAddress ? ` from IP address <strong style="color: #374151;">${ipAddress}</strong>` : ""
                  }.
                </p>
              </div>
            </div>

            <div style="background-color: #f9fafb; padding: 24px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                This email was sent by <strong>${appName}</strong>
              </p>
              <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 12px;">
                You can disable these notifications in Settings if you no longer want them.
              </p>
              <p style="margin: 4px 0 0 0; color: #9ca3af; font-size: 10px;">
                Powered by <a href="https://kyantech.com.br" style="color: #9ca3af; text-decoration: none;">Kyantech Solutions</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
  }

  async sendInfectedFileNotification(
    to: string,
    fileName: string,
    threatName: string | null,
    action: "quarantine" | "delete"
  ) {
    const transporter = await this.createTransporter();
    if (!transporter) {
      throw new Error("SMTP is not enabled");
    }

    const fromName = await this.configService.getValue("smtpFromName");
    const fromEmail = await this.configService.getValue("smtpFromEmail");
    const appName = await this.configService.getValue("appName");

    const threatLabel = threatName || "unknown threat";
    const actionLabel =
      action === "delete"
        ? "The file has been permanently deleted."
        : "The file has been quarantined and is no longer downloadable.";

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: `${appName} - Malware detected in "${fileName}"`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${appName} - Malware Detected</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; color: #333333;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); overflow: hidden; margin-top: 40px; margin-bottom: 40px;">
            <div style="background-color: #dc2626; padding: 30px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">${appName}</h1>
              <p style="margin: 2px 0 0 0; color: #ffffff; font-size: 16px; opacity: 0.9;">Malware Detected</p>
            </div>

            <div style="padding: 40px 30px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <h2 style="margin: 0 0 12px 0; color: #1f2937; font-size: 24px; font-weight: 600;">A file you uploaded was flagged as infected</h2>
                <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">
                  The antivirus scan detected <strong style="color: #dc2626;">${threatLabel}</strong> in the file <strong style="color: #374151;">"${fileName}"</strong>. ${actionLabel}
                </p>
              </div>

              <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px 20px; margin-top: 8px;">
                <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.5;">
                  <strong>What you can do:</strong> if you believe this is a false positive, contact your administrator. Otherwise, please make sure the file's source is trustworthy before uploading again.
                </p>
              </div>
            </div>

            <div style="background-color: #f9fafb; padding: 24px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                This email was sent by <strong>${appName}</strong>
              </p>
              <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 12px;">
                This is an automated notice from your configured antivirus scanning settings.
              </p>
              <p style="margin: 4px 0 0 0; color: #9ca3af; font-size: 10px;">
                Powered by <a href="https://kyantech.com.br" style="color: #9ca3af; text-decoration: none;">Kyantech Solutions</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
  }
}
