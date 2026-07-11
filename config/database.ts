import type { DatabaseConfig } from '@stacksjs/types'
import type { SupportedDialect } from 'bun-query-builder'
import { env } from '@stacksjs/env'

/**
 * Database configuration. Very Good AdBlock only needs a small, self-contained
 * SQLite database for newsletter subscribers, so SQLite is the default. The file
 * lives under database/ (persisted across deploys via the site's shared dir).
 */
export default {
  default: (env.DB_CONNECTION as SupportedDialect) || 'sqlite',

  connections: {
    sqlite: {
      database: env.DB_DATABASE_PATH || 'database/verygoodadblock.sqlite',
      prefix: '',
    },
  },

  migrations: 'migrations',
  migrationLocks: 'migration_locks',
} satisfies DatabaseConfig
