"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useDisclosure } from "@/hooks/use-disclosure";
import { adminDeleteFile, listAllFiles } from "@/http/endpoints";
import { AdminFileItem } from "@/http/endpoints/files/types";

export function useAdminFilesManagement() {
  const t = useTranslations();

  const [files, setFiles] = useState<AdminFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteModalFile, setDeleteModalFile] = useState<AdminFileItem | null>(null);

  const { isOpen: isDeleteModalOpen, onOpen: onDeleteModalOpen, onClose: onDeleteModalClose } = useDisclosure();

  const loadFiles = useCallback(async () => {
    try {
      const response = await listAllFiles();
      setFiles(response.data.files);
    } catch {
      toast.error(t("filesManagement.errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const query = searchQuery.toLowerCase();
    return files.filter(
      (file) =>
        file.name.toLowerCase().includes(query) ||
        file.owner.email.toLowerCase().includes(query) ||
        file.owner.username.toLowerCase().includes(query) ||
        `${file.owner.firstName} ${file.owner.lastName}`.toLowerCase().includes(query)
    );
  }, [files, searchQuery]);

  const handleDeleteFile = async () => {
    if (!deleteModalFile) return;

    try {
      await adminDeleteFile(deleteModalFile.id);
      toast.success(t("filesManagement.messages.deleteSuccess"));
      loadFiles();
      onDeleteModalClose();
    } catch {
      toast.error(t("filesManagement.errors.deleteFailed"));
    }
  };

  return {
    files: filteredFiles,
    totalFiles: files.length,
    isLoading,
    searchQuery,
    setSearchQuery,
    deleteModalFile,
    setDeleteModalFile,
    isDeleteModalOpen,
    onDeleteModalOpen,
    onDeleteModalClose,
    handleDeleteFile,
  };
}
