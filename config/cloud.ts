import type { CloudConfig as TsCloudConfig } from '@stacksjs/ts-cloud'
import { env } from '@stacksjs/env'

/**
 * ts-cloud configuration — verygoodadblock.org.
 *
 * This repo builds a static marketing/docs site (`bun run site:build` →
 * `dist/site`) and ships it to the shared `stacks` Hetzner box as an additive
 * rpx site. Previously verygoodadblock.org lived in the stacks repo's config
 * and deployed via `./buddy deploy --site verygoodadblock`; this makes the
 * project self-contained (un-pollutes stacks).
 */
export const tsCloud: TsCloudConfig = {
  project: {
    name: 'verygoodadblock',
    slug: 'verygoodadblock',
    region: 'us-east-1',
  },

  cloud: {
    provider: 'hetzner',
    // Attach to the shared box owned by the `stacks` project — resolve the
    // `stacks-<env>-app` server, ship only this static site, add an additive
    // rpx fragment + DNS. Never touches the box lifecycle or other tenants.
    attachTo: 'stacks',
  },

  mode: 'server',

  environments: {
    production: {
      type: 'production',
      // Push to `main` → deploy here (bare apex verygoodadblock.org).
      deployBranch: 'main',
      region: 'us-east-1',
      variables: {
        NODE_ENV: 'production',
      },
    },
  },

  sites: {
    // Static site: rpx serves the pre-built files directly (no app process).
    // `build` runs in CI before packaging; `root` is the build output.
    verygoodadblock: {
      deploy: 'server',
      root: 'dist/site',
      path: '/',
      domain: env.APP_DOMAIN || 'verygoodadblock.org',
      build: 'bun run site:build',
      pathRewriteStyle: 'directory',
    },

    // Subscribe API: native Stacks routes, actions, ORM, migrations, and
    // `buddy serve:api`, run as a systemd service. rpx routes the SAME domain by
    // longest path prefix, so `/api/*` hits this process and everything else
    // stays static above — the marketing form posts same-origin (no CORS). Bound
    // to loopback (HOST=127.0.0.1); rpx is the only public entry.
    //
    // The server needs the app source + node_modules (the ORM model), so it ships
    // the repo (source only; heavy dirs excluded) and installs on the box via
    // preStart. The SQLite db lives under storage/, which ts-cloud symlinks from
    // the site's shared dir into every release (sharedPaths defaults to
    // ['storage', '.env']), so subscribers persist across deploys; the migrations
    // ship in database/migrations and are applied on boot. Port 3010 avoids the
    // box's stacks apps (3000/3008).
    api: {
      deploy: 'server',
      root: '.',
      path: '/api',
      domain: env.APP_DOMAIN || 'verygoodadblock.org',
      start: 'bun node_modules/@stacksjs/buddy/dist/cli.js serve:api',
      port: 3010,
      preStart: [
        'bun install --frozen-lockfile',
        'bun node_modules/@stacksjs/buddy/dist/cli.js migrate --no-auth --force',
      ],
      exclude: ['node_modules', '.git', '.cache', '.qb', '.stx', 'dist', 'dist-firefox', '*.zip', 'pantry', 'bench'],
      env: {
        HOST: '127.0.0.1',
        PORT: '3010',
        APP_ENV: 'production',
        DB_CONNECTION: 'sqlite',
        DB_DATABASE_PATH: 'storage/subscribers.sqlite',
      },
    },

    // www → apex redirect.
    verygoodadblockWww: {
      domain: 'www.verygoodadblock.org',
      redirect: 'https://verygoodadblock.org',
    },

    // Legacy hyphenated domain → canonical domain. Declaring these as rpx
    // redirect sites makes ts-cloud upsert both zones to the shared Hetzner box,
    // provision their TLS names, and keep the request path/query intact.
    veryGoodAdblockLegacy: {
      domain: 'very-good-adblock.org',
      redirect: 'https://verygoodadblock.org',
    },
    veryGoodAdblockLegacyWww: {
      domain: 'www.very-good-adblock.org',
      redirect: 'https://verygoodadblock.org',
    },
  },
}

export default tsCloud
