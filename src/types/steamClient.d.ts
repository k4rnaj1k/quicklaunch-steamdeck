/**
 * steamClient.d.ts
 *
 * Ambient type declarations for the global window.SteamClient object that
 * Valve injects into Steam's CEF (Chromium Embedded Framework) pages, and
 * for the global window.appStore that the Steam UI uses internally.
 *
 * This is NOT an exhaustive API surface – only the methods used by
 * QuickLaunch are declared here.  The real object has many more members.
 * Types are inferred from community reverse-engineering and plugin examples.
 */

// ------------------------------------------------------------------ //
// SteamClient                                                          //
// ------------------------------------------------------------------ //

interface SteamClientApps {
  /**
   * Launches a game by its Steam appId.
   *
   * @param appId      Numeric app ID (as a string – Steam accepts both, but
   *                   string is safer across SteamOS versions).
   * @param launchOpts Additional launch options string (pass "" for defaults).
   * @param launchType Launch type flag.
   *                     -1 = default / auto
   *                      0 = none
   *                    100 = normal Steam game
   *                    104 = non-Steam shortcut
   * @param _unknown   Internal Steam parameter – pass 100 to match the
   *                   value the Steam UI itself uses for normal launches.
   */
  RunGame(
    appId: string,
    launchOpts: string,
    launchType: number,
    _unknown: number
  ): void;

  /**
   * Terminates a running game.
   * @param appId Numeric app ID (string form).
   */
  TerminateApp(appId: string, unknown?: boolean): void;

  /**
   * Removes a non-Steam game shortcut.
   * @param appId Numeric app ID of the shortcut.
   */
  RemoveShortcut(appId: number): void;

  /**
   * Returns basic info about all known apps.
   * Shape is partial – only fields relevant to QuickLaunch are listed.
   */
  GetAllApps(): Promise<{ appid: number; display_name: string }[]>;
}

interface SteamClientGameSessions {
  /**
   * Register a callback that fires whenever an app starts or stops.
   * @returns An object with an `unregister()` method.
   */
  RegisterForAppLifetimeNotifications(
    callback: (data: { unAppID: number; bRunning: boolean }) => void
  ): { unregister(): void };
}

interface SteamClientSystem {
  RegisterForOnSuspendRequest(callback: () => void): { unregister(): void };
  RegisterForOnResumeFromSuspend(callback: () => void): { unregister(): void };
}

interface SteamClientType {
  Apps: SteamClientApps;
  GameSessions: SteamClientGameSessions;
  System: SteamClientSystem;
}

// ------------------------------------------------------------------ //
// Steam global appStore (React context exposed on window)             //
// ------------------------------------------------------------------ //

/**
 * Per-client data attached to each app overview.
 * The `installed` field is the most relevant for QuickLaunch.
 * Other fields exist but are not typed here.
 */
interface SteamAppPerClientData {
  /** True when the app is installed on the local device. */
  installed: boolean;
  /** True when an update is queued or downloading. */
  client_has_available_update?: boolean;
}

/**
 * Minimal shape of the app overview object returned by appStore.
 * Field names follow Valve's own naming conventions (snake_case / m_ prefix).
 * Only fields used by QuickLaunch are declared; the real object is much larger.
 */
interface SteamAppOverview {
  /** Numeric app ID. */
  appid: number;
  /** Human-readable display name. */
  display_name: string;
  /**
   * Per-client installation data.  Always an array; index 0 is the local
   * client.  May be empty if the client data hasn't loaded yet.
   */
  per_client_data: SteamAppPerClientData[];
}

/**
 * Partial type for Steam's internal app store, which is exposed on
 * window as `appStore` in the CEF game-mode UI.
 */
interface SteamAppStore {
  /**
   * Returns the app overview for the given appId, or null/undefined if
   * the app isn't in the store yet (e.g. during initial load).
   */
  GetAppOverviewByAppID(appId: number): SteamAppOverview | null | undefined;
}

// ------------------------------------------------------------------ //
// Global augmentations                                                 //
// ------------------------------------------------------------------ //

declare global {
  interface Window {
    /** Valve's privileged Steam client API, available in CEF pages. */
    SteamClient: SteamClientType;

    /**
     * Steam's internal React app store, exposed as a window global.
     * May be undefined during plugin startup before the UI has fully loaded.
     */
    appStore?: SteamAppStore;
  }
}

export {};
