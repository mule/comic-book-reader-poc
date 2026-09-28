import { describe, expect, test } from 'vitest'
import { clampIndex, indexForPageId, pageLabel, stepIndex } from './nav'
import { buildReaderBook } from '../manifest/load'
import { makeManifest, makePage } from '../testing/manifestFixture'

function sampleBook() {
  const pages = [makePage(1), makePage(2), makePage(3)]
  const manifest = makeManifest({ pages, page_order: [pages[0].id, pages[1].id, pages[2].id] })
  return buildReaderBook('fixture-book', manifest)
}

describe('navigation helpers', () => {
  test('clamps indices to the page count', () => {
    expect(clampIndex(-1, 3)).toBe(0)
    expect(clampIndex(2, 3)).toBe(2)
    expect(clampIndex(99, 3)).toBe(2)
    expect(() => clampIndex(0, 0)).toThrow()
  })

  test('steps forward and backward', () => {
    expect(stepIndex(0, 3, 1)).toBe(1)
    expect(stepIndex(0, 3, -1)).toBe(0)
    expect(stepIndex(2, 3, 1)).toBe(2)
  })

  test('resolves page ids to indices', () => {
    const book = sampleBook()
    expect(indexForPageId(book, book.pages[1].id)).toBe(1)
    expect(indexForPageId(book, 'unknown')).toBeNull()
  })
})

describe('pageLabel', () => {
  test('uses the PDF page number when order matches the PDF sequence', () => {
    expect(pageLabel({ orderIndex: 0, pdfPageNumber: 1 }, 3)).toBe('PDF page 1 / 3')
  })

  test('shows both counters when the reading order differs from the PDF order', () => {
    expect(pageLabel({ orderIndex: 0, pdfPageNumber: 3 }, 3)).toBe('Page 1 / 3 (PDF page 3)')
  })
})
