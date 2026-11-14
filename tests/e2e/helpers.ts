import { _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function launch(opts: { args?: string[]; settings?: Record<string, unknown>; env?: Record<string, string> } = {}): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = mkdtempSync(join(tmpdir(), "rfr-e2e-"));
  if (opts.settings) writeFileSync(join(userData, "settings.json"), JSON.stringify(opts.settings));
  const args = ["dist-electron/electron/main.js", "--test", ...(opts.args ?? [])];
  if (process.platform === "linux") args.unshift("--no-sandbox");
  const app = await electron.launch({
    args,
    env: { ...process.env, RFR_TEST: "1", RFR_USER_DATA: userData, ...(opts.env ?? {}) } as Record<string, string>,
  });
  return { app, userData };
}
