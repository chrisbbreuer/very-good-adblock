import { Glob } from 'bun'
import stxPlugin from 'bun-plugin-stx'
import packageJson from '../package.json'
import { buildManifest } from '../src/manifest'
import { buildStaticRules } from '../src/rules/static-rules'

const target = Bun.argv.includes('--target=firefox') ? 'firefox' : 'chrome'
// Chrome keeps the historical flat `dist/` path other tooling (site build, smoke
// tests, docs) already assumes; Firefox gets a sibling directory instead of
// disturbing that default.
const outdir = target === 'firefox' ? './dist-firefox' : './dist'

async function clean(): Promise<void> {
  await Bun.$`rm -rf ${outdir}`
  await Bun.$`mkdir -p ${outdir}/rules ${outdir}/icons`
}

async function buildPages(): Promise<void> {
  const entrypoints = ['pages/popup.stx', 'pages/options.stx', 'pages/marketing.stx']
  const result = await Bun.build({
    entrypoints,
    outdir,
    plugins: [stxPlugin()],
    naming: {
      entry: '[name].html',
    },
    minify: true,
  })

  if (!result.success) {
    console.error(result.logs)
    throw new Error('Failed to build STX pages')
  }

  await sanitizeHtml('popup.html', ['popup.js'])
  await sanitizeHtml('options.html', ['options.js'])
  await sanitizeHtml('marketing.html', [])
  await injectPopupPreview()
  await removeStxChunks()
}

/**
 * Inline the real popup component into the marketing hero, replacing the
 * `#popup-preview` placeholder with the generated static markup
 * (pages/partials/popup-preview.html). Runs after sanitizeHtml so the injected
 * markup is not stripped. Regenerate the partial with `bun run preview:marketing`.
 */
async function injectPopupPreview(): Promise<void> {
  const file = `${outdir}/marketing.html`
  const partial = 'pages/partials/popup-preview.html'
  if (!(await Bun.file(partial).exists()))
    throw new Error(`${partial} is missing. Run \`bun run preview:marketing\` to generate it.`)

  const frame = (await Bun.file(partial).text()).replace(/^<!--[\s\S]*?-->\s*/, '').trim()
  const placeholder = /<div class="hero-device" id="popup-preview"[^>]*><\/div>/
  const html = await Bun.file(file).text()
  if (!placeholder.test(html))
    throw new Error('marketing.html has no #popup-preview placeholder to inject the popup into.')

  const label = 'The Very Good AdBlock popup: 47 ads blocked on this page, 8.4 GB of data saved, 20 hours of video time recovered, and a chart of the last 24 hours.'
  const replacement = `<div class="hero-device" role="img" aria-label="${label}"><div class="popup-preview popup-shell" aria-hidden="true">${frame}</div></div>`
  await Bun.write(file, html.replace(placeholder, replacement))
}

async function sanitizeHtml(filename: string, scriptNames: string[]): Promise<void> {
  const file = `${outdir}/${filename}`
  let html = await Bun.file(file).text()
  const protectedScripts = scriptNames
    .map(scriptName => `(?![^>]*src="/?${scriptName.replace('.', '\\.')}")`)
    .join('')

  html = html
    .replace(/\n?<!-- stx SEO Tags -->[\s\S]*?(?=\n\s*<meta charset=)/, '')
    .replace(/\n?\s*<style\b[\s\S]*?<\/style>/g, '')
    .replace(new RegExp(`\\n?\\s*<script\\b${protectedScripts}[\\s\\S]*?<\\/script>`, 'g'), '')
    .replaceAll('href="/styles.css"', 'href="styles.css"')
    .replaceAll('href="/icons/', 'href="icons/')

  for (const scriptName of scriptNames) {
    html = html.replaceAll(`src="/${scriptName}"`, `src="${scriptName}"`)
  }

  await Bun.write(file, html)
}

async function removeStxChunks(): Promise<void> {
  const chunks = new Glob('chunk-*.js')
  for await (const chunk of chunks.scan(outdir)) {
    await Bun.$`rm -f ${outdir}/${chunk}`
  }
}

async function buildScripts(): Promise<void> {
  await Promise.all([
    buildScript('src/background/index.ts', 'background.js'),
    buildScript('src/content/index.ts', 'content.js'),
    buildScript('src/content/x-inpage.ts', 'x-inpage.js'),
    buildScript('src/content/yt-inpage.ts', 'yt-inpage.js'),
    buildScript('src/content/popup-guard.ts', 'popup-guard.js'),
    buildScript('src/ui/popup.ts', 'popup.js'),
    buildScript('src/ui/options.ts', 'options.js'),
  ])
}

async function buildScript(entrypoint: string, filename: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir,
    target: 'browser',
    format: 'esm',
    splitting: false,
    minify: true,
    naming: {
      entry: filename,
    },
  })

  if (!result.success) {
    console.error(result.logs)
    throw new Error(`Failed to build ${filename}`)
  }
}

async function copyPublic(): Promise<void> {
  await Bun.write(`${outdir}/styles.css`, await Bun.file('src/ui/styles.css').text())

  const publicFiles = new Glob('public/**/*')
  for await (const file of publicFiles.scan('.')) {
    const source = Bun.file(file)
    if (!(await source.exists())) continue
    await Bun.write(`${outdir}/${file.replace(/^public\//, '')}`, await source.arrayBuffer())
  }
}

async function writeGeneratedFiles(): Promise<void> {
  await Bun.write(`${outdir}/manifest.json`, `${JSON.stringify(buildManifest({ version: packageJson.version, target }), null, 2)}\n`)
  await Bun.write(`${outdir}/rules/static.json`, `${JSON.stringify(buildStaticRules(), null, 2)}\n`)
}

await clean()
await buildPages()
await buildScripts()
await copyPublic()
await writeGeneratedFiles()

console.log(`Built ${packageJson.name} ${packageJson.version} (${target}) into ${outdir}`)
