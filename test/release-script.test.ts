import { describe, expect, it } from 'bun:test'
import { nextVersion, parseArgs } from '../resources/scripts/release'

describe('nextVersion', () => {
  it('bumps each segment', () => {
    expect(nextVersion('0.3.1', 'patch')).toBe('0.3.2')
    expect(nextVersion('0.3.1', 'minor')).toBe('0.4.0')
    expect(nextVersion('0.3.1', 'major')).toBe('1.0.0')
  })

  it('carries across segment boundaries', () => {
    expect(nextVersion('1.9.9', 'patch')).toBe('1.9.10')
    expect(nextVersion('1.9.9', 'minor')).toBe('1.10.0')
  })

  it('accepts an explicit x.y.z', () => {
    expect(nextVersion('0.3.1', '2.5.0')).toBe('2.5.0')
  })

  it('rejects unknown bump types and malformed versions', () => {
    expect(() => nextVersion('0.3.1', 'huge')).toThrow('--bump')
    expect(() => nextVersion('0.3', 'patch')).toThrow('Unsupported current version')
    expect(() => nextVersion('alpha', 'patch')).toThrow('Unsupported current version')
  })
})

describe('parseArgs', () => {
  it('reads the bump type in both forms', () => {
    expect(parseArgs(['--bump', 'patch']).bump).toBe('patch')
    expect(parseArgs(['--bump=minor']).bump).toBe('minor')
  })

  it('reads the flags', () => {
    const options = parseArgs(['--bump=major', '--dry-run', '--no-push'])
    expect(options.dryRun).toBe(true)
    expect(options.noPush).toBe(true)
  })

  it('defaults to a plain, pushing release', () => {
    const options = parseArgs([])
    expect(options.bump).toBe('')
    expect(options.dryRun).toBe(false)
    expect(options.noPush).toBe(false)
  })
})
