/**
 * Tiny timing harness shared by the hot-path and competitive benchmarks.
 * Everything is measured in-process with `performance.now()`, warmed up first,
 * then run for a fixed wall-clock budget so short and long operations get a
 * comparable number of samples.
 */

export interface Result {
  name: string
  note: string
  nsPerOp: number
  opsPerSec: number
}

/** Time a cheap synchronous op by running it for at least `minMs`. */
export function bench(name: string, note: string, fn: () => void, minMs = 500): Result {
  for (let i = 0; i < 64; i++) fn() // warmup
  const batch = 16
  let iters = 0
  const start = performance.now()
  let elapsed = 0
  do {
    for (let i = 0; i < batch; i++) fn()
    iters += batch
    elapsed = performance.now() - start
  } while (elapsed < minMs)
  const nsPerOp = (elapsed * 1e6) / iters
  return { name, note, nsPerOp, opsPerSec: 1e9 / nsPerOp }
}

export interface SweepResult extends Result {
  requests: number
  blocked: number
}

/**
 * Time a request matcher by sweeping the whole corpus repeatedly for at least
 * `minMs`. The reported `nsPerOp` is per single request, which is the number
 * that matters: it is the JavaScript cost a blocker pays for every network
 * request the page makes. `blocked` is a sanity signal that the engine is
 * actually doing work and roughly agreeing with the others.
 */
export function benchSweep(name: string, note: string, requests: readonly BenchRequest[], match: (r: BenchRequest) => boolean, minMs = 750): SweepResult {
  let blocked = 0
  for (let i = 0; i < requests.length; i++) if (match(requests[i])) blocked++ // warmup + block count
  let sweeps = 0
  const start = performance.now()
  let elapsed = 0
  do {
    for (let i = 0; i < requests.length; i++) match(requests[i])
    sweeps++
    elapsed = performance.now() - start
  } while (elapsed < minMs)
  const totalOps = sweeps * requests.length
  const nsPerOp = (elapsed * 1e6) / totalOps
  return { name, note, nsPerOp, opsPerSec: 1e9 / nsPerOp, requests: requests.length, blocked }
}

/** Median wall-clock milliseconds of an expensive async op over `runs` runs. */
export async function benchBuild(fn: () => Promise<unknown> | unknown, runs = 5): Promise<number> {
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    await fn()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]
}

export function fmtTime(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(0)} ns`
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`
  return `${(ns / 1_000_000).toFixed(2)} ms`
}

export function fmtOps(ops: number): string {
  if (ops >= 1e6) return `${(ops / 1e6).toFixed(1)}M/s`
  if (ops >= 1e3) return `${(ops / 1e3).toFixed(0)}K/s`
  return `${ops.toFixed(0)}/s`
}

/** A canonical request the competitive adapters translate into engine-native shapes. */
export interface BenchRequest {
  url: string
  sourceUrl: string
  type: BenchResourceType
}

export type BenchResourceType
  = | 'script'
    | 'image'
    | 'xmlhttprequest'
    | 'sub_frame'
    | 'stylesheet'
    | 'font'
    | 'media'
