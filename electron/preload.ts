// Sandboxed preload: only `electron` may be required here. Keep it a typed, minimal bridge.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { RfrApi, UpdateStatus } from "../src/shared/api";
import type { Settings } from "../src/shared/settings";

// Duplicated from src/shared/api.ts because a sandboxed preload cannot require local modules.
const IPC = {
  appInfo: "rfr:appInfo", getSettings: "rfr:getSettings", setSettings: "rfr:setSettings",
  getDisplays: "rfr:getDisplays", play: "rfr:play", openLauncher: "rfr:openLauncher", quit: "rfr:quit",
  openLogs: "rfr:openLogs", getCredits: "rfr:getCredits", readSave: "rfr:readSave", writeSave: "rfr:writeSave",
  deleteSave: "rfr:deleteSave", screenshot: "rfr:screenshot", log: "rfr:log",
  checkForUpdates: "rfr:checkForUpdates", installUpdate: "rfr:installUpdate", updateStatus: "rfr:updateStatus",
  steamAchievement: "rfr:steamAchievement", applyDisplay: "rfr:applyDisplay",
} as const;

const api: RfrApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (s: Settings) => ipcRenderer.invoke(IPC.setSettings, s),
  getDisplays: () => ipcRenderer.invoke(IPC.getDisplays),
  play: () => ipcRenderer.invoke(IPC.play),
  openLauncher: () => ipcRenderer.invoke(IPC.openLauncher),
  quit: () => ipcRenderer.invoke(IPC.quit),
  openLogs: () => ipcRenderer.invoke(IPC.openLogs),
  getCredits: () => ipcRenderer.invoke(IPC.getCredits),
  readSave: (slot: string) => ipcRenderer.invoke(IPC.readSave, slot),
  writeSave: (slot: string, json: string) => ipcRenderer.invoke(IPC.writeSave, slot, json),
  deleteSave: (slot: string) => ipcRenderer.invoke(IPC.deleteSave, slot),
  screenshot: (b64: string) => ipcRenderer.invoke(IPC.screenshot, b64),
  log: (level, message) => ipcRenderer.send(IPC.log, level, String(message).slice(0, 4000)),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => {
    const h = (_e: IpcRendererEvent, s: UpdateStatus) => cb(s);
    ipcRenderer.on(IPC.updateStatus, h);
    return () => ipcRenderer.removeListener(IPC.updateStatus, h);
  },
  steamAchievement: (id: string) => ipcRenderer.invoke(IPC.steamAchievement, id),
  applyDisplay: () => ipcRenderer.invoke(IPC.applyDisplay),
};

contextBridge.exposeInMainWorld("rfr", api);
