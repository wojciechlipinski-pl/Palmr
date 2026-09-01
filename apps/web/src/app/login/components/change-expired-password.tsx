"use client";

import { useState } from "react";
import { IconLock } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ChangeExpiredPasswordProps {
  onSubmit: (currentPassword: string, newPassword: string, confirmPassword: string) => void;
  error?: string;
  isSubmitting: boolean;
}

export function ChangeExpiredPassword({ onSubmit, error, isSubmitting }: ChangeExpiredPasswordProps) {
  const t = useTranslations();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(currentPassword, newPassword, confirmPassword);
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-full bg-primary/10">
            <IconLock className="h-8 w-8 text-primary" />
          </div>
        </div>
        <CardTitle>{t("expiredPassword.title")}</CardTitle>
        <CardDescription>{t("expiredPassword.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="currentPassword" className="mb-2">
              {t("expiredPassword.currentPassword")}
            </Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <div>
            <Label htmlFor="newPassword" className="mb-2">
              {t("expiredPassword.newPassword")}
            </Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div>
            <Label htmlFor="confirmPassword" className="mb-2">
              {t("expiredPassword.confirmPassword")}
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword}
          >
            {isSubmitting ? t("expiredPassword.submitting") : t("expiredPassword.submit")}
          </Button>

          {error && (
            <div className="text-sm text-destructive text-center bg-destructive/10 p-3 rounded-md">{error}</div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
