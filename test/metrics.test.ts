import { describe, expect, it } from 'bun:test'
import { estimateBytesSaved, eventTotals, formatBytes, formatMinutes } from '../src/shared/metrics'

describe('metrics', () => {
  it('formats estimated savings', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatMinutes(90)).toBe('1.5 min')
  })

  it('rolls up block events', () => {
    const totals = eventTotals([
      {
        hostname: 'example.com',
        source: 'dnr',
        category: 'image',
        count: 2,
        bytesSaved: estimateBytesSaved('image', 2),
        occurredAt: new Date().toISOString(),
      },
    ])

    expect(totals.adsBlocked).toBe(2)
    expect(totals.bytesSaved).toBeGreaterThan(0)
  })
})
