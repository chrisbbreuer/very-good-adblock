# Store submission

Copy-paste reference for the Chrome Web Store and Firefox AMO listings. Keep this
in sync with `src/shared/constants.ts` (name/description) and `package.json`.

## Publishing

Cut a release from a clean, up-to-date `main` branch:

```bash
bun run release:patch # or release:minor / release:major
```

Stacks creates the release commit and `v*` tag. The tag calls Stacks' reusable
browser-extension workflow, which builds and validates every target, submits the
existing Chrome and Firefox listings, builds/uploads the signed Safari container
app with stable Xcode, and creates the GitHub Release only after every enabled
store job succeeds. Firefox receives a human-readable source archive alongside
the signed build.

The workflow reads these repository settings; never commit their values:

- `CHROME_WEB_STORE_PUBLISHER_ID` (variable) and
  `CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON` (secret)
- `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` (secrets)
- `APP_STORE_CONNECT_API_KEY`, `APP_STORE_CONNECT_API_KEY_ID`, and
  `APP_STORE_CONNECT_API_ISSUER_ID` (secrets)
- `ENABLE_SAFARI_PUBLISH` (variable; `true` after the macOS app record exists)

The Chrome item id and stable Firefox add-on id are declared in
`config/extension.ts`; never replace them or the stores will treat the upload as
a different extension.

For local validation, build the same store artifacts directly:

```bash
bun run package          # → very-good-adblock-<version>-chrome.zip    (Chrome)
bun run package:firefox  # → very-good-adblock-<version>-firefox.zip   (Firefox)
bun run package:safari   # → very-good-adblock-<version>-safari.zip    (Safari source bundle)
bun run capture          # → dist/captures/*.png       (raw surfaces, no framing)
bun run screenshots      # → every store's set (see Screenshots below)
bun run og               # → resources/social/*.jpg    (link-preview cards)
```

## Basics

- **Name:** Very Good AdBlock
- **Category:** Productivity (Chrome) / Privacy & Security (Firefox)
- **Primary language:** English
- **Short description (max 132 chars):**
  > Removes ads, pop-ups, and YouTube and Twitch interruptions at the source. Fast, private, no telemetry.

## Detailed description

> Very Good AdBlock removes ads, pop-ups, and YouTube and Twitch interruptions at
> the source, then stays out of the way. It is a Manifest V3 extension for Chrome
> and Firefox, built to be fast and private: no accounts, no tracking, no data
> leaves your machine.
>
> What it does
> - Network blocking. Stops 14,000+ ad, tracker, and annoyance hosts before the
> request completes, using bundled declarativeNetRequest rules that refresh daily
> from a public host list generated from pinned filter-list revisions.
> - YouTube and Twitch. Strips video ads out of YouTube's player response so the
> real video starts immediately, skips anything that slips through, and detects
> Twitch stream ads. The player itself is never touched.
> - Pop-ups and pop-unders. Neutralizes the click-hijack pop-ups that streaming
> and file-host sites open, including the ones fired from inside a player iframe.
> - Cookie banners. Optional one-click hiding of the common consent overlays.
> - One-click control. Pause protection per site, keep an allowlist, and read
> local stats (blocked count, data saved, video time) from a clean dashboard,
> in a light or dark theme that follows your system.
> - One-click reporting. If an ad ever slips through, report it straight from the
> popup — it opens a pre-filled issue with diagnostics so it gets fixed fast.
>
> Privacy
> - No telemetry and no analytics. Nothing about your browsing is collected or
> sent anywhere. Settings and lifetime totals sync through your own browser
> account only; the detailed history stays on the device.

## Permission justifications

| Permission | Why it is needed |
|---|---|
| `declarativeNetRequest` | Block ad, tracker, and pop-up network requests using bundled rule lists. |
| `declarativeNetRequestFeedback` | Show the number of items blocked on the current page as the toolbar badge. It only reports which of the extension's own rules matched in the active tab; it does not read browsing history. |
| `webRequest` | Observe failed requests (the `onErrorOccurred` event only) so the per-page blocked count updates live in packed installs. The extension never reads request or response content and cannot modify requests with it. |
| `storage` | Save your settings and local statistics, and sync compact totals across your own installs. |
| `tabs` | Read the active tab's URL and favicon to show per-site stats and the per-site allow/pause toggle. |
| `alarms` | Schedule the daily filter-list refresh and the timer that resumes protection after a pause. |
| `host_permissions` (`<http://*/*>`, `<https://*/*>`) | Apply cosmetic hiding, source-level ad pruning, and pop-up blocking on the pages you choose to visit. Nothing is read or sent off-device. |

## Data collection disclosure

Both stores ask what data is collected. The answer is **none**:

- No personally identifiable information, browsing history, or content is collected.
- No data is transmitted to the developer or any third party.
- The only network request the extension makes is a daily fetch of the public
  filter-host list from GitHub (no user data attached).

Firefox AMO: `browser_specific_settings.gecko.data_collection_permissions` is set
to `none` in the generated manifest.

## Screenshots

Every store's set comes from one declaration in `config/images.ts`. `bun run
screenshots` runs three steps:

1. **Capture.** `resources/scripts/capture-surfaces.ts` shoots the real popup
   and dashboard at 2x against the seeded fixture — raw, with no frame,
   caption, or bezel — into `dist/captures/`.
2. **Compose.** `buddy generate:app-store` frames those captures for every
   device class listed in `config/images.ts` and writes
   `resources/app-store/screenshots/<display-type>-<nn>.png` at Apple's exact
   dimensions.
3. **Downscale.** The Mac frames are resampled to the 1280x800 the Chrome Web
   Store and AMO accept, into `resources/web-store/`. Committed, because the
   release workflow never runs a capture: the Firefox sync reads them from the
   checkout, and the Chrome upload is done by hand from there.

The slides are the copy in `config/images.ts`, not this document — change them
there and every store's set follows:

1. The toolbar popup: blocked-on-this-page count, 24h chart, per-site stats.
2. The popup mid-pause, showing per-site control and the resume countdown.
3. The dashboard: lifetime stats, 60 days of history, protection toggles. iPad
   and Mac only — it is a wide surface, and on a 1290x2796 phone frame the
   slack reads as empty background.

`config/extension.ts` points `safariAppStore.screenshots` at those generated
paths, and `extension:safari:publish` regenerates them before uploading, so the
set that ships describes the build that ships.

### What each store will accept

| Store | Screenshots |
| --- | --- |
| App Store | Uploaded with the version's metadata by `extension:safari:publish`. |
| Firefox AMO | Synced by `extension:firefox:publish` from `firefoxAddons.screenshots`, or on demand with `buddy extension:firefox:previews --dry-run`. |
| Chrome Web Store | **By hand.** The API publishes packages only — it has no endpoint for listing images. Upload `resources/web-store/*.png` (1280x800) in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) under Store listing → Screenshots. |

Adding a slide means adding one entry to `appStore.slides`; adding a device
class means one entry in `appStore.displays`. Apple accepts up to ten per
class.

## Social cards

`bun run og` writes the link-preview cards to `resources/social/` — a 1200x630
primary plus square and 4:5 crops per page. The pages and their copy live in
`social.pages` in `config/images.ts`.

`bun run site:build` regenerates them itself before assembling the site, so a
deploy ships cards describing the build being deployed rather than whatever was
last committed. That works on CI as well as a laptop: capturing the popup goes
through `Bun.WebView`, which uses WKWebView on macOS and drives an installed
Chrome elsewhere, and the `ubuntu-latest` runner image ships Chrome. The cards
are committed too, so a checkout has them without a build. After assembling,
the build fails if a template declares a card that was never generated, or if a
configured page no template references.

## Firefox notes

- Build the AMO artifact with `bun run package:firefox` (produces
  `very-good-adblock-<version>-firefox.zip` from `dist-firefox/`).
- The add-on id (`browser_specific_settings.gecko.id`) must stay stable across
  submissions or AMO treats it as a new, disconnected add-on.
- Source code is required for AMO review because the build is minified: point the
  reviewer at this repository and the `bun run build:firefox` command.
