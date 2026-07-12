/**
 * Sync config/dns.ts records to Porkbun for verygoodadblock.org.
 *
 * Runs on every production deploy (see .github/workflows/deploy.yml) and can be
 * run by hand with `bun run dns:sync` (needs PORKBUN_API_KEY / PORKBUN_SECRET_KEY
 * in the environment). `bun run dns:pull` lists the domain's current records
 * without writing.
 *
 * SAFETY: the sync is additive and idempotent. For each record declared in
 * config/dns.ts it will:
 *   - skip it if an identical record already exists,
 *   - for single-value types (A/AAAA/CNAME) update the existing record of that
 *     name+type in place,
 *   - for multi-value types (TXT/MX) create a new record alongside the others.
 * It never deletes a record it did not create, so the apex/www A records the
 * ts-cloud deploy manages and the mail SPF/MX records are never clobbered.
 */
import type { DnsConfig } from '@stacksjs/types'
import dnsConfig from '../config/dns'

const API = 'https://api.porkbun.com/api/json/v3'
const DOMAIN = process.env.APP_DOMAIN || 'verygoodadblock.org'
const apikey = process.env.PORKBUN_API_KEY
const secretapikey = process.env.PORKBUN_SECRET_KEY
const pullOnly = Bun.argv.includes('--pull')

interface PorkbunRecord {
  id: string
  name: string
  type: string
  content: string
  ttl: string
  prio?: string
}

interface DesiredRecord {
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT'
  subdomain: string // Porkbun's per-record host: '' for the apex, e.g. 'www'
  fqdn: string
  content: string
  ttl: number
  prio?: number
  multi: boolean // TXT/MX may coexist; A/AAAA/CNAME are single-valued
}

// Porkbun's minimum TTL is 600s.
function ttlOf(ttl: number | 'auto' | undefined): number {
  const n = ttl === 'auto' || ttl == null ? 600 : ttl
  return Math.max(600, n)
}

function fqdn(name: string): string {
  return name === '@' || name === '' ? DOMAIN : `${name}.${DOMAIN}`
}

function subdomainOf(name: string): string {
  return name === '@' || name === '' ? '' : name
}

function desiredRecords(cfg: DnsConfig): DesiredRecord[] {
  const out: DesiredRecord[] = []
  for (const r of cfg.txt ?? [])
    out.push({ type: 'TXT', subdomain: subdomainOf(r.name), fqdn: fqdn(r.name), content: r.content, ttl: ttlOf(r.ttl), multi: true })
  for (const r of cfg.a ?? [])
    out.push({ type: 'A', subdomain: subdomainOf(r.name), fqdn: fqdn(r.name), content: r.address, ttl: ttlOf(r.ttl), multi: false })
  for (const r of cfg.aaaa ?? [])
    out.push({ type: 'AAAA', subdomain: subdomainOf(r.name), fqdn: fqdn(r.name), content: r.address, ttl: ttlOf(r.ttl), multi: false })
  for (const r of cfg.cname ?? [])
    out.push({ type: 'CNAME', subdomain: subdomainOf(r.name), fqdn: fqdn(r.name), content: r.target, ttl: ttlOf(r.ttl), multi: false })
  for (const r of cfg.mx ?? [])
    out.push({ type: 'MX', subdomain: subdomainOf(r.name), fqdn: fqdn(r.name), content: r.mailServer, ttl: ttlOf(r.ttl), prio: r.priority, multi: true })
  return out
}

async function porkbun(path: string, body: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apikey, secretapikey, ...body }),
  })
  const json = await res.json().catch(() => ({})) as { status?: string, message?: string, records?: PorkbunRecord[], id?: number }
  if (json.status !== 'SUCCESS')
    throw new Error(`Porkbun ${path} failed: ${json.message || res.status}`)
  return json
}

async function main(): Promise<void> {
  if (!apikey || !secretapikey) {
    // Best-effort: never fail the deploy just because DNS creds are absent.
    console.warn('[dns] PORKBUN_API_KEY / PORKBUN_SECRET_KEY not set — skipping DNS sync.')
    return
  }

  const { records = [] } = await porkbun(`/dns/retrieve/${DOMAIN}`) as { records: PorkbunRecord[] }

  if (pullOnly) {
    console.log(`[dns] ${DOMAIN} has ${records.length} records:`)
    for (const r of records)
      console.log(`  ${r.type.padEnd(5)} ${r.name.padEnd(32)} ${r.content}${r.prio && r.prio !== '0' ? ` (prio ${r.prio})` : ''}`)
    return
  }

  // Porkbun may return TXT content wrapped in quotes; compare unwrapped so a
  // re-run recognizes its own record instead of creating a duplicate.
  const unquote = (s: string): string => s.replace(/^"(.*)"$/s, '$1')

  let created = 0
  let updated = 0
  let unchanged = 0
  let failed = 0

  for (const want of desiredRecords(dnsConfig)) {
    const sameNameType = records.filter(r => r.type === want.type && r.name === want.fqdn)
    if (sameNameType.some(r => unquote(r.content) === unquote(want.content))) {
      unchanged += 1
      console.log(`[dns] ok    ${want.type} ${want.fqdn} already set`)
      continue
    }

    const payload: Record<string, unknown> = { name: want.subdomain, type: want.type, content: want.content, ttl: String(want.ttl) }
    if (want.prio != null) payload.prio = String(want.prio)

    try {
      // Single-valued types replace the existing record of that name+type in
      // place; multi-valued types (TXT/MX) are added alongside the others.
      if (!want.multi && sameNameType[0]) {
        await porkbun(`/dns/edit/${DOMAIN}/${sameNameType[0].id}`, payload)
        updated += 1
        console.log(`[dns] edit  ${want.type} ${want.fqdn} → ${want.content}`)
      }
      else {
        await porkbun(`/dns/create/${DOMAIN}`, payload)
        created += 1
        console.log(`[dns] add   ${want.type} ${want.fqdn} → ${want.content}`)
      }
    }
    catch (err) {
      failed += 1
      console.error(`[dns] FAIL  ${want.type} ${want.fqdn}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`[dns] done: ${created} created, ${updated} updated, ${unchanged} unchanged, ${failed} failed`)
  if (failed > 0)
    process.exitCode = 1
}

await main()
