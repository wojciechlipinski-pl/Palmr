"use client";

import { useRef, useState } from "react";
import { IconEye, IconLoader, IconMailForward } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { testShareNotificationEmailTemplate } from "@/http/endpoints";

// Keep in sync with SHARE_NOTIFICATION_PLACEHOLDERS in
// apps/server/src/modules/email/template.ts
const PLACEHOLDERS: { token: string; descriptionKey: string; fallback: string }[] = [
  { token: "fileName", descriptionKey: "fileName", fallback: "Name of the share / shared item" },
  { token: "fileCount", descriptionKey: "fileCount", fallback: "Number of files in the share" },
  { token: "senderName", descriptionKey: "senderName", fallback: "Name of the person sharing the files" },
  { token: "senderEmail", descriptionKey: "senderEmail", fallback: "Email address of the sender" },
  { token: "recipientEmail", descriptionKey: "recipientEmail", fallback: "Email address of this recipient" },
  { token: "expiryDate", descriptionKey: "expiryDate", fallback: "When the share expires (or a fallback text)" },
  { token: "downloadLink", descriptionKey: "downloadLink", fallback: "Link to access the shared files" },
  { token: "message", descriptionKey: "message", fallback: "Optional message the sender attached to the share" },
  { token: "appName", descriptionKey: "appName", fallback: "This application's name" },
];

const SAMPLE_VALUES: Record<string, string> = {
  fileName: "example-file.pdf",
  fileCount: "3",
  senderName: "Jane Doe",
  senderEmail: "jane.doe@example.com",
  recipientEmail: "you@example.com",
  expiryDate: "January 1, 2027",
  downloadLink: "https://example.com/s/sample-share",
  message: "Hey! Here are the files we discussed.",
  appName: "Palmr.",
};

function renderPreview(template: string): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, token) =>
    Object.prototype.hasOwnProperty.call(SAMPLE_VALUES, token) ? SAMPLE_VALUES[token] : full
  );
}

interface ShareNotificationTemplateEditorProps {
  form: UseFormReturn<any>;
  disabled?: boolean;
}

export function ShareNotificationTemplateEditor({ form, disabled }: ShareNotificationTemplateEditorProps) {
  const t = useTranslations();
  const [isSendingTest, setIsSendingTest] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const subject = form.watch("configs.shareNotificationEmailSubject") || "";
  const body = form.watch("configs.shareNotificationEmailBody") || "";

  const insertPlaceholder = (token: string) => {
    const textarea = bodyRef.current;
    const placeholder = `{${token}}`;

    if (!textarea) {
      form.setValue("configs.shareNotificationEmailBody", `${body}${placeholder}`);
      return;
    }

    const start = textarea.selectionStart ?? body.length;
    const end = textarea.selectionEnd ?? body.length;
    const nextValue = `${body.slice(0, start)}${placeholder}${body.slice(end)}`;

    form.setValue("configs.shareNotificationEmailBody", nextValue, { shouldDirty: true });

    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + placeholder.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const handleSendTest = async () => {
    setIsSendingTest(true);
    try {
      await testShareNotificationEmailTemplate({ subject, body });
      toast.success(
        t("settings.fields.shareNotificationEmail.testSuccess", {
          defaultValue: "Test email sent - check your inbox.",
        })
      );
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error || error?.message || t("common.unexpectedError");
      toast.error(
        t("settings.fields.shareNotificationEmail.testFailed", {
          defaultValue: "Couldn't send the test email: {error}",
          error: errorMessage,
        })
      );
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">
          {t("settings.fields.shareNotificationEmail.title", { defaultValue: "“File shared with you” email" })}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          {t("settings.fields.shareNotificationEmail.description", {
            defaultValue:
              "Customize the email recipients get when someone shares a file with them. Leave both fields empty to keep using the built-in default.",
          })}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="shareNotificationEmailSubject">
          {t("settings.fields.shareNotificationEmailSubject.title", { defaultValue: "Subject" })}
        </Label>
        <Input
          id="shareNotificationEmailSubject"
          placeholder={t("settings.fields.shareNotificationEmail.subjectPlaceholder", {
            defaultValue: "Default: {appName} - {fileName} shared with you",
          })}
          {...form.register("configs.shareNotificationEmailSubject")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="shareNotificationEmailBody">
          {t("settings.fields.shareNotificationEmailBody.title", { defaultValue: "Body (HTML)" })}
        </Label>
        <Textarea
          id="shareNotificationEmailBody"
          className="min-h-[200px] font-mono text-xs"
          placeholder={t("settings.fields.shareNotificationEmail.bodyPlaceholder", {
            defaultValue: "Leave empty to use the built-in default template",
          })}
          {...form.register("configs.shareNotificationEmailBody")}
          ref={(el) => {
            bodyRef.current = el;
            form.register("configs.shareNotificationEmailBody").ref(el);
          }}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("settings.fields.shareNotificationEmail.placeholdersTitle", {
            defaultValue: "Available placeholders (click to insert into the body):",
          })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PLACEHOLDERS.map(({ token, descriptionKey, fallback }) => (
            <Badge
              key={token}
              variant="outline"
              asChild
              className="cursor-pointer hover:bg-accent"
              title={t(`settings.fields.shareNotificationEmail.placeholders.${descriptionKey}`, {
                defaultValue: fallback,
              })}
            >
              <button type="button" onClick={() => insertPlaceholder(token)}>
                {`{${token}}`}
              </button>
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" className="flex items-center gap-2" disabled={!body.trim()}>
              <IconEye className="h-4 w-4" />
              {t("settings.buttons.previewEmail", { defaultValue: "Preview" })}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {subject ? renderPreview(subject) : t("settings.buttons.previewEmail", { defaultValue: "Preview" })}
              </DialogTitle>
              <DialogDescription>
                {t("settings.fields.shareNotificationEmail.previewHint", {
                  defaultValue: "Rendered with sample data - the real email uses the actual share's details.",
                })}
              </DialogDescription>
            </DialogHeader>
            <iframe
              title="email-preview"
              sandbox=""
              srcDoc={renderPreview(body)}
              className="w-full h-[420px] rounded-md border bg-white"
            />
          </DialogContent>
        </Dialog>

        <Button
          type="button"
          variant="outline"
          className="flex items-center gap-2"
          onClick={handleSendTest}
          disabled={disabled || isSendingTest}
        >
          {isSendingTest ? <IconLoader className="h-4 w-4 animate-spin" /> : <IconMailForward className="h-4 w-4" />}
          {t("settings.buttons.sendTestEmail", { defaultValue: "Send test email to me" })}
        </Button>
      </div>
    </div>
  );
}
