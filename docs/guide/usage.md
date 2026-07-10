---
title: Usage
description: Use the minimal popup and dashboard to manage protection, stats, and site rules.
---

# Usage

The popup is designed for quick, lightweight decisions while browsing. The dashboard is for deeper history, settings, diagnostics, and reset/export controls.

<p align="center">
  <img src="../../screenshots/dashboard.png" alt="The Very Good AdBlock dashboard: 52,914 lifetime blocks, a 60-day history chart, and protection toggles for cosmetic hiding, cookie banners, pop-up blocking, and YouTube/Twitch helpers." width="760">
</p>

## Popup

Use the popup to:

- Toggle global protection, or pause it for 15, 30, or 60 minutes (it resumes
  automatically, with a live countdown).
- Allow or protect the current site.
- See how many items were blocked on the current page visit (network requests
  plus hidden placements), updating live while the popup is open.
- View lifetime blocked count and estimated data and video time saved.
- Scan the last 24 hours and top blocked categories.
- Report an ad that slipped through in one click. **"Saw an ad slip through?"**
  opens a fully pre-filled GitHub issue (extension version, browser, page, and
  block counts auto-attached, with no browsing history) and copies a screenshot
  of the page to your clipboard to paste in.

## Dashboard

Use the options dashboard to:

- Review lifetime stats and 60-day history.
- Manage allowed and blocked sites, and import/export the allowlist as JSON.
- Toggle YouTube skip assist, Twitch video detection, cookie-banner hiding, pop-up/pop-under blocking, and badge counts.
- Update the network filter list on demand ("Update filters").
- Export or reset local stats.
- Inspect filter and cloud-sync diagnostics.
- Report an ad that slipped through ("Report an ad") — same pre-filled GitHub
  issue as the popup.

## Stats

Exact network byte savings are not exposed by Chrome MV3 for every blocked item, so data saved and video minutes saved are clearly treated as estimates. Counts and local events are stored locally first, then compact lifetime and daily history are synced through Chrome.
