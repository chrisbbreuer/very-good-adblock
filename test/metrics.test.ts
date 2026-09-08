import { describe, expect, it } from 'bun:test'
import { categoryForRequestType, estimateBytesSaved, estimateVideoAdBytes, estimateVideoSecondsSaved, eventTotals, formatBytes, formatMinutes, hourBucketKey, hourlySeries, localDayKey } from '../src/shared/metrics'

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

  it('keys days by the local calendar, not UTC', () => {
    // 23:30 local must stay on the local day regardless of the host timezone —
    // this is what makes "Blocked today" roll over at local midnight.
    expect(localDayKey(new Date(2026, 6, 5, 23, 30))).toBe('2026-07-05')
    expect(localDayKey(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
    expect(localDayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
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

  it('pins hourly buckets to the hour they happened in', () => {
    const now = new Date('2026-09-07T12:30:00.000Z')
    const buckets = [
      { key: '2026-09-07T03', adsBlocked: 300, bytesSaved: 0, videoSecondsSaved: 0 },
      { key: '2026-09-07T12', adsBlocked: 5, bytesSaved: 0, videoSecondsSaved: 0 },
    ]

    const series = hourlySeries(buckets, 24, now)

    // Idle hours have no stored bucket; without the zero fill, 03:00 and 12:00
    // would render as neighbouring bars and read as "1 hour ago".
    expect(series).toHaveLength(24)
    expect(series.at(-1)?.key).toBe('2026-09-07T12')
    expect(series.at(-1)?.adsBlocked).toBe(5)
    expect(series[0].key).toBe('2026-09-06T13')
    expect(series[24 - 1 - 9].adsBlocked).toBe(300)
    expect(series.filter(bucket => bucket.adsBlocked > 0)).toHaveLength(2)
  })

  it('drops hourly buckets that fell out of the window', () => {
    const now = new Date('2026-09-07T12:30:00.000Z')
    // Retention keeps 72 hours of buckets, so stale ones must not be drawn as
    // if they were recent.
    const series = hourlySeries([{ key: '2026-09-05T09', adsBlocked: 900, bytesSaved: 0, videoSecondsSaved: 0 }], 24, now)

    expect(series.every(bucket => bucket.adsBlocked === 0)).toBe(true)
  })

  it('keys hourly buckets by UTC hour', () => {
    expect(hourBucketKey(new Date('2026-09-07T03:59:59.000Z'))).toBe('2026-09-07T03')
  })
})
