# Deploying the site

`https://verygoodadblock.org` is the marketing page (`pages/marketing.stx`) plus
the BunPress docs, assembled by `bun run site:build` into `dist/site/`.

It is served in **server mode** from a Hetzner box via
[`ts-cloud`](https://github.com/stacksjs/ts-cloud) and the rpx gateway. The site
is defined in the sibling `stacks` repo at `config/cloud.ts` (the
`verygoodadblock` / `verygoodadblockWww` entries, with `root: '../adblock/dist/site'`).
The alternate domain `very-good-adblock.org` is a 301 redirect to the canonical host.

## Deploy manually

From the `stacks` checkout, with your Hetzner token available:

```sh
HCLOUD_TOKEN=<your-token> ./buddy deploy production --site verygoodadblock --yes
```

`buddy deploy` wraps `ts-cloud`. The `--site verygoodadblock` filter makes it a
surgical single-site deploy: it builds and ships only `../adblock/dist/site`,
reloads the rpx gateway from the **full** site model (so other sites' routes are
never dropped), and upserts DNS for `verygoodadblock.org` only. Other sites on
the box (stacksjs.com, docs, blog) are left untouched.

A manual deploy also records a GitHub **Deployment** against this repo (buddy
derives the repo/commit from the deployed site's git worktree), so terminal
deploys show up in the [Deployments](https://github.com/chrisbbreuer/very-good-adblock/deployments)
tab just like CI ones. Set `TS_CLOUD_GITHUB_DEPLOYMENTS=0` to skip it.

## Deploy automatically (self-hosted runner)

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) redeploys on
every push to `main` that touches the site sources (or on manual
`workflow_dispatch`). It runs on a **self-hosted** runner so the Hetzner
credentials never leave the machine — both repos are public, so no production
secret is stored in GitHub Actions.

Each run is recorded as a GitHub **Deployment** against the `production`
environment (`https://verygoodadblock.org`), visible under the repo's
[Deployments](https://github.com/chrisbbreuer/very-good-adblock/deployments).

### Runner prerequisites

Register a self-hosted runner under **Settings → Actions → Runners**, on the
machine that has:

- `HCLOUD_TOKEN` in the runner's environment (buddy/ts-cloud reads `process.env`).
  Set it in the runner's `.env`, its service environment, or the shell that
  launches `./run.sh`.
- SSH access to the production box (the key ts-cloud uses to `scp`/`ssh`).
- Local sibling checkouts of `adblock` and `stacks`. The workflow defaults to
  `/Users/chris/Code/adblock` and `/Users/chris/Code/stacks`; override with the
  repo variables `ADBLOCK_DIR` / `STACKS_DIR` if your layout differs.

The workflow fast-forwards the local `adblock` checkout to the pushed commit
before deploying, then runs the single-site `buddy deploy` above. Until a runner
is registered, `deploy.yml` runs queue rather than fail — deploy manually in the
meantime.
