import { describe, expect, test } from 'vitest'
import { validateAnnotationDocument, parseAnnotationJson } from './validate'
import type { AnnotationDocument } from './merge'
import { makeManifest, FIXTURE_SHA } from '../testing/manifestFixture'

const SUGGESTED = { id: 'r1', x: 0, y: 0, width: 1, height: 1 }

function manifestWithSuggestions() {
  const manifest = makeManifest()
  manifest.pages[0].suggestions = {
    detector: { name: 'synthetic', version: '1', configuration: {}, run_id: 'one' },
    regions: [{ ...SUGGESTED }],
    order: ['r1'],
  }
  return manifest
}

function document(overrides: Partial<AnnotationDocument> = {}): AnnotationDocument {
  return {
    schema_version: 1,
    book_id: 'fixture-book',
    source_sha256: FIXTURE_SHA,
    pages: [],
    ...overrides,
  }
}

function override(overrides = {}) {
  return {
    page_id: `p-${FIXTURE_SHA}-0001`,
    pdf_page_number: 1,
    added_regions: [],
    edited_regions: [],
    deleted_region_ids: [],
    order: [],
    ...overrides,
  }
}

function failureOf(result: ReturnType<typeof validateAnnotationDocument>) {
  if (result.ok) throw new Error('expected the document to be rejected')
  return result.error
}

function issuesOf(result: ReturnType<typeof validateAnnotationDocument>): string[] {
  const error = failureOf(result)
  return error.kind === 'parse' ? [] : error.issues
}

describe('validateAnnotationDocument', () => {
  test('accepts a valid manual document against the canonical schema', () => {
    const manifest = manifestWithSuggestions()
    const doc = document({
      pages: [
        override({
          added_regions: [{ id: 'manual-1', x: 0, y: 0, width: 0.5, height: 1 }],
          deleted_region_ids: ['r1'],
          order: ['manual-1'],
        }),
      ],
    })
    const result = validateAnnotationDocument(doc, manifest)
    expect(result.ok).toBe(true)
  })

  test('rejects documents that fail format/annotations.schema.json', () => {
    const manifest = manifestWithSuggestions()
    const cases: unknown[] = [
      { ...document(), schema_version: 2 },
      { ...document(), extra: true },
      document({ pages: [override({ added_regions: [{ id: 'bad id', x: 0, y: 0, width: 1, height: 1 }] })] }),
      document({ pages: [override({ order: ['dup', 'dup'] })] }),
      document({ source_sha256: 'not-hex' }),
    ]
    for (const candidate of cases) {
      const result = validateAnnotationDocument(candidate, manifest)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('schema')
    }
  })

  test('rejects a different book or source revision', () => {
    const manifest = manifestWithSuggestions()
    const wrongBook = validateAnnotationDocument(document({ book_id: 'other-book' }), manifest)
    expect(failureOf(wrongBook).kind).toBe('identity')

    const wrongSource = validateAnnotationDocument(document({ source_sha256: '0'.repeat(64) }), manifest)
    expect(failureOf(wrongSource).kind).toBe('identity')
  })

  test('rejects unknown pages and pdf page number mismatches', () => {
    const manifest = manifestWithSuggestions()
    const unknown = validateAnnotationDocument(
      document({ pages: [override({ page_id: 'p-gone' })] }),
      manifest,
    )
    expect(issuesOf(unknown)[0]).toContain('mismatch')

    const wrongNumber = validateAnnotationDocument(
      document({ pages: [override({ pdf_page_number: 2 })] }),
      manifest,
    )
    expect(wrongNumber.ok).toBe(false)
  })

  test('rejects regions out of bounds, duplicate ids and add/delete overlap', () => {
    const manifest = manifestWithSuggestions()
    const cases = [
      override({ added_regions: [{ id: 'm-1', x: 0.9, y: 0, width: 0.2, height: 1 }], order: ['m-1'] }),
      override({
        added_regions: [
          { id: 'm-1', x: 0, y: 0, width: 0.2, height: 1 },
          { id: 'm-1', x: 0.5, y: 0, width: 0.2, height: 1 },
        ],
        order: ['m-1'],
      }),
      override({ deleted_region_ids: ['r1'], added_regions: [{ ...SUGGESTED }], order: ['r1'] }),
    ]
    for (const page of cases) {
      const result = validateAnnotationDocument(document({ pages: [page] }), manifest)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('semantic')
    }
  })

  test('rejects an added region colliding with a suggestion id', () => {
    const manifest = manifestWithSuggestions()
    const result = validateAnnotationDocument(
      document({ pages: [override({ added_regions: [{ ...SUGGESTED }], order: ['r1'] })] }),
      manifest,
    )
    expect(issuesOf(result).join(' ')).toContain('collides')
  })

  test('the manual order must reference known regions and cover survivors', () => {
    const manifest = manifestWithSuggestions()
    const unknown = validateAnnotationDocument(
      document({ pages: [override({ order: ['missing'] })] }),
      manifest,
    )
    expect(unknown.ok).toBe(false)

    const missingSurvivor = validateAnnotationDocument(
      document({
        pages: [
          override({
            added_regions: [{ id: 'm-1', x: 0, y: 0, width: 0.5, height: 1 }],
            order: ['m-1'],
          }),
        ],
      }),
      manifest,
    )
    expect(missingSurvivor.ok).toBe(false)
    expect(issuesOf(missingSurvivor).join(' ')).toContain('surviving region r1')
  })

  test('tombstones for ids absent from current suggestions are accepted', () => {
    const manifest = manifestWithSuggestions()
    const result = validateAnnotationDocument(
      document({
        pages: [
          override({
            deleted_region_ids: ['r1', 'ghost-from-old-run'],
            order: [],
          }),
        ],
      }),
      manifest,
    )
    expect(result.ok).toBe(true)
  })
})

describe('parseAnnotationJson', () => {
  test('parses valid text and reports invalid text', () => {
    expect(parseAnnotationJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    const bad = parseAnnotationJson('{nope')
    expect(bad.ok).toBe(false)
  })
})
