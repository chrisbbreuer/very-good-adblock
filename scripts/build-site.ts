import { existsSync } from 'node:fs'

const siteOut = './dist/site'
const docsOut = './dist/docs/.bunpress'

async function main(): Promise<void> {
  await ensureExists('./dist/marketing.html', 'dist/marketing.html is missing. Run bun run build first.')
  await ensureExists('./dist/features.html', 'dist/features.html is missing. Run bun run build first.')
  await ensureExists(docsOut, 'Bunpress output is missing. Run bun run docs:build first.')

  await Bun.$`rm -rf ${siteOut}`
  await Bun.$`mkdir -p ${siteOut}/icons ${siteOut}/docs ${siteOut}/features ${siteOut}/screenshots`

  await Bun.write(`${siteOut}/index.html`, await rewriteMarketingHtml())
  // The features page is served at /features/ (directory-style clean URL).
  await Bun.write(`${siteOut}/features/index.html`, await rewriteFeaturesHtml())
  await Bun.write(`${siteOut}/styles.css`, await Bun.file('./dist/styles.css').arrayBuffer())
  await Bun.write(`${siteOut}/marketing.js`, await Bun.file('./dist/marketing.js').arrayBuffer())
  await Bun.$`cp -R ./dist/icons/. ${siteOut}/icons/`
  // Product screenshots used by the marketing + features pages (also live under /docs).
  await Bun.$`cp ./docs/public/screenshots/popup.png ./docs/public/screenshots/dashboard.png ${siteOut}/screenshots/`
  await Bun.$`cp -R ${docsOut}/. ${siteOut}/docs/`

  console.log(`Built Very Good AdBlock site into ${siteOut}`)
}

async function rewriteMarketingHtml(): Promise<string> {
  // Marketing links use clean, extensionless docs URLs (docs/guide/install),
  // which resolve to <path>/index.html via the directory-style docs build.
  return Bun.file('./dist/marketing.html').text()
}

async function rewriteFeaturesHtml(): Promise<string> {
  // The extension build emits page-relative asset refs (styles.css, marketing.js,
  // icons/...) which resolve fine for the root marketing page but 404 for the
  // features page served from /features/. Re-root them to absolute site paths.
  const html = await Bun.file('./dist/features.html').text()
  return html
    .replace(/(href|src)="styles\.css"/g, '$1="/styles.css"')
    .replace(/(href|src)="icons\//g, '$1="/icons/')
    // The page's script is bundled as features.js (identical source to
    // marketing.js); reuse the single shared bundle at the site root.
    .replace(/src="features\.js"/g, 'src="/marketing.js"')
}

async function ensureExists(path: string, message: string): Promise<void> {
  if (!existsSync(path)) throw new Error(message)
}

await main()
