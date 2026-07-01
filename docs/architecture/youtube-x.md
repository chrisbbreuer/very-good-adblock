---
title: YouTube and Twitch Video Helpers
description: How Very Good AdBlock handles YouTube skip buttons and Twitch video-ad markers without cosmetic DOM hiding.
---

# YouTube and Twitch Video Helpers

YouTube and Twitch use small, site-specific content helpers on top of normal DNR blocking. These helpers do not hide ad containers or rewrite player DOM.

## YouTube

The content script:

- Detects `youtube.com` hostnames.
- Clicks visible ad skip buttons when the page exposes them.
- Records estimated video seconds saved when a skip is clicked.

The skip behavior is tested with a cached YouTube-like watch page served as `www.youtube.com` in Bun WebView.

## Twitch

The content script:

- Detects `twitch.tv` hostnames.
- Records estimated video seconds saved when Twitch video-ad markers appear.
- Uses throttled mutation scans so stream chat and live page updates stay responsive.

Twitch changes often, so the implementation focuses on marker detection instead of brittle player rewrites.

## Limits

These sites change often. The implementation favors visible skip-button automation and passive marker detection over fragile playback hacks or broad DOM hiding that risk breaking normal use.
