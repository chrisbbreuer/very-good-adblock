import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'vga-subs-'))
process.env.DB_DATABASE_PATH = join(dir, 'verygoodadblock.sqlite')

let subscribe: (params: Record<string, string>) => Promise<{ success: boolean, message: string }>

beforeAll(async () => {
  const db = new Database(process.env.DB_DATABASE_PATH, { create: true })
  for (const file of readdirSync('database/migrations').filter(file => file.endsWith('.sql')).sort())
    db.exec(readFileSync(join('database/migrations', file), 'utf8'))
  db.close()
  ;({ subscribe } = await import('../app/Actions/SubscriberEmailAction'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('native Stacks subscribe action', () => {
  it('stores a new subscriber and normalizes the email', async () => {
    expect(await subscribe({ email: 'Alice@Example.com', source: 'verygoodadblock' })).toEqual({ success: true, message: 'Subscribed' })
  })

  it('treats a repeat signup as an idempotent success', async () => {
    expect(await subscribe({ email: 'alice@example.com' })).toEqual({ success: true, message: 'Already subscribed' })
  })

  it('rejects an invalid email', async () => {
    expect(await subscribe({ email: 'not-an-email' })).toEqual({ success: false, message: 'Please enter a valid email address.' })
  })

  it('accepts values parsed from JSON and form requests alike', async () => {
    expect(await subscribe({ email: 'bob@example.com', source: 'features' })).toEqual({ success: true, message: 'Subscribed' })
  })
})
