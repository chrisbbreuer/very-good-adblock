import packageJson from '../package.json'

const target = Bun.argv.includes('--target=firefox') ? 'firefox' : 'chrome'
const dist = target === 'firefox' ? 'dist-firefox' : 'dist'
const archive = target === 'firefox'
  ? `very-good-adblock-${packageJson.version}-firefox.zip`
  : `very-good-adblock-${packageJson.version}.zip`

await Bun.$`rm -f ${archive}`
// marketing.html is built into dist for the site; it is not part of the
// extension, so keep it out of the store package.
await Bun.$`cd ${dist} && zip -qr ../${archive} . -x marketing.html`

console.log(`Created ${archive}`)
