import { describe, expect, it } from 'bun:test'

/**
 * Loads the neutered ad-SDK stubs in a real Chromium and exercises the public API
 * surface page code relies on, proving they no-op without throwing (so redirecting
 * the real scripts to these can't break a page that awaits the SDK).
 */
describe('neutered ad-SDK stubs', () => {
  it('satisfy the googletag and adsbygoogle APIs without throwing', async () => {
    const gpt = await Bun.file('public/stubs/googletag.js').text()
    const adsbygoogle = await Bun.file('public/stubs/adsbygoogle.js').text()
    const page = fixture(gpt, adsbygoogle)

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      },
    })

    const errors: string[] = []
    const view = await openChromeView({
      width: 640,
      height: 480,
      backend: { type: 'chrome', url: false, argv: ['--proxy-server=direct://', '--proxy-bypass-list=*'] },
      console: (type, ...args) => {
        if (type === 'error') errors.push(args.map(String).join(' '))
      },
    })

    try {
      await view.navigate(`http://127.0.0.1:${server.port}/`)
      await waitFor(view, `window.__stubTest && window.__stubTest.done === true`, 'stub test ran')

      const result = await view.evaluate<{ gptOk: boolean, slotChained: boolean, adSlotDone: boolean, error: string | null }>(`window.__stubTest`)

      expect(result.error).toBeNull()
      expect(result.gptOk).toBe(true)
      expect(result.slotChained).toBe(true)
      expect(result.adSlotDone).toBe(true)
      expect(errors).toEqual([])
    }
    finally {
      view.close()
      server.stop(true)
    }
  }, 30_000)
})

function fixture(gpt: string, adsbygoogle: string): string {
  return `<!doctype html>
<html>
  <head><title>Stub Fixture</title></head>
  <body>
    <div id="slot-1"></div>
    <ins class="adsbygoogle" style="display:block"></ins>
    <script>${gpt}</script>
    <script>${adsbygoogle}</script>
    <script>
      (function () {
        try {
          var slotChained = false;
          window.googletag = window.googletag || { cmd: [] };
          googletag.cmd.push(function () {
            var slot = googletag.defineSlot('/1234/unit', [[300, 250]], 'slot-1');
            slotChained = slot.addService(googletag.pubads()) === slot;
            googletag.pubads().enableSingleRequest();
            googletag.pubads().addEventListener('slotRenderEnded', function () {});
            googletag.enableServices();
            googletag.display('slot-1');
          });

          (window.adsbygoogle = window.adsbygoogle || []).push({});
          var ins = document.querySelector('ins.adsbygoogle');

          window.__stubTest = {
            gptOk: window.googletag.apiReady === true,
            slotChained: slotChained,
            adSlotDone: ins.getAttribute('data-adsbygoogle-status') === 'done',
            error: null,
            done: true,
          };
        }
        catch (e) {
          window.__stubTest = { done: true, error: String(e), gptOk: false, slotChained: false, adSlotDone: false };
        }
      }());
    </script>
  </body>
</html>`
}

async function waitFor(view: Bun.WebView, expression: string, label: string, timeoutMs = 8_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await view.evaluate<boolean>(`Boolean(${expression})`)) return
    await Bun.sleep(100)
  }

  throw new Error(`Timed out waiting for ${label}`)
}

async function openChromeView(options: Bun.WebView.ConstructorOptions): Promise<Bun.WebView> {
  let lastError: unknown

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return new Bun.WebView(options)
    }
    catch (error) {
      lastError = error
      if (attempt < 5) await Bun.sleep(250)
    }
  }

  throw lastError
}
