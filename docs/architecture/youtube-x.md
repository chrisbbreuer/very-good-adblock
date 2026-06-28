---
title: YouTube and X
description: How Adblock handles YouTube video ads and X/Twitter promoted content.
---

# YouTube and X

YouTube and X/Twitter are handled with site-specific content cleanup on top of normal DNR blocking.

## YouTube

The content script:

- Detects `youtube.com` hostnames.
- Clicks visible ad skip buttons before hiding ad containers.
- Hides known YouTube ad modules, display renderers, companion slots, and promoted sparkles.
- Records estimated video seconds saved when a skip is clicked.

The skip behavior is tested with a cached YouTube-like watch page served as `www.youtube.com` in Bun WebView.

## X/Twitter

The content script:

- Detects `x.com` and `twitter.com` hostnames.
- Removes articles that contain promoted labels.
- Removes known tracking and placement containers.
- Records cleanup events for dashboard stats.

## Limits

These sites change often. The implementation favors resilient selectors and visible user-facing cleanup over fragile playback hacks that risk breaking normal use.
