import { AdminFileItem } from "@/http/endpoints/files/types";

export interface AdminFilesTableProps {
  files: AdminFileItem[];
  onDelete: (file: AdminFileItem) => void;
}

export interface FilesManagementHeaderProps {
  totalFiles: number;
  searchQuery: string;
  onSearch: (query: string) => void;
}

export interface AdminFileDeleteModalProps {
  isOpen: boolean;
  file: AdminFileItem | null;
  onClose: () => void;
  onConfirm: () => void;
}
