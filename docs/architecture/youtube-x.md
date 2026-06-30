---
title: YouTube, Twitch, and X
description: How Very Good AdBlock handles YouTube video ads, Twitch interruptions, and X/Twitter promoted content with resilient, minimal cleanup.
---

# YouTube, Twitch, and X

YouTube, Twitch, and X/Twitter are handled with site-specific, minimal content cleanup on top of normal DNR blocking.

## YouTube

The content script:

- Detects `youtube.com` hostnames.
- Clicks visible ad skip buttons before hiding ad containers.
- Hides known YouTube ad modules, display renderers, companion slots, and promoted sparkles.
- Records estimated video seconds saved when a skip is clicked.

The skip behavior is tested with a cached YouTube-like watch page served as `www.youtube.com` in Bun WebView.

## Twitch

The content script:

- Detects `twitch.tv` hostnames.
- Hides visible ad notices, video-ad countdowns, ad overlays, and ad banners.
- Records estimated video seconds saved when Twitch video-ad markers appear.
- Uses throttled mutation scans so stream chat and live page updates stay responsive.

Twitch changes often, so the implementation focuses on resilient, visible cleanup instead of brittle player rewrites.

## X/Twitter

The content script:

- Detects `x.com` and `twitter.com` hostnames.
- Removes articles that contain promoted labels.
- Removes known tracking and placement containers.
- Records cleanup events for dashboard stats.

## Limits

These sites change often. The implementation favors resilient selectors and visible user-facing cleanup over fragile playback hacks that risk breaking normal use.
