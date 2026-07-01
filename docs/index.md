---
title: Very Good AdBlock
description: A polished, performant, minimal, modern Chrome MV3 ad blocker with local-first stats and immediate pop-up, placement, YouTube, and Twitch protection.
layout: home
hero:
  name: Very Good AdBlock
  text: Block ads before they get in your way.
  tagline: A polished, performant, minimal, modern Chrome Manifest V3 extension built because intrusive popups, obstructive placements, YouTube ads, and Twitch interruptions should be gone immediately, not after they interrupt you. It keeps lifetime stats, syncs compact totals for fresh installs, and stays transparent about estimates.
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
  - title: YouTube and Twitch Helpers
    details: Content scripts click exposed YouTube skip buttons and detect Twitch video-ad markers without broad cosmetic DOM hiding.
  - title: Stats That Follow You
    details: Lifetime totals and compact history sync through Chrome so fresh installs can restore your dashboard.
  - title: Local by Default
    details: Detailed history stays on the device. Cloud sync carries only compact counters and settings through Chrome storage.
---

## Why It Exists

Very Good AdBlock exists because I was tired of running into new popups, intrusive placements, and obstructive ads that were not caught yet. I do not want to wait until an ad interrupts me to deal with it. I want those distractions gone immediately, using a blocker that stays performant, minimal, and modern.

## What It Tracks

- Ads and placements blocked today and over the lifetime of the extension.
- Estimated data saved from blocked resource categories.
- Estimated minutes saved from skipped or detected YouTube and Twitch video ads.
- Compact daily history and top-site rollups synced through Chrome.

## What To Read First

- [Install locally](/guide/install) if you want to load the unpacked extension in Chrome.
- [Usage](/guide/usage) if you want to pause a site, inspect stats, or reset/export history.
- [YouTube and Twitch video helpers](/architecture/youtube-x) if you want the details behind skip automation and saved-time estimates.
- [Stats and cloud sync](/architecture/stats-sync) if you want to know what follows a user into a fresh install.

## Core Commands

```bash
bun install
bun run build
bun run test
bun run smoke:chrome
```

Load `dist/` as an unpacked Chrome extension during development.
