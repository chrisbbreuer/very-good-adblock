---
title: Stats and Cloud Sync
description: Local-first tracking with compact Chrome sync restore for modern cross-install stats.
---

# Stats and Cloud Sync

Very Good AdBlock tracks stats locally first, then syncs a compact snapshot through Chrome so a fresh install can restore the important totals.

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
- Last 30 daily buckets.
- Top 15 site rollups.

These limits keep the snapshot under `chrome.storage.sync`'s 8 KB per-item quota; if it still runs over, the oldest daily buckets are dropped first, then trailing site rollups, until it fits.

On startup or install, Very Good AdBlock hydrates local dashboard data from the cloud snapshot. Merge logic uses the highest observed values for counters so the same synced stats do not get counted twice.
