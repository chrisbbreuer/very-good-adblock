# Very Good AdBlock

A fast Manifest V3 ad blocker for Chrome and Firefox that removes ads, pop-ups, and YouTube and Twitch interruptions at the source, then stays out of the way. No telemetry. Built with Bun, TypeScript, and STX.

## Why

Very Good AdBlock exists because I was tired of running into new popups, intrusive placements, and obstructive ads that were not caught yet. I do not want to wait until an ad interrupts me to deal with it; I want those distractions gone immediately, with a blocker that stays fast, small, and modern.

## Features

- Cross-browser Manifest V3 build (Chrome and Firefox) sharing one codebase, with per-target manifests generated at build time.
- MV3 `declarativeNetRequest` blocking with static bundled rules.
- Dynamic local rules for per-site allowlisting.
- Pinned generated host rules from EasyList and AdGuard filter-list revisions.
- YouTube skip assist, non-skippable video-ad fast-forward, and anti-adblock popup dismissal through a conservative content script.
- Twitch video-ad marker detection for estimated saved-time stats.
- Daily filter-list refresh that loads newer hosts as dynamic rules between releases.
- Local-first stats for blocked ads, estimated data saved, and estimated video time saved, with compact Chrome cloud sync for fresh installs.
- Premium, minimal STX popup and dashboard UI with external scripts for MV3 CSP safety.
- Performance-conscious content scripts with throttled observers and site-specific cosmetic hiding for first-party ad placements.
- Bun WebView smoke coverage for UI rendering, screenshots, video helpers, and overflow checks.

## Cosmetic Filtering

Cosmetic filtering hides first-party ad placements that survive network blocking (YouTube feed/masthead/display ads, Twitch display banners, X promoted entries). It ships on by default behind site-specific selectors, global and per-site kill switches, a narrow default set with an opt-in aggressive tier, and per-page diagnostics. The player region is never hidden, so skip automation and playback are untouched. See `docs/architecture/cosmetic-filtering.md`.

## Setup

```bash
bun install
bun run build
```

Load `dist/` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

The STX marketing page is emitted at `dist/marketing.html` during `bun run build`.
The deployable website is emitted at `dist/site` during `bun run site:build`, with docs mounted under `/docs`.

### Firefox

```bash
bun run build:firefox
```

This emits a Firefox-flavored build (an event-page `background`, `browser_specific_settings.gecko`, and no `minimum_chrome_version`) into `dist-firefox/`. Load it temporarily via `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `dist-firefox/manifest.json`, or run `bun run dev:firefox` to launch it automatically with `web-ext run`.

## Scripts

```bash
bun run build
bun run build:chrome
bun run build:firefox
bun run dev:firefox
bun run docs:build
bun run docs:dev
bun run docs:preview
bun run site:build
bun run package
bun run package:firefox
bun run update:filters
bun run validate:extension
bun run validate:extension:firefox
bun run validate:rules
bun run smoke:chrome
bun run test
bun run typecheck
bun run lint
```

## Notes

The UI is authored as `.stx` pages and compiled by `bun-plugin-stx`. Runtime behavior is bundled into external TypeScript modules because Manifest V3 extension pages cannot rely on inline scripts.

Stats are local-first. Compact settings, lifetime totals, daily history, and top-site rollups use `chrome.storage.sync` so a new Chrome install can hydrate the dashboard; high-churn hourly/site-detail/recent-event data stays in `chrome.storage.local`.
