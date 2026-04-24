/**
 * steamClient.d.ts
 *
 * Ambient type declarations for the global window.SteamClient object that
 * Valve injects into Steam's CEF (Chromium Embedded Framework) pages.
 *
 * This is NOT an exhaustive API surface – only the methods used by
 * QuickLaunch are declared here.  The real object has many more members.
 * Types are inferred from community reverse-engineering and plugin examples.
 */

interface SteamClientApps {
  /**
   * Launches a game by its Steam appId.
   *
   * @param appId      Numeric app ID (as a string or number – Steam accepts
   *                   both, but string is safer across SteamOS versions).
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
   * @param appId Numeric app ID.
   */
  TerminateApp(appId: string, unknown?: boolean): void;

  /**
   * Removes a non-Steam game shortcut.
   * @param appId Numeric app ID of the shortcut.
   */
  RemoveShortcut(appId: number): void;

  /**
   * Returns basic info about an installed app.
   * Shape is incomplete – extend as needed.
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

declare global {
  interface Window {
    /** Valve's privileged Steam client API, available in CEF pages. */
    SteamClient: SteamClientType;
  }
}

export {};
