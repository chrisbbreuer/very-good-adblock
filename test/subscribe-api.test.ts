import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Point the app at a throwaway SQLite DB before importing the server (config/
// database.ts + server/serve.ts read DB_DATABASE_PATH at module init, and
// importing the server applies the migrations). Import dynamically so the env is
// set first.
const dir = mkdtempSync(join(tmpdir(), 'vga-subs-'))
process.env.DB_DATABASE_PATH = join(dir, 'verygoodadblock.sqlite')

let handleRequest: (req: Request) => Promise<Response>

beforeAll(async () => {
  ;({ handleRequest } = await import('../server/serve'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function post(body: Record<string, string>): Request {
  return new Request('http://local/api/email/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
}

describe('subscribe API (routes → Action → Subscriber model → SQLite)', () => {
  it('stores a new subscriber and normalizes the email', async () => {
    const res = await handleRequest(post({ email: 'Alice@Example.com', source: 'verygoodadblock' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, message: 'Subscribed' })
  })

  it('treats a repeat signup as an idempotent success', async () => {
    const res = await handleRequest(post({ email: 'alice@example.com' }))
    expect(await res.json()).toEqual({ success: true, message: 'Already subscribed' })
  })

  it('rejects an invalid email', async () => {
    const res = await handleRequest(post({ email: 'not-an-email' }))
    expect(await res.json()).toEqual({ success: false, message: 'Please enter a valid email address.' })
  })

  it('accepts a JSON body too', async () => {
    const req = new Request('http://local/api/email/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', source: 'features' }),
    })
    expect(await (await handleRequest(req)).json()).toEqual({ success: true, message: 'Subscribed' })
  })

  it('answers a health probe', async () => {
    const res = await handleRequest(new Request('http://local/api/health'))
    expect(await res.json()).toEqual({ ok: true })
  })

  it('404s an unknown path', async () => {
    const res = await handleRequest(new Request('http://local/api/nope'))
    expect(res.status).toBe(404)
  })
})
