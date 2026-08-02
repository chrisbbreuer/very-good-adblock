/**
 * Serve the built popup and dashboard with the seeded fixture, for looking at
 * them in a browser. `bun run preview:surfaces`, then open the port it prints.
 *
 * Run `bun run build` first — this serves `dist/`, it does not produce it.
 */
import { startPreviewServer } from './lib/preview-server'

const server = startPreviewServer({ port: Number(process.env.PORT ?? 8123) })

console.log(`Popup:     http://localhost:${server.port}/popup.html`)
console.log(`Dashboard: http://localhost:${server.port}/options.html`)
