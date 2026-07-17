import packageJson from '../package.json'

const targetArg = Bun.argv.find(arg => arg.startsWith('--target='))?.split('=')[1]
const target = targetArg === 'firefox' || targetArg === 'safari' ? targetArg : 'chrome'
const dist = target === 'firefox' ? 'dist-firefox' : target === 'safari' ? 'dist-safari' : 'dist'
// Name every artifact with its target so the browser is obvious at a glance:
// very-good-adblock-<version>-chrome.zip / -firefox.zip / -safari.zip.
// The Safari zip is the input format `xcrun safari-web-extension-converter`
// expects, and the exact bundle `safari:sync` mirrors into the Xcode project.
const archive = `very-good-adblock-${packageJson.version}-${target}.zip`

await Bun.$`rm -f ${archive}`
// The marketing site pages (marketing/features hub + per-feature pages) and the
// marketing script are built into dist for the site build; they are not part of
// the extension, so keep them out of the store package.
const siteOnly = [
  'marketing.html',
  'marketing.js',
  'features.html',
  'network-blocking.html',
  'youtube-twitch.html',
  'popups.html',
  'controls.html',
]
await Bun.$`cd ${dist} && zip -qr ../${archive} . ${siteOnly.flatMap(f => ['-x', f])}`

console.log(`Created ${archive}`)
