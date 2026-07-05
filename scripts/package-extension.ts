import packageJson from '../package.json'

const target = Bun.argv.includes('--target=firefox') ? 'firefox' : 'chrome'
const dist = target === 'firefox' ? 'dist-firefox' : 'dist'
const archive = target === 'firefox'
  ? `very-good-adblock-${packageJson.version}-firefox.zip`
  : `very-good-adblock-${packageJson.version}.zip`

await Bun.$`rm -f ${archive}`
// marketing.html/marketing.js are built into dist for the site; they are not
// part of the extension, so keep them out of the store package.
await Bun.$`cd ${dist} && zip -qr ../${archive} . -x marketing.html -x marketing.js`

console.log(`Created ${archive}`)
