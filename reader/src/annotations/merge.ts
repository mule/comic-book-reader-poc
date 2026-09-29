import type { Region, Suggestions } from '../manifest/types'

/** One page entry of a manual annotation document (format/annotations.schema.json). */
export interface PageOverride {
  page_id: string
  pdf_page_number: number
  added_regions: Region[]
  edited_regions: Region[]
  deleted_region_ids: string[]
  order: string[]
}

/** A complete manual annotation document bound to one (book_id, source_sha256). */
export interface AnnotationDocument {
  schema_version: 1
  book_id: string
  source_sha256: string
  pages: PageOverride[]
}

export const EMPTY_SUGGESTIONS: Suggestions = {
  detector: { name: '', version: '', configuration: {}, run_id: '' },
  regions: [],
  order: [],
}

export function pageSuggestions(page: { suggestions?: Suggestions }): Suggestions {
  return page.suggestions ?? EMPTY_SUGGESTIONS
}

export function suggestedIds(page: { suggestions?: Suggestions }): Set<string> {
  return new Set(pageSuggestions(page).regions.map((region) => region.id))
}

/**
 * Merge suggestions with one manual override, exactly mirroring
 * `effective_regions` in tools/src/comicpoc/manifest.py:
 * start with suggestions, apply tombstones, apply complete edits/additions,
 * then use the manual order; surviving suggestions absent from that order
 * (e.g. new ones from a detector rerun) append afterwards in detector order.
 */
export function effectiveRegions(
  page: { suggestions?: Suggestions },
  override: PageOverride | null,
): Region[] {
  const suggestions = pageSuggestions(page)
  const regions = new Map(suggestions.regions.map((region) => [region.id, region]))
  let order: readonly string[] = suggestions.order
  if (override !== null) {
    for (const id of override.deleted_region_ids) regions.delete(id)
    for (const region of [...override.edited_regions, ...override.added_regions]) {
      regions.set(region.id, region)
    }
    const manual = new Set(override.order)
    order = [...override.order, ...suggestions.order.filter((id) => !manual.has(id))]
  }
  const merged: Region[] = []
  for (const id of order) {
    const region = regions.get(id)
    if (region) merged.push(region)
  }
  return merged
}

/** True when the override records any actual change for the page. */
export function overrideIsNonEmpty(
  page: { suggestions?: Suggestions },
  override: PageOverride,
): boolean {
  const suggestions = pageSuggestions(page)
  if (
    override.added_regions.length > 0 ||
    override.edited_regions.length > 0 ||
    override.deleted_region_ids.length > 0
  ) {
    return true
  }
  const order = override.order
  const suggestionOrder = suggestions.order
  if (order.length !== suggestionOrder.length) return true
  return order.some((id, index) => id !== suggestionOrder[index])
}
