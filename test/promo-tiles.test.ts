import { describe, expect, it } from 'bun:test'
import { encodeOpaquePng, promoTiles } from '../resources/scripts/lib/promo-tiles'

/**
 * The Chrome Web Store rejects listing imagery on its dimensions and on its
 * colour type, and both are easy to lose silently: a layout tweak that changes
 * a canvas, or an encoder that helpfully writes RGBA. Neither shows up until
 * someone is standing in the Developer Dashboard trying to ship.
 */
describe('promo tiles', () => {
  it('matches the canvases the store asks for', () => {
    expect(promoTiles.find(tile => tile.name === 'promo-small.png')).toEqual({
      name: 'promo-small.png',
      width: 440,
      height: 280,
    })
    expect(promoTiles.find(tile => tile.name === 'promo-marquee.png')).toEqual({
      name: 'promo-marquee.png',
      width: 1400,
      height: 560,
    })
  })
})

describe('encodeOpaquePng', () => {
  it('writes 24-bit PNG with no alpha channel', () => {
    const width = 4
    const height = 2
    const data = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 239
      data[index + 1] = 68
      data[index + 2] = 68
      data[index + 3] = 255
    }

    const png = encodeOpaquePng({ data, width, height, colorSpace: 'srgb', hasAlpha: true, bitDepth: 8 })

    // IHDR is the first chunk: width and height as big-endian u32 at byte 16,
    // then bit depth and colour type. Colour type 2 is RGB; 6 would be RGBA.
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength)
    expect(header.getUint32(16)).toBe(width)
    expect(header.getUint32(20)).toBe(height)
    expect(png[24]).toBe(8)
    expect(png[25]).toBe(2)
  })
})
