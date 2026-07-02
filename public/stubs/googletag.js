/**
 * Neutered Google Publisher Tag (gpt.js) stub.
 *
 * Ad-blocking lists redirect the real gpt.js here instead of hard-blocking it, so
 * pages that `await` the GPT API keep working while no ads are ever requested.
 * This is an original minimal implementation of the public `googletag` surface —
 * every method is a no-op and every slot/service is an inert chainable object.
 */
(function () {
  'use strict'

  if (window.googletag && window.googletag.apiReady) return

  const noop = function () {}
  const chain = function (object) {
    // Every unknown call returns the same object so page code can chain freely.
    return new Proxy(object, {
      get(target, prop) {
        if (prop in target) return target[prop]
        return function () { return chain(object) }
      },
    })
  }

  const slot = chain({
    addService() { return this },
    setCollapseEmptyDiv() { return this },
    setTargeting() { return this },
    setAttribute() { return this },
    setClickUrl() { return this },
    getSlotElementId() { return '' },
    getAdUnitPath() { return '' },
    getTargeting() { return [] },
    getTargetingKeys() { return [] },
    getResponseInformation() { return null },
  })

  const pubads = chain({
    addEventListener() { return this },
    removeEventListener() { return this },
    enableSingleRequest() { return this },
    disableInitialLoad() { return this },
    collapseEmptyDivs() { return this },
    refresh() {},
    clear() {},
    setTargeting() { return this },
    clearTargeting() { return this },
    setPrivacySettings() { return this },
    setRequestNonPersonalizedAds() { return this },
    setCentering() {},
    getSlots() { return [] },
    setSafeFrameConfig() { return this },
    isInitialLoadDisabled() { return true },
    updateCorrelator() { return this },
  })

  const queue = []
  const googletag = {
    apiReady: true,
    cmd: {
      push(...fns) {
        for (const fn of fns) {
          if (typeof fn === 'function') {
            try { fn() }
            catch { /* swallow — a broken ad callback must not break the page */ }
          }
          else { queue.push(fn) }
        }
        return queue.length
      },
    },
    pubads() { return pubads },
    defineSlot() { return slot },
    defineOutOfPageSlot() { return slot },
    defineUnit() { return slot },
    display: noop,
    enableServices: noop,
    destroySlots() { return true },
    companionAds() { return chain({ setRefreshUnfilledSlots: noop }) },
    content() { return chain({ setContent: noop }) },
    sizeMapping() {
      const builder = chain({ addSize() { return builder }, build() { return [] } })
      return builder
    },
    setAdIframeTitle: noop,
    getVersion() { return '' },
    enums: {},
    secureSignalProviders: { push: noop },
  }

  window.googletag = googletag
}())
