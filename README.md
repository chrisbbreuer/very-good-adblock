# Very Good AdBlock

A fast, open-source Manifest V3 ad blocker for Chrome and Firefox. It removes ads, pop-ups, and YouTube and Twitch interruptions **at the source**, then stays out of the way. No account, no telemetry, no bloat. Built with Bun, TypeScript, and STX.

[![License: MIT](https://img.shields.io/badge/license-MIT-17c964)](./LICENSE) [![Built with Bun](https://img.shields.io/badge/built%20with-Bun-14151a)](https://bun.sh) [![Manifest V3](https://img.shields.io/badge/Manifest-V3-17c964)](https://developer.chrome.com/docs/extensions/mv3/intro/)

## Why

Very Good AdBlock exists because waiting for an ad to interrupt you before it gets blocked is backwards. Pop-ups, intrusive placements, and video ads should be gone *before* the page can show them, with a blocker that stays fast, small, and modern instead of shipping a background page that churns on every request.

## Performance

Speed here is an architecture decision, not a micro-optimization pass:

- **Network blocking runs in the browser, not in JavaScript.** MV3 `declarativeNetRequest` hands the rules to the browser's native network stack (C++), so ad and tracker requests are matched and cancelled with **zero per-request JavaScript**. There is no background page waking up to inspect every request the way an MV2 `webRequest` blocker does. This is the lowest-overhead blocking model a modern extension can use.
- **Ads are pruned once, at the source.** For YouTube and X, the ad instructions are deleted from the JSON response before the page ever schedules or renders them — a single pass over the payload, no polling, no `MutationObserver` hammering the DOM waiting for an ad to appear.
- **The content script stays cheap.** Cosmetic hiding uses a small, site-specific selector set behind throttled observers; the player region is never touched.
- **Nothing phones home.** No analytics, no telemetry, no remote config fetches on the hot path — the only network call the extension makes is a once-a-day filter-list refresh.

### Benchmarks

`bun run bench` measures the actual runtime hot paths on representative fixtures. Numbers below are from Bun 1.3 on an Apple Silicon laptop (run it yourself for your machine):

| Operation | What runs while you browse | Time | Throughput |
|---|---|---:|---:|
| `pruneYouTubeAds` | parse + strip ads from a 90 KB YouTube browse response | ~0.39 ms | ~2,500/s |
| `prunePromotedFromTimeline` | parse + strip promoted tweets from a 34 KB X timeline | ~0.13 ms | ~7,400/s |
| `activeCosmeticGroups` | resolve the cosmetic selectors for a page | ~95 ns | ~10.5M/s |
| `eventTotals` | aggregate 240 block events for the dashboard | ~0.84 µs | ~1.2M/s |
| `siteMatches` | match a hostname against your allowlist | ~130 ns | ~7.8M/s |
| `buildStaticRules` | compile the 14,421-rule static ruleset | ~0.35 ms | — |
| `buildHostRefreshRules` | compile 15,000 filter hosts into DNR rules | ~1.8 ms | — |

The takeaway: every response the extension touches is cleaned in a fraction of a millisecond, and the per-page work (cosmetic resolution, allowlist checks) is measured in nanoseconds. The network blocking itself costs no JavaScript at all.

## Features

- Cross-browser Manifest V3 build (Chrome and Firefox) from one codebase, with per-target manifests generated at build time.
- MV3 `declarativeNetRequest` blocking with bundled static rules (14,000+) plus dynamic local rules for per-site allowlisting.
- Pinned generated host rules from EasyList and AdGuard filter-list revisions, refreshed daily as dynamic rules between releases.
- YouTube ad removal at the source (player/browse/Shorts responses), skip assist, non-skippable fast-forward, and anti-adblock pop-up dismissal.
- X promoted-tweet removal at the source, and Twitch video-ad marker detection for saved-time stats.
- Local-first stats for blocked ads, estimated data saved, and estimated video time saved, with compact Chrome cloud sync for fresh installs.
- Premium, minimal STX popup and dashboard UI, with external scripts for MV3 CSP safety.
- Bun WebView smoke coverage for UI rendering, screenshots, video helpers, and overflow checks.

## Cosmetic filtering

Cosmetic filtering hides first-party ad placements that survive network blocking (YouTube feed/masthead/display ads, Twitch display banners, X promoted entries). It ships on by default behind site-specific selectors, global and per-site kill switches, a narrow default set with an opt-in aggressive tier, and per-page diagnostics. The player region is never hidden, so skip automation and playback are untouched. See [`docs/architecture/cosmetic-filtering.md`](./docs/architecture/cosmetic-filtering.md).

## Setup

```bash
bun install
bun run build
```

Load `dist/` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

### Firefox

```bash
bun run build:firefox
```

This emits a Firefox-flavored build (an event-page `background`, `browser_specific_settings.gecko`, and no `minimum_chrome_version`) into `dist-firefox/`. Load it via `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `dist-firefox/manifest.json`, or run `bun run dev:firefox` to launch it with `web-ext run`.

## Scripts

```bash
bun run build            # build the Chrome extension into dist/
bun run build:firefox    # build the Firefox extension into dist-firefox/
bun run bench            # run the hot-path benchmarks
bun run test             # unit tests
bun run smoke:chrome     # headless Bun WebView smoke test
bun run site:build       # build the marketing site + docs into dist/site
bun run package          # validate + zip the extension for the store
bun run update:filters   # regenerate host rules from the filter lists
bun run typecheck        # tsc --noEmit
bun run lint             # pickier
```

## Notes

The UI is authored as `.stx` pages and compiled by `bun-plugin-stx`. Runtime behavior is bundled into external TypeScript modules because Manifest V3 extension pages cannot rely on inline scripts.

Stats are local-first: compact settings, lifetime totals, daily history, and top-site rollups use `chrome.storage.sync` so a new Chrome install can hydrate the dashboard; high-churn hourly/site-detail/recent-event data stays in `chrome.storage.local`.

## License

[MIT](./LICENSE) © Chris Breuer
