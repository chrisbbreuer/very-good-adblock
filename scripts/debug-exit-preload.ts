import { appendFileSync } from 'node:fs'
import process from 'node:process'
const LOG = '/tmp/exit.log'
const w = (m: string) => { try { appendFileSync(LOG, m + '\n') } catch {} }
// Capture console output synchronously so logged errors survive a fast exit.
for (const m of ['error', 'warn', 'log'] as const) {
  const orig = console[m].bind(console)
  console[m] = (...a: any[]) => { try { w(`[console.${m}] ` + a.map(x => x?.stack || (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')) } catch {}; return orig(...a) }
}
const realExit = process.exit.bind(process)
// @ts-expect-error override
process.exit = (code?: number) => { if (code) w(`[EXIT ${code}]`); return realExit(code as any) }
process.on('uncaughtException', e => w(`[uncaught] ${(e as any)?.stack || e}`))
process.on('unhandledRejection', e => w(`[unhandled] ${(e as any)?.stack || e}`))
w(`[preload] argv=${process.argv.slice(2).join(' ')}`)
