"use client";

import { useEffect, useState } from "react";
import { IconShieldLock } from "@tabler/icons-react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLoginAttempts, getStorageStats } from "@/http/endpoints";
import type { LoginAttemptEntry, UserStorageStat } from "@/http/endpoints/users/types";
import { formatFileSize } from "@/utils/format-file-size";

export function SecurityPanel() {
  const t = useTranslations();
  const [storageStats, setStorageStats] = useState<UserStorageStat[]>([]);
  const [loginAttempts, setLoginAttempts] = useState<LoginAttemptEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [storageRes, attemptsRes] = await Promise.all([getStorageStats(), getLoginAttempts()]);
        setStorageStats(storageRes.data.stats);
        setLoginAttempts(attemptsRes.data.attempts);
      } catch {
        setStorageStats([]);
        setLoginAttempts([]);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconShieldLock className="h-5 w-5" />
          {t("users.security.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader size="lg" />
          </div>
        ) : (
          <Tabs defaultValue="storage">
            <TabsList>
              <TabsTrigger value="storage">{t("users.security.storageTab")}</TabsTrigger>
              <TabsTrigger value="loginAttempts">{t("users.security.loginAttemptsTab")}</TabsTrigger>
            </TabsList>

            <TabsContent value="storage">
              {storageStats.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">{t("users.security.noStorageData")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("users.security.columns.user")}</TableHead>
                        <TableHead>{t("users.security.columns.email")}</TableHead>
                        <TableHead>{t("users.security.columns.filesCount")}</TableHead>
                        <TableHead>{t("users.security.columns.storageUsed")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {storageStats.map((stat) => (
                        <TableRow key={stat.userId}>
                          <TableCell className="font-medium">
                            {stat.firstName} {stat.lastName} ({stat.username})
                          </TableCell>
                          <TableCell className="text-muted-foreground">{stat.email}</TableCell>
                          <TableCell>{stat.fileCount}</TableCell>
                          <TableCell>{formatFileSize(Number(stat.totalSize))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="loginAttempts">
              {loginAttempts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">{t("users.security.noLoginAttempts")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("users.security.columns.user")}</TableHead>
                        <TableHead>{t("users.security.columns.email")}</TableHead>
                        <TableHead>{t("users.security.columns.attempts")}</TableHead>
                        <TableHead>{t("users.security.columns.lastAttempt")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loginAttempts.map((attempt) => (
                        <TableRow key={attempt.userId}>
                          <TableCell className="font-medium">{attempt.username}</TableCell>
                          <TableCell className="text-muted-foreground">{attempt.email}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-red-500/20 text-red-600">
                              {attempt.attempts}
                            </Badge>
                          </TableCell>
                          <TableCell>{format(new Date(attempt.lastAttempt), "MM/dd/yyyy HH:mm")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
