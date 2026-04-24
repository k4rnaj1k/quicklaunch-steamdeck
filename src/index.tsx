/**
 * QuickLaunch – Decky Loader Plugin
 *
 * Launches games immediately when selected in the Steam Deck library,
 * bypassing the game detail / content preview page.
 *
 * Entry point: Decky calls the default export produced by definePlugin.
 */

import {
  ButtonItem,
  definePlugin,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import { callable, toaster } from "@decky/api";
import { VFC } from "react";
import { FaRocket } from "react-icons/fa";

import { registerLibraryPatch } from "./hooks/libraryPatch";
import { bypassAndLaunch } from "./launch/gameLauncher";
import {
  isEnabled,
  setEnabled,
  setGameSelectedListener,
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

const QuickLaunchQAM: VFC<{ onToggle: () => void }> = ({ onToggle }) => {
  // Read from module state directly so QAM always reflects the live value.
  const enabled = isEnabled();

  return (
    <PanelSection title="QuickLaunch">
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={onToggle}
          description={
            enabled
              ? "Selecting a game launches it immediately."
              : "Normal Steam behaviour restored."
          }
        >
          {enabled ? "Enabled – click to disable" : "Disabled – click to enable"}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
};

// ---------------------------------------------------------------------- //
// Plugin definition                                                        //
// ---------------------------------------------------------------------- //

export default definePlugin(() => {
  /** Cleanup functions collected during onMount; drained in onDismount. */
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
   * Fired by libraryPatch whenever the Steam router navigates to
   * /library/app/:appid (i.e. the user selects a game in the library).
   *
   * Immediately launches the game and navigates back to the library,
   * effectively bypassing the game detail / preview page entirely.
   *
   * Edge-case handling (Play / Continue prompts, uninstalled games, etc.)
   * will be layered on top of this in the next task.
   */
  function onGameSelected(appId: number): void {
    if (!isEnabled()) {
      console.log(
        `[QuickLaunch] Game ${appId} selected but plugin is disabled – passing through.`
      );
      return;
    }

    // Fire-and-forget: bypassAndLaunch is async (needs a tiny sleep before
    // navigating) but we intentionally don't await it here so the patch
    // callback returns immediately and doesn't block Steam's render pipeline.
    bypassAndLaunch(appId).catch((err) => {
      console.error(`[QuickLaunch] bypassAndLaunch failed for appId=${appId}:`, err);
    });
  }

  // ---------------------------------------------------------------- //
  // Toggle handler                                                     //
  // ---------------------------------------------------------------- //

  const handleToggle = async (): Promise<void> => {
    const next = !isEnabled();
    setEnabled(next);

    try {
      await saveSettings({ enabled: next });
      toaster.toast({
        title: "QuickLaunch",
        body: next ? "Quick-launch enabled." : "Quick-launch disabled.",
        icon: <FaRocket />,
      });
    } catch (err) {
      console.error("[QuickLaunch] Failed to save settings:", err);
    }
  };

  // ---------------------------------------------------------------- //
  // Plugin descriptor                                                  //
  // ---------------------------------------------------------------- //

  return {
    name: "QuickLaunch",
    title: <div className={staticClasses.Title}>QuickLaunch</div>,
    icon: <FaRocket />,

    // Keep the plugin mounted so the route patch stays active when the
    // QAM is closed.
    alwaysRender: true,

    content: <QuickLaunchQAM onToggle={handleToggle} />,

    onMount(): void {
      // 1. Register the library route patch – this is what detects game
      //    selection by intercepting /library/app/:appid navigation.
      const removeLibraryPatch = registerLibraryPatch();
      cleanupHooks.push(removeLibraryPatch);

      // 2. Wire our handler into the shared state so the patch can call it.
      setGameSelectedListener(onGameSelected);

      console.log(
        "[QuickLaunch] Plugin mounted – library route patch active."
      );
    },

    onDismount(): void {
      // Remove the game-selection listener first so no callbacks fire
      // during teardown.
      setGameSelectedListener(null);

      // Run all registered cleanup functions (route patches, etc.).
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
