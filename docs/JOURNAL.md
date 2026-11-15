# Project Journal

- `last_updated`: `2026-11-15T22:56:38Z`
- `scope`: `simple-poe-check` (Electron + Vue 3 Path of Exile price checker, stash tracker, farm profit analyzer, and bulk listing overlay)
- `owner`: project maintainers

## Current State
- **2026-11-15** | Overlay app (`Ctrl+Space`, hidden on startup via `show: false`) and cursor price-check (`Ctrl+D`) are integrated in `src/main/overlay.ts`, `src/main/hotkeys.ts`, and `src/renderer/App.vue` | `verified-earlier` | `npm test` (11/11) and `npm run build` passed on commit `69bc55a`.
- **2026-11-15** | Stash scanning uses `character-window/get-stash-items` via `PoeApiClient` (`PolicyRateLimiter`) and prices items locally against `poe.ninja` categories without hitting Trade API | `verified-earlier` | `npm run build` passed; live GGG stash API response not yet tested in runtime.
- **2026-11-15** | Snapshots, farm-session `chaos/hr` & `div/hr` diffs, and bulk aggregation are implemented in `src/shared/stashValuation.ts` and persisted locally in `userData/stash-snapshots.json` (max 100) | `verified-earlier` | Unit-tested in `tests/stashValuation.test.ts`.
- **2026-11-15** | Stash auth (`POESESSID`), `/api/profile` account resolution, and `character-window/get-stash-items` tab listing verified working live in Path of Exile overlay | `verified-this-turn` | User screenshot confirmed account resolution and colored tab list.
- **2026-11-15** | Fixed `An object could not be cloned.` on `Take Snapshot` / `Save Config` by stripping Vue 3 reactive Proxies via `JSON.parse(JSON.stringify(...))` in `src/main/preload.ts` | `verified-this-turn` | `npm test` (11/11) and `npm run build` passed.

## Active Decisions
- **2026-11-15** | **POESESSID over OAuth 2.1 for now** | GGG OAuth registration requires manual approval (`oauth@grindinggear.com`) and user prefers not to scaffold OAuth yet | `verified-earlier` | Next review: if GGG restricts `character-window` or user registers an OAuth client.
- **2026-11-15** | **System browser login + manual POESESSID paste** | External browsers isolate `HttpOnly` cookies; opening system browser avoids in-app login window while keeping cookie entry one step | `verified-earlier` | Revisit only if OAuth PKCE is adopted.
- **2026-11-15** | **Brand palette + system font fallback** | Applied `#141413` / `#faf9f5` / `#d97757` / `#6799E2` / `#87A26A` in `src/renderer/style.css`; `Science Gothic` and `Geologica` are not installed on host, using `'Segoe UI', system-ui, -apple-system, sans-serif` | `verified-earlier` | Checked with `fc-list`.

## Risks and Mitigations
- **POESESSID expiration / GGG rate limits** | Risk: session cookie expires or scanning many tabs triggers `429`. Mitigation: user selects specific tabs (`selectedStashTabIds`) and all requests pass sequentially through `PolicyRateLimiter` (`stash-api` policy). | `assumption`
- **Untested live PoE Stash API response shape** | Risk: `character-window/get-stash-items` or `/api/profile` may return unexpected fields or Cloudflare 403 in live Electron run. Mitigation: verify in live session with real `POESESSID`. | `assumption`

## Config and Environment
- Runtime config stored in Electron `userData/config.json` (`src/main/config.ts`); `poeSessId` is stored locally and never committed to git.
- Hotkeys: `Ctrl+Space` (`toggleAppHotkey`), `Ctrl+D` (`priceCheckHotkey`), `Escape` (`closeHotkey`), plus configurable `chatMacros`.
- Build/test commands: `npm test` (`scripts/run-tests.mjs`), `npm run build` (`vue-tsc --noEmit && vite build` + `tsc --noEmit -p tsconfig.main.json && node scripts/build-main.mjs`).

## Open Questions
- Verify live `character-window/get-stash-items` and `/api/profile` behavior with a real `POESESSID` inside Path of Exile overlay mode.

## Hygiene Debt
- None tracked.

## Verification Log
- **2026-11-15** | `npm test && npm run build` | 11/11 tests passed; renderer and main builds succeeded after `preload.ts` IPC clone fix | `verified-this-turn`.
