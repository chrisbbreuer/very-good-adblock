---
title: Adblock
description: A polished Chrome MV3 ad blocker built with Bun, STX, and local-first stats.
layout: home
hero:
  name: Adblock
  text: Block ads before they get in your way.
  tagline: A Chrome Manifest V3 extension built because intrusive popups, obstructive placements, and video ads should be gone immediately, not after they interrupt you.
  actions:
    - theme: brand
      text: Install Locally
      link: /guide/install
    - theme: alt
      text: How It Works
      link: /architecture/
features:
  - title: MV3 Native Blocking
    details: Uses Chrome declarativeNetRequest static rules plus dynamic per-site rules for allowlists and manual blocks.
  - title: YouTube and X Cleanup
    details: Content scripts remove ad containers, promoted placements, and click YouTube skip buttons when the page exposes them.
  - title: Stats That Follow You
    details: Lifetime totals and compact history sync through Chrome so fresh installs can restore your dashboard.
---

## Why It Exists

Adblock exists because I was tired of running into new popups, intrusive placements, and obstructive ads that were not caught yet. I do not want to wait until an ad interrupts me to deal with it. I want those distractions gone immediately.

## What It Tracks

- Ads and placements blocked today and over the lifetime of the extension.
- Estimated data saved from blocked resource categories.
- Estimated minutes saved from skipped or detected video ads.
- Compact daily history and top-site rollups synced through Chrome.

## Core Commands

```bash
bun install
bun run build
bun run test
bun run smoke:chrome
```

Load `dist/` as an unpacked Chrome extension during development.
