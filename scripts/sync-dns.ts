/**
 * DNS tooling for verygoodadblock.org.
 *
 *   bun run dns:sync   push config/dns.ts to Porkbun (deploy step; needs
 *                      PORKBUN_API_KEY / PORKBUN_SECRET_KEY)
 *   bun run dns:pull   read the zone's live records (public DNS, no creds) and
 *                      print them as a config/dns.ts block to diff/paste
 *
 * SAFETY (sync): the reconcile is strictly additive. For each record declared in
 * config/dns.ts it will only ever CREATE a record that is missing; it never
 * deletes a record and never overwrites an existing one:
 *   - single-valued types (A/AAAA/CNAME): if a record of that name+type already
 *     exists it is left exactly as-is (so the apex/www A that the ts-cloud deploy
 *     manages is never clobbered, even if the value here is stale),
 *   - multi-valued types (TXT/MX): a record is added only if an identical one is
 *     not already present (so the google-verification TXT is added alongside the
 *     SPF TXT, never replacing it).
 * Nothing is ever deleted, so a deploy can only ever add a missing record.
 */
import type { DnsConfig } from '@stacksjs/types'
import { promises as resolver } from 'node:dns'
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

// Porkbun may return TXT content wrapped in quotes; compare unwrapped so a re-run
// recognizes its own record instead of creating a duplicate.
function unquote(s: string): string {
  return s.replace(/^"(.*)"$/s, '$1')
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

/**
 * Read the zone's live records over public DNS (no registrar credentials) and
 * print them as a config/dns.ts block, so config/dns.ts can be diffed against
 * reality and kept complete. This is the resolver-only "pull" half of the tool.
 */
async function pull(): Promise<void> {
  const ok = async <T>(p: Promise<T>): Promise<T | []> => p.catch(() => [] as unknown as T)
  const [apex, www, aaaa, txt, mx, ns] = await Promise.all([
    ok(resolver.resolve4(DOMAIN)),
    ok(resolver.resolve4(`www.${DOMAIN}`)),
    ok(resolver.resolve6(DOMAIN)),
    ok(resolver.resolveTxt(DOMAIN)),
    ok(resolver.resolveMx(DOMAIN)),
    ok(resolver.resolveNs(DOMAIN)),
  ])

  const lines: string[] = [`// Live records for ${DOMAIN} (pulled via public DNS):`]
  lines.push('a: [')
  for (const ip of apex as string[]) lines.push(`  { name: '@', address: '${ip}', ttl: 600 },`)
  for (const ip of www as string[]) lines.push(`  { name: 'www', address: '${ip}', ttl: 600 },`)
  lines.push('],')
  if ((aaaa as string[]).length) {
    lines.push('aaaa: [')
    for (const ip of aaaa as string[]) lines.push(`  { name: '@', address: '${ip}', ttl: 600 },`)
    lines.push('],')
  }
  lines.push('txt: [')
  for (const chunks of txt as string[][]) lines.push(`  { name: '@', ttl: 'auto', content: ${JSON.stringify(chunks.join(''))} },`)
  lines.push('],')
  lines.push('mx: [')
  for (const r of mx as { priority: number, exchange: string }[]) lines.push(`  { name: '@', mailServer: '${r.exchange}', ttl: 'auto', priority: ${r.priority} },`)
  lines.push('],')
  lines.push(`nameservers: [${(ns as string[]).map(n => `'${n}'`).join(', ')}],`)
  console.log(lines.join('\n'))
}

async function sync(): Promise<void> {
  if (!apikey || !secretapikey) {
    // Best-effort: never fail the deploy just because DNS creds are absent.
    console.warn('[dns] PORKBUN_API_KEY / PORKBUN_SECRET_KEY not set — skipping DNS sync.')
    return
  }

  const { records = [] } = await porkbun(`/dns/retrieve/${DOMAIN}`) as { records: PorkbunRecord[] }

  let created = 0
  let kept = 0
  let failed = 0

  for (const want of desiredRecords(dnsConfig)) {
    const sameNameType = records.filter(r => r.type === want.type && r.name === want.fqdn)

    // Single-valued types: if any record of this name+type exists, leave it
    // untouched (never overwrite — e.g. the apex A that ts-cloud manages).
    // Multi-valued types: skip only if an identical record already exists.
    const present = want.multi
      ? sameNameType.some(r => unquote(r.content) === unquote(want.content))
      : sameNameType.length > 0

    if (present) {
      kept += 1
      console.log(`[dns] keep  ${want.type} ${want.fqdn}${want.multi ? ` ${want.content}` : ''}`)
      continue
    }

    const payload: Record<string, unknown> = { name: want.subdomain, type: want.type, content: want.content, ttl: String(want.ttl) }
    if (want.prio != null) payload.prio = String(want.prio)

    try {
      await porkbun(`/dns/create/${DOMAIN}`, payload)
      created += 1
      console.log(`[dns] add   ${want.type} ${want.fqdn} → ${want.content}`)
    }
    catch (err) {
      failed += 1
      console.error(`[dns] FAIL  ${want.type} ${want.fqdn}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`[dns] done: ${created} created, ${kept} kept, ${failed} failed`)
  if (failed > 0)
    process.exitCode = 1
}

await (pullOnly ? pull() : sync())
