"use client";

import { useEffect, useState } from "react";
import { IconDeviceFloppy, IconLoader, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getDeletionNotificationSchedules, replaceDeletionNotificationSchedules } from "@/http/endpoints";

interface ScheduleRow {
  // Stable client-side key so React can track rows independently of their
  // (possibly duplicate-while-editing) day value.
  key: string;
  daysBeforeDeletion: string;
  enabled: boolean;
}

const MAX_DAYS = 30;

function makeKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function DeletionNotificationScheduleEditor() {
  const t = useTranslations();
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getDeletionNotificationSchedules()
      .then((response) => {
        if (cancelled) return;
        const schedules = [...response.data.schedules].sort((a, b) => b.daysBeforeDeletion - a.daysBeforeDeletion);
        setRows(
          schedules.map((schedule) => ({
            key: schedule.id,
            daysBeforeDeletion: String(schedule.daysBeforeDeletion),
            enabled: schedule.enabled,
          }))
        );
      })
      .catch(() => {
        if (!cancelled)
          toast.error(
            t("settings.messages.deletionScheduleLoadFailed", {
              defaultValue: "Couldn't load the deletion notification schedule",
            })
          );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const addRow = () => {
    setRows((prev) => [...prev, { key: makeKey(), daysBeforeDeletion: "", enabled: true }]);
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((row) => row.key !== key));
  };

  const updateRow = (key: string, patch: Partial<ScheduleRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const validate = (): string | null => {
    const seen = new Set<number>();
    for (const row of rows) {
      const value = Number(row.daysBeforeDeletion);
      if (!Number.isInteger(value) || value <= 0) {
        return t("settings.messages.deletionSchedulePositiveInteger", {
          defaultValue: "Every notification day must be a positive whole number",
        });
      }
      if (value > MAX_DAYS) {
        return t("settings.messages.deletionScheduleMaxDays", {
          defaultValue: "Notifications can be scheduled at most {max} days before deletion",
          max: MAX_DAYS,
        });
      }
      if (seen.has(value)) {
        return t("settings.messages.deletionScheduleDuplicate", {
          defaultValue: "Duplicate notification day: {day}",
          day: value,
        });
      }
      seen.add(value);
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsSaving(true);
    try {
      const response = await replaceDeletionNotificationSchedules({
        schedules: rows.map((row) => ({ daysBeforeDeletion: Number(row.daysBeforeDeletion), enabled: row.enabled })),
      });
      const schedules = [...response.data.schedules].sort((a, b) => b.daysBeforeDeletion - a.daysBeforeDeletion);
      setRows(
        schedules.map((schedule) => ({
          key: schedule.id,
          daysBeforeDeletion: String(schedule.daysBeforeDeletion),
          enabled: schedule.enabled,
        }))
      );
      toast.success(
        t("settings.messages.deletionScheduleSaved", { defaultValue: "Deletion notification schedule saved" })
      );
    } catch (error: any) {
      const errorMessage = error?.response?.data?.error || error?.message || t("common.unexpectedError");
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">
          {t("settings.fields.deletionNotificationSchedule.title", {
            defaultValue: "Deletion warning schedule",
          })}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          {t("settings.fields.deletionNotificationSchedule.description", {
            defaultValue:
              "Add as many warning emails as you like, each a number of days before an expired or limit-reached share is permanently deleted. Leave the list empty to send no warnings.",
          })}
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconLoader className="h-4 w-4 animate-spin" />
          {t("common.loading", { defaultValue: "Loading..." })}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("settings.fields.deletionNotificationSchedule.empty", {
                defaultValue: "No deletion warnings configured.",
              })}
            </p>
          )}
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={MAX_DAYS}
                value={row.daysBeforeDeletion}
                onChange={(e) => updateRow(row.key, { daysBeforeDeletion: e.target.value })}
                placeholder={t("settings.fields.deletionNotificationSchedule.daysPlaceholder", {
                  defaultValue: "Days before deletion",
                })}
                className="w-48"
              />
              <span className="text-xs text-muted-foreground shrink-0">
                {t("settings.fields.deletionNotificationSchedule.daysSuffix", { defaultValue: "days before deletion" })}
              </span>
              <div className="flex items-center gap-2 ml-auto shrink-0">
                <Switch
                  checked={row.enabled}
                  onCheckedChange={(checked) => updateRow(row.key, { enabled: checked })}
                  aria-label={t("settings.fields.deletionNotificationSchedule.enabled", { defaultValue: "Enabled" })}
                />
                <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(row.key)}>
                  <IconTrash className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button type="button" variant="outline" className="flex items-center gap-2" onClick={addRow}>
          <IconPlus className="h-4 w-4" />
          {t("settings.buttons.addDeletionWarning", { defaultValue: "Add notification" })}
        </Button>
        <Button
          type="button"
          variant="default"
          className="flex items-center gap-2"
          onClick={handleSave}
          disabled={isSaving || isLoading}
        >
          {isSaving ? <IconLoader className="h-4 w-4 animate-spin" /> : <IconDeviceFloppy className="h-4 w-4" />}
          {t("settings.buttons.saveDeletionSchedule", { defaultValue: "Save schedule" })}
        </Button>
      </div>
    </div>
  );
}
