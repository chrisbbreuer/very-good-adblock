import { describe, expect, it } from 'bun:test'
import { popupBlockMessageSource } from '../src/shared/constants'

/**
 * Runs the real built popup-guard.js in Chromium and checks the window.open
 * heuristic: a cross-origin pop-up from clicking a non-interactive element (the
 * pop-under pattern) is blocked with a decoy, while a pop-up from a real button
 * click (OAuth) and a same-origin pop-up are allowed through.
 */
describe('built pop-up guard', () => {
  it('blocks pop-unders but allows legit pop-ups', async () => {
    const guardScript = await buildScript()
    const page = fixture(guardScript)

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      },
    })

    const errors: string[] = []
    const view = new Bun.WebView({
      width: 640,
      height: 480,
      backend: { type: 'chrome', url: false, argv: ['--proxy-server=direct://', '--proxy-bypass-list=*'] },
      console: (type, ...args) => {
        if (type === 'error') errors.push(args.map(String).join(' '))
      },
    })

    try {
      await view.navigate(`http://127.0.0.1:${server.port}/`)
      await waitFor(view, `window.__guardTest && window.__guardTest.done === true`, 'guard ran')

      const result = await view.evaluate<{
        blockedIsDecoy: boolean
        oauthAllowed: boolean
        sameOriginAllowed: boolean
        floodBlocked: boolean
        linkPiggybackBlocked: boolean
        linkOwnHrefAllowed: boolean
        reported: number
      }>(`window.__guardTest`)

      expect((result as { error?: string }).error ?? null).toBeNull()
      expect(result.blockedIsDecoy).toBe(true)
      expect(result.oauthAllowed).toBe(true)
      expect(result.sameOriginAllowed).toBe(true)
      expect(result.floodBlocked).toBe(true)
      // Clicking a real link must not let a pop-up to a *different* ad domain
      // through, but a pop-up to the link's own destination is fine.
      expect(result.linkPiggybackBlocked).toBe(true)
      expect(result.linkOwnHrefAllowed).toBe(true)
      expect(result.reported).toBeGreaterThanOrEqual(1)
      expect(errors).toEqual([])
    }
    finally {
      view.close()
      server.stop(true)
      Bun.WebView.closeAll()
    }
  }, 30_000)
})

async function buildScript(): Promise<string> {
  const result = await Bun.build({
    entrypoints: ['src/content/popup-guard.ts'],
    target: 'browser',
    write: false,
    minify: false,
  } as Parameters<typeof Bun.build>[0] & { write: false })

  if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'))
  const output = result.outputs.find(file => file.path.endsWith('.js')) ?? result.outputs[0]
  return output.text()
}

function fixture(guardScript: string): string {
  const source = JSON.stringify(popupBlockMessageSource)
  return `<!doctype html>
<html>
  <head><title>Pop-up Guard Fixture</title></head>
  <body>
    <div id="video">play</div>
    <button id="signin">Sign in</button>
    <a id="navlink" href="/other-page">Other page</a>
    <a id="extlink" href="https://legit.example/page">External</a>
    <script>
      // Stand in for the native window.open so "allowed" calls are observable
      // without actually opening a window; the guard wraps this as its original.
      window.open = function (url) { return { __stub: true, url: url }; };
    </script>
    <script>${guardScript}</script>
    <script>
      (function () {
        var reported = 0;
        window.addEventListener('message', function (e) {
          if (e.source === window && e.data && e.data.source === ${source}) reported += Number(e.data.count) || 0;
        });

        // Stop the test's synthetic link clicks from actually navigating away
        // (the guard still records the gesture in its capture-phase listener).
        document.addEventListener('click', function (e) { e.preventDefault(); }, true);

        function clickOn(id) {
          document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
        function isDecoy(w) {
          return !!(w && !w.__stub && w.document && typeof w.document.write === 'function');
        }

       try {
        // Blocked cases first (they don't count toward the flood budget):
        // Pop-under — click a non-interactive div, then open a cross-origin URL.
        clickOn('video');
        var blocked = window.open('https://ads.example/pop');

        // Link piggyback — click a real link, but the pop-up goes to a *different*
        // ad domain (not where the link points).
        clickOn('navlink');
        var piggyback = window.open('https://ads.example/pop');

        // Allowed cases (each pushes toward the flood budget):
        // Link opening its own external destination.
        clickOn('extlink');
        var linkOwn = window.open('https://legit.example/page');

        // Same-origin pop-up.
        var same = window.open('/player');

        // OAuth — a real button, cross-origin.
        clickOn('signin');
        var oauth = window.open('https://accounts.example/oauth');

        // Flood: further opens in the same window are throttled.
        var floodBlocked = false;
        for (var i = 0; i < 4; i++) { clickOn('signin'); var r = window.open('/x' + i); if (isDecoy(r)) floodBlocked = true; }

        setTimeout(function () {
          window.__guardTest = {
            blockedIsDecoy: isDecoy(blocked),
            oauthAllowed: !!(oauth && oauth.__stub),
            sameOriginAllowed: !!(same && same.__stub),
            floodBlocked: floodBlocked,
            linkPiggybackBlocked: isDecoy(piggyback),
            linkOwnHrefAllowed: !!(linkOwn && linkOwn.__stub),
            reported: reported,
            done: true,
          };
        }, 50);
       } catch (err) { window.__guardTest = { done: true, error: String(err) }; }
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
