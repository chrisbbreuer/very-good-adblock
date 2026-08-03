/**
 * Refuse to deploy when config/dns.ts has records to reconcile but nothing can
 * reconcile them.
 *
 * `buddy deploy` reads its DNS credentials from the environment and, finding
 * none, logs one `⚠ DNS: no DNS provider credentials found` line and carries
 * on. It is the third-to-last line of a two-hundred-line deploy that otherwise
 * says SUCCESS, so the deploy looks clean and the zone silently drifts from
 * what config/dns.ts declares. Two paths are skipped, not one: the apex and
 * www A records that point at the box just deployed to, and the config/dns.ts
 * reconciliation itself.
 *
 * A missing credential is a setup problem, so it stops the deploy here rather
 * than surfacing as stale DNS days later. `SKIP_DNS_CHECK=1` is the way past
 * it when a deploy genuinely should not touch DNS.
 *
 * Never prints a value: only which variables are present.
 */
import process from 'node:process'
import dns from '../../config/dns'

// Mirrors the provider table in @stacksjs/buddy's deploy command. Porkbun also
// accepts PORKBUN_SECRET_API_KEY as an alias for the secret half.
const PROVIDERS = [
  { name: 'Porkbun', vars: ['PORKBUN_API_KEY', 'PORKBUN_SECRET_KEY'], aliases: { PORKBUN_SECRET_KEY: 'PORKBUN_SECRET_API_KEY' } as Record<string, string> },
  { name: 'Cloudflare', vars: ['CLOUDFLARE_API_TOKEN'], aliases: {} as Record<string, string> },
  { name: 'GoDaddy', vars: ['GODADDY_API_KEY', 'GODADDY_API_SECRET'], aliases: {} as Record<string, string> },
  { name: 'Route 53', vars: ['AWS_ACCESS_KEY_ID'], aliases: { AWS_ACCESS_KEY_ID: 'AWS_PROFILE' } as Record<string, string> },
]

const has = (name: string, alias?: string): boolean =>
  Boolean(process.env[name]?.trim()) || Boolean(alias && process.env[alias]?.trim())

const recordCount = (['a', 'aaaa', 'cname', 'mx', 'txt', 'srv', 'ns', 'caa'] as const)
  .reduce((total, key) => total + ((dns as Record<string, unknown[]>)[key]?.length ?? 0), 0)

if (process.env.SKIP_DNS_CHECK) {
  console.log('DNS check skipped (SKIP_DNS_CHECK is set). The deploy will not reconcile DNS.')
  process.exit(0)
}

if (recordCount === 0) {
  console.log('config/dns.ts declares no records; nothing to reconcile.')
  process.exit(0)
}

const configured = PROVIDERS.filter(p => p.vars.every(v => has(v, p.aliases[v])))
if (configured.length) {
  console.log(`DNS credentials present: ${configured.map(p => p.name).join(', ')}. ${recordCount} declared records will be reconciled.`)
  process.exit(0)
}

// A half-configured provider is the likelier mistake, so say which half.
const partial = PROVIDERS.filter(p => p.vars.some(v => has(v, p.aliases[v])))

console.error(`config/dns.ts declares ${recordCount} records, but no DNS provider credentials are set.\n`)
for (const p of partial)
  console.error(`  ${p.name} is half configured. Missing: ${p.vars.filter(v => !has(v, p.aliases[v])).join(', ')}`)

if (!partial.length)
  console.error(`  Expected one of: ${PROVIDERS.map(p => p.vars.join(' + ')).join('  |  ')}`)

console.error(`
Add the pair to .env in the project root (Bun loads it automatically), see
.env.example for where to generate them. Without this the deploy still ships
the site, but the apex and www A records and everything in config/dns.ts are
left untouched.

To deploy without touching DNS on purpose:  SKIP_DNS_CHECK=1 bun run deploy`)

process.exit(1)
