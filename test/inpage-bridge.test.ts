import { describe, expect, it } from 'bun:test'
import { rebuildJsonResponse } from '../src/content/inpage-bridge'

describe('rebuildJsonResponse', () => {
  it('serializes the pruned payload with the original status line', async () => {
    const original = new Response('{"a":1}', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    })
    const rebuilt = rebuildJsonResponse(original, { a: 2 })

    expect(rebuilt.status).toBe(200)
    expect(rebuilt.statusText).toBe('OK')
    expect(rebuilt.headers.get('content-type')).toBe('application/json')
    await expect(rebuilt.json()).resolves.toEqual({ a: 2 })
  })

  it('drops transport headers that describe the original body', () => {
    // content-length describes the unpruned body, and content-encoding /
    // transfer-encoding describe wire compression the browser already undid;
    // carrying any of them onto the rebuilt response can leave a consumer
    // waiting for bytes that never come.
    const original = new Response('{}', {
      headers: new Headers({
        'content-type': 'application/json',
        'content-length': '4123',
        'content-encoding': 'br',
        'transfer-encoding': 'chunked',
        'cache-control': 'no-store',
      }),
    })
    const rebuilt = rebuildJsonResponse(original, {})

    expect(rebuilt.headers.get('content-length')).toBeNull()
    expect(rebuilt.headers.get('content-encoding')).toBeNull()
    expect(rebuilt.headers.get('transfer-encoding')).toBeNull()
    expect(rebuilt.headers.get('content-type')).toBe('application/json')
    expect(rebuilt.headers.get('cache-control')).toBe('no-store')
  })

  it('preserves error statuses so failed calls still look failed', () => {
    const original = new Response('{"error":"gone"}', { status: 404, statusText: 'Not Found' })
    const rebuilt = rebuildJsonResponse(original, { error: 'gone' })

    expect(rebuilt.status).toBe(404)
    expect(rebuilt.statusText).toBe('Not Found')
    expect(rebuilt.ok).toBe(false)
  })
})
