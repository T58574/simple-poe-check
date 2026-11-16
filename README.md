# Simple PoE Check

Lightweight, open-source Path of Exile overlay combining instant item price-checking with local stash valuation, farm profit tracking, and bulk listing export. Everything runs locally on your machine with no third-party backend or account servers.

## Features

- **In-Game Price Checker (`Ctrl+D`)**
  - Instant `poe.ninja` pricing for Currency (including sub-1c stack totals), Fragments, Scarabs, Beasts, Divination Cards, Uniques, Skill Gems, and Maps.
  - Live Path of Exile Trade API search for Rare, Magic, Fractured, Influenced (Shaper/Elder/Conquerors/Eldritch), and tiered `Map (Tier N)` items.
  - Supports Advanced Mod Descriptions (`Ctrl+Alt+C`), tier-aware min filters, hybrid fractured mod splitting, weapon DPS / armour Q20 estimation, quality (`Q%`), and socket/link/color (`R`/`G`/`B`/`W`) filters.
  - Proactive rate-limiter (`PolicyRateLimiter`) reading `x-rate-limit-*` headers to avoid `429` blocks.

- **Stash & Farm Tracker (`Ctrl+Space` or Pop-Out Window)**
  - **Net Worth & Tab Breakdown:** scans only the stash tabs you select and prices them locally against `poe.ninja` in Chaos and Divine Orbs.
  - **Table Filtering & Sorting:** filter by item name, category, stash tab, or minimum chaos value (`minItemChaos`), sort by any column, and click any item name to copy it.
  - **Farm Session Tracker:** take snapshots before and after mapping to measure net profit, `chaos/hr`, `divine/hr`, and top gained/lost items.
  - **Bulk Selling:** aggregates stackable/liquid items across selected tabs with configurable minimum value and price multiplier (`85%`–`110%`), ready to copy for trade.
  - **Pop-Out Window:** detach the workspace into a standard resizable OS window to move it to a second monitor.

- **Chat Macros**
  - Configurable hotkeys for `/hideout` (`F5`), `/kingsmarch` (`F6`), `@last` (`F7`), `/leave` (`F9`), and custom commands.

## Default Hotkeys

| Hotkey | Action |
|---|---|
| `Ctrl+D` | Price-check hovered item |
| `Ctrl+Space` | Toggle Stash / Farm / Bulk overlay |
| `Escape` | Close active overlay |
| `F5` | `/hideout` |

All hotkeys can be customized in **Settings**.

## Privacy & `POESESSID`

- Your `POESESSID` is stored **only locally** in your Electron `userData/config.json` and is sent exclusively to `pathofexile.com` to read your selected stash tabs.
- Stash snapshots and `poe.ninja` / Trade caches are stored locally on disk.
- Clicking **Sign in (PoE)** opens `https://www.pathofexile.com/login` in your active system browser so you can copy `POESESSID` from DevTools (`Application -> Cookies -> POESESSID`).

## Development & Build

Requires Node.js 20+.

```bash
npm install
npm test
npm run build
```

Run locally after building:

```bash
npx electron .
```

Build a portable Windows executable:

```bash
npm run package:win
```

## Disclaimer

This tool is not affiliated with or endorsed by Grinding Gear Games.
