import { ConfigService } from "../config/service";

const configService = new ConfigService();

export type ScanGateResult = { allowed: boolean; reason?: "infected" | "pending" };

/**
 * Decides whether a file may be downloaded/streamed/embedded based on its
 * antivirus scan status. Entirely permissive when scanning is disabled
 * (avScanEnabled=false), so this never blocks anyone on an install that
 * hasn't turned the feature on - including every file uploaded before it
 * was enabled.
 */
export async function checkScanGate(scanStatus: string): Promise<ScanGateResult> {
  const enabled = (await configService.getValue("avScanEnabled")) === "true";
  if (!enabled) return { allowed: true };
  if (scanStatus === "CLEAN") return { allowed: true };
  if (scanStatus === "INFECTED") return { allowed: false, reason: "infected" };
  return { allowed: false, reason: "pending" }; // PENDING / SCANNING / ERROR
}
