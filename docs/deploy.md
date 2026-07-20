# Deploying the site

`<https://verygoodadblock.org>` is the marketing site (`resources/views/`) plus
the BunPress docs, assembled by `bun run site:build` into `dist/site/`, with a
small subscribe API (`app/`, `routes/api.ts`, `server/serve.ts`) served
same-origin at `/api`.

It is served in **server mode** from a shared stacks box via
[`ts-cloud`](https://github.com/stacksjs/ts-cloud) and the rpx gateway. Deploying
attaches to the existing `stacks-production-app`, adds an **additive** rpx site
for `verygoodadblock.org` (plus its DNS), and never touches the box lifecycle or
the other tenants on it. The alternate domain `very-good-adblock.org` is a 301
redirect to the canonical host.

## Deploy automatically (GitHub Actions)

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) redeploys on
**every push to `main`** (and on manual `workflow_dispatch`). It runs on a
GitHub-hosted `ubuntu-latest` runner: it installs deps, adds the deploy SSH key,
builds the static site, and runs

```sh
bun node_modules/@stacksjs/buddy/dist/cli.js deploy --prod --yes
```

The credentials come from repository **secrets**, so nothing sensitive lives in
the workflow file:

- `HCLOUD_TOKEN` — Hetzner API token ts-cloud uses to reach the box.
- `DEPLOY_SSH_KEY` — SSH key ts-cloud uses to `scp`/`ssh` the built site over.
- `PORKBUN_API_KEY` / `PORKBUN_SECRET_KEY` — DNS provider credentials for
  upserting the `verygoodadblock.org` records.

Each run is recorded as a GitHub **Deployment** against the `production`
environment (`<https://verygoodadblock.org>`), visible under the repo's
[Deployments](https://github.com/chrisbbreuer/very-good-adblock/deployments) and
Actions tabs.

## Deploy manually

Trigger the same workflow without pushing a commit:

```sh
gh workflow run "Deploy site"
```

Or, from a local checkout with the same environment variables exported
(`HCLOUD_TOKEN`, `DEPLOY_SSH_KEY` on disk, `PORKBUN_API_KEY`,
`PORKBUN_SECRET_KEY`), run the build and the same deploy command the workflow
uses:

```sh
bun run site:build
bun node_modules/@stacksjs/buddy/dist/cli.js deploy --prod --yes
```

`buddy deploy` wraps `ts-cloud`: it ships only `dist/site`, reloads the rpx
gateway from the **full** site model (so other sites' routes are never dropped),
and upserts DNS for `verygoodadblock.org` only.
