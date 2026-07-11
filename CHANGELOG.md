# Changelog

[Compare changes](https://github.com/chrisbbreuer/very-good-adblock/compare/v0.1.0...v0.1.1)

## ✨ Features

- **site**: theme-matched hero preview, GitHub logo button, red text selection ([066d1be](https://github.com/chrisbbreuer/very-good-adblock/commit/066d1be)) _(by Chris <chrisbreuer93@gmail.com>)_
- **brand**: make the extension popup/dashboard follow system light/dark too ([c770a71](https://github.com/chrisbbreuer/very-good-adblock/commit/c770a71)) _(by Chris <chrisbreuer93@gmail.com>)_
- **brand**: recolor marketing site + docs to red with light/dark themes ([ceace06](https://github.com/chrisbbreuer/very-good-adblock/commit/ceace06)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🐛 Bug Fixes

- **brand**: keep the chart tooltip legible in light mode ([2f35e22](https://github.com/chrisbbreuer/very-good-adblock/commit/2f35e22)) _(by Chris <chrisbreuer93@gmail.com>)_
- **brand**: white badge text, warm-red screenshot frame, on-brand shots ([aa7356a](https://github.com/chrisbbreuer/very-good-adblock/commit/aa7356a)) _(by Chris <chrisbreuer93@gmail.com>)_
- **smoke**: give the youtube fixture an ad-showing player so skip automation engages ([85404af](https://github.com/chrisbbreuer/very-good-adblock/commit/85404af)) _(by Chris <chrisbreuer93@gmail.com>)_

## 💚 Continuous Integration

- **release**: add bumpx+logsmith release script (release / release:patch) ([0b48ea7](https://github.com/chrisbbreuer/very-good-adblock/commit/0b48ea7)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Chris <chrisbreuer93@gmail.com>_

## v0.1.0

Initial release.

- Manifest V3 network blocking via `declarativeNetRequest`: 14,421 bundled
  static rules (14,387 generated hosts from pinned EasyList/AdGuard revisions
  plus curated and redirect seeds), refreshed daily as dynamic rules from the
  public generated host list.
- Per-site allowlist and pause (15m/30m/1h) using dynamic `allowAllRequests`
  rules.
- YouTube: ad removal at the source (player, browse, search, and Shorts
  responses), skip assist, non-skippable fast-forward, and anti-adblock pop-up
  dismissal.
- X: promoted-tweet removal at the source. Twitch: video-ad marker detection
  for saved-time stats and nag-overlay hiding.
- Cosmetic filtering with site-specific selector groups, a narrow default set,
  an opt-in aggressive tier, opt-in cookie-consent hiding, global and per-site
  kill switches, and per-page diagnostics. The player region is never hidden.
- Pop-up/pop-under guard covering sub-frames (including player iframes).
- Local-first stats (blocked counts, estimated data saved, estimated video
  time saved) with compact `chrome.storage.sync` totals so fresh installs can
  hydrate the dashboard; detailed history stays on-device.
- Cross-browser builds from one codebase: Chrome (`dist/`) and Firefox
  (`dist-firefox/`, event-page background, `browser_specific_settings.gecko`,
  AMO data-collection permissions set to `none`).
- No telemetry, no analytics, no accounts. The extension's only network call
  is the filter-list refresh.
