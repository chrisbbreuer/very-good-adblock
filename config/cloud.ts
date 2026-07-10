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

    // www → apex redirect.
    verygoodadblockWww: {
      domain: 'www.verygoodadblock.org',
      redirect: 'https://verygoodadblock.org',
    },
  },
}

export default tsCloud
