import { IconAlertTriangle, IconLoader2, IconShieldX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

type FileScanStatus = "PENDING" | "SCANNING" | "CLEAN" | "INFECTED" | "ERROR";

interface FileScanStatusBadgeProps {
  scanStatus?: FileScanStatus | null;
}

// Silent for PENDING/CLEAN: PENDING is the steady state for every file on an
// install that hasn't turned antivirus scanning on, so showing a badge for it
// would put a permanent "pending" pill on every single file. Only surface the
// states that carry real signal once the scan has actually run.
export function FileScanStatusBadge({ scanStatus }: FileScanStatusBadgeProps) {
  const t = useTranslations();

  if (scanStatus === "SCANNING") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground flex-shrink-0"
        title={t("filesTable.scanStatus.scanning")}
      >
        <IconLoader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }

  if (scanStatus === "INFECTED") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive flex-shrink-0"
        title={t("filesTable.scanStatus.infected")}
      >
        <IconShieldX className="h-3 w-3" />
      </span>
    );
  }

  if (scanStatus === "ERROR") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-500 flex-shrink-0"
        title={t("filesTable.scanStatus.error")}
      >
        <IconAlertTriangle className="h-3 w-3" />
      </span>
    );
  }

  return null;
}
