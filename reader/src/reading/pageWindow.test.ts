import { describe, expect, test } from 'vitest'
import {
  PageWindow,
  DEFAULT_WINDOW_SPEC,
  MAX_WINDOW_ENTRIES,
  windowIndices,
  assertWindowSpec,
} from './pageWindow'

function tracker() {
  const acquired: string[] = []
  const released: string[] = []
  const changes: number[] = []
  const make = (keys: string[], spec = DEFAULT_WINDOW_SPEC) =>
    new PageWindow<string, string>({
      keys,
      spec,
      acquire: (key) => {
        acquired.push(key)
        return `handle:${key}`
      },
      release: (handle, key) => {
        released.push(key)
        expect(handle).toBe(`handle:${key}`)
      },
      onChange: () => changes.push(1),
    })
  return { acquired, released, changes, make }
}

describe('windowIndices', () => {
  test('returns the current page plus one back and two ahead', () => {
    expect(windowIndices(10, 4, DEFAULT_WINDOW_SPEC)).toEqual([3, 4, 5, 6])
  })

  test('clamps at the start and end of the book', () => {
    expect(windowIndices(10, 0, DEFAULT_WINDOW_SPEC)).toEqual([0, 1, 2])
    expect(windowIndices(10, 9, DEFAULT_WINDOW_SPEC)).toEqual([8, 9])
  })

  test('handles books smaller than the window', () => {
    expect(windowIndices(2, 1, DEFAULT_WINDOW_SPEC)).toEqual([0, 1])
  })

  test('rejects invalid indices and specs', () => {
    expect(() => windowIndices(5, -1, DEFAULT_WINDOW_SPEC)).toThrow()
    expect(() => windowIndices(5, 5, DEFAULT_WINDOW_SPEC)).toThrow()
    expect(() => windowIndices(5, 2, { back: -1, ahead: 0 })).toThrow()
    expect(() => windowIndices(5, 2, { back: 1.5, ahead: 0 })).toThrow()
  })
})

describe('assertWindowSpec', () => {
  test('enforces the explicit entry cap', () => {
    expect(() => assertWindowSpec({ back: 1, ahead: 2 })).not.toThrow()
    expect(() => assertWindowSpec({ back: MAX_WINDOW_ENTRIES, ahead: 1 })).toThrow(
      /explicit cap/,
    )
  })
})

describe('PageWindow', () => {
  test('acquires the initial window and releases pages that leave it', () => {
    const t = tracker()
    const w = t.make(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    w.setIndex(3)
    expect(t.acquired).toEqual(['c', 'd', 'e', 'f'])
    expect(w.activeKeys().sort()).toEqual(['c', 'd', 'e', 'f'])
    w.setIndex(4)
    expect(t.acquired).toEqual(['c', 'd', 'e', 'f', 'g'])
    expect(t.released).toEqual(['c'])
    expect(w.activeKeys().sort()).toEqual(['d', 'e', 'f', 'g'])
    expect(w.size).toBeLessThanOrEqual(MAX_WINDOW_ENTRIES)
  })

  test('never exceeds the cap when jumping across the book', () => {
    const t = tracker()
    const w = t.make(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    w.setIndex(0)
    w.setIndex(7)
    w.setIndex(3)
    expect(w.size).toBe(4)
    expect(t.acquired.length - t.released.length).toBe(w.size)
    expect(t.released.sort()).toEqual(['a', 'b', 'c', 'g', 'h'].sort())
  })

  test('release callbacks fire for every acquired handle on destroy', () => {
    const t = tracker()
    const w = t.make(['a', 'b', 'c'])
    w.setIndex(1)
    w.destroy()
    expect(t.released.sort()).toEqual(['a', 'b', 'c'].sort())
    expect(w.size).toBe(0)
  })

  test('re-acquires a single key on refresh', () => {
    const t = tracker()
    const w = t.make(['a', 'b', 'c'])
    w.setIndex(0)
    const before = w.get('b')
    expect(w.refresh('b')).toBe(true)
    expect(w.get('b')).not.toBe(before)
    expect(w.refresh('missing')).toBe(false)
    w.destroy()
  })

  test('rejects empty key lists', () => {
    expect(() => tracker().make([])).toThrow(/at least one key/)
  })

  test('notifies on membership changes', () => {
    const t = tracker()
    const w = t.make(['a', 'b', 'c', 'd'])
    w.setIndex(0)
    const changesAfterFirst = t.changes.length
    w.setIndex(1)
    expect(t.changes.length).toBeGreaterThan(changesAfterFirst)
    w.destroy()
  })
})
