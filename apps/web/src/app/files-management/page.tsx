"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { Navbar } from "@/components/layout/navbar";
import { DefaultFooter } from "@/components/ui/default-footer";
import { AdminFileDeleteModal } from "./components/admin-file-delete-modal";
import { AdminFilesTable } from "./components/admin-files-table";
import { FilesManagementHeader } from "./components/files-management-header";
import { useAdminFilesManagement } from "./hooks/use-admin-files-management";

export default function FilesManagementPage() {
  const {
    files,
    totalFiles,
    isLoading,
    searchQuery,
    setSearchQuery,
    deleteModalFile,
    setDeleteModalFile,
    isDeleteModalOpen,
    onDeleteModalOpen,
    onDeleteModalClose,
    handleDeleteFile,
  } = useAdminFilesManagement();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <ProtectedRoute requireAdmin>
      <div className="w-full h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-7xl mx-auto w-full py-8 px-6">
          <div className="flex flex-col gap-8">
            <FilesManagementHeader searchQuery={searchQuery} totalFiles={totalFiles} onSearch={setSearchQuery} />

            <AdminFilesTable
              files={files}
              onDelete={(file) => {
                setDeleteModalFile(file);
                onDeleteModalOpen();
              }}
            />
          </div>
        </div>
        <DefaultFooter />

        <AdminFileDeleteModal
          file={deleteModalFile}
          isOpen={isDeleteModalOpen}
          onClose={onDeleteModalClose}
          onConfirm={handleDeleteFile}
        />
      </div>
    </ProtectedRoute>
  );
}
