import Link from "next/link";
import { IconFiles, IconLayoutDashboard, IconSearch } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { FilesManagementHeaderProps } from "../types";

export function FilesManagementHeader({ totalFiles, searchQuery, onSearch }: FilesManagementHeaderProps) {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <IconFiles className="text-2xl" />
          <h1 className="text-2xl font-bold">{t("filesManagement.header.title", { count: totalFiles })}</h1>
        </div>
        <div className="relative w-full max-w-xs">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <Input
            className="pl-9"
            placeholder={t("filesManagement.header.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      </div>
      <Separator />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard" className="flex items-center">
                <IconLayoutDashboard size={20} className="mr-2" />
                {t("common.dashboard")}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <span className="flex items-center gap-2">
              <IconFiles size={20} /> {t("filesManagement.header.management")}
            </span>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
