import { describe, expect, test } from 'vitest'
import { buildGuidedSequence, stepForward, stepBackward, findStep, firstStepOfPage } from './sequence'
import { buildReaderBook, type ReaderBook } from '../manifest/load'
import { makeManifest, makePage } from '../testing/manifestFixture'
import type { Region, Suggestions } from '../manifest/types'

function suggestions(...regions: Region[]): Suggestions {
  return {
    detector: { name: 'synthetic', version: '1', configuration: {}, run_id: 'one' },
    regions,
    order: regions.map((region) => region.id),
  }
}

const A1: Region = { id: 'a1', x: 0, y: 0, width: 1, height: 0.5 }
const A2: Region = { id: 'a2', x: 0, y: 0.5, width: 1, height: 0.5 }
const B1: Region = { id: 'b1', x: 0, y: 0, width: 0.5, height: 1 }

function book(): ReaderBook {
  const manifest = makeManifest({
    pages: [
      makePage(1, { suggestions: suggestions(A1, A2) }),
      makePage(2),
      makePage(3, { suggestions: suggestions(B1) }),
    ],
  })
  return buildReaderBook('fixture-book', manifest)
}

describe('buildGuidedSequence', () => {
  test('flattens page_order then effective region order', () => {
    const steps = buildGuidedSequence(book(), () => null)
    expect(steps.map((step) => [step.pageId, step.regionId])).toEqual([
      ['p-' + 'a'.repeat(64) + '-0001', 'a1'],
      ['p-' + 'a'.repeat(64) + '-0001', 'a2'],
      ['p-' + 'a'.repeat(64) + '-0002', null],
      ['p-' + 'a'.repeat(64) + '-0003', 'b1'],
    ])
  })

  test('pages with no usable regions contribute one transient full-page step', () => {
    const steps = buildGuidedSequence(book(), () => null)
    const fallback = steps[2]
    expect(fallback.regionId).toBeNull()
    expect(fallback.rect).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  test('overrides change the effective sequence', () => {
    const pageId = 'p-' + 'a'.repeat(64) + '-0001'
    const steps = buildGuidedSequence(book(), (page) =>
      page.id === pageId
        ? {
            page_id: pageId,
            pdf_page_number: 1,
            added_regions: [{ id: 'm-1', x: 0, y: 0, width: 1, height: 0.25 }],
            edited_regions: [],
            deleted_region_ids: ['a1'],
            order: ['m-1', 'a2'],
          }
        : null,
    )
    expect(steps.map((step) => step.regionId)).toEqual(['m-1', 'a2', null, 'b1'])
  })

  test('suppressing every region of a page falls back to a full-page step', () => {
    const steps = buildGuidedSequence(book(), (page) => ({
      page_id: page.id,
      pdf_page_number: page.pdfPageNumber,
      added_regions: [],
      edited_regions: [],
      deleted_region_ids: page.suggestions?.regions.map((region) => region.id) ?? [],
      order: [],
    }))
    expect(steps.every((step) => step.regionId === null)).toBe(true)
    expect(steps).toHaveLength(3)
  })
})

describe('next / previous symmetry', () => {
  test('previous is the exact inverse of next across the whole book', () => {
    const steps = buildGuidedSequence(book(), () => null)
    let index = 0
    const visitedForward: number[] = [0]
    for (let i = 0; i + 1 < steps.length; i += 1) {
      index = stepForward(steps, index)
      visitedForward.push(index)
    }
    expect(visitedForward).toEqual([0, 1, 2, 3])
    const visitedBackward: number[] = [index]
    for (let i = 0; i + 1 < steps.length; i += 1) {
      index = stepBackward(steps, index)
      visitedBackward.push(index)
    }
    expect(visitedBackward).toEqual([3, 2, 1, 0])
    // Away from the clamped ends, each step is exactly invertible.
    for (let i = 0; i + 1 < steps.length; i += 1) {
      expect(stepBackward(steps, stepForward(steps, i))).toBe(i)
    }
    for (let i = 1; i < steps.length; i += 1) {
      expect(stepForward(steps, stepBackward(steps, i))).toBe(i)
    }
  })

  test('navigation clamps at both ends', () => {
    const steps = buildGuidedSequence(book(), () => null)
    expect(stepForward(steps, steps.length - 1)).toBe(steps.length - 1)
    expect(stepBackward(steps, 0)).toBe(0)
  })
})

describe('findStep / firstStepOfPage', () => {
  test('locates a (page, region) step and page starts', () => {
    const b = book()
    const steps = buildGuidedSequence(b, () => null)
    const page2 = b.pages[1].id
    expect(findStep(steps, page2, null)).toBe(2)
    expect(findStep(steps, page2, 'gone')).toBeNull()
    expect(firstStepOfPage(steps, page2)).toBe(2)
    expect(firstStepOfPage(steps, 'p-nope')).toBeNull()
  })
})
