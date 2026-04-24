/**
 * appStateChecker.ts
 *
 * Determines whether a game can be launched immediately (bypassing the
 * detail page), or whether the user needs to see the detail page first
 * (e.g. because the game is not installed and needs to be downloaded).
 *
 * Edge cases handled
 * ------------------
 *
 *  NOT_INSTALLED
 *    The game has never been downloaded or was uninstalled.  Bypassing and
 *    calling RunGame would silently fail or open an unexpected dialog.
 *    Decision: abort bypass → let the detail page show so the user can click
 *    Install.
 *
 *  ALREADY_RUNNING
 *    A session for this game is already active.  RunGame will resume /
 *    bring the game to focus rather than launching a second instance.
 *    Decision: allow bypass → navigate back and let RunGame resume the session.
 *
 *  UPDATE_REQUIRED
 *    An update is pending.  Steam queues the update then launches the game
 *    automatically once done; the RunGame call itself is valid.
 *    Decision: allow bypass → Steam handles the update flow.
 *
 *  MULTIPLE_LAUNCH_OPTIONS
 *    Some games (e.g. GTA V, Age of Empires II) present a launcher dialog
 *    that asks which executable / mode to start.  We cannot reliably detect
 *    this case without Steam's internal launch-option API, so we fall through
 *    and let Steam show the picker dialog (it will appear over the library
 *    after we navigate back, which is acceptable UX).
 *    Decision: allow bypass (treated as LAUNCHABLE / UNKNOWN).
 *
 *  UNKNOWN
 *    We could not determine app state (e.g. appStore not yet ready).
 *    Decision: allow bypass optimistically – Steam will show appropriate UI
 *    if something is wrong.
 *
 * Running-apps tracker
 * --------------------
 * Call startRunningAppsTracker() in plugin onMount.
 * The returned cleanup function must be called in onDismount.
 * While the tracker is active, isAppRunning(appId) is O(1).
 */

// ------------------------------------------------------------------ //
// App launch state enum                                                //
// ------------------------------------------------------------------ //

export type AppLaunchState =
  | "launchable"       // installed, not running → full bypass
  | "already_running"  // running → bypass (RunGame resumes session)
  | "not_installed"    // not installed → abort bypass
  | "update_required"  // update pending → bypass (Steam handles update+launch)
  | "unknown";         // can't determine → bypass optimistically

// ------------------------------------------------------------------ //
// Running-apps tracker                                                 //
// ------------------------------------------------------------------ //

/** Set of appIds with an active game session on this device. */
const _runningApps = new Set<number>();

/**
 * Start listening to Steam's app-lifetime events to keep _runningApps
 * up to date.  Must be called once from plugin onMount.
 *
 * @returns Cleanup function – call from plugin onDismount.
 */
export function startRunningAppsTracker(): () => void {
  try {
    const reg =
      window.SteamClient?.GameSessions?.RegisterForAppLifetimeNotifications(
        (data) => {
          if (data.bRunning) {
            _runningApps.add(data.unAppID);
          } else {
            _runningApps.delete(data.unAppID);
          }
          console.log(
            `[QuickLaunch] App ${data.unAppID} is now ${data.bRunning ? "running" : "stopped"}.`
          );
        }
      );

    if (!reg) {
      console.warn(
        "[QuickLaunch] RegisterForAppLifetimeNotifications unavailable – " +
          "running-apps tracking disabled."
      );
      return () => {};
    }

    console.log("[QuickLaunch] Running-apps tracker started.");
    return () => {
      reg.unregister();
      _runningApps.clear();
      console.log("[QuickLaunch] Running-apps tracker stopped.");
    };
  } catch (err) {
    console.error("[QuickLaunch] Failed to start running-apps tracker:", err);
    return () => {};
  }
}

/** Returns true if a game session is currently active for the given appId. */
export function isAppRunning(appId: number): boolean {
  return _runningApps.has(appId);
}

// ------------------------------------------------------------------ //
// Install-state detection                                              //
// ------------------------------------------------------------------ //

/**
 * Attempt to read installation state from Steam's global appStore.
 *
 * Returns:
 *   true   → installed
 *   false  → not installed
 *   null   → could not determine (appStore unavailable or app not found)
 */
function readInstallState(appId: number): boolean | null {
  try {
    const store = window.appStore;
    if (!store || typeof store.GetAppOverviewByAppID !== "function") {
      return null; // appStore not ready yet
    }

    const overview = store.GetAppOverviewByAppID(appId);
    if (!overview) return null;

    // per_client_data[0] is the local client's data.
    const clientData = overview.per_client_data?.[0];
    if (!clientData) return null;

    return clientData.installed === true;
  } catch (err) {
    console.warn("[QuickLaunch] readInstallState error:", err);
    return null;
  }
}

/**
 * Check whether an update is pending for the given app.
 * Returns false (not updatable) if the info isn't available.
 */
function readUpdateRequired(appId: number): boolean {
  try {
    const store = window.appStore;
    if (!store || typeof store.GetAppOverviewByAppID !== "function") return false;

    const overview = store.GetAppOverviewByAppID(appId);
    const clientData = overview?.per_client_data?.[0];
    return (clientData as unknown as Record<string, unknown>)?.["client_has_available_update"] === true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ //
// Public API                                                           //
// ------------------------------------------------------------------ //

/**
 * Determine the launch state for an app before the bypass is applied.
 *
 * @param appId  Numeric Steam app ID.
 * @returns      An AppLaunchState value indicating how to proceed.
 */
export function getAppLaunchState(appId: number): AppLaunchState {
  // 1. Already running? (fastest check – O(1) Set lookup)
  if (isAppRunning(appId)) {
    console.log(`[QuickLaunch] appId=${appId} is already running.`);
    return "already_running";
  }

  // 2. Check install state via appStore.
  const installed = readInstallState(appId);

  if (installed === false) {
    console.log(`[QuickLaunch] appId=${appId} is not installed.`);
    return "not_installed";
  }

  if (installed === null) {
    // appStore not ready – can't determine; proceed optimistically.
    console.log(
      `[QuickLaunch] appId=${appId} install state unknown – proceeding optimistically.`
    );
    return "unknown";
  }

  // 3. Update pending?
  if (readUpdateRequired(appId)) {
    console.log(`[QuickLaunch] appId=${appId} has a pending update.`);
    return "update_required";
  }

  return "launchable";
}
