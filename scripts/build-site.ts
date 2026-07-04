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
  await Bun.$`cp -R ./dist/icons/. ${siteOut}/icons/`
  await Bun.$`cp -R ${docsOut}/. ${siteOut}/docs/`
  // Marketing assets (the hero popup screenshot), copied from public/ into dist/
  // by the extension build's copyPublic().
  if (existsSync('./dist/marketing')) {
    await Bun.$`mkdir -p ${siteOut}/marketing`
    await Bun.$`cp -R ./dist/marketing/. ${siteOut}/marketing/`
  }

  console.log(`Built Very Good AdBlock site into ${siteOut}`)
}

async function rewriteMarketingHtml(): Promise<string> {
  return (await Bun.file('./dist/marketing.html').text())
    .replaceAll('href="docs/guide/install"', 'href="docs/guide/install.html"')
    .replaceAll('href="docs/guide/usage"', 'href="docs/guide/usage.html"')
}

async function ensureExists(path: string, message: string): Promise<void> {
  if (!existsSync(path)) throw new Error(message)
}

await main()
