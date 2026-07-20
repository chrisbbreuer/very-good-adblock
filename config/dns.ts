import type { DnsConfig } from '@stacksjs/types'

/**
 * DNS records for verygoodadblock.org — the complete, declared picture of the
 * zone. Regenerate/verify against live DNS with `bun run dns:pull`.
 *
 * `buddy dns:sync` (also exposed as `bun run dns:sync`) reconciles these to
 * Porkbun **safely**:
 *   - it only ever CREATES records that are declared here but missing,
 *   - it never deletes a record, and never overwrites an existing one.
 * So records managed elsewhere are documented here for completeness but are
 * never clobbered: the apex + `www` A records are (re)set to the box IP by the
 * ts-cloud deploy, and the SPF TXT + MX come from the shared mail tenant. If the
 * box IP changes, ts-cloud updates the A records on deploy — the value below is
 * documentation, and the sync leaves the live record alone.
 */
const dns: DnsConfig = {
  a: [
    { name: '@', address: '178.105.248.188', ttl: 600 }, // apex → stacks box (managed by ts-cloud deploy)
    { name: 'www', address: '178.105.248.188', ttl: 600 }, // www → box; rpx 301-redirects to the apex
  ],

  txt: [
    { name: '@', ttl: 'auto', content: 'v=spf1 ip4:178.105.248.188 ~all' }, // SPF (mail tenant)
    { name: '@', ttl: 'auto', content: 'google-site-verification=6JSNOKCPD4ArMJcWRbxdMeOTrr7QvuEJiA1MkoGFtgw' }, // Google Search Console
  ],

  mx: [
    { name: '@', mailServer: 'mail.stacksjs.com', ttl: 'auto', priority: 10 }, // mail (mail tenant)
  ],

  // Registrar-level (Porkbun) nameservers, recorded for reference. Not pushed by
  // the sync — nameserver delegation is managed at the registrar, not as a record.
  nameservers: [
    'curitiba.ns.porkbun.com',
    'fortaleza.ns.porkbun.com',
    'maceio.ns.porkbun.com',
    'salvador.ns.porkbun.com',
  ],
}

export default dns
