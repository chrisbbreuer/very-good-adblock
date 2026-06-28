# Adblock

A polished Chrome Manifest V3 ad blocker built with Bun, TypeScript, and STX.

## Why

Adblock exists because I was tired of running into new popups, intrusive placements, and obstructive ads that were not caught yet. I do not want to wait until an ad interrupts me to deal with it; I want those distractions gone immediately.

## Features

- Chrome MV3 `declarativeNetRequest` blocking with static bundled rules.
- Dynamic local rules for per-site allowlisting.
- Pinned generated host rules from EasyList and AdGuard filter-list revisions.
- Cosmetic filtering and cleanup for common ad containers.
- Balanced YouTube and X/Twitter cleanup through content scripts.
- Local-first stats for blocked ads, estimated data saved, and estimated video time saved, with compact Chrome cloud sync for fresh installs.
- Premium STX popup and dashboard UI with external scripts for MV3 CSP safety.
- Bun WebView smoke coverage for UI rendering, screenshots, content cleanup, and overflow checks.

## Setup

```bash
bun install
bun run build
```

Load `dist/` as an unpacked extension in Chrome.

## Scripts

```bash
bun run build
bun run docs:build
bun run docs:dev
bun run docs:preview
bun run package
bun run update:filters
bun run validate:extension
bun run validate:rules
bun run smoke:chrome
bun run test
bun run typecheck
bun run lint
```

## Notes

The UI is authored as `.stx` pages and compiled by `bun-plugin-stx`. Runtime behavior is bundled into external TypeScript modules because Manifest V3 extension pages cannot rely on inline scripts.

Stats are local-first. Compact settings, lifetime totals, daily history, and top-site rollups use `chrome.storage.sync` so a new Chrome install can hydrate the dashboard; high-churn hourly/site-detail/recent-event data stays in `chrome.storage.local`.
