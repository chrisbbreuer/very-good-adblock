import { existsSync } from 'node:fs'

const siteOut = './dist/site'
const docsOut = './dist/docs/.bunpress'

// Dedicated per-feature pages: the extension build names each output by its
// template basename, so dist/<slug>.html → /features/<slug>/.
const FEATURE_SLUGS = ['network-blocking', 'youtube-twitch', 'popups', 'controls']

async function main(): Promise<void> {
  await ensureExists('./dist/marketing.html', 'dist/marketing.html is missing. Run bun run build first.')
  await ensureExists('./dist/features.html', 'dist/features.html is missing. Run bun run build first.')
  for (const slug of FEATURE_SLUGS)
    await ensureExists(`./dist/${slug}.html`, `dist/${slug}.html is missing. Run bun run build first.`)
  await ensureExists(docsOut, 'Bunpress output is missing. Run bun run docs:build first.')

  await Bun.$`rm -rf ${siteOut}`
  await Bun.$`mkdir -p ${siteOut}/icons ${siteOut}/docs ${siteOut}/features ${siteOut}/screenshots`

  // Home page is served at the site root, where the extension build's
  // page-relative asset refs (styles.css, marketing.js) already resolve.
  await Bun.write(`${siteOut}/index.html`, await Bun.file('./dist/marketing.html').text())

  // Features hub + each dedicated feature page live one or two directories deep,
  // so their assets are re-rooted to absolute and the shared script is injected.
  await Bun.write(`${siteOut}/features/index.html`, siteize(await Bun.file('./dist/features.html').text()))
  for (const slug of FEATURE_SLUGS) {
    await Bun.$`mkdir -p ${siteOut}/features/${slug}`
    await Bun.write(`${siteOut}/features/${slug}/index.html`, siteize(await Bun.file(`./dist/${slug}.html`).text()))
  }

  await Bun.write(`${siteOut}/styles.css`, await Bun.file('./dist/styles.css').arrayBuffer())
  await Bun.write(`${siteOut}/marketing.js`, await Bun.file('./dist/marketing.js').arrayBuffer())
  await Bun.$`cp -R ./dist/icons/. ${siteOut}/icons/`
  // Product screenshots used by the marketing + feature pages (also live under /docs).
  await Bun.$`cp ./docs/public/screenshots/popup.png ./docs/public/screenshots/dashboard.png ${siteOut}/screenshots/`
  await Bun.$`cp -R ${docsOut}/. ${siteOut}/docs/`

  console.log(`Built Very Good AdBlock site into ${siteOut}`)
}

/**
 * Re-root a sub-page's assets to absolute paths and inject the shared marketing
 * script. The extension build emits page-relative asset refs (styles.css,
 * icons/...) and strips inline/companion scripts under its CSP sanitizer; both
 * resolve fine for the root marketing page but not for pages served from
 * /features/ or /features/<slug>/.
 */
function siteize(html: string): string {
  const out = html
    .replace(/(href|src)="styles\.css"/g, '$1="/styles.css"')
    .replace(/(href|src)="icons\//g, '$1="/icons/')
  if (out.includes('/marketing.js'))
    return out
  return out.replace('</body>', '  <script type="module" src="/marketing.js"></script>\n</body>')
}

async function ensureExists(path: string, message: string): Promise<void> {
  if (!existsSync(path)) throw new Error(message)
}

await main()
