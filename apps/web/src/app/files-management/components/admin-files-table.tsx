import { IconTrash } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { FileScanStatusBadge } from "@/components/tables/file-scan-status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getFileIcon } from "@/utils/file-icons";
import { formatFileSize } from "@/utils/format-file-size";
import { AdminFilesTableProps } from "../types";

export function AdminFilesTable({ files, onDelete }: AdminFilesTableProps) {
  const t = useTranslations();

  const formatDate = (dateString: string) =>
    new Intl.DateTimeFormat("pl-PL", { year: "numeric", month: "short", day: "numeric" }).format(new Date(dateString));

  return (
    <div className="rounded-lg shadow-sm overflow-hidden border">
      <Table>
        <TableHeader>
          <TableRow className="border-b-0">
            <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("filesManagement.table.name")}
            </TableHead>
            <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("filesManagement.table.owner")}
            </TableHead>
            <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("filesManagement.table.size")}
            </TableHead>
            <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("filesManagement.table.createdAt")}
            </TableHead>
            <TableHead className="h-10 w-[70px] text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("filesManagement.table.actions")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((file) => {
            const { icon: FileIcon, color } = getFileIcon(file.name);
            return (
              <TableRow key={file.id} className="hover:bg-muted/50 transition-colors border-0">
                <TableCell className="h-12 px-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileIcon className={`h-5 w-5 flex-shrink-0 ${color}`} />
                    <span className="truncate max-w-[280px] font-medium" title={file.name}>
                      {file.name}
                    </span>
                    <FileScanStatusBadge scanStatus={file.scanStatus} />
                  </div>
                </TableCell>
                <TableCell className="h-12 px-4">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                        {file.owner.firstName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{`${file.owner.firstName} ${file.owner.lastName}`}</p>
                      <p className="text-xs text-muted-foreground">{file.owner.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="h-12 px-4 text-sm text-muted-foreground">
                  {formatFileSize(Number(file.size))}
                </TableCell>
                <TableCell className="h-12 px-4 text-sm text-muted-foreground">{formatDate(file.createdAt)}</TableCell>
                <TableCell className="h-12 px-4">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    aria-label={t("filesManagement.table.delete")}
                    onClick={() => onDelete(file)}
                  >
                    <IconTrash size={16} />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
