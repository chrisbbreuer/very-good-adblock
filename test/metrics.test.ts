import { describe, expect, it } from 'bun:test'
import { categoryForRequestType, estimateBytesSaved, estimateVideoAdBytes, estimateVideoSecondsSaved, eventTotals, formatBytes, formatMinutes } from '../src/shared/metrics'

describe('metrics', () => {
  it('formats estimated savings', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatMinutes(90)).toBe('1.5 min')
  })

  it('estimates modest per-request savings', () => {
    // Tracker pings/beacons dominate blocked traffic and are tiny; a blocked
    // media request is one segment, not a whole video ad.
    expect(estimateBytesSaved('xhr')).toBe(2_000)
    expect(estimateBytesSaved('media')).toBe(250_000)
    expect(estimateBytesSaved('script')).toBe(40_000)
    expect(estimateVideoAdBytes()).toBe(2_500_000)
    expect(estimateVideoSecondsSaved()).toBe(15)
  })

  it('maps request types to stat categories', () => {
    expect(categoryForRequestType('script')).toBe('script')
    expect(categoryForRequestType('image')).toBe('image')
    expect(categoryForRequestType('media')).toBe('media')
    expect(categoryForRequestType('stylesheet')).toBe('stylesheet')
    expect(categoryForRequestType('font')).toBe('font')
    expect(categoryForRequestType('xmlhttprequest')).toBe('xhr')
    expect(categoryForRequestType('ping')).toBe('xhr')
    expect(categoryForRequestType('websocket')).toBe('xhr')
    expect(categoryForRequestType('main_frame')).toBe('document')
    expect(categoryForRequestType('sub_frame')).toBe('document')
    expect(categoryForRequestType('csp_report')).toBe('other')
    expect(categoryForRequestType('something-else')).toBe('other')
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
