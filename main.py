"""
QuickLaunch – Decky Loader Plugin Backend
Provides helper methods callable from the frontend via @decky/api.
"""

import json
import os
from typing import Any

import decky  # type: ignore  # provided by Decky Loader at runtime

# ------------------------------------------------------------------ #
# Settings file                                                        #
# ------------------------------------------------------------------ #

# Decky manages DECKY_PLUGIN_SETTINGS_DIR and creates it automatically.
_SETTINGS_FILE = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")

# Default values returned when no settings file exists yet.
_DEFAULTS: dict[str, Any] = {
    "enabled": True,
}


def _read_settings() -> dict[str, Any]:
    """Read settings from disk, returning defaults on any error."""
    try:
        with open(_SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("settings file did not contain a JSON object")
        # Merge with defaults so new keys added in future versions are present.
        return {**_DEFAULTS, **data}
    except FileNotFoundError:
        decky.logger.info("QuickLaunch: no settings file found – using defaults.")
        return dict(_DEFAULTS)
    except Exception as exc:  # noqa: BLE001
        decky.logger.warning(f"QuickLaunch: failed to read settings ({exc}) – using defaults.")
        return dict(_DEFAULTS)


def _write_settings(data: dict[str, Any]) -> None:
    """
    Write settings to disk atomically.

    Writes to a .tmp file first, then renames to the real path so a crash
    or power-loss during the write can never leave a corrupt settings file.
    """
    tmp_path = _SETTINGS_FILE + ".tmp"
    os.makedirs(os.path.dirname(_SETTINGS_FILE), exist_ok=True)
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp_path, _SETTINGS_FILE)


# ------------------------------------------------------------------ #
# Plugin class                                                         #
# ------------------------------------------------------------------ #

class Plugin:
    # ---------------------------------------------------------------- #
    # Lifecycle hooks (called by Decky Loader)                         #
    # ---------------------------------------------------------------- #

    async def _main(self) -> None:
        """Entry point – called once when the plugin is loaded."""
        decky.logger.info("QuickLaunch plugin started.")
        decky.logger.info(f"QuickLaunch settings file: {_SETTINGS_FILE}")

    async def _unload(self) -> None:
        """Called when the plugin is unloaded / Decky shuts down."""
        decky.logger.info("QuickLaunch plugin unloaded.")

    async def _migration(self) -> None:
        """
        Called on first load after an update to migrate old settings/data.
        Moves any legacy settings file to the Decky-managed directory.
        """
        decky.logger.info("QuickLaunch running migration check.")
        decky.migrate_settings(
            os.path.join(decky.DECKY_HOME, "settings", "quicklaunch.json")
        )

    # ---------------------------------------------------------------- #
    # Public methods (callable from the frontend via call / callable)  #
    # ---------------------------------------------------------------- #

    async def get_settings(self) -> dict[str, Any]:
        """
        Return the plugin's persisted settings.

        Always succeeds: returns defaults when no file exists yet.
        Called by the frontend on plugin startup to restore the last state.
        """
        settings = _read_settings()
        decky.logger.info(f"QuickLaunch get_settings → {settings}")
        return settings

    async def save_settings(self, settings: dict[str, Any]) -> bool:
        """
        Persist the plugin's settings to disk.

        The frontend passes the full settings dict; we validate the types of
        known keys before writing so corrupt data can never reach the file.

        Returns True on success, False on failure (frontend shows no toast
        on failure – the rollback in index.tsx handles UX recovery).
        """
        try:
            # Validate and sanitise known fields.
            clean: dict[str, Any] = dict(_DEFAULTS)  # start from defaults
            if "enabled" in settings:
                clean["enabled"] = bool(settings["enabled"])
            # Future settings keys can be added here.

            _write_settings(clean)
            decky.logger.info(f"QuickLaunch save_settings ← {clean}")
            return True
        except Exception as exc:  # noqa: BLE001
            decky.logger.error(f"QuickLaunch: save_settings failed: {exc}")
            return False

    async def log_info(self, message: str) -> None:
        """Forward log messages emitted by the frontend."""
        decky.logger.info(f"[frontend] {message}")
