import sharedCases from '../../../format/merge-cases.json'
import { describe, expect, test } from 'vitest'
import { effectiveRegions, overrideIsNonEmpty } from './merge'
import type { Suggestions } from '../manifest/types'

function suggestions(...regions: { id: string; x: number; y: number; width: number; height: number }[]): Suggestions {
  return {
    detector: { name: 'synthetic', version: '1', configuration: {}, run_id: 'one' },
    regions,
    order: regions.map((region) => region.id),
  }
}

const R1 = { id: 'r1', x: 0, y: 0, width: 1, height: 1 }
const R2 = { id: 'r2', x: 0, y: 0, width: 0.5, height: 0.5 }

describe('effectiveRegions', () => {
  test('returns suggestions in detector order without an override', () => {
    const page = { suggestions: suggestions({ ...R2 }, { ...R1 }) }
    expect(effectiveRegions(page, null).map((region) => region.id)).toEqual(['r2', 'r1'])
  })

  test('treats missing suggestions as an empty sequence', () => {
    expect(effectiveRegions({}, null)).toEqual([])
  })

  test('applies tombstones, edits and additions, then the manual order', () => {
    const page = { suggestions: suggestions({ ...R1 }, { ...R2 }) }
    const manual = { id: 'manual-1', x: 0, y: 0, width: 0.5, height: 1 }
    const edited = { id: 'r2', x: 0.1, y: 0.1, width: 0.2, height: 0.2 }
    const merged = effectiveRegions(page, {
      page_id: 'p',
      pdf_page_number: 1,
      added_regions: [manual],
      edited_regions: [edited],
      deleted_region_ids: ['r1'],
      order: ['manual-1', 'r2'],
    })
    expect(merged).toEqual([manual, edited])
  })

  test('an explicit deletion list can suppress every suggestion', () => {
    const page = { suggestions: suggestions({ ...R1 }, { ...R2 }) }
    expect(
      effectiveRegions(page, {
        page_id: 'p',
        pdf_page_number: 1,
        added_regions: [],
        edited_regions: [],
        deleted_region_ids: ['r1', 'r2'],
        order: [],
      }),
    ).toEqual([])
  })

  test('an edited suggestion remains usable when the rerun omits it', () => {
    const edited = { id: 'r1', x: 0, y: 0, width: 0.25, height: 0.25 }
    const merged = effectiveRegions(
      { suggestions: suggestions({ ...R2 }) },
      {
        page_id: 'p',
        pdf_page_number: 1,
        added_regions: [],
        edited_regions: [edited],
        deleted_region_ids: [],
        order: ['r1', 'r2'],
      },
    )
    expect(merged).toEqual([edited, { ...R2 }])
  })

  test('new surviving suggestions from a rerun append in detector order', () => {
    const first = { suggestions: suggestions({ ...R1 }) }
    const override = {
      page_id: 'p',
      pdf_page_number: 1,
      added_regions: [{ id: 'm-1', x: 0, y: 0, width: 1, height: 0.5 }],
      edited_regions: [],
      deleted_region_ids: [],
      order: ['m-1'],
    }
    expect(effectiveRegions(first, override).map((region) => region.id)).toEqual(['m-1', 'r1'])
    const rerun = { suggestions: suggestions({ ...R1 }, { ...R2 }) }
    expect(effectiveRegions(rerun, override).map((region) => region.id)).toEqual(['m-1', 'r1', 'r2'])
  })

  test('tombstones persist for ids absent from the current suggestions', () => {
    const rerun = { suggestions: suggestions({ ...R2 }) }
    const override = {
      page_id: 'p',
      pdf_page_number: 1,
      added_regions: [],
      edited_regions: [],
      deleted_region_ids: ['r1'],
      order: [],
    }
    expect(effectiveRegions(rerun, override)).toEqual([{ ...R2 }])
    const again = { suggestions: suggestions({ ...R2 }, { ...R1 }) }
    expect(effectiveRegions(again, override).map((region) => region.id)).toEqual(['r2'])
  })

  test('stale order references are dropped instead of failing the merge', () => {
    const page = { suggestions: suggestions({ ...R2 }) }
    const merged = effectiveRegions(page, {
      page_id: 'p',
      pdf_page_number: 1,
      added_regions: [],
      edited_regions: [],
      deleted_region_ids: [],
      order: ['vanished', 'r2'],
    })
    expect(merged.map((region) => region.id)).toEqual(['r2'])
  })
})

describe('overrideIsNonEmpty', () => {
  test('detects additions, edits, deletions and reorders', () => {
    const page = { suggestions: suggestions({ ...R1 }, { ...R2 }) }
    const empty = {
      page_id: 'p',
      pdf_page_number: 1,
      added_regions: [],
      edited_regions: [],
      deleted_region_ids: [],
      order: ['r1', 'r2'],
    }
    expect(overrideIsNonEmpty(page, empty)).toBe(false)
    expect(overrideIsNonEmpty(page, { ...empty, deleted_region_ids: ['r1'], order: ['r2'] })).toBe(true)
    expect(overrideIsNonEmpty(page, { ...empty, order: ['r2', 'r1'] })).toBe(true)
    expect(
      overrideIsNonEmpty({}, { ...empty, added_regions: [{ ...R1 }], order: ['r1'] }),
    ).toBe(true)
  })
})

// These exact inputs and outputs are also exercised by Python effective_regions.
test.each(sharedCases)('shared Python/TypeScript merge: $name', ({ page, override, expected }) => {
  expect(effectiveRegions(page, override)).toEqual(expected)
})
