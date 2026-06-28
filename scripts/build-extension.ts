import { Glob } from 'bun'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import packageJson from '../package.json'
import { buildManifest } from '../src/manifest'
import { buildStaticRules } from '../src/rules/static-rules'

const outdir = './dist'
const localStxPluginPath = '/Users/chris/Code/Tools/stx/packages/bun-plugin/src/index.ts'

async function clean(): Promise<void> {
  await Bun.$`rm -rf ${outdir}`
  await Bun.$`mkdir -p ${outdir}/rules ${outdir}/icons`
}

async function buildPages(): Promise<void> {
  const stxPlugin = await loadStxPlugin()
  const entrypoints = ['pages/popup.stx', 'pages/options.stx']
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

  await sanitizeHtml('popup.html', 'popup.js')
  await sanitizeHtml('options.html', 'options.js')
  await removeStxChunks()
}

async function loadStxPlugin(): Promise<() => Bun.BunPlugin> {
  if (existsSync(localStxPluginPath)) {
    try {
      const localModule = await import(pathToFileURL(localStxPluginPath).href)
      return localModule.default ?? localModule.stxPlugin
    }
    catch (error) {
      console.warn(`Local STX plugin unavailable, falling back to package: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const module = await import('bun-plugin-stx')
  return module.default ?? module.stxPlugin
}

async function sanitizeHtml(filename: string, scriptName: string): Promise<void> {
  const file = `${outdir}/${filename}`
  let html = await Bun.file(file).text()

  html = html
    .replace(/\n?<!-- stx SEO Tags -->[\s\S]*?(?=\n\s*<meta charset=)/, '')
    .replace(/\n?\s*<style\b[\s\S]*?<\/style>/g, '')
    .replace(/\n?\s*<script\b(?![^>]*src="\/?popup\.js")(?![^>]*src="\/?options\.js")[\s\S]*?<\/script>/g, '')
    .replaceAll('href="/styles.css"', 'href="styles.css"')
    .replaceAll(`src="/${scriptName}"`, `src="${scriptName}"`)

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
  await Bun.write(`${outdir}/manifest.json`, `${JSON.stringify(buildManifest({ version: packageJson.version }), null, 2)}\n`)
  await Bun.write(`${outdir}/rules/static.json`, `${JSON.stringify(buildStaticRules(), null, 2)}\n`)
}

await clean()
await buildPages()
await buildScripts()
await copyPublic()
await writeGeneratedFiles()

console.log(`Built ${packageJson.name} ${packageJson.version} into ${outdir}`)
