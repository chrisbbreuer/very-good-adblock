import { existsSync } from 'node:fs'

const siteOut = './dist/site'
const docsOut = './dist/docs/.bunpress'

async function main(): Promise<void> {
  await ensureExists('./dist/marketing.html', 'dist/marketing.html is missing. Run bun run build first.')
  await ensureExists(docsOut, 'Bunpress output is missing. Run bun run docs:build first.')

  await Bun.$`rm -rf ${siteOut}`
  await Bun.$`mkdir -p ${siteOut}/icons ${siteOut}/docs`

  await Bun.write(`${siteOut}/index.html`, await rewriteMarketingHtml())
  await Bun.write(`${siteOut}/styles.css`, await Bun.file('./dist/styles.css').arrayBuffer())
  await Bun.write(`${siteOut}/marketing.js`, await Bun.file('./dist/marketing.js').arrayBuffer())
  await Bun.$`cp -R ./dist/icons/. ${siteOut}/icons/`
  await Bun.$`cp -R ${docsOut}/. ${siteOut}/docs/`

  console.log(`Built Very Good AdBlock site into ${siteOut}`)
}

async function rewriteMarketingHtml(): Promise<string> {
  // Marketing links use clean, extensionless docs URLs (docs/guide/install),
  // which resolve to <path>/index.html via the directory-style docs build.
  return Bun.file('./dist/marketing.html').text()
}

async function ensureExists(path: string, message: string): Promise<void> {
  if (!existsSync(path)) throw new Error(message)
}

await main()
