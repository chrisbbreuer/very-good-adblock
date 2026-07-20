/**
 * Render public/icons/icon.svg to the PNG sizes the manifest ships. There is no
 * SVG rasteriser on the box, so we draw the SVG onto a canvas in a real Chromium
 * (Bun WebView) and read back PNG bytes — preserving transparency.
 */
const sizes = [16, 32, 48, 128]
const raw = await Bun.file('public/icons/icon.svg').text()
// Give the SVG an explicit intrinsic size so drawImage scales it predictably.
const svg = raw.replace('<svg ', '<svg width="128" height="128" ')

const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response('<!doctype html><html><body></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
  },
})

const view = new Bun.WebView({
  width: 200,
  height: 200,
  backend: { type: 'chrome', url: false, argv: ['--proxy-server=direct://', '--proxy-bypass-list=*'] },
})

try {
  await view.navigate(`http://127.0.0.1:${server.port}/`)

  for (const size of sizes) {
    const dataUrl = await view.evaluate<string>(`(async () => {
      const blob = new Blob([${JSON.stringify(svg)}], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('svg load failed')); img.src = url; });
      const canvas = document.createElement('canvas');
      canvas.width = ${size};
      canvas.height = ${size};
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, ${size}, ${size});
      ctx.drawImage(img, 0, 0, ${size}, ${size});
      URL.revokeObjectURL(url);
      return canvas.toDataURL('image/png');
    })()`)

    const base64 = dataUrl.split(',')[1]
    if (!base64) throw new Error(`Empty PNG for size ${size}`)
    await Bun.write(`public/icons/icon-${size}.png`, Buffer.from(base64, 'base64'))
    console.log(`Wrote public/icons/icon-${size}.png`)
  }
}
finally {
  view.close()
  server.stop(true)
  Bun.WebView.closeAll()
}
