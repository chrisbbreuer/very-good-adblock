/**
 * Neutered Google AdSense (adsbygoogle.js) stub.
 *
 * Redirected here instead of hard-blocking the real script, so pages that push
 * ad config to `window.adsbygoogle` keep running while no ad is ever fetched.
 * Existing `<ins class="adsbygoogle">` slots are marked done so the page does not
 * retry. Original minimal implementation.
 */
(function () {
  'use strict'

  const markSlotsDone = function () {
    try {
      const slots = document.querySelectorAll('ins.adsbygoogle')
      for (const slot of slots) {
        if (slot.getAttribute('data-adsbygoogle-status') !== 'done') {
          slot.setAttribute('data-adsbygoogle-status', 'done')
        }
      }
    }
    catch { /* DOM not ready or inaccessible — nothing to do */ }
  }

  const adsbygoogle = {
    loaded: true,
    push() {
      markSlotsDone()
      return 1
    },
    // Some integrations read these; keep them inert.
    pauseAdRequests: 0,
    onload: null,
  }

  try {
    Object.defineProperty(window, 'adsbygoogle', {
      configurable: true,
      get() { return adsbygoogle },
      set() { /* ignore reassignment so the stub stands */ },
    })
  }
  catch {
    window.adsbygoogle = adsbygoogle
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markSlotsDone, { once: true })
  }
  else {
    markSlotsDone()
  }
}())
