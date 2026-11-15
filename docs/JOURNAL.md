# Project Journal

- `last_updated`: `2026-11-15T23:23:15Z`
- `scope`: `simple-poe-check` (Electron + Vue 3 Path of Exile price checker, stash tracker, farm profit analyzer, and bulk listing overlay)
- `owner`: project maintainers

## Current State
- **2026-11-15** | Overlay app (`Ctrl+Space`, hidden on startup via `show: false`) and cursor price-check (`Ctrl+D`) are integrated in `src/main/overlay.ts`, `src/main/hotkeys.ts`, and `src/renderer/App.vue` | `verified-earlier` | `npm test` (11/11) and `npm run build` passed on commit `69bc55a`.
- **2026-11-15** | Price-check overlay opens at full viewport height (`100vh`) and positions adjacent to cursor (`28px` offset right or left based on cursor half) in `src/main/overlay.ts` and `src/renderer/App.vue` | `verified-this-turn` | `npm test` (11/11) and `npm run build` passed; live in-game positioning pending user verification.
- **2026-11-15** | Migrated `poe.ninja` client (`src/main/poeApi.ts`, cache `ninja-v3-*.json`) to `poe1/api/economy/exchange/current/overview` and `poe1/api/economy/stash/current/item/overview` after verifying live `Covens` JSON; fixed `Divine Orb` rate (`core.rates.divine` / `divine` line) and all currency/item pricing | `verified-this-turn` | Live `curl` verified `Covens` schema; `npm test` and `npm run build` passed.
- **2026-11-15** | Added `Beast`, `Scarab` (in `stash/current/item/overview`), `BlightedMap`, `BlightRavagedMap`, `UniqueMap`, `UniqueRelic`, `AllflameEmber`, and `Runegraft` to `poe.ninja` loader (`ninja-v4-*.json`) + `Beast` classification in `src/shared/stashValuation.ts` | `verified-this-turn` | Probed live `poe.ninja` `Covens` endpoints; `npm test` and `npm run build` passed.
- **2026-11-15** | Added `minItemChaos` setting (default `1c`) to hide low-value items in Stash table and click-to-copy on item names (`src/renderer/components/StashWorkspace.vue`, `src/shared/types.ts`) | `verified-this-turn` | `npm test` (11/11) and `npm run build` passed.
- **2026-11-15** | Snapshots, farm-session `chaos/hr` & `div/hr` diffs, and bulk aggregation are implemented in `src/shared/stashValuation.ts` and persisted locally in `userData/stash-snapshots.json` (max 100) | `verified-earlier` | Unit-tested in `tests/stashValuation.test.ts`.
- **2026-11-15** | Fixed `An object could not be cloned.` on `Take Snapshot` / `Save Config` by unwrapping Vue 3 reactive Proxies in the renderer (`src/renderer/components/StashWorkspace.vue`, `src/renderer/App.vue`) before crossing Electron `contextBridge` (which clones arguments before `preload.ts` runs) | `verified-this-turn` | `npm test` (11/11) and `npm run build` passed.

## Active Decisions
- **2026-11-15** | **POESESSID over OAuth 2.1 for now** | GGG OAuth registration requires manual approval (`oauth@grindinggear.com`) and user prefers not to scaffold OAuth yet | `verified-earlier` | Next review: if GGG restricts `character-window` or user registers an OAuth client.
- **2026-11-15** | **System browser login + manual POESESSID paste** | External browsers isolate `HttpOnly` cookies; opening system browser avoids in-app login window while keeping cookie entry one step | `verified-earlier` | Revisit only if OAuth PKCE is adopted.
- **2026-11-15** | **Brand palette + system font fallback** | Applied `#141413` / `#faf9f5` / `#d97757` / `#6799E2` / `#87A26A` in `src/renderer/style.css`; `Science Gothic` and `Geologica` are not installed on host, using `'Segoe UI', system-ui, -apple-system, sans-serif` | `verified-earlier` | Checked with `fc-list`.

## Risks and Mitigations
- **POESESSID expiration / GGG rate limits** | Risk: session cookie expires or scanning many tabs triggers `429`. Mitigation: user selects specific tabs (`selectedStashTabIds`) and all requests pass sequentially through `PolicyRateLimiter` (`stash-api` policy). | `assumption`
- **Live overlay DPI / multi-monitor bounds** | Risk: `win.getBounds()` vs `OverlayController.targetBounds` may differ under non-100% Windows scaling. Mitigation: `showAtCursor` prefers `win.getBounds()` (DIPs) and clamps to `[0, bounds.width - width]`. | `assumption`

## Config and Environment
- Runtime config stored in Electron `userData/config.json` (`src/main/config.ts`); `poeSessId` is stored locally and never committed to git.
- Hotkeys: `Ctrl+Space` (`toggleAppHotkey`), `Ctrl+D` (`priceCheckHotkey`), `Escape` (`closeHotkey`), plus configurable `chatMacros`.
- Build/test commands: `npm test` (`scripts/run-tests.mjs`), `npm run build` (`vue-tsc --noEmit && vite build` + `tsc --noEmit -p tsconfig.main.json && node scripts/build-main.mjs`).

## Open Questions
- Verify live cursor-adjacent full-height price-check overlay positioning in Path of Exile.

## Hygiene Debt
- None tracked.

## Verification Log
- **2026-11-15** | `npm test && npm run build` | 11/11 tests passed; renderer and main builds succeeded after cursor-adjacent full-height overlay update | `verified-this-turn`.
