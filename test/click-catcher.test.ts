import { describe, expect, it } from 'bun:test'
import { Window } from 'very-happy-dom'
import { isClickCatcherElement, isClickCatcher, isTransparent } from '../src/shared/click-catcher'
import type { OverlayMeasurements } from '../src/shared/click-catcher'

const viewport = { width: 1280, height: 720 }

/** The lid observed on thestreameast.one, as computed style reports it. */
function adcashLid(overrides: Partial<OverlayMeasurements> = {}): OverlayMeasurements {
  return {
    position: 'fixed',
    zIndex: '2147483647',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    backgroundImage: 'none',
    pointerEvents: 'auto',
    width: 1280,
    height: 720,
    hasContent: false,
    ...overrides,
  }
}

describe('isTransparent', () => {
  it('recognises the ways a computed colour paints nothing', () => {
    expect(isTransparent('transparent')).toBe(true)
    expect(isTransparent('rgba(0, 0, 0, 0)')).toBe(true)
    expect(isTransparent('rgba(255, 255, 255, 0)')).toBe(true)
    expect(isTransparent('')).toBe(true)
    // Modern slash syntax, which Chrome now returns for some colours.
    expect(isTransparent('rgb(0 0 0 / 0)')).toBe(true)
    expect(isTransparent('rgb(0 0 0 / 0%)')).toBe(true)
  })

  it('treats anything the user can see as painted', () => {
    // Opaque black: the trailing zero is the blue channel, not an alpha.
    expect(isTransparent('rgb(0, 0, 0)')).toBe(false)
    expect(isTransparent('rgb(0 0 0)')).toBe(false)
    expect(isTransparent('rgba(0, 0, 0, 0.5)')).toBe(false)
    expect(isTransparent('rgb(0 0 0 / 50%)')).toBe(false)
    // A backdrop only just visible is still the page dimming itself.
    expect(isTransparent('rgba(0, 0, 0, 0.01)')).toBe(false)
  })
})

describe('isClickCatcher', () => {
  it('identifies the invisible full-viewport lid', () => {
    expect(isClickCatcher(adcashLid(), viewport)).toBe(true)
  })

  it('accepts an absolutely positioned lid too', () => {
    expect(isClickCatcher(adcashLid({ position: 'absolute' }), viewport)).toBe(true)
  })

  it('ignores one already neutralised, so it is never counted twice', () => {
    expect(isClickCatcher(adcashLid({ pointerEvents: 'none' }), viewport)).toBe(false)
  })

  /**
   * The false positives that would matter: every one of these is a real
   * interface element that must keep receiving clicks.
   */
  it('leaves legitimate overlays alone', () => {
    // A modal backdrop is visibly tinted.
    expect(isClickCatcher(adcashLid({ backgroundColor: 'rgba(0, 0, 0, 0.6)' }), viewport)).toBe(false)
    // A lightbox or cookie banner holds content.
    expect(isClickCatcher(adcashLid({ hasContent: true }), viewport)).toBe(false)
    // A decorative wash paints an image or gradient.
    expect(isClickCatcher(adcashLid({ backgroundImage: 'linear-gradient(black, white)' }), viewport)).toBe(false)
    // Ordinary in-flow page furniture is not layered over anything.
    expect(isClickCatcher(adcashLid({ position: 'static' }), viewport)).toBe(false)
    expect(isClickCatcher(adcashLid({ position: 'relative' }), viewport)).toBe(false)
    // A sticky header spans the width but not the page.
    expect(isClickCatcher(adcashLid({ height: 64 }), viewport)).toBe(false)
    // A drawer spans the height but not the width.
    expect(isClickCatcher(adcashLid({ width: 320 }), viewport)).toBe(false)
    // An ordinary stacking context is not fighting to be topmost.
    expect(isClickCatcher(adcashLid({ zIndex: '10' }), viewport)).toBe(false)
    expect(isClickCatcher(adcashLid({ zIndex: 'auto' }), viewport)).toBe(false)
  })

  it('ignores a viewport too small to measure against', () => {
    // Background tabs report a zero-sized viewport; nothing "covers" it.
    expect(isClickCatcher(adcashLid(), { width: 0, height: 0 })).toBe(false)
  })
})

describe('isClickCatcherElement', () => {
  it('reads the lid straight off a live DOM', () => {
    const window = new Window({ url: 'https://stream.example/watch' })
    window.document.body!.innerHTML = `
      <div id="player">video</div>
      <div id="lid" znid="10591654" style="top:0;left:0;width:1280px;height:720px;position:fixed;z-index:2147483647;background-color:transparent;"></div>
      <div id="banner" style="position:fixed;width:1280px;height:720px;z-index:2147483647;background-color:rgba(0,0,0,0.6);">Accept cookies</div>
    `

    // happy-dom's element type is structurally close but not identical to the
    // lib.dom one the source is written against.
    const query = (selector: string): Element =>
      window.document.querySelector(selector) as unknown as Element

    expect(isClickCatcherElement(query('#lid'))).toBe(true)
    expect(isClickCatcherElement(query('#player'))).toBe(false)
    expect(isClickCatcherElement(query('#banner'))).toBe(false)
  })
})
