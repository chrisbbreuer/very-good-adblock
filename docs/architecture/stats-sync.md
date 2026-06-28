---
title: Stats and Cloud Sync
description: Local-first tracking with compact Chrome sync restore.
---

# Stats and Cloud Sync

Adblock tracks stats locally first, then syncs a compact snapshot through Chrome so a fresh install can restore the important totals.

## Lifetime Totals

Lifetime totals include:

- Ads blocked.
- Estimated bytes saved.
- Estimated video seconds saved.
- First tracking date.
- Last updated date.

## Local Storage

High-churn data stays in `chrome.storage.local`:

- Hourly history.
- Full site rollups.
- Recent events.

## Chrome Sync

Compact cloud data is stored in `chrome.storage.sync`:

- Settings.
- Lifetime totals.
- Last 60 daily buckets.
- Top 20 site rollups.

On startup or install, Adblock hydrates local dashboard data from the cloud snapshot. Merge logic uses the highest observed values for counters so the same synced stats do not get counted twice.
