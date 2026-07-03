import packageJson from '../package.json'

const target = Bun.argv.includes('--target=firefox') ? 'firefox' : 'chrome'
const dist = target === 'firefox' ? 'dist-firefox' : 'dist'
const archive = target === 'firefox'
  ? `very-good-adblock-${packageJson.version}-firefox.zip`
  : `very-good-adblock-${packageJson.version}.zip`

await Bun.$`rm -f ${archive}`
await Bun.$`cd ${dist} && zip -qr ../${archive} .`

console.log(`Created ${archive}`)
