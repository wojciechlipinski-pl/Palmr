import { IconTrash } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminFileDeleteModalProps } from "../types";

export function AdminFileDeleteModal({ isOpen, onClose, file, onConfirm }: AdminFileDeleteModalProps) {
  const t = useTranslations();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader className="flex flex-col gap-1">
          <DialogTitle className="flex items-center gap-2 font-semibold">
            <IconTrash size={24} className="mr-1" />
            {t("filesManagement.delete.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {file && (
            <p className="text-muted-foreground">
              {t("filesManagement.delete.confirmation", {
                name: file.name,
                owner: `${file.owner.firstName} ${file.owner.lastName}`,
              })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("filesManagement.delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
