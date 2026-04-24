# QuickLaunch – Test Plan

This document covers both the automated unit tests (run in CI / locally via
`npm test`) and the manual on-device test scenarios that must be verified on
a real Steam Deck before each release.

---

## 1. Automated Unit Tests

```bash
npm test          # run all tests + coverage report
npm run test:watch  # watch mode during development
```

The test suites live under `src/tests/` and cover the pure logic modules
that do not depend on browser-only Decky / Steam CEF globals:

| Suite | Module under test | What is tested |
|---|---|---|
| `routeUtils.test.ts` | `src/utils/routeUtils.ts` | `extractAppId` across all three router arg shapes, all game-type appId ranges, invalid/boundary inputs |
| `launchUtils.test.ts` | `src/utils/launchUtils.ts` | `isNonSteamShortcut` and `launchTypeFor` for native Linux, Proton, and non-Steam shortcut appIds |
| `appStateChecker.test.ts` | `src/launch/appStateChecker.ts` | `getAppLaunchState` with mocked `window.appStore` and `SteamClient.GameSessions`; covers launchable, not_installed, already_running, update_required, unknown states |

---

## 2. Manual Device Test Matrix

Perform these tests on a Steam Deck running Decky Loader with the plugin
installed (`npm run build` → copy `dist/` + `plugin.json` + `main.py` to
`~/homebrew/plugins/QuickLaunch/`).

### 2.1 Game Type Matrix

| # | Game type | Example | Expected behaviour |
|---|---|---|---|
| T1 | **Native Linux – installed** | Team Fortress 2 (440) | Game launches immediately; detail page never fully visible |
| T2 | **Native Linux – not installed** | Any uninstalled Valve game | Toast "not installed"; detail page stays for the user to install |
| T3 | **Proton – installed** | Cyberpunk 2077 / Elden Ring | Game launches immediately via Proton; detail page bypassed |
| T4 | **Proton – not installed** | Any uninstalled Proton title | Toast "not installed"; detail page stays |
| T5 | **Non-Steam shortcut – installed** | Heroic / Lutris shortcut | Game/launcher launches; launchType=104 used |
| T6 | **Non-Steam shortcut – not installed** | Removed shortcut stub | Toast "not installed" |
| T7 | **Game already running** | Start any game, alt-tab to library, select it again | Toast "Resuming"; focus returns to running game |
| T8 | **Update required** | Let a game sit unupdated | Toast "Update pending"; Steam queues update then launches |
| T9 | **Multiple launch options** | GTA V / Age of Empires II DE | Launcher dialog appears over /library (acceptable) |
| T10 | **Plugin disabled** | Toggle off in QAM, select any game | Detail page appears normally; no auto-launch |

### 2.2 Toggle Persistence

| # | Scenario | Expected behaviour |
|---|---|---|
| P1 | Disable plugin, close Steam, reopen | Plugin remains disabled after restart |
| P2 | Enable plugin, close Steam, reopen | Plugin remains enabled after restart |
| P3 | Rapid toggle (5× in 1 second) | Final state persists correctly; no crash |

### 2.3 Debounce Guard

| # | Scenario | Expected behaviour |
|---|---|---|
| D1 | Select the same game twice within 500 ms | Game launched exactly once |
| D2 | Select two different games in quick succession | Only the first triggers a launch |

### 2.4 Edge Cases

| # | Scenario | Expected behaviour |
|---|---|---|
| E1 | Decky loader disabled mid-session | Plugin unloads cleanly; route patch removed |
| E2 | SteamOS update changes router arg shape | `extractAppId` logs warning; detail page visible as fallback |
| E3 | `appStore` not ready at plugin startup | `getAppLaunchState` returns `unknown`; launch proceeds optimistically |
| E4 | Backend save fails (disk full) | Toggle snaps back; no settings corruption |

---

## 3. Pass Criteria

A build is considered **release-ready** when:

1. `npm test` passes with 0 failures.
2. All T1–T10 scenarios pass on device.
3. P1–P3, D1–D2, E1–E4 pass on device.
4. No unhandled JavaScript errors appear in the CEF console
   (`chrome://inspect` → SharedJSContext) during any test scenario.

---

## 4. How to Open the CEF Console

1. Connect the Steam Deck to a desktop browser via USB or same Wi-Fi.
2. Navigate to `chrome://inspect/#devices` and click **Inspect** on
   **SharedJSContext** under the Steam Deck entry.
3. Open the **Console** tab.  QuickLaunch log lines are prefixed with
   `[QuickLaunch]`.
