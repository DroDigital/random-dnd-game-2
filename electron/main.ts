import { app, BrowserWindow, crashReporter, ipcMain, screen, shell, type Rectangle } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { autoUpdater } from "electron-updater";
import { Logger, writeCrashReport } from "./logger";
import { initSteam, steamEnabled, unlockAchievement } from "./steam";
import { IPC, SAVE_SLOT_RE, type AppInfo, type DisplayInfo, type UpdateStatus } from "../src/shared/api";
import { migrateSettings, SettingsSchema, type Settings } from "../src/shared/settings";

// ---------------------------------------------------------------------------
// Paths and flags
// ---------------------------------------------------------------------------
const argv = process.argv.slice(1);
const hasFlag = (f: string): boolean => argv.includes(f);
const TEST_MODE = hasFlag("--test") || process.env.RFR_TEST === "1";
if (process.env.RFR_USER_DATA) app.setPath("userData", process.env.RFR_USER_DATA);

const userData = app.getPath("userData");
const logDir = join(userData, "logs");
const crashDir = join(userData, "crashes");
const saveDir = join(userData, "saves");
const shotDir = join(userData, "screenshots");
const settingsFile = join(userData, "settings.json");
const log = new Logger(logDir);

crashReporter.start({ uploadToServer: false, compress: true });

process.on("uncaughtException", (e) => {
  const f = writeCrashReport(crashDir, "main-uncaught", e);
  log.error(`uncaught exception, report: ${f}\n${e.stack ?? e}`);
});
process.on("unhandledRejection", (e) => {
  log.error(`unhandled rejection: ${String(e)}`);
});

// ---------------------------------------------------------------------------
// Settings (versioned JSON, atomic writes)
// ---------------------------------------------------------------------------
function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

function loadSettings(): Settings {
  try {
    if (existsSync(settingsFile)) return migrateSettings(JSON.parse(readFileSync(settingsFile, "utf8")));
  } catch (e) {
    log.warn(`settings unreadable, using defaults: ${String(e)}`);
  }
  return migrateSettings(undefined);
}
let settings = loadSettings();
function saveSettings(s: Settings): void {
  mkdirSync(userData, { recursive: true });
  atomicWrite(settingsFile, JSON.stringify(s, null, 2));
}

// vsync must be decided before the GPU process starts.
if (!settings.display.vsync) {
  app.commandLine.appendSwitch("disable-gpu-vsync");
  app.commandLine.appendSwitch("disable-frame-rate-limit");
}
// Gamepads keep working when the window is in the background (local co-op on a TV).
app.commandLine.appendSwitch("disable-renderer-backgrounding");

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
const devUrl = process.env.VITE_DEV_SERVER_URL;
const distDir = join(__dirname, "..", "..", "dist");
let launcherWin: BrowserWindow | null = null;
let gameWin: BrowserWindow | null = null;

const webPreferences = {
  preload: join(__dirname, "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false,
  spellcheck: false,
  webSecurity: true,
} as const;

function harden(win: BrowserWindow, kind: string): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (!devUrl || !url.startsWith(devUrl)) e.preventDefault();
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    const f = writeCrashReport(crashDir, `${kind}-renderer-gone`, details);
    log.error(`${kind} renderer gone (${details.reason}); report ${f}`);
  });
  win.webContents.on("console-message", (e) => {
    const lvl = e.level === "error" ? "error" : e.level === "warning" ? "warn" : null;
    if (lvl) log.write(lvl, `[${kind}] ${e.message}`);
  });
}

function load(win: BrowserWindow, page: "index" | "launcher"): void {
  if (devUrl) void win.loadURL(`${devUrl}/${page}.html`);
  else void win.loadFile(join(distDir, `${page}.html`));
}

function displayList(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    index: i, id: d.id, label: d.label || `Display ${i + 1}`,
    width: d.size.width, height: d.size.height, scaleFactor: d.scaleFactor, primary: d.id === primary,
  }));
}

function targetDisplayBounds(): Rectangle {
  const all = screen.getAllDisplays();
  const d = all[settings.display.monitor] ?? screen.getPrimaryDisplay();
  return d.bounds;
}

function applyDisplay(win: BrowserWindow): void {
  const b = targetDisplayBounds();
  const mode = settings.display.mode;
  if (mode === "fullscreen") {
    win.setFullScreen(false);
    win.setBounds({ x: b.x, y: b.y, width: Math.min(1440, b.width), height: Math.min(810, b.height) });
    win.setFullScreen(true);
  } else if (mode === "borderless") {
    win.setFullScreen(false);
    win.setBounds(b);
  } else {
    win.setFullScreen(false);
    const w = Math.min(480 * settings.display.renderScale, b.width - 80);
    const h = Math.min(270 * settings.display.renderScale, b.height - 80);
    win.setBounds({ x: b.x + Math.round((b.width - w) / 2), y: b.y + Math.round((b.height - h) / 2), width: w, height: h });
  }
}

function createLauncher(): void {
  if (launcherWin) {
    launcherWin.show();
    launcherWin.focus();
    return;
  }
  launcherWin = new BrowserWindow({
    width: 860, height: 600, minWidth: 720, minHeight: 520, show: false, resizable: true,
    title: "Roll for Ruin — Launcher", backgroundColor: "#14121c", autoHideMenuBar: true, webPreferences,
  });
  harden(launcherWin, "launcher");
  launcherWin.once("ready-to-show", () => launcherWin?.show());
  launcherWin.on("closed", () => {
    launcherWin = null;
    if (!gameWin) app.quit();
  });
  load(launcherWin, "launcher");
}

function createGame(): void {
  if (gameWin) {
    gameWin.focus();
    return;
  }
  const borderless = settings.display.mode === "borderless";
  gameWin = new BrowserWindow({
    width: 480 * settings.display.renderScale, height: 270 * settings.display.renderScale,
    show: false, frame: !borderless, title: "Roll for Ruin", backgroundColor: "#14121c",
    autoHideMenuBar: true, useContentSize: true, webPreferences,
  });
  harden(gameWin, "game");
  applyDisplay(gameWin);
  gameWin.once("ready-to-show", () => {
    gameWin?.show();
    gameWin?.focus();
  });
  gameWin.on("closed", () => {
    gameWin = null;
    if (!launcherWin) app.quit();
  });
  load(gameWin, "index");
  if (launcherWin) launcherWin.close();
}

// ---------------------------------------------------------------------------
// Updates (electron-updater, GitHub Releases). Only meaningful for packaged builds.
// ---------------------------------------------------------------------------
let updateStatus: UpdateStatus = { state: "idle" };
function pushUpdate(s: UpdateStatus): void {
  updateStatus = s;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.updateStatus, s);
}
function updatesSupported(): string | null {
  if (TEST_MODE) return "test mode";
  if (!app.isPackaged) return "development build";
  if (process.platform === "linux" && !process.env.APPIMAGE) return "only the AppImage self-updates on Linux";
  if (process.env.PORTABLE_EXECUTABLE_DIR) return "the portable build does not self-update";
  return null;
}
function setupUpdater(): void {
  const why = updatesSupported();
  if (why) {
    pushUpdate({ state: "disabled", reason: why });
    return;
  }
  autoUpdater.logger = { info: (m: unknown) => log.info(`updater: ${String(m)}`), warn: (m: unknown) => log.warn(`updater: ${String(m)}`), error: (m: unknown) => log.error(`updater: ${String(m)}`), debug: () => undefined };
  autoUpdater.autoDownload = true;
  autoUpdater.on("checking-for-update", () => pushUpdate({ state: "checking" }));
  autoUpdater.on("update-available", (i) => pushUpdate({ state: "available", version: i.version }));
  autoUpdater.on("update-not-available", (i) => pushUpdate({ state: "none", version: i.version }));
  autoUpdater.on("download-progress", (p) => pushUpdate({ state: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => pushUpdate({ state: "ready", version: i.version }));
  autoUpdater.on("error", (e) => pushUpdate({ state: "error", message: String(e?.message ?? e) }));
  void autoUpdater.checkForUpdates().catch((e: unknown) => pushUpdate({ state: "error", message: String(e) }));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function readCredits(): string {
  const candidates = [join(app.getAppPath(), "CREDITS.md"), join(process.resourcesPath ?? "", "CREDITS.md"), join(__dirname, "..", "..", "CREDITS.md")];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  return "CREDITS.md not found.";
}

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    version: app.getVersion(), platform: process.platform, arch: process.arch,
    electron: process.versions.electron, chrome: process.versions.chrome,
    packaged: app.isPackaged, userData, steam: steamEnabled(), testMode: TEST_MODE,
  }));
  ipcMain.handle(IPC.getSettings, () => settings);
  ipcMain.handle(IPC.setSettings, (_e, raw: unknown) => {
    const parsed = SettingsSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn(`rejected settings: ${parsed.error.message}`);
      return settings;
    }
    settings = parsed.data;
    saveSettings(settings);
    return settings;
  });
  ipcMain.handle(IPC.getDisplays, () => displayList());
  ipcMain.handle(IPC.applyDisplay, () => {
    if (gameWin) applyDisplay(gameWin);
  });
  ipcMain.handle(IPC.play, () => createGame());
  ipcMain.handle(IPC.openLauncher, () => {
    createLauncher();
    gameWin?.close();
  });
  ipcMain.handle(IPC.quit, () => app.quit());
  ipcMain.handle(IPC.openLogs, async () => {
    mkdirSync(logDir, { recursive: true });
    if (!TEST_MODE) await shell.openPath(logDir);
  });
  ipcMain.handle(IPC.getCredits, () => readCredits());
  ipcMain.handle(IPC.readSave, (_e, slot: unknown) => {
    if (typeof slot !== "string" || !SAVE_SLOT_RE.test(slot)) return null;
    const f = join(saveDir, `${slot}.json`);
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  });
  ipcMain.handle(IPC.writeSave, (_e, slot: unknown, json: unknown) => {
    if (typeof slot !== "string" || !SAVE_SLOT_RE.test(slot) || typeof json !== "string" || json.length > 8_000_000) return false;
    try {
      JSON.parse(json);
      mkdirSync(saveDir, { recursive: true });
      atomicWrite(join(saveDir, `${slot}.json`), json);
      return true;
    } catch (e) {
      log.warn(`save ${slot} failed: ${String(e)}`);
      return false;
    }
  });
  ipcMain.handle(IPC.deleteSave, (_e, slot: unknown) => {
    if (typeof slot !== "string" || !SAVE_SLOT_RE.test(slot)) return false;
    const f = join(saveDir, `${slot}.json`);
    if (existsSync(f)) unlinkSync(f);
    return true;
  });
  ipcMain.handle(IPC.screenshot, (_e, b64: unknown) => {
    if (typeof b64 !== "string" || b64.length > 40_000_000) return "";
    mkdirSync(shotDir, { recursive: true });
    const f = join(shotDir, `rfr-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    writeFileSync(f, Buffer.from(b64, "base64"));
    log.info(`screenshot ${f}`);
    return f;
  });
  ipcMain.on(IPC.log, (_e, level: unknown, msg: unknown) => {
    const l = level === "error" || level === "warn" ? level : "info";
    log.write(l, `[renderer] ${String(msg).slice(0, 4000)}`);
  });
  ipcMain.handle(IPC.checkForUpdates, async () => {
    if (!updatesSupported()) await autoUpdater.checkForUpdates().catch(() => undefined);
    return updateStatus;
  });
  ipcMain.handle(IPC.installUpdate, () => {
    if (updateStatus.state === "ready") autoUpdater.quitAndInstall();
  });
  ipcMain.handle(IPC.steamAchievement, (_e, id: unknown) => typeof id === "string" && unlockAchievement(id));
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
const gotLock = TEST_MODE || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => (gameWin ?? launcherWin)?.focus());
  app.on("child-process-gone", (_e, details) => {
    if (details.reason !== "clean-exit") {
      const f = writeCrashReport(crashDir, `child-${details.type}`, details);
      log.error(`child process ${details.type} gone (${details.reason}); report ${f}`);
    }
  });
  app.on("window-all-closed", () => app.quit());
  void app.whenReady().then(() => {
    log.info(`start v${app.getVersion()} ${process.platform}/${process.arch} electron ${process.versions.electron} test=${TEST_MODE}`);
    initSteam(log, hasFlag("--steam") || process.env.RFR_STEAM === "1" || settings.steam.enabled);
    registerIpc();
    const forceLauncher = hasFlag("--launcher");
    const forceGame = hasFlag("--skip-launcher");
    if (forceGame || (settings.launcher.skip && !forceLauncher)) createGame();
    else createLauncher();
    setupUpdater();
  });
}
