---
title: Development
description: Development workflow for the Adblock extension and docs.
---

# Development

Adblock is a Bun TypeScript project with STX-authored extension UI and Bunpress-authored docs.

## Extension Build

```bash
bun run build
```

Build output goes to `dist/`.

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
