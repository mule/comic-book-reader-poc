import { beforeEach, describe, expect, test } from 'vitest'
import { savePosition, loadPosition, findPositionForBook, clearPosition, resolveStartPosition } from './progress'
import type { ReaderBook } from '../manifest/load'
import { makeManifest } from '../testing/manifestFixture'
import { buildReaderBook } from '../manifest/load'

function book(sha: string): ReaderBook {
  const manifest = makeManifest()
  manifest.source.sha256 = sha
  return buildReaderBook('fixture-book', manifest)
}

const SHA = 'a'.repeat(64)
const OTHER_SHA = 'b'.repeat(64)

beforeEach(() => {
  localStorage.clear()
})

describe('savePosition / loadPosition', () => {
  test('round-trips a position keyed by book id and source sha256', () => {
    savePosition('fixture-book', SHA, 'page-2')
    const loaded = loadPosition('fixture-book', SHA)
    expect(loaded).not.toBeNull()
    expect(loaded?.pageId).toBe('page-2')
    expect(loaded?.sourceSha256).toBe(SHA)
    expect(loadPosition('fixture-book', OTHER_SHA)).toBeNull()
    expect(loadPosition('other-book', SHA)).toBeNull()
  })

  test('finds positions across revisions for mismatch reporting', () => {
    savePosition('fixture-book', OTHER_SHA, 'page-5')
    const found = findPositionForBook('fixture-book')
    expect(found).toHaveLength(1)
    expect(found[0].sourceSha256).toBe(OTHER_SHA)
    clearPosition('fixture-book', OTHER_SHA)
    expect(findPositionForBook('fixture-book')).toHaveLength(0)
  })

  test('ignores malformed stored values', () => {
    localStorage.setItem('comicpoc:reading-position:v1:fixture-book:' + SHA, 'not-json')
    expect(loadPosition('fixture-book', SHA)).toBeNull()
  })
})

describe('panel-level positions', () => {
  test('round-trips a region id alongside the page id', () => {
    savePosition('fixture-book', SHA, 'page-2', 'r7')
    const loaded = loadPosition('fixture-book', SHA)
    expect(loaded?.pageId).toBe('page-2')
    expect(loaded?.regionId).toBe('r7')
  })

  test('full-page positions store an explicit null region id', () => {
    savePosition('fixture-book', SHA, 'page-2', null)
    expect(loadPosition('fixture-book', SHA)?.regionId).toBeNull()
  })

  test('positions saved before panel support parse with a null region id', () => {
    localStorage.setItem(
      'comicpoc:reading-position:v1:fixture-book:' + SHA,
      JSON.stringify({
        bookId: 'fixture-book',
        sourceSha256: SHA,
        pageId: 'page-1',
        updatedAt: 1,
      }),
    )
    expect(loadPosition('fixture-book', SHA)?.regionId).toBeNull()
  })

  test('resolveStartPosition exposes the saved region id for guided restore', () => {
    const b = book(SHA)
    savePosition('fixture-book', SHA, b.pages[1].id, 'r3')
    const result = resolveStartPosition(b)
    expect(result.status).toBe('restored')
    if (result.status === 'restored') expect(result.regionId).toBe('r3')
  })
})

describe('resolveStartPosition', () => {
  test('starts at the first page without a notice when nothing is saved', () => {
    const result = resolveStartPosition(book(SHA))
    expect(result.status).toBe('restored')
    expect(result.index).toBe(0)
    expect(result.notice).toBeNull()
  })

  test('restores a saved position', () => {
    const b = book(SHA)
    savePosition('fixture-book', SHA, b.pages[1].id)
    const result = resolveStartPosition(b)
    expect(result.status).toBe('restored')
    expect(result.index).toBe(1)
    expect(result.notice).toBeNull()
  })

  test('falls back with an explicit notice for stale page ids', () => {
    savePosition('fixture-book', SHA, 'p-nope')
    const result = resolveStartPosition(book(SHA))
    expect(result.status).toBe('fallback')
    expect(result.index).toBe(0)
    expect(result.notice).toContain('no longer exists')
  })

  test('falls back with an explicit notice when the source revision differs', () => {
    savePosition('fixture-book', OTHER_SHA, 'whatever')
    const result = resolveStartPosition(book(SHA))
    expect(result.status).toBe('fallback')
    expect(result.index).toBe(0)
    expect(result.notice).toContain('different source revision')
  })
})

 test('guided full-page fallback retains mode across reload', () => {
  savePosition('fixture-book', SHA, 'page-2', null, 'guided')
  expect(loadPosition('fixture-book', SHA)?.mode).toBe('guided')
})
