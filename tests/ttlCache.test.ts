import { describe, it, expect, vi } from 'vitest'

import { TtlCache } from '../src/services/ttlCache.js'

describe('TtlCache', () => {
  it('TC1 – returns undefined for a key that was never set', () => {
    const cache = new TtlCache<string>(10, 1000)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('TC2 – returns a value that was just set', () => {
    const cache = new TtlCache<string>(10, 1000)
    cache.set('a', 'value-a')
    expect(cache.get('a')).toBe('value-a')
  })

  it('TC3 – caches a legitimate `null` value distinctly from a cache miss', () => {
    const cache = new TtlCache<string | null>(10, 1000)
    cache.set('not-found', null)
    // A hit that resolves to `null` must be returned as `null`, not `undefined`.
    expect(cache.get('not-found')).toBeNull()
    expect(cache.get('not-found')).not.toBeUndefined()
  })

  it('TC4 – expires an entry once the injected clock reaches expiresAt (now + ttlMs)', () => {
    let now = 0
    const clock = (): number => now
    const cache = new TtlCache<string>(10, 1000, clock)

    cache.set('a', 'value-a')

    now = 999
    expect(cache.get('a')).toBe('value-a')

    now = 1000
    expect(cache.get('a')).toBeUndefined()
  })

  it('TC5 – re-set of an existing key refreshes its TTL', () => {
    let now = 0
    const clock = (): number => now
    const cache = new TtlCache<string>(10, 1000, clock)

    cache.set('a', 'value-a')
    now = 900
    cache.set('a', 'value-a-updated')
    now = 1500 // would be expired relative to the first set, not the second
    expect(cache.get('a')).toBe('value-a-updated')
  })

  it('TC6 – evicts the oldest (first-inserted) entry once maxEntries is exceeded (FIFO)', () => {
    const cache = new TtlCache<string>(2, 100_000)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3') // exceeds maxEntries=2, must evict 'a' (oldest)

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('2')
    expect(cache.get('c')).toBe('3')
  })

  it('TC7 – eviction is insertion-order (FIFO), not access-order (LRU)', () => {
    const cache = new TtlCache<string>(2, 100_000)
    cache.set('a', '1')
    cache.set('b', '2')
    cache.get('a') // touch 'a' — must NOT protect it from FIFO eviction
    cache.set('c', '3')

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('2')
    expect(cache.get('c')).toBe('3')
  })

  it('TC8 – defaults the clock to Date.now when none is injected', () => {
    const cache = new TtlCache<string>(10, 100_000)
    cache.set('a', '1')
    expect(cache.get('a')).toBe('1')
  })

  it('TC9 – never schedules a timer/interval (expiry is checked on read only)', () => {
    vi.useFakeTimers()
    try {
      const timerCountBefore = vi.getTimerCount()
      const cache = new TtlCache<string>(10, 1000)
      cache.set('a', '1')
      cache.get('a')
      cache.get('missing')
      expect(vi.getTimerCount()).toBe(timerCountBefore)
    } finally {
      vi.useRealTimers()
    }
  })
})
