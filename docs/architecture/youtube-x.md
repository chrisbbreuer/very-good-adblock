---
title: YouTube and Twitch Video Helpers
description: How Very Good AdBlock handles YouTube skip buttons, Twitch video-ad markers, and site-specific cosmetic hiding.
---

# YouTube and Twitch Video Helpers

YouTube and Twitch use small, site-specific content helpers on top of normal DNR blocking. Cosmetic hiding targets dedicated ad-only elements; the player region and real content are never touched. See [Cosmetic Filtering](/architecture/cosmetic-filtering) for the full policy.

## YouTube

The content script:

- Detects `youtube.com` hostnames.
- Hides feed, masthead, display, and companion ad elements (`ytd-ad-slot-renderer`, `ytd-display-ad-renderer`, `#masthead-ad`, and the grid cells that wrap them) without hiding real videos, comments, Shorts, or recommendations.
- Clicks visible ad skip buttons when the page exposes them.
- Fast-forwards non-skippable pre/mid-roll ads: when the player is `ad-showing`, the ad video jumps to its end and speeds up so the real video loads immediately.
- Dismisses the "ad blockers violate Terms" enforcement popup — hides the modal and shared backdrop, restores scrolling, and resumes playback, only when the enforcement message is present.
- Records estimated video seconds saved when a skip or fast-forward happens.

These behaviors are tested with cached YouTube-like pages served as `www.youtube.com` in Bun WebView, asserting ads are hidden and skipped while the real feed video, comments, `<video>`, and skip button stay visible and playback continues.

## Twitch

The content script:

- Detects `twitch.tv` hostnames.
- Hides Twitch display banner ads (`.stream-display-ad__container`).
- Records estimated video seconds saved when Twitch video-ad markers appear — the markers stay visible because the ad is the live stream itself.
- Uses throttled mutation scans so stream chat and live page updates stay responsive.

Twitch changes often, so the implementation focuses on banner hiding plus marker detection instead of brittle player rewrites.

## Limits

These sites change often. The implementation favors precise, ad-only selectors, visible skip-button automation, and passive marker detection over fragile playback hacks or broad DOM hiding that risk breaking normal use.
