import { beforeEach, describe, expect, test } from 'vitest'
import { saveAnnotations, loadAnnotations, clearAnnotations, annotationKey } from './store'
import type { AnnotationDocument } from './merge'

const SHA = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

function doc(overrides: Partial<AnnotationDocument> = {}): AnnotationDocument {
  return {
    schema_version: 1,
    book_id: 'fixture-book',
    source_sha256: SHA,
    pages: [
      {
        page_id: `p-${SHA}-0001`,
        pdf_page_number: 1,
        added_regions: [{ id: 'm-1', x: 0, y: 0, width: 1, height: 0.5 }],
        edited_regions: [],
        deleted_region_ids: [],
        order: ['m-1'],
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('annotation store', () => {
  test('round-trips a document keyed by (book id, source sha256)', () => {
    saveAnnotations('fixture-book', SHA, doc())
    const loaded = loadAnnotations('fixture-book', SHA)
    expect(loaded.warning).toBeNull()
    expect(loaded.entry?.document).toEqual(doc())
    expect(loadAnnotations('fixture-book', OTHER).entry).toBeNull()
    expect(loadAnnotations('other-book', SHA).entry).toBeNull()
  })

  test('clear removes the stored document', () => {
    saveAnnotations('fixture-book', SHA, doc())
    clearAnnotations('fixture-book', SHA)
    expect(loadAnnotations('fixture-book', SHA).entry).toBeNull()
    expect(localStorage.getItem(annotationKey('fixture-book', SHA))).toBeNull()
  })

  test('corrupted stored values are reported, not silently used', () => {
    localStorage.setItem(annotationKey('fixture-book', SHA), 'not-json')
    const broken = loadAnnotations('fixture-book', SHA)
    expect(broken.entry).toBeNull()
    expect(broken.warning).toContain('could not be parsed')

    localStorage.setItem(annotationKey('fixture-book', SHA), JSON.stringify({ nope: true }))
    const shaped = loadAnnotations('fixture-book', SHA)
    expect(shaped.entry).toBeNull()
    expect(shaped.warning).toContain('unexpected shape')
  })

  test('entries bound to a different book or source revision are ignored with a warning', () => {
    saveAnnotations('fixture-book', SHA, doc({ book_id: 'other-book' }))
    const mismatched = loadAnnotations('fixture-book', SHA)
    expect(mismatched.entry).toBeNull()
    expect(mismatched.warning).toContain('different book or source')
  })
})
