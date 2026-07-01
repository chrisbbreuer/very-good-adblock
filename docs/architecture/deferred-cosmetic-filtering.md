---
title: Deferred Cosmetic Filtering
description: Why cosmetic DOM hiding is disabled and what has to be true before it returns.
---

# Deferred Cosmetic Filtering

Cosmetic filtering is disabled for now.

The first implementation hid generic ad containers plus YouTube, Twitch, and X/Twitter page elements from a content script. That looked useful on simple fixtures, but broad DOM hiding is risky on modern video and social apps. YouTube in particular changes player and layout internals often, and hiding the wrong container can interfere with playback, navigation, comments, recommendations, or Shorts.

## Current Behavior

Very Good AdBlock currently keeps:

- MV3 `declarativeNetRequest` blocking.
- Dynamic allow/block site rules.
- YouTube skip-button automation when the skip control is visible.
- Twitch video-ad marker detection for estimated saved-time stats.
- Local and Chrome sync stats.

It does not currently:

- Hide generic ad containers.
- Hide YouTube display ad modules or companion slots.
- Hide Twitch overlays or player notices.
- Remove X/Twitter promoted feed entries.

## Reimplementation Requirements

Before cosmetic filtering comes back, it should have:

- Site-specific selectors instead of broad generic matches.
- A per-site kill switch that can disable cosmetic behavior without disabling network blocking.
- Tests that assert YouTube watch, Shorts, comments, navigation, and playback still work.
- Fixture coverage for late-loading page mutations.
- A narrow default-on set and an advanced opt-in set for riskier selectors.
- Clear diagnostics showing which selector acted on a page.

The goal is still to remove obstructions immediately, but only in a way that does not make the page more broken than the ad.
