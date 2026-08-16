import { describe, expect, it } from 'bun:test'
import { popupBlockMessageSource } from '../src/shared/constants'
import { openChromeView } from './helpers/webview'

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
      await waitFor(view, `window.__guardTest && window.__guardTest.done === true`, 'guard ran')

      const result = await view.evaluate<{
        blockedIsDecoy: boolean
        oauthAllowed: boolean
        sameOriginAllowed: boolean
        floodBlocked: boolean
        linkPiggybackBlocked: boolean
        linkOwnHrefAllowed: boolean
        javascriptChatAllowed: boolean
        javascriptLinkMismatchBlocked: boolean
        isolatedUserPopupAllowed: boolean
        declaredLinkAfterFloodAllowed: boolean
        duplicateDeclaredLinkBlocked: boolean
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
      expect(result.javascriptChatAllowed).toBe(true)
      expect(result.javascriptLinkMismatchBlocked).toBe(true)
      expect(result.isolatedUserPopupAllowed).toBe(true)
      expect(result.declaredLinkAfterFloodAllowed).toBe(true)
      expect(result.duplicateDeclaredLinkBlocked).toBe(true)
      expect(result.reported).toBeGreaterThanOrEqual(1)
      expect(errors).toEqual([])
    }
    finally {
      view.close()
      server.stop(true)
    }
  }, 30_000)

  /**
   * The routes pop-under scripts actually use now that everyone guards
   * `window.open`: a detached `<a target="_blank">` that the page clicks itself,
   * an untrusted click event dispatched at one, and a `target="_blank"` form.
   *
   * The hard case is the last two assertions. On streaming pages the site's own
   * outbound link is *also* a synthetic anchor click, and the ad script's
   * capture-phase listener fires first — so blocking by arrival order would
   * hand the tab to the ad and lose the link the user asked for. The guard
   * discriminates on what the clicked row declared instead.
   */
  it('blocks scripted new-tab routes while keeping the link the user clicked', async () => {
    const guardScript = await buildScript()
    const page = syntheticFixture(guardScript)

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
      await waitFor(view, `window.__guardTest && window.__guardTest.done === true`, 'guard ran')

      const result = await view.evaluate<{
        popunderBlocked: boolean
        dispatchedPopunderBlocked: boolean
        timerPopunderBlocked: boolean
        formPopunderBlocked: boolean
        sameOriginSyntheticAllowed: boolean
        downloadAllowed: boolean
        shareButtonAllowed: boolean
        declaredRowLinkAllowed: boolean
        adLosesRaceToDeclaredLink: boolean
        lidPopunderBlocked: boolean
        detachedLidPopunderBlocked: boolean
        gestureBurstCapped: boolean
        repeatClicksAllAllowed: boolean
        reported: number
      }>(`window.__guardTest`)

      expect((result as { error?: string }).error ?? null).toBeNull()

      // Scripted new-tab opens that nothing on the page asked for.
      expect(result.popunderBlocked).toBe(true)
      expect(result.dispatchedPopunderBlocked).toBe(true)
      expect(result.timerPopunderBlocked).toBe(true)
      expect(result.formPopunderBlocked).toBe(true)

      // Ordinary scripted navigation must keep working.
      expect(result.sameOriginSyntheticAllowed).toBe(true)
      expect(result.downloadAllowed).toBe(true)
      expect(result.shareButtonAllowed).toBe(true)

      // The streaming-site shape: the row declares the destination, so the
      // site's own link opens even though an ad rode the same click first.
      expect(result.declaredRowLinkAllowed).toBe(true)
      expect(result.adLosesRaceToDeclaredLink).toBe(true)

      // A click harvested by an invisible lid buys no pop-up, even isolated,
      // and even when the lid is torn out of the page mid-gesture.
      expect(result.lidPopunderBlocked).toBe(true)
      expect(result.detachedLidPopunderBlocked).toBe(true)

      // One click still cannot become a burst of tabs, but repeat clicks on
      // the row keep working rather than tripping the flood cap.
      expect(result.gestureBurstCapped).toBe(true)
      expect(result.repeatClicksAllAllowed).toBe(true)

      expect(result.reported).toBeGreaterThanOrEqual(1)
      expect(errors).toEqual([])
    }
    finally {
      view.close()
      server.stop(true)
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
    <a id="vwchat" href='javascript:void(open("https://chat.vw.com/", "VW Chat"))'>Chat</a>
    <a id="jslink" href='javascript:window.open("https://help.example/chat")'>Help</a>
    <script>
      // Stand in for the native window.open so "allowed" calls are observable
      // without actually opening a window; the guard wraps this as its original.
      window.open = function (url) { return { __stub: true, url: url }; };
      window.__now = 1000;
      window.__userActive = false;
      Date.now = function () { return window.__now; };
      Object.defineProperty(navigator, 'userActivation', {
        configurable: true,
        value: { get isActive() { return window.__userActive; } },
      });
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

        // Legacy but legitimate chat launchers (including vw.com) put a
        // literal window.open destination in a javascript: anchor. That exact
        // destination is allowed, while piggybacking to another host is not.
        clickOn('vwchat');
        var javascriptChat = window.open('https://chat.vw.com/');
        clickOn('jslink');
        var javascriptMismatch = window.open('https://ads.example/pop');
        window.__now += 5000;

        // Framework-managed external links can lose their anchor identity but
        // retain the browser's transient user activation. Only an explicitly
        // opener-isolated window gets this fallback.
        clickOn('video');
        window.__userActive = true;
        var isolatedUserPopup = window.open('https://article.example/read', '_blank', 'noopener');
        window.__userActive = false;
        window.__now += 5000;

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

        // A busy app can legitimately exhaust the generic short-window budget.
        // The next explicit anchor destination still represents a fresh user
        // choice and must not be miscounted as a pop-up.
        clickOn('extlink');
        var declaredLinkAfterFlood = window.open('https://legit.example/page', '_blank', 'noopener');
        var duplicateDeclaredLink = window.open('https://legit.example/page', '_blank', 'noopener');

        setTimeout(function () {
          window.__guardTest = {
            blockedIsDecoy: isDecoy(blocked),
            oauthAllowed: !!(oauth && oauth.__stub),
            sameOriginAllowed: !!(same && same.__stub),
            floodBlocked: floodBlocked,
            linkPiggybackBlocked: isDecoy(piggyback),
            linkOwnHrefAllowed: !!(linkOwn && linkOwn.__stub),
            javascriptChatAllowed: !!(javascriptChat && javascriptChat.__stub),
            javascriptLinkMismatchBlocked: isDecoy(javascriptMismatch),
            isolatedUserPopupAllowed: !!(isolatedUserPopup && isolatedUserPopup.__stub),
            declaredLinkAfterFloodAllowed: !!(declaredLinkAfterFlood && declaredLinkAfterFlood.__stub),
            duplicateDeclaredLinkBlocked: isDecoy(duplicateDeclaredLink),
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

/**
 * Fixture for the scripted new-tab routes. Mirrors the real markup these pages
 * use: a table row that carries its destination in `data-stream-link` and opens
 * it from script, alongside an ad script riding the same click.
 */
function syntheticFixture(guardScript: string): string {
  const source = JSON.stringify(popupBlockMessageSource)
  return `<!doctype html>
<html>
  <head><title>Scripted Pop-under Fixture</title></head>
  <body>
    <div id="video">play</div>
    <button id="share">Share</button>
    <table><tbody>
      <tr id="row" data-stream-link="https://legit.example/stream"><td id="cell">watch</td></tr>
    </tbody></table>
    <a id="download" href="https://files.example/clip.zip" download target="_blank">Save</a>
    <!-- Invisible full-viewport lids, as pop-under networks lay them down. -->
    <div id="lid" style="top:0;left:0;width:100vw;height:100vh;position:fixed;z-index:2147483647;background-color:transparent;"></div>
    <div id="lid2" style="top:0;left:0;width:100vw;height:100vh;position:fixed;z-index:2147483647;background-color:transparent;"></div>
    <script>
      // Stand in for the natives so an "allowed" call is observable without
      // actually opening a window or navigating; the guard wraps these as its
      // originals.
      window.open = function (url) { return { __stub: true, url: url }; };
      window.__formSubmitted = 0;
      HTMLFormElement.prototype.submit = function () { window.__formSubmitted++; };
      window.__now = 1000;
      window.__userActive = false;
      Date.now = function () { return window.__now; };
      Object.defineProperty(navigator, 'userActivation', {
        configurable: true,
        value: { get isActive() { return window.__userActive; } },
      });
    </script>
    <script>${guardScript}</script>
    <script>
      (function () {
        var reported = 0;
        window.addEventListener('message', function (e) {
          if (e.source === window && e.data && e.data.source === ${source}) reported += Number(e.data.count) || 0;
        });

        function clickOn(id) {
          document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
        function isDecoy(w) {
          return !!(w && !w.__stub && w.document && typeof w.document.write === 'function');
        }

        // Build the pop-under's anchor exactly as these scripts do, then report
        // whether the click actually reached it. A blocked click never fires.
        function syntheticOpen(href, how) {
          var a = Object.assign(document.createElement('a'), { target: '_blank', href: href });
          var fired = false;
          a.addEventListener('click', function (e) { fired = true; e.preventDefault(); });
          if (how === 'dispatch') a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          else a.click();
          return fired;
        }

        function submitBlankForm(action) {
          var before = window.__formSubmitted;
          var form = document.createElement('form');
          form.target = '_blank';
          form.action = action;
          document.body.appendChild(form);
          form.submit();
          form.remove();
          return window.__formSubmitted > before;
        }

       try {
        // Click the video, then have a script open an ad domain in a new tab.
        clickOn('video');
        var popunderBlocked = !syntheticOpen('https://ads.example/pop');

        clickOn('video');
        var dispatchedPopunderBlocked = !syntheticOpen('https://ads.example/pop', 'dispatch');

        // A timer-driven open with no gesture behind it at all.
        window.__now += 5000;
        var timerPopunderBlocked = !syntheticOpen('https://ads.example/pop');
        var formPopunderBlocked = !submitBlankForm('https://ads.example/form');

        // Ordinary scripted navigation the guard must not disturb.
        clickOn('video');
        var sameOriginSyntheticAllowed = syntheticOpen('/player');

        var downloadFired = false;
        var downloadLink = document.getElementById('download');
        downloadLink.addEventListener('click', function (e) { downloadFired = true; e.preventDefault(); });
        downloadLink.click();
        var downloadAllowed = downloadFired;

        // A real button computing its own destination (share sheets, "open in
        // new tab") has no declared href to match, so it keeps the benefit of
        // the doubt.
        window.__now += 5000;
        clickOn('share');
        var shareButtonAllowed = syntheticOpen('https://social.example/intent');

        // The streaming-site shape: the row declares where it goes, and the
        // page opens that destination from a script.
        window.__now += 5000;
        clickOn('cell');
        var declaredRowLinkAllowed = syntheticOpen('https://legit.example/stream');

        // Same click, but an ad script gets there first. The ad must lose and
        // the declared destination must still open.
        window.__now += 5000;
        clickOn('cell');
        var adRode = syntheticOpen('https://ads.example/pop');
        var realOpened = syntheticOpen('https://legit.example/stream');
        var adLosesRaceToDeclaredLink = !adRode && realOpened;

        // One gesture cannot be spun into a burst of tabs.
        window.__now += 5000;
        clickOn('share');
        var opened = 0;
        for (var i = 0; i < 5; i++) { if (syntheticOpen('https://social.example/intent' + i)) opened++; }
        var gestureBurstCapped = opened <= 2;

        // An invisible lid over the page harvests the click and spends it on
        // an opener-isolated pop-up — the same 'noopener' shape a framework
        // link uses, so isolation alone must stop being a free pass here.
        window.__now += 5000;
        window.__userActive = true;
        clickOn('lid');
        var lidPopunder = window.open('https://ads.example/pop', '_blank', 'noopener,noreferrer');
        var lidPopunderBlocked = isDecoy(lidPopunder);

        // The real sequence observed in the wild: the lid takes the
        // pointerdown, the script rips it out of the document, and by the
        // mousedown/click that follow it is detached and measures as nothing.
        // The verdict reached at pointerdown has to survive those later events.
        window.__now += 5000;
        var lid2 = document.getElementById('lid2');
        lid2.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        // Whatever the script does next — detaching it, restyling it — the
        // element stops measuring as a lid for the rest of the interaction.
        lid2.style.position = 'static';
        lid2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        lid2.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        var detachedLidPopunder = window.open('https://ads.example/pop', '_blank', 'noopener,noreferrer');
        var detachedLidPopunderBlocked = isDecoy(detachedLidPopunder);
        window.__userActive = false;

        // Impatient repeat clicks on the same row are the user asking for the
        // same page again, so the generic flood window must not start failing
        // them. Four clicks, well inside that window.
        window.__now += 5000;
        var repeats = 0;
        for (var j = 0; j < 4; j++) {
          window.__now += 200;
          clickOn('cell');
          if (syntheticOpen('https://legit.example/stream')) repeats++;
        }
        var repeatClicksAllAllowed = repeats === 4;

        setTimeout(function () {
          window.__guardTest = {
            popunderBlocked: popunderBlocked,
            dispatchedPopunderBlocked: dispatchedPopunderBlocked,
            timerPopunderBlocked: timerPopunderBlocked,
            formPopunderBlocked: formPopunderBlocked,
            sameOriginSyntheticAllowed: sameOriginSyntheticAllowed,
            downloadAllowed: downloadAllowed,
            shareButtonAllowed: shareButtonAllowed,
            declaredRowLinkAllowed: declaredRowLinkAllowed,
            adLosesRaceToDeclaredLink: adLosesRaceToDeclaredLink,
            lidPopunderBlocked: lidPopunderBlocked,
            detachedLidPopunderBlocked: detachedLidPopunderBlocked,
            gestureBurstCapped: gestureBurstCapped,
            repeatClicksAllAllowed: repeatClicksAllAllowed,
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
