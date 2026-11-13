import type { Logger } from "./logger";

interface SteamClient {
  achievement: { activate(name: string): boolean };
}
interface SteamworksModule {
  init(appId?: number): SteamClient;
  electronEnableSteamOverlay(disableEachFrameInvalidation?: boolean): void;
}

let client: SteamClient | null = null;

/**
 * Steamworks is optional and behind a flag (--steam, RFR_STEAM=1 or settings.steam.enabled).
 * Remote Play Together needs nothing beyond the overlay; Steam streams the window and
 * forwards remote players' controllers as local gamepads, which the Gamepad API already reads.
 */
export function initSteam(log: Logger, enabled: boolean): boolean {
  if (!enabled) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const steamworks = require("steamworks.js") as SteamworksModule;
    const appId = Number(process.env.RFR_STEAM_APP_ID ?? "480");
    client = steamworks.init(appId);
    steamworks.electronEnableSteamOverlay();
    log.info(`steam: initialised with app id ${appId}`);
    return true;
  } catch (e) {
    log.warn(`steam: unavailable (${String(e)})`);
    client = null;
    return false;
  }
}

export function steamEnabled(): boolean {
  return client !== null;
}

export function unlockAchievement(id: string): boolean {
  if (!client) return false;
  try {
    return client.achievement.activate(id);
  } catch {
    return false;
  }
}
