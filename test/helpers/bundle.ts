/**
 * Build one extension entrypoint into an injectable browser bundle.
 *
 * The e2e suites serve real pages from a local origin and inject these bundles
 * as page scripts (the MAIN-world pruners) or pseudo-content-scripts (the
 * isolated script), so the exact shipped code is exercised in a real Chromium
 * without loading the packed extension.
 */
export async function buildEntry(entrypoint: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: 'browser',
    write: false,
    minify: false,
  } as Parameters<typeof Bun.build>[0] & { write: false })

  if (!result.success) {
    throw new Error(result.logs.map(log => log.message).join('\n'))
  }

  const output = result.outputs.find(file => file.path.endsWith('.js')) ?? result.outputs[0]
  return output.text()
}

/** The isolated, every-site content script. */
export async function buildContentScript(): Promise<string> {
  return buildEntry('src/content/index.ts')
}
