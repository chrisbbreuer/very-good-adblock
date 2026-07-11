/**
 * Very Good AdBlock — subscribe API server (lean runtime).
 *
 * Serves the app's routes/api.ts over HTTP and applies the database migrations,
 * backing the marketing page's "notify me when it hits the stores" form. It runs
 * as a systemd service on the shared stacks box (see config/cloud.ts → sites.api)
 * and rpx routes `verygoodadblock.org/api/*` to it, so the browser posts
 * same-origin (no CORS).
 *
 * The actual persistence goes through the real Stacks ORM: routes/api.ts →
 * app/Actions/SubscriberEmailAction.ts → app/Models/Subscriber.ts, which reads
 * its SQLite connection from config/database.ts (DB_DATABASE_PATH). This server
 * only owns the HTTP layer + migrations, so it stays dependency-light and does
 * not need the framework's full feature system to boot.
 */
import { Database } from 'bun:sqlite'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { routes } from '../routes/api'

const PORT = Number(process.env.PORT || 3010)
const HOST = process.env.HOST || '127.0.0.1'
// Must match config/database.ts so the model writes to the DB we migrate here.
const DB_PATH = process.env.DB_DATABASE_PATH || 'database/verygoodadblock.sqlite'
const MIGRATIONS_DIR = join(import.meta.dir, '..', 'database', 'migrations')

// Apply migrations idempotently on boot. Every generated file is
// `CREATE ... IF NOT EXISTS`, so re-running each release is safe.
function migrate(): void {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  const db = new Database(DB_PATH, { create: true })
  db.exec('PRAGMA journal_mode = WAL;')
  for (const file of readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort())
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  db.close()
}
migrate()

// Per-IP throttle. The endpoint is unauthenticated so bots will find it; 10/min
// is generous for a real human filling the same form repeatedly.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10
const hits = new Map<string, { count: number, resetAt: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const rec = hits.get(ip)
  if (!rec || now > rec.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  rec.count += 1
  return rec.count > MAX_PER_WINDOW
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function readParams(req: Request): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json'))
    return (await req.json().catch(() => ({}))) as Record<string, string>
  return Object.fromEntries(new URLSearchParams(await req.text()))
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  return forwarded ? forwarded.split(',')[0].trim() : 'local'
}

/**
 * Handle a request. Exported so a local dev proxy (mimicking rpx: static files +
 * `/api`) and tests can reuse the exact production dispatch.
 */
export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)

  // Liveness probe for smoke checks / rpx health.
  if (req.method === 'GET' && url.pathname === '/api/health')
    return json({ ok: true })

  const matched = routes.find(r => r.path === url.pathname)
  if (matched) {
    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204 })
    if (req.method !== matched.method)
      return json({ success: false, message: 'Method not allowed' }, 405)

    if (rateLimited(clientIp(req)))
      return json({ success: false, message: 'Too many attempts. Please try again in a minute.' }, 429)

    const result = await matched.handler(await readParams(req))
    return json(result)
  }

  return json({ success: false, message: 'Not found' }, 404)
}

// Only listen when run directly (the systemd `start` command), not when imported
// by the dev proxy or a test.
if (import.meta.main) {
  const server = Bun.serve({ port: PORT, hostname: HOST, fetch: handleRequest })
  // eslint-disable-next-line no-console
  console.log(`subscribe API listening on http://${server.hostname}:${server.port} (db: ${DB_PATH})`)
}
