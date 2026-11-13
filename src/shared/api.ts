import type { Settings } from "./settings";

export interface DisplayInfo {
  index: number;
  id: number;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
}

export type UpdateStatus =
  | { state: "idle" }
  | { state: "disabled"; reason: string }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "none"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  packaged: boolean;
  userData: string;
  steam: boolean;
  testMode: boolean;
}

/** The only surface the sandboxed renderers get. Exposed as `window.rfr`. */
export interface RfrApi {
  appInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<Settings>;
  getDisplays(): Promise<DisplayInfo[]>;
  play(): Promise<void>;
  openLauncher(): Promise<void>;
  quit(): Promise<void>;
  openLogs(): Promise<void>;
  getCredits(): Promise<string>;
  readSave(slot: string): Promise<string | null>;
  writeSave(slot: string, json: string): Promise<boolean>;
  deleteSave(slot: string): Promise<boolean>;
  screenshot(pngBase64: string): Promise<string>;
  log(level: "info" | "warn" | "error", message: string): void;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
  steamAchievement(id: string): Promise<boolean>;
  applyDisplay(): Promise<void>;
}

/** IPC channel names, shared by main and preload. */
export const IPC = {
  appInfo: "rfr:appInfo",
  getSettings: "rfr:getSettings",
  setSettings: "rfr:setSettings",
  getDisplays: "rfr:getDisplays",
  play: "rfr:play",
  openLauncher: "rfr:openLauncher",
  quit: "rfr:quit",
  openLogs: "rfr:openLogs",
  getCredits: "rfr:getCredits",
  readSave: "rfr:readSave",
  writeSave: "rfr:writeSave",
  deleteSave: "rfr:deleteSave",
  screenshot: "rfr:screenshot",
  log: "rfr:log",
  checkForUpdates: "rfr:checkForUpdates",
  installUpdate: "rfr:installUpdate",
  updateStatus: "rfr:updateStatus",
  steamAchievement: "rfr:steamAchievement",
  applyDisplay: "rfr:applyDisplay",
} as const;

export const SAVE_SLOT_RE = /^[a-z0-9_-]{1,32}$/;
