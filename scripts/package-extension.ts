import packageJson from '../package.json'

const target = Bun.argv.includes('--target=firefox') ? 'firefox' : 'chrome'
const dist = target === 'firefox' ? 'dist-firefox' : 'dist'
// Name every artifact with its target so the browser is obvious at a glance:
// very-good-adblock-<version>-chrome.zip / -firefox.zip.
const archive = `very-good-adblock-${packageJson.version}-${target}.zip`

await Bun.$`rm -f ${archive}`
// marketing.html/marketing.js are built into dist for the site; they are not
// part of the extension, so keep them out of the store package.
await Bun.$`cd ${dist} && zip -qr ../${archive} . -x marketing.html -x marketing.js`

console.log(`Created ${archive}`)
