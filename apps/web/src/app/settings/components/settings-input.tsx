"use client";

import { useTranslations } from "next-intl";
import { UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Config } from "../types";
import { FileSizeInput } from "./file-size-input";
import { LogoInput } from "./logo-input";

const HIDDEN_FIELDS = [
  "serverUrl",
  "firstUserAccess",
  "shareNotificationEmailSubject",
  "shareNotificationEmailBody",
  // Legacy two-threshold warning config, superseded by the deletion notification
  // schedule editor. Hidden (rather than removed) so an existing install that
  // still has these AppConfig rows doesn't show them as stray duplicate fields.
  "shareAutoDeleteFirstWarningDays",
  "shareAutoDeleteSecondWarningDays",
];

export function isFieldHidden(fieldKey: string): boolean {
  return HIDDEN_FIELDS.includes(fieldKey);
}

export interface ConfigInputProps {
  config: Config;
  register: UseFormRegister<any>;
  setValue: UseFormSetValue<any>;
  watch: UseFormWatch<any>;
  error?: any;
  smtpEnabled?: string;
  authProvidersEnabled?: string;
}

export function SettingsInput({
  config,
  register,
  setValue,
  watch,
  error,
  smtpEnabled,
  authProvidersEnabled,
}: ConfigInputProps) {
  const t = useTranslations();

  const isSmtpField = config.group === "email" && config.key !== "smtpEnabled";
  const isAuthProvidersField = config.group === "auth-providers" && config.key !== "authProvidersEnabled";
  const isDisabled =
    (isSmtpField && smtpEnabled === "false") || (isAuthProvidersField && authProvidersEnabled === "false");

  const renderInput = () => {
    if (config.key === "appLogo") {
      return (
        <LogoInput
          value={watch(`configs.${config.key}`)}
          onChange={(value) => setValue(`configs.${config.key}`, value)}
          isDisabled={isDisabled}
        />
      );
    }

    if (config.type === "boolean") {
      return (
        <Switch
          id={config.key}
          checked={watch(`configs.${config.key}`) === "true"}
          onCheckedChange={(checked) => setValue(`configs.${config.key}`, checked ? "true" : "false")}
          disabled={isDisabled}
        />
      );
    }

    if (config.key === "appDescription") {
      return (
        <Textarea
          id={config.key}
          {...register(`configs.${config.key}`)}
          disabled={isDisabled}
          className="min-h-[80px]"
        />
      );
    }

    if (config.key === "maxFileSize" || config.key === "maxTotalStoragePerUser" || config.key === "avScanMaxFileSize") {
      const currentValue = watch(`configs.${config.key}`) || "0";
      return (
        <FileSizeInput
          value={currentValue}
          onChange={(value) => setValue(`configs.${config.key}`, value)}
          disabled={isDisabled}
          placeholder="0"
        />
      );
    }

    if (config.key === "smtpSecure") {
      const currentValue = watch(`configs.${config.key}`) || "auto";
      return (
        <Select
          value={currentValue}
          onValueChange={(value) => setValue(`configs.${config.key}`, value)}
          disabled={isDisabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("settings.fields.smtpSecure.options.auto")}</SelectItem>
            <SelectItem value="ssl">{t("settings.fields.smtpSecure.options.ssl")}</SelectItem>
            <SelectItem value="tls">{t("settings.fields.smtpSecure.options.tls")}</SelectItem>
            <SelectItem value="none">{t("settings.fields.smtpSecure.options.none")}</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    if (config.key === "avScanActionOnInfection") {
      const currentValue = watch(`configs.${config.key}`) || "quarantine";
      return (
        <Select
          value={currentValue}
          onValueChange={(value) => setValue(`configs.${config.key}`, value)}
          disabled={isDisabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="quarantine">
              {t("settings.fields.avScanActionOnInfection.options.quarantine")}
            </SelectItem>
            <SelectItem value="delete">{t("settings.fields.avScanActionOnInfection.options.delete")}</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    if (config.type === "number" || config.type === "bigint") {
      return (
        <Input
          id={config.key}
          type="number"
          {...register(`configs.${config.key}`, {
            setValueAs: (value: string) => (value === "" ? "" : String(Number(value))),
          })}
          disabled={isDisabled}
        />
      );
    }

    return (
      <Input
        id={config.key}
        type={
          config.key.toLowerCase().includes("pass") || config.key.toLowerCase().includes("secret") ? "password" : "text"
        }
        {...register(`configs.${config.key}`)}
        disabled={isDisabled}
      />
    );
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={config.key} className={isDisabled ? "text-muted-foreground" : ""}>
        {t(`settings.fields.${config.key}.title`)}
      </Label>
      {renderInput()}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  );
}
