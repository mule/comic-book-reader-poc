import { describe, expect, test } from 'vitest'
import {
  EMPTY_SESSION,
  addRegion,
  deleteRegion,
  restoreRegion,
  reorderRegion,
  sessionFromDocument,
  toDocument,
  updateRegionRect,
  clampRegionRect,
} from './session'
import { effectiveRegions } from './merge'
import { validateAnnotationDocument } from './validate'
import { buildReaderBook, type ReaderBook, type ReaderPage } from '../manifest/load'
import { makeManifest, makePage, FIXTURE_SHA } from '../testing/manifestFixture'
import type { Region, Suggestions } from '../manifest/types'

function syntheticSuggestions(...regions: Region[]): Suggestions {
  return {
    detector: { name: 'synthetic', version: '1', configuration: {}, run_id: 'one' },
    regions,
    order: regions.map((region) => region.id),
  }
}

function bookWith(suggestionsPerPage: (Suggestions | undefined)[]): ReaderBook {
  const pages = suggestionsPerPage.map((suggestions, index) =>
    makePage(index + 1, suggestions ? { suggestions } : {}),
  )
  const manifest = makeManifest({ pages, page_order: pages.map((page) => page.id) })
  return buildReaderBook('fixture-book', manifest)
}

const R1: Region = { id: 'r1', x: 0, y: 0, width: 1, height: 0.5 }
const R2: Region = { id: 'r2', x: 0, y: 0.5, width: 1, height: 0.5 }

describe('editor session', () => {
  test('adding regions assigns fresh manual ids and appends to the order', () => {
    const book = bookWith([syntheticSuggestions(R1)])
    const page = book.pages[0]
    const first = addRegion(EMPTY_SESSION, page, { x: 0, y: 0, width: 0.5, height: 0.2 })
    const second = addRegion(first.session, page, { x: 0.5, y: 0, width: 0.5, height: 0.2 })
    expect(first.regionId).toBe('m-1')
    expect(second.regionId).toBe('m-2')
    const doc = toDocument(second.session, book)
    expect(doc.pages[0].added_regions.map((region) => region.id)).toEqual(['m-1', 'm-2'])
    expect(doc.pages[0].order).toEqual(['r1', 'm-1', 'm-2'])
  })

  test('manual ids never collide with suggestions or tombstones', () => {
    const book = bookWith([syntheticSuggestions({ ...R1, id: 'm-1' })])
    const page = book.pages[0]
    const deleted = deleteRegion(EMPTY_SESSION, page, 'm-1')
    const added = addRegion(deleted, page, { x: 0, y: 0, width: 1, height: 1 })
    expect(added.regionId).toBe('m-2')
  })

  test('editing a suggestion stores a complete replacement with the same id', () => {
    const book = bookWith([syntheticSuggestions(R1, R2)])
    const page = book.pages[0]
    const session = updateRegionRect(EMPTY_SESSION, page, 'r2', {
      x: 0.1, y: 0.6, width: 0.8, height: 0.3,
    })
    const doc = toDocument(session, book)
    expect(doc.pages[0].edited_regions).toEqual([{ id: 'r2', x: 0.1, y: 0.6, width: 0.8, height: 0.3 }])
    expect(doc.pages[0].order).toEqual(['r1', 'r2'])
    const merged = effectiveRegions(page, doc.pages[0])
    expect(merged[1]).toEqual({ id: 'r2', x: 0.1, y: 0.6, width: 0.8, height: 0.3 })
  })

  test('editing a manual region updates the addition in place', () => {
    const book = bookWith([undefined])
    const page = book.pages[0]
    const added = addRegion(EMPTY_SESSION, page, { x: 0, y: 0, width: 0.5, height: 0.5 })
    const moved = updateRegionRect(added.session, page, added.regionId, {
      x: 0.25, y: 0.25, width: 0.5, height: 0.5,
    })
    const doc = toDocument(moved, book)
    expect(doc.pages[0].added_regions).toEqual([{ id: 'm-1', x: 0.25, y: 0.25, width: 0.5, height: 0.5 }])
    expect(doc.pages[0].edited_regions).toEqual([])
  })

  test('deleting a suggestion creates a persistent tombstone', () => {
    const book = bookWith([syntheticSuggestions(R1, R2)])
    const page = book.pages[0]
    const session = deleteRegion(EMPTY_SESSION, page, 'r1')
    const doc = toDocument(session, book)
    expect(doc.pages[0].deleted_region_ids).toEqual(['r1'])
    expect(doc.pages[0].order).toEqual(['r2'])
    expect(effectiveRegions(page, doc.pages[0]).map((region) => region.id)).toEqual(['r2'])
  })

  test('deleting an edited suggestion drops the edit and keeps only the tombstone', () => {
    const book = bookWith([syntheticSuggestions(R1, R2)])
    const page = book.pages[0]
    const edited = updateRegionRect(EMPTY_SESSION, page, 'r1', {
      x: 0, y: 0, width: 0.5, height: 0.25,
    })
    const deleted = deleteRegion(edited, page, 'r1')
    const doc = toDocument(deleted, book)
    expect(doc.pages[0].edited_regions).toEqual([])
    expect(doc.pages[0].deleted_region_ids).toEqual(['r1'])
    const validation = validateAnnotationDocument(doc, fixtureManifest(book))
    expect(validation.ok).toBe(true)
  })

  test('deleting a manual region removes it without a tombstone', () => {
    const book = bookWith([undefined])
    const page = book.pages[0]
    const added = addRegion(EMPTY_SESSION, page, { x: 0, y: 0, width: 1, height: 0.5 })
    const deleted = deleteRegion(added.session, page, added.regionId)
    const doc = toDocument(deleted, book)
    expect(doc.pages).toEqual([])
  })

  test('restore removes the tombstone and reorders to the end', () => {
    const book = bookWith([syntheticSuggestions(R1, R2)])
    const page = book.pages[0]
    const deleted = deleteRegion(EMPTY_SESSION, page, 'r1')
    const restored = restoreRegion(deleted, page, 'r1')
    const doc = toDocument(restored, book)
    expect(doc.pages[0].deleted_region_ids).toEqual([])
    expect(doc.pages[0].order).toEqual(['r2', 'r1'])
  })

  test('reorder moves a region within the surviving sequence', () => {
    const book = bookWith([syntheticSuggestions(R1, R2)])
    const page = book.pages[0]
    const moved = reorderRegion(EMPTY_SESSION, page, 'r2', 0)
    const doc = toDocument(moved, book)
    expect(doc.pages[0].order).toEqual(['r2', 'r1'])
  })

  test('exports reconcile against changed detector output', () => {
    // Session was curated against a run that only had r1.
    const curated = bookWith([syntheticSuggestions(R1)])
    const page = curated.pages[0]
    const withManual = addRegion(EMPTY_SESSION, page, { x: 0, y: 0, width: 1, height: 0.2 })
    const reordered = reorderRegion(withManual.session, page, 'm-1', 0)

    // The rerun adds r2 and drops r1.
    const rerun = bookWith([syntheticSuggestions(R2)])
    const rerunPage = rerun.pages[0]
    const doc = toDocument(reordered, rerun)
    expect(doc.pages[0].order).toEqual(['m-1', 'r2'])

    // A later run brings r1 back; the manual order keeps priority and r1 reappears last.
    const again = bookWith([syntheticSuggestions(R1, R2)])
    const merged = effectiveRegions(again.pages[0], doc.pages[0])
    expect(merged.map((region) => region.id)).toEqual(['m-1', 'r2', 'r1'])
  })

  test('tombstones survive detector reruns that omit the suggestion', () => {
    const curated = bookWith([syntheticSuggestions(R1)])
    const deleted = deleteRegion(EMPTY_SESSION, curated.pages[0], 'r1')
    const rerun = bookWith([undefined])
    const doc = toDocument(deleted, rerun)
    expect(doc.pages[0].deleted_region_ids).toEqual(['r1'])
    const again = bookWith([syntheticSuggestions(R1)])
    expect(effectiveRegions(again.pages[0], doc.pages[0])).toEqual([])
  })

  test('sessionFromDocument round-trips through toDocument', () => {
    const book = bookWith([syntheticSuggestions(R1)])
    const session = addRegion(EMPTY_SESSION, book.pages[0], { x: 0, y: 0, width: 1, height: 0.2 }).session
    const doc = toDocument(session, book)
    const restored = sessionFromDocument(doc)
    expect(toDocument(restored, book)).toEqual(doc)
  })

  test('every exported document validates against the canonical schema and identity', () => {
    const book = bookWith([syntheticSuggestions(R1, R2), undefined])
    let session = EMPTY_SESSION
    session = addRegion(session, book.pages[0], { x: 0, y: 0, width: 0.5, height: 0.2 }).session
    session = updateRegionRect(session, book.pages[0], 'r1', { x: 0.1, y: 0.1, width: 0.4, height: 0.2 })
    session = deleteRegion(session, book.pages[0], 'r2')
    session = addRegion(session, book.pages[1], { x: 0, y: 0, width: 1, height: 0.5 }).session
    session = addRegion(session, book.pages[1], { x: 0, y: 0.5, width: 1, height: 0.5 }).session
    const doc = toDocument(session, book)
    const validation = validateAnnotationDocument(doc, fixtureManifest(book))
    expect(validation.ok).toBe(true)
  })

  test('updateRegionRect fails loudly for unknown regions', () => {
    const book = bookWith([undefined])
    expect(() => updateRegionRect(EMPTY_SESSION, book.pages[0], 'ghost', { x: 0, y: 0, width: 1, height: 1 })).toThrow()
  })

  test('clampRegionRect keeps rectangles inside the page with a minimum size', () => {
    expect(clampRegionRect({ x: -0.2, y: 0.9, width: 0.5, height: 0.5 })).toEqual({
      x: 0, y: 0.9, width: 0.5, height: 0.1,
    })
    expect(clampRegionRect({ x: 0.5, y: 0.5, width: 0, height: -1 })).toEqual({
      x: 0.5, y: 0.5, width: 0.01, height: 0.01,
    })
  })
})

function fixtureManifest(book: ReaderBook) {
  const pages = book.pages.map((page: ReaderPage) => ({
    id: page.id,
    pdf_page_number: page.pdfPageNumber,
    width: page.width,
    height: page.height,
    orientation: page.orientation,
    rotation_degrees: 0 as const,
    page: { path: `pages/${page.id}.webp`, sha256: page.id.padEnd(64, '0').slice(0, 64), byte_size: 1, width: page.width, height: page.height },
    thumbnail: { path: `thumbs/${page.id}.webp`, sha256: page.id.padEnd(64, '0').slice(0, 64), byte_size: 1, width: 100, height: 150 },
    ...(page.suggestions ? { suggestions: page.suggestions } : {}),
  }))
  return {
    schema_version: 1 as const,
    book: { id: 'fixture-book', title: 'Fixture Book' },
    source: { sha256: FIXTURE_SHA, byte_size: 12345, page_count: 3 },
    render_profile: {
      id: 'render-0123456789abcdef',
      format: 'webp' as const,
      quality: 90,
      long_edge_px: 3056,
      resolution_policy: 'native-embedded-capped' as const,
      thumbnail: { format: 'webp' as const, quality: 80, long_edge_px: 360 },
    },
    selection: 'all' as const,
    page_order: pages.map((page) => page.id),
    pages,
  }
}
