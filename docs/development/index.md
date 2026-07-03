---
title: Development
description: Development workflow for the performant, minimal, modern Very Good AdBlock extension and docs.
---

# Development

Very Good AdBlock is a Bun TypeScript project with STX-authored extension UI and Bunpress-authored docs.

## Extension Build

```bash
bun run build           # Chrome, output to dist/
bun run build:firefox   # Firefox, output to dist-firefox/
```

Both targets share one codebase; `src/manifest.ts` generates the browser-specific `manifest.json` (service worker vs. event page, `browser_specific_settings.gecko`, etc.) at build time. See [Install](/guide/install) for loading and packaging each target.

## Docs

```bash
bun run docs:dev
bun run docs:build
bun run docs:preview
```

Docs are Markdown files in `docs/`, with Bunpress config in `.config/docs.ts`.

## Generated Rules

```bash
bun run update:filters
bun run validate:rules
```

Filter sources are pinned and attributed in the repository.
