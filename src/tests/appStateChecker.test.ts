/**
 * appStateChecker.test.ts
 *
 * Tests for getAppLaunchState() – the function that classifies a game
 * before the bypass fires, preventing launches of uninstalled games and
 * correctly handling already-running games and pending updates.
 *
 * window.SteamClient and window.appStore are mocked per test so the
 * module-level _runningApps Set can be exercised without a real Steam client.
 */

import { getAppLaunchState, startRunningAppsTracker } from "../launch/appStateChecker";

// ------------------------------------------------------------------ //
// Helpers                                                              //
// ------------------------------------------------------------------ //

/** Build a minimal window.appStore mock for a given app state. */
function makeAppStore(opts: {
  appId: number;
  installed: boolean;
  hasUpdate?: boolean;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
  return {
    GetAppOverviewByAppID: (id: number) => {
      if (id !== opts.appId) return null;
      return {
        appid: opts.appId,
        display_name: "Test Game",
        per_client_data: [
          {
            installed: opts.installed,
            client_has_available_update: opts.hasUpdate ?? false,
          },
        ],
      };
    },
  };
}

/** Build a minimal SteamClient.GameSessions mock. */
function makeGameSessions(
  registerImpl: (cb: (data: { unAppID: number; bRunning: boolean }) => void) => {
    unregister(): void;
  }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return { RegisterForAppLifetimeNotifications: registerImpl };
}

// ------------------------------------------------------------------ //
// beforeEach: reset mocks                                              //
// ------------------------------------------------------------------ //

beforeEach(() => {
  // Remove any existing mocks so tests are isolated.
  (window as unknown as Record<string, unknown>).appStore = undefined;
  (window as unknown as Record<string, unknown>).SteamClient = {
    Apps: {},
    GameSessions: {
      RegisterForAppLifetimeNotifications: jest.fn(() => ({ unregister: jest.fn() })),
    },
    System: {},
  };
});

// ------------------------------------------------------------------ //
// appStore unavailable → unknown                                       //
// ------------------------------------------------------------------ //

describe("getAppLaunchState – appStore unavailable", () => {
  it("returns 'unknown' when window.appStore is undefined", () => {
    (window as unknown as Record<string, unknown>).appStore = undefined;
    expect(getAppLaunchState(440)).toBe("unknown");
  });

  it("returns 'unknown' when GetAppOverviewByAppID returns null", () => {
    (window as unknown as Record<string, unknown>).appStore = {
      GetAppOverviewByAppID: () => null,
    };
    expect(getAppLaunchState(440)).toBe("unknown");
  });

  it("returns 'unknown' when per_client_data is empty", () => {
    (window as unknown as Record<string, unknown>).appStore = {
      GetAppOverviewByAppID: () => ({ appid: 440, display_name: "TF2", per_client_data: [] }),
    };
    expect(getAppLaunchState(440)).toBe("unknown");
  });
});

// ------------------------------------------------------------------ //
// Installed games → launchable                                         //
// ------------------------------------------------------------------ //

describe("getAppLaunchState – installed games", () => {
  it("returns 'launchable' for a native Linux game (TF2 = 440)", () => {
    (window as unknown as Record<string, unknown>).appStore = makeAppStore({ appId: 440, installed: true });
    expect(getAppLaunchState(440)).toBe("launchable");
  });

  it("returns 'launchable' for a Proton game (Cyberpunk = 1091500)", () => {
    (window as unknown as Record<string, unknown>).appStore = makeAppStore({ appId: 1091500, installed: true });
    expect(getAppLaunchState(1091500)).toBe("launchable");
  });

  it("returns 'launchable' for a non-Steam shortcut (high appId)", () => {
    const shortcutId = 0x80000000 + 42;
    (window as unknown as Record<string, unknown>).appStore = makeAppStore({ appId: shortcutId, installed: true });
    expect(getAppLaunchState(shortcutId)).toBe("launchable");
  });
});

// ------------------------------------------------------------------ //
// Not installed → not_installed                                        //
// ------------------------------------------------------------------ //

describe("getAppLaunchState – not installed", () => {
  it("returns 'not_installed' for an uninstalled Steam game", () => {
    (window as unknown as Record<string, unknown>).appStore = makeAppStore({ appId: 730, installed: false });
    expect(getAppLaunchState(730)).toBe("not_installed");
  });

  it("returns 'not_installed' for an uninstalled Proton game", () => {
    (window as unknown as Record<string, unknown>).appStore = makeAppStore({ appId: 1245620, installed: false });
    expect(getAppLaunchState(1245620)).toBe("not_installed");
  });
});

// ------------------------------------------------------------------ //
// Already running → already_running                                    //
// ------------------------------------------------------------------ //

describe("getAppLaunchState – already running", () => {
  it("returns 'already_running' for a game with an active session", async () => {
    // Capture the callback registered by startRunningAppsTracker.
    let lifetimeCallback: ((data: { unAppID: number; bRunning: boolean }) => void) | null = null;

    (window as unknown as Record<string, unknown>).SteamClient = {
      Apps: {},
      GameSessions: makeGameSessions((cb) => {
        lifetimeCallback = cb;
        return { unregister: jest.fn() };
      }),
      System: {},
    };
    (window as unknown as Record<string, unknown>).appStore = makeAppStore({ appId: 440, installed: true });

    const stop = startRunningAppsTracker();

    // Simulate the game starting.
    lifetimeCallback!({ unAppID: 440, bRunning: true });

    expect(getAppLaunchState(440)).toBe("already_running");

    // Simulate the game stopping.
    lifetimeCallback!({ unAppID: 440, bRunning: false });
    expect(getAppLaunchState(440)).toBe("launchable");

    stop();
  });
});

// ------------------------------------------------------------------ //
// Update required → update_required                                    //
// ------------------------------------------------------------------ //

describe("getAppLaunchState – update required", () => {
  it("returns 'update_required' when a game has a pending update", () => {
    (window as unknown as Record<string, unknown>).appStore = makeAppStore({
      appId: 570,
      installed: true,
      hasUpdate: true,
    });
    expect(getAppLaunchState(570)).toBe("update_required");
  });

  it("returns 'launchable' when update flag is false", () => {
    (window as unknown as Record<string, unknown>).appStore = makeAppStore({
      appId: 570,
      installed: true,
      hasUpdate: false,
    });
    expect(getAppLaunchState(570)).toBe("launchable");
  });
});

// ------------------------------------------------------------------ //
// already_running takes priority over not_installed                   //
// ------------------------------------------------------------------ //

describe("getAppLaunchState – priority order", () => {
  it("already_running is checked before install state", async () => {
    let lifetimeCallback: ((data: { unAppID: number; bRunning: boolean }) => void) | null = null;

    (window as unknown as Record<string, unknown>).SteamClient = {
      Apps: {},
      GameSessions: makeGameSessions((cb) => {
        lifetimeCallback = cb;
        return { unregister: jest.fn() };
      }),
      System: {},
    };
    // Report as not installed, but also mark as running.
    (window as unknown as Record<string, unknown>).appStore = makeAppStore({ appId: 440, installed: false });

    const stop = startRunningAppsTracker();
    lifetimeCallback!({ unAppID: 440, bRunning: true });

    // already_running wins over not_installed.
    expect(getAppLaunchState(440)).toBe("already_running");

    stop();
  });
});
