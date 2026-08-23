---
title: YouTube and Twitch Video Helpers
description: How Very Good AdBlock handles YouTube skip buttons, Twitch video-ad markers, and site-specific cosmetic hiding.
---

# YouTube and Twitch Video Helpers

YouTube and Twitch use small, site-specific content helpers on top of normal DNR blocking. Cosmetic hiding targets dedicated ad-only elements; the player region and real content are never touched. See [Cosmetic Filtering](/architecture/cosmetic-filtering) for the full policy.

## YouTube

Video ads are removed at the source. A MAIN-world script (`content/yt-inpage.ts`) runs in the page's own context at `document_start` and deletes the ad instructions (`adPlacements`, `adSlots`, `playerAds`) from YouTube's Innertube JSON wherever it enters the app:

- The inline `ytInitialPlayerResponse` (first video) and `ytInitialData` (first browse/search render), via accessors installed before either is assigned.
- Responses fetched over `fetch` **or** `XMLHttpRequest` for the ad-carrying endpoints (`/youtubei/v1/{player,get_watch,browse,search,playlist,reel_watch_sequence}`, plus the legacy `playlist?list=` HTML endpoint). XHR matters because YouTube's TV/mobile web clients still use it, and a response read there never touches the fetch wrap.
- Fresh realms: a page that runs after us can grab pristine `fetch`/`JSON.parse` from a dynamically inserted iframe and bypass every hook, so dynamically added same-origin frames are patched the moment they become reachable.

With no ads to schedule, the player starts the real video immediately; `streamingData` and everything else is left intact. This is uBlock Origin's approach and is much cleaner than fast-forwarding. It honors the off switch, allowlist, and YouTube toggle via a config message from the isolated content script, and reports removed ads back for stats. The same pruning runs on `youtube-nocookie.com`, the privacy-enhanced embed host.

On top of that source-level pruning, the isolated content script:

- Detects `youtube.com` (and `youtube-nocookie.com`) hostnames.
- Hides feed, masthead, display, and companion ad elements (`ytd-ad-slot-renderer`, `ytd-display-ad-renderer`, `#masthead-ad`, and the grid cells that wrap them) without hiding real videos, comments, Shorts, or recommendations.
- Clicks visible ad skip buttons and fast-forwards any `ad-showing` / `ad-interrupting` pre/mid-roll — a safety net for ads that slip past the pruner — then resumes playback when the ad period ends, so the video starts on its own instead of staying paused.
- Dismisses the "ad blockers violate Terms" enforcement popup — hides the modal and shared backdrop, restores scrolling, and resumes playback, only when the enforcement message is present.
- Records estimated video seconds saved when an ad is pruned, skipped, or fast-forwarded — one credit per ad period even though both the skip click and the fast-forward fire for it.

These behaviors are tested with cached YouTube-like pages served as `www.youtube.com` in Bun WebView, asserting ads are hidden and skipped while the real feed video, comments, `<video>`, and skip button stay visible and playback continues. `test/youtube-prune.test.ts` runs the built `yt-inpage.js` in real Chromium and asserts ads are stripped from inline and fetched player responses while `streamingData` survives, and `test/youtube-defense.test.ts` additionally covers XHR-delivered responses, `ytInitialData` assignment, the iframe-realm bypass, and playback auto-resume after an ad ends.

## Twitch

The content script:

- Detects `twitch.tv` hostnames.
- Hides Twitch's ad-only affordances — the "Leave feedback for this Ad" / "Learn more about this ad" buttons and the anti-adblock nag overlay. (Twitch now stitches video ads into the stream server-side, so the old display-banner containers no longer exist and were dropped.)
- Records estimated video seconds saved when Twitch video-ad markers appear — the markers stay visible because the ad is the live stream itself.
- Uses throttled mutation scans so stream chat and live page updates stay responsive.

Twitch changes often, so the implementation focuses on ad-affordance hiding plus marker detection instead of brittle player rewrites.

## Limits

These sites change often. The implementation favors precise, ad-only selectors, visible skip-button automation, and passive marker detection over fragile playback hacks or broad DOM hiding that risk breaking normal use.
