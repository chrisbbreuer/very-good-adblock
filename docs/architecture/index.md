---
title: Blocking Model
description: How Adblock combines DNR rules, dynamic rules, and content scripts.
---

# Blocking Model

Adblock uses a balanced Manifest V3 architecture:

- Static `declarativeNetRequest` rules for known network ad domains and URL patterns.
- Dynamic `declarativeNetRequest` rules for user site overrides.
- Content scripts for cosmetic cleanup, promoted-content removal, and video-ad skip automation.
- Chrome storage for settings, stats, and cross-install sync.

## Static Rules

Static rules are generated at build time from pinned filter sources and curated seeds. They are shipped with the extension and loaded by Chrome through the MV3 ruleset manifest.

## Dynamic Rules

Dynamic rules are derived from settings:

- Allowed sites receive allow rules.
- Manually blocked sites receive block rules.
- Rules are bounded to the configured dynamic ID range.

## Content Cleanup

Content scripts handle cases that network blocking cannot cover safely:

- Cosmetic ad containers.
- YouTube ad modules and display placements.
- X/Twitter promoted articles and tracking placements.
- Skip buttons that are visible and actionable.

The goal is to remove interruptions without brittle page-breaking media hacks.
