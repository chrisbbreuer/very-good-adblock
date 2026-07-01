---
title: Blocking Model
description: How Very Good AdBlock combines performant DNR rules, dynamic rules, and content scripts.
---

# Blocking Model

Very Good AdBlock uses a balanced, performance-conscious Manifest V3 architecture:

- Static `declarativeNetRequest` rules for known network ad domains and URL patterns.
- Dynamic `declarativeNetRequest` rules for user site overrides.
- Content scripts for YouTube skip automation and Twitch video-ad marker detection.
- Chrome storage for settings, stats, and cross-install sync.

## Static Rules

Static rules are generated at build time from pinned filter sources and curated seeds. They are shipped with the extension and loaded by Chrome through the MV3 ruleset manifest.

## Dynamic Rules

Dynamic rules are derived from settings:

- Allowed sites receive allow rules.
- Manually blocked sites receive block rules.
- Rules are bounded to the configured dynamic ID range.

## Content Scripts

Content scripts currently handle only low-risk video helpers:

- YouTube skip buttons that are visible and actionable.
- Twitch video-ad markers used to estimate saved time.
- Throttled mutation scans for late-loading video controls and markers.

The goal is to remove interruptions immediately without brittle page-breaking media hacks.

Cosmetic filtering and promoted-post DOM removal are deferred until they can be tested without breaking YouTube playback or normal page layout. See [Deferred Cosmetic Filtering](/architecture/deferred-cosmetic-filtering).
