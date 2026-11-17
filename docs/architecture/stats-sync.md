---
title: Stats and Cloud Sync
description: Local-first tracking, with each install's totals synced as its own share and added up for display.
---

# Stats and Cloud Sync

Very Good AdBlock tracks stats locally first. Each install publishes a compact summary of what it blocked, and every dashboard shows the sum across your installs.

## Lifetime Totals

Lifetime totals include:

- Ads blocked.
- Estimated bytes saved.
- Estimated video seconds saved.
- First tracking date.
- Last updated date.

## Local Storage

This install's own data stays in `chrome.storage.local`:

- Its lifetime totals, written on every block so nothing is lost if the service worker stops between syncs.
- Hourly history and recent events (never synced).
- Daily history and full per-site rollups (capped at 500 sites).
- A random install id, generated once.

## Chrome Sync

`chrome.storage.sync` holds:

- Settings.
- One share per install, under `statsDevice:<install id>`: that install's lifetime totals, its last 30 daily buckets and its top 15 sites. Each share is kept under the 8 KB per-item quota by dropping the oldest days first, then the smallest sites.
- `statsResetAt`, the reset epoch.
- `statsBaseline`, totals carried over from before shares existed (see below).

An install only ever writes its own share. Totals are the sum of all shares, so two installs blocking at the same moment cannot overwrite each other, and an idle install never repeats someone else's numbers. Per-site and daily figures are summed by key the same way.

## Reset

Resetting writes a new `statsResetAt` epoch and clears the local share. Every install compares the epoch with the one it last applied (on change, and at startup if it was off) and clears its own share when the epoch is newer. Shares and the baseline stamped with an older epoch are left out of the sum, so a reset sticks even before every install has caught up.

## Migrating From the Shared Snapshot

Earlier versions kept one shared lifetime total and merged copies by taking the larger value, so every install held roughly the same numbers. On upgrade those totals cannot become any one install's share without being counted once per install. They become the baseline instead: the larger of each figure across what this install and any install that migrated first had seen. The synced baseline is a single 8 KB item, so each install also keeps its full copy locally and combines it with the synced one by maximum, never by sum. The install's own share then starts from zero. After a reset the baseline is dropped with everything else.
