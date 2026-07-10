import { appendFileSync } from 'node:fs'
import process from 'node:process'
const LOG = '/tmp/exit.log'
const w = (m: string) => { try { appendFileSync(LOG, m + '\n') } catch {} }
const realExit = process.exit.bind(process)
// @ts-expect-error override
process.exit = (code?: number) => { if (code) w(`[EXIT ${code}] ${new Error('exit').stack}`); return realExit(code as any) }
process.on('uncaughtException', e => w(`[uncaught] ${(e as any)?.stack || e}`))
process.on('unhandledRejection', e => w(`[unhandled] ${(e as any)?.stack || e}`))
w(`[preload] argv=${process.argv.slice(2).join(' ')}`)
