# very-good-adblock

Very Good AdBlock's blocking for apps that embed WebKit (`WKWebView`) instead of running a browser
extension. The extension's own rules ship as WebKit content-blocker lists and its content scripts
as user scripts, so an app and the extension stay one blocker. Built by the Stacks `webkit`
extension target.

## Install

```sh
bun add very-good-adblock
```

## Use

```ts
import { webkitRuleLists, webkitUserScripts } from 'very-good-adblock'

// Compile each list once with WKContentRuleListStore, under its id.
// Reuse the compiled copy until `version` changes.
for (const list of await webkitRuleLists())
  compile(list.id, list.version, list.json)

// Inject each script as a WKUserScript: `world` 'page' is WKContentWorld.page,
// 'isolated' a content world of your own; `runAt` is document-start or document-end.
for (const script of webkitUserScripts())
  inject(script)
```

- `webkitRuleLists({ includeDisabled })` returns the enabled lists: the network rules and the
  default cosmetic hiding. `includeDisabled` adds the opt-in lists (`enabled: false`): the broader
  cosmetic selectors and cookie-banner hiding.
- `webkitUserScripts()` returns the YouTube and X pruning scripts and the pop-up guard (page world)
  and the content script (isolated world), with the match patterns each one runs on.
- `webkitManifest()` is the whole build manifest, including the conversion report. The extension's
  three redirect-to-stub rules have no content-blocker form and are listed there.

The raw files are exported too: `very-good-adblock/webkit/manifest.json`,
`very-good-adblock/webkit/lists/<id>.json`, `very-good-adblock/webkit/scripts/<id>.js`.

## The content script's messages

The isolated-world `content` script calls `chrome.runtime.sendMessage`, which arrives at the
`very-good-adblock` script message handler (`webkit.messageHandlers['very-good-adblock']`) as
`{ v: 1, api: 'runtime.sendMessage', payload: { message } }`. Register the handler with
`WKScriptMessageHandlerWithReply`. The messages are:

| `message.type` | Reply |
|---|---|
| `get-dashboard` | `{ ok: true, data: { settings } }`, or nothing to use the default settings |
| `record-blocks` | nothing (block events for statistics) |
| `record-cosmetic` | nothing (hidden-element counts for statistics) |

Without a handler the script runs with the default settings. The full contract is in the Stacks
`stacks-browser-extension` skill (`WEBKIT.md`).

The rules are generated from the extension's source in
[chrisbbreuer/very-good-adblock](https://github.com/chrisbbreuer/very-good-adblock), and versions
follow the extension's.

## License

MIT
