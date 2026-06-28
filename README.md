# Adblock

A polished Chrome Manifest V3 ad blocker built with Bun, TypeScript, and STX.

## Features

- Chrome MV3 `declarativeNetRequest` blocking with static bundled rules.
- Dynamic local rules for per-site allowlisting.
- Pinned generated host rules from EasyList and AdGuard filter-list revisions.
- Cosmetic filtering and cleanup for common ad containers.
- Balanced YouTube and X/Twitter cleanup through content scripts.
- Local-first stats for blocked ads, estimated data saved, and estimated video time saved.
- Premium STX popup and dashboard UI with external scripts for MV3 CSP safety.

## Setup

```bash
bun install
bun run build
```

Load `dist/` as an unpacked extension in Chrome.

## Scripts

```bash
bun run build
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

Stats stay local to the browser. Compact settings and lifetime totals use `chrome.storage.sync`; high-churn hourly/daily/site stats use `chrome.storage.local`.
