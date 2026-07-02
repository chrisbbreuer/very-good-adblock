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
- **X promoted tweets are matched by label, not test id.** X reuses its media
  container (`[data-testid="placementTracking"]`) on ordinary tweets, so hiding
  that test id would remove real photos and videos. Promoted tweets are instead
  detected in the content script by their standalone "Ad"/"Promoted" label,
  matched against a set of locale strings (see `xPromotedLabels` in
  `constants.ts`), and the whole timeline cell is hidden. Only translations
  verified against a real source are included — unverified ones are omitted so a
  wrong string can never hide a genuine post.
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
- `test/x-content.test.ts` asserts a promoted tweet cell is hidden while an
  ordinary tweet's photo and video (in the same `placementTracking` container)
  stay visible.
- `scripts/smoke-extension.ts` screenshots the built extension against YouTube,
  Twitch, popup, options, and marketing surfaces.
