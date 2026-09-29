import type { ReaderBook, ReaderPage } from '../manifest/load'
import type { PageOverride } from '../annotations/merge'
import { effectiveRegions } from '../annotations/merge'
import { FULL_PAGE_RECT, type Rect } from './camera'

/**
 * One stop of the guided reading sequence. `regionId === null` marks the
 * transient full-page fallback used when a page has no usable regions; it is
 * not a stored region id and cannot collide with annotations.
 */
export interface GuidedStep {
  pageIndex: number
  pageId: string
  regionId: string | null
  rect: Rect
}

export function buildGuidedSequence(
  book: ReaderBook,
  overrideFor: (page: ReaderPage) => PageOverride | null,
): GuidedStep[] {
  const steps: GuidedStep[] = []
  book.pages.forEach((page, pageIndex) => {
    const regions = effectiveRegions(page, overrideFor(page))
    if (regions.length === 0) {
      steps.push({ pageIndex, pageId: page.id, regionId: null, rect: FULL_PAGE_RECT })
      return
    }
    for (const region of regions) {
      steps.push({
        pageIndex,
        pageId: page.id,
        regionId: region.id,
        rect: { x: region.x, y: region.y, width: region.width, height: region.height },
      })
    }
  })
  return steps
}

/** Next is clamp(index + 1); previous is the exact inverse (clamp(index - 1)). */
export function stepForward(steps: GuidedStep[], index: number): number {
  if (steps.length === 0) throw new Error('No guided steps to navigate.')
  return Math.min(steps.length - 1, Math.max(0, index + 1))
}

export function stepBackward(steps: GuidedStep[], index: number): number {
  if (steps.length === 0) throw new Error('No guided steps to navigate.')
  return Math.min(steps.length - 1, Math.max(0, index - 1))
}

export function findStep(
  steps: GuidedStep[],
  pageId: string,
  regionId: string | null,
): number | null {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    if (step.pageId === pageId && step.regionId === regionId) return index
  }
  return null
}

export function firstStepOfPage(steps: GuidedStep[], pageId: string): number | null {
  for (let index = 0; index < steps.length; index += 1) {
    if (steps[index].pageId === pageId) return index
  }
  return null
}

export function stepLabel(step: GuidedStep, steps: GuidedStep[]): string {
  const position = steps.indexOf(step) + 1
  if (step.regionId === null) return `panel — (full page) · ${position} / ${steps.length}`
  return `panel ${position} / ${steps.length}`
}
