import type { DnsConfig } from '@stacksjs/types'

/**
 * DNS records for verygoodadblock.org.
 *
 * Synced to Porkbun on deploy by `scripts/sync-dns.ts` (also `bun run dns:sync`).
 * The sync is additive and idempotent: it only ever creates or updates the exact
 * records declared here and never deletes anything else, so the apex/www A
 * records that the ts-cloud deploy manages, and the mail SPF/MX records, are left
 * untouched. Declare only the extra records this project owns.
 */
const dns: DnsConfig = {
  txt: [
    {
      // Google Search Console domain-ownership verification for verygoodadblock.org.
      name: '@',
      ttl: 'auto',
      content: 'google-site-verification=6JSNOKCPD4ArMJcWRbxdMeOTrr7QvuEJiA1MkoGFtgw',
    },
  ],
}

export default dns
