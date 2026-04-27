/**
 * QuickLaunch – Decky Loader Plugin
 *
 * Launches games immediately when selected in the Steam Deck library,
 * bypassing the game detail / content preview page.
 *
 * Entry point: Decky calls the default export produced by definePlugin.
 */

import {
  definePlugin,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  staticClasses,
} from "@decky/ui";
import { callable, toaster } from "@decky/api";
import React, { useEffect, useState, VFC } from "react";
import { FaRocket } from "react-icons/fa";

import { registerLibraryPatch } from "./hooks/libraryPatch";
import { prepareBypass, bypassAndLaunch } from "./launch/gameLauncher";
import { startRunningAppsTracker } from "./launch/appStateChecker";
import {
  isEnabled,
  setEnabled,
  setGameSelectedListener,
  subscribeToEnabled,
} from "./state/pluginState";

// ---------------------------------------------------------------------- //
// Backend callables                                                        //
// ---------------------------------------------------------------------- //

/** Fetch persisted settings from the Python backend. */
const getSettings = callable<[], { enabled: boolean }>("get_settings");

/** Save settings to the Python backend. */
const saveSettings = callable<[{ enabled: boolean }], boolean>("save_settings");

// ---------------------------------------------------------------------- //
// Quick Access Menu (QAM) content component                               //
// ---------------------------------------------------------------------- //

/**
 * QuickLaunchQAM
 *
 * Renders a single ToggleField that shows and controls whether quick-launch
 * is active.  Local React state (`enabled`) is initialised from the module
 * state and stays in sync via `subscribeToEnabled`, so async events such as
 * the initial settings load from the Python backend are reflected
 * automatically without any prop-drilling or context provider.
 */
const QuickLaunchQAM: VFC<{
  onToggle: (next: boolean) => Promise<void>;
}> = ({ onToggle }) => {
  const [enabled, setLocalEnabled] = useState<boolean>(isEnabled());

  // Keep local React state in sync with the module state.
  // subscribeToEnabled returns an unsubscribe function used as cleanup.
  useEffect(() => subscribeToEnabled(setLocalEnabled), []);

  return (
    <PanelSection title="QuickLaunch">
      <PanelSectionRow>
        <ToggleField
          label="Quick Launch"
          description={
            enabled
              ? "Selecting a game launches it immediately."
              : "Normal Steam behaviour restored."
          }
          checked={enabled}
          onChange={onToggle}
        />
      </PanelSectionRow>
    </PanelSection>
  );
};

// ---------------------------------------------------------------------- //
// Plugin definition                                                        //
// ---------------------------------------------------------------------- //

export default definePlugin(() => {
  /** Cleanup functions drained in onDismount. */
  let cleanupHooks: Array<() => void> = [];

  // ---------------------------------------------------------------- //
  // Load persisted settings on startup                                //
  // ---------------------------------------------------------------- //
  (async () => {
    try {
      const settings = await getSettings();
      setEnabled(settings.enabled ?? true);
    } catch (err) {
      console.error("[QuickLaunch] Failed to load settings:", err);
    }
  })();

  // ---------------------------------------------------------------- //
  // Game-selection handler                                             //
  // ---------------------------------------------------------------- //

  /**
   * Fired by libraryPatch whenever the Steam router navigates to a
   * game detail page (or, on builds where Strategies 0 / 0b succeed,
   * before the navigation commits at all).
   *
   * Called synchronously from within the push-intercept patch or
   * Strategy 2's `useLayoutEffect`, so everything before the first
   * `await` runs in the same call-stack as the navigation event –
   * `RunGame` is issued before the next browser paint.
   *
   * Step 1 – prepareBypass() [synchronous]:
   *   Checks install state and shows any needed toast.
   *
   * Step 2 – bypassAndLaunch() [async, fire-and-forget]:
   *   Issues the RunGame command (with a 200 ms retry if SteamClient
   *   was not yet ready).  Steam's launch animation then replaces
   *   the overview / library on its own – no NavigateBack required.
   *
   * @returns true if bypass was applied, false if aborted.
   */
  function onGameSelected(appId: number): boolean {
    if (!isEnabled()) {
      console.log(
        `[QuickLaunch] Game ${appId} selected but plugin is disabled – passing through.`
      );
      return false;
    }

    // Step 1: synchronous — state-check, toast.
    const shouldLaunch = prepareBypass(appId);
    if (!shouldLaunch) return false;

    // Step 2: async — RunGame with retry.
    bypassAndLaunch(appId).catch((err) => {
      console.error(`[QuickLaunch] bypassAndLaunch failed for appId=${appId}:`, err);
    });
    return true;
  }

  // ---------------------------------------------------------------- //
  // Toggle handler                                                     //
  // ---------------------------------------------------------------- //

  const handleToggle = async (next: boolean): Promise<void> => {
    setEnabled(next);

    try {
      await saveSettings({ enabled: next });
    } catch (err) {
      console.error("[QuickLaunch] Failed to save settings:", err);
      setEnabled(!next);
    }

    toaster.toast({
      title: "QuickLaunch",
      body: next ? "Quick-launch enabled." : "Quick-launch disabled.",
      icon: <FaRocket />,
      duration: 2000,
    });
  };

  // ---------------------------------------------------------------- //
  // Initialise immediately – do NOT wait for onMount                  //
  //                                                                   //
  // onMount fires only when the QAM panel component mounts, which may //
  // be AFTER the user has already pressed A on a game.  Registering   //
  // hooks here (in the factory body) guarantees they are active from  //
  // the moment the plugin IIFE executes.                              //
  // ---------------------------------------------------------------- //

  // Wire the game-selection listener so notifyGameSelected() can reach us.
  setGameSelectedListener(onGameSelected);

  // Start the running-apps tracker (O(1) isAppRunning() lookups).
  const stopTracker = startRunningAppsTracker();
  cleanupHooks.push(stopTracker);

  // Register route patch + history listener for game-page detection.
  const removeLibraryPatch = registerLibraryPatch();
  cleanupHooks.push(removeLibraryPatch);

  console.log("[QuickLaunch] Plugin initialised – hooks active.");

  // ---------------------------------------------------------------- //
  // Plugin descriptor                                                  //
  // ---------------------------------------------------------------- //

  return {
    name: "QuickLaunch",
    title: <div className={staticClasses.Title}>QuickLaunch</div>,
    icon: <FaRocket />,

    // alwaysRender keeps the QAM content mounted so subscribeToEnabled
    // stays active across QAM open/close cycles.
    alwaysRender: true,

    content: <QuickLaunchQAM onToggle={handleToggle} />,

    onDismount(): void {
      setGameSelectedListener(null);

      for (const cleanup of cleanupHooks) {
        try {
          cleanup();
        } catch (err) {
          console.error("[QuickLaunch] Error during hook cleanup:", err);
        }
      }
      cleanupHooks = [];

      console.log("[QuickLaunch] Plugin dismounted – all hooks cleaned up.");
    },
  };
});
