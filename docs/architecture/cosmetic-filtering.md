---
title: Cosmetic Filtering
description: How Very Good AdBlock hides first-party ad placements safely, and the guardrails that keep pages working.
---

# Cosmetic Filtering

Some ads survive network blocking because the site serves them inline from its
own origin — YouTube feed and masthead ads, Twitch display banners, X promoted
entries. `declarativeNetRequest` cannot touch those, so Very Good AdBlock hides
them in the page with cosmetic filtering.

Cosmetic filtering is **on by default**. It was previously deferred because the
first attempt used broad, generic selectors that risked breaking modern video
and social layouts. The current implementation ships with the guardrails that
deferral asked for.

## How It Works

- The content script runs at `document_start` and injects the default
  stylesheet synchronously, before the page parses, so ads never paint. Once
  settings load it reconciles — removing the sheet if the extension is off, the
  site is allowlisted, or cosmetic filtering is disabled, and adding aggressive
  selectors when enabled.
- The stylesheet sets `display: none !important` per selector. CSS hides
  matching elements immediately, including ones YouTube's SPA adds later, so no
  per-element mutation race is needed.
- Each selector gets its **own** rule. In a comma-joined selector list a single
  invalid or unsupported selector (for example `:has()` on an old engine) makes
  the browser discard the entire rule; per-selector rules fail in isolation, so
  one bad selector never disables the rest of the hiding.
- A throttled mutation sweep then tags each hidden node (`data-adblock-hidden`)
  and attributes it to the selector that matched, feeding the blocked count and
  per-page diagnostics.

## Guardrails

- **Site-specific selectors.** Selectors target dedicated ad-only custom
  elements (`ytd-ad-slot-renderer`, `ytd-display-ad-renderer`, `#masthead-ad`),
  not broad `[class*="ad"]` matches. Real videos, comments, Shorts, and
  recommendations are never targeted.
- **X promoted tweets are pruned at the source.** A MAIN-world content script
  (`content/x-inpage.ts`) wraps `fetch` and removes entries carrying
  `content.itemContent.promotedMetadata` from X's GraphQL timeline responses
  before the app renders them — the same source-level approach uBlock Origin
  uses. It is locale-independent, leaves no flash, and never guesses at DOM
  nodes. It talks to the isolated content script over `window.postMessage`: it
  receives an enable flag (honoring the off switch and allowlist) and reports how
  many ads it removed for stats. A DOM label check (`xPromotedLabels` in
  `constants.ts`) stays as a fallback for stragglers — matched only against
  standalone label spans, never the `[data-testid="placementTracking"]` media
  container X reuses on ordinary tweets.
- **Never the player.** Instream video ads are handled by skip automation.
  Player-region containers (`.video-ads`, `.ytp-ad-module`) are intentionally
  not hidden, so hiding an ad can never hide the skip control or the video.
- **Detection, not hiding, for stream ads.** Twitch now stitches video ads into
  the stream server-side (SSAI), so the legacy display-ad selectors
  (`.stream-display-ad__container`, `sad-overlay`, `video-ad-banner`) are gone
  from the maintained filter lists and were dropped. What remains is hiding the
  ad-only affordances (`Leave feedback for this Ad` / `Learn more about this ad`
  buttons) and the anti-adblock nag overlay. The in-stream ad markers
  (`.commercial-break-in-progress`, `[data-a-target="video-ad-label"]`,
  countdown) stay visible and are only counted — the ad is the live stream, so
  hiding the notice would remove feedback while the ad keeps playing.
- **Global + per-site kill switches.** `cosmeticFiltering` disables all hiding
  without touching network blocking; the per-site YouTube/Twitch toggles and the
  allowlist scope it further.
- **Opt-in cookie-consent hiding.** `cookieConsentFiltering` (off by default)
  adds a group targeting the common consent-management platforms by their
  dedicated container ids/classes only (OneTrust, Didomi, Cookiebot,
  Usercentrics, Quantcast, Sourcepoint, and more) — never a generic
  `[class*="cookie"]`. When a banner is hidden the content script also restores
  the page scroll these overlays lock.
- **Narrow default, opt-in aggressive.** A high-confidence set ships on;
  `aggressiveCosmetic` adds broader matches for people who accept a small risk of
  over-hiding.
- **Diagnostics.** The dashboard's Cosmetic activity panel lists which selectors
  acted on the active tab and how many placements each removed.

## Selectors

The full registry lives in `src/shared/cosmetic.ts`, grouped by surface
(generic, YouTube, Twitch, X) and tier (`default` vs `aggressive`).
`activeCosmeticGroups()` resolves the set for the current page from the settings,
which keeps the selector policy testable without a browser.

## Tests

- `test/youtube-content.test.ts` loads a YouTube-like page in Bun WebView and
  asserts masthead, feed, and display ads are hidden while the real feed video,
  comments, `<video>`, and the skip button stay visible and playback works.
- `test/twitch-content.test.ts` asserts the ad-only feedback button and the
  anti-adblock nag overlay are hidden, the dropped legacy display-ad container is
  left visible, and the in-stream video-ad markers stay visible for detection.
- `test/x-content.test.ts` asserts a promoted tweet cell is hidden by the DOM
  fallback while an ordinary tweet's photo and video (in the same
  `placementTracking` container) stay visible.
- `test/x-prune.test.ts` asserts the GraphQL pruner removes promoted entries
  (by `promotedMetadata` and `promoted-` ids, including promoted module items)
  while leaving organic entries and unrelated `entries` arrays untouched.
- `scripts/smoke-extension.ts` screenshots the built extension against YouTube,
  Twitch, popup, options, and marketing surfaces.
