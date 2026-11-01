# very-good-adblock

Very Good AdBlock's blocking for apps that embed WebKit (`WKWebView`) instead of running a browser
extension. It turns the extension's own rules into WebKit content-blocker lists and page scripts,
so an app and the extension stay one blocker.

## Install

```sh
bun add very-good-adblock
```

## Use

```ts
import { webkitContentRules, webkitPageScripts } from 'very-good-adblock'

// Compile each list once with WKContentRuleListStore. Reuse the compiled copy until `version` changes.
for (const list of webkitContentRules({ cookieConsent: true }))
  compile(list.identifier, list.version, JSON.stringify(list.rules))

// Inject each script as a WKUserScript at document start, in the page's own world.
for (const script of webkitPageScripts())
  inject(script.js, { hosts: script.hosts, allFrames: script.allFrames })
```

- `webkitContentRules(options?)` returns the lists, each under WebKit's rule cap. `cookieConsent`
  adds rules that hide cookie banners, and `aggressive` adds the stricter cosmetic selectors.
- `webkitPageScripts()` returns the YouTube, Twitch and X scripts, with the hosts each one runs on.
- `webkitRulesGeneratedAt` says when the bundled rules were generated.
- `urlFilterToRegex(filter)` converts an adblock-style URL filter (`||host^`, `*` wildcards) to the regex WebKit accepts.

The rules are generated from the extension's source in
[chrisbbreuer/very-good-adblock](https://github.com/chrisbbreuer/very-good-adblock), and versions
follow the extension's.

## License

MIT
