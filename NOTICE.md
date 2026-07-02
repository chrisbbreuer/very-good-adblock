# Notices

Very Good AdBlock v0.1.0 ships a curated seed ruleset maintained in this repository plus generated static network host rules from pinned public filter-list revisions.

Generated host rules are committed in `rules/generated/network-hosts.json`. They are produced by `bun run update:filters` from exact immutable upstream Git revisions listed in `rules/filter-sources.json`; each generated source entry includes the raw URL, revision, license label, host count, and SHA-256 of the fetched source text.

Sources currently include pinned files from:

- EasyList, GPL-3.0-or-later, <https://github.com/easylist/easylist>
- AdGuard Filters, GPL-3.0-or-later, <https://github.com/AdguardTeam/AdguardFilters>

## Technique credits

The source-level ad pruners follow uBlock Origin's approach
(<https://github.com/uBlockOrigin/uAssets>); the implementations here are
original — no uBlock code is included.

- X / Twitter: removes timeline entries carrying
  `content.itemContent.promotedMetadata` from GraphQL responses.
- YouTube: removes `adPlacements` / `adSlots` / `playerAds` from player
  responses (inline `ytInitialPlayerResponse` and the `/youtubei/v1/player` API).
