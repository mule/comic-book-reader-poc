import type { Region, Suggestions } from '../manifest/types'
import type { ReaderPage } from '../manifest/load'
import type { AnnotationDocument, PageOverride } from './merge'
import { effectiveRegions, overrideIsNonEmpty, pageSuggestions } from './merge'
import type { Rect } from '../reading/camera'

/** Coordinates are stored rounded to avoid float drift across merge/export. */
const COORDINATE_DECIMALS = 4
export const MIN_REGION_SIZE = 0.01

export interface PageEditSession {
  added: Region[]
  edited: Region[]
  deleted: string[]
  order: string[]
}

export interface EditSession {
  pages: Map<string, PageEditSession>
}

export const EMPTY_SESSION: EditSession = { pages: new Map() }

export function roundRect(rect: Rect): Rect {
  const round = (value: number) => Number(value.toFixed(COORDINATE_DECIMALS))
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  }
}

export function clampRegionRect(rect: Rect): Rect {
  const x = Math.min(1, Math.max(0, rect.x))
  const y = Math.min(1, Math.max(0, rect.y))
  const width = Math.min(1 - x, Math.max(MIN_REGION_SIZE, rect.width))
  const height = Math.min(1 - y, Math.max(MIN_REGION_SIZE, rect.height))
  return roundRect({ x, y, width, height })
}

export function sessionFromDocument(document: AnnotationDocument | null): EditSession {
  const pages = new Map<string, PageEditSession>()
  if (!document) return { pages }
  for (const override of document.pages) {
    pages.set(override.page_id, {
      added: override.added_regions.map((region) => ({ ...region })),
      edited: override.edited_regions.map((region) => ({ ...region })),
      deleted: [...override.deleted_region_ids],
      order: [...override.order],
    })
  }
  return { pages }
}

export function getPageSession(
  session: EditSession,
  page: { id: string },
): PageEditSession | null {
  return session.pages.get(page.id) ?? null
}

function putPageSession(
  session: EditSession,
  page: { id: string },
  pageSession: PageEditSession,
): EditSession {
  const pages = new Map(session.pages)
  pages.set(page.id, pageSession)
  return { pages }
}

function clonePageSession(pageSession: PageEditSession): PageEditSession {
  return {
    added: pageSession.added.map((region) => ({ ...region })),
    edited: pageSession.edited.map((region) => ({ ...region })),
    deleted: [...pageSession.deleted],
    order: [...pageSession.order],
  }
}

/**
 * Materialize the page's editing state from the current suggestions merged
 * with any existing override. The stored order becomes the explicit curated
 * sequence; ids absent from the current detector run stay (stale ids are
 * filtered again in buildOverride, so exports always validate).
 */
export function ensurePageSession(
  session: EditSession,
  page: { id: string; suggestions?: Suggestions },
): { session: EditSession; pageSession: PageEditSession } {
  const existing = session.pages.get(page.id)
  if (existing) return { session, pageSession: existing }
  const order = effectiveRegions(page, null).map((region) => region.id)
  const pageSession: PageEditSession = { added: [], edited: [], deleted: [], order }
  return { session: putPageSession(session, page, pageSession), pageSession }
}

function nextManualId(page: { suggestions?: Suggestions }, pageSession: PageEditSession): string {
  const taken = new Set<string>([
    ...pageSuggestions(page).regions.map((region) => region.id),
    ...pageSession.added.map((region) => region.id),
    ...pageSession.edited.map((region) => region.id),
    ...pageSession.deleted,
    ...pageSession.order,
  ])
  let counter = 1
  while (taken.has(`m-${counter}`)) counter += 1
  return `m-${counter}`
}

export function addRegion(
  session: EditSession,
  page: { id: string; suggestions?: Suggestions },
  rect: Rect,
): { session: EditSession; regionId: string } {
  const ensured = ensurePageSession(session, page)
  const pageSession = clonePageSession(ensured.pageSession)
  const id = nextManualId(page, pageSession)
  pageSession.added.push({ id, ...clampRegionRect(rect) })
  pageSession.order.push(id)
  return { session: putPageSession(ensured.session, page, pageSession), regionId: id }
}

function isSuggestedRegion(page: { suggestions?: Suggestions }, id: string): boolean {
  return pageSuggestions(page).regions.some((region) => region.id === id)
}

export function updateRegionRect(
  session: EditSession,
  page: { id: string; suggestions?: Suggestions },
  id: string,
  rect: Rect,
): EditSession {
  const ensured = ensurePageSession(session, page)
  const pageSession = clonePageSession(ensured.pageSession)
  const clamped = clampRegionRect(rect)
  const addedIndex = pageSession.added.findIndex((region) => region.id === id)
  if (addedIndex >= 0) {
    pageSession.added[addedIndex] = { id, ...clamped }
    return putPageSession(ensured.session, page, pageSession)
  }
  const editedIndex = pageSession.edited.findIndex((region) => region.id === id)
  if (editedIndex >= 0) {
    pageSession.edited[editedIndex] = { id, ...clamped }
    return putPageSession(ensured.session, page, pageSession)
  }
  if (isSuggestedRegion(page, id)) {
    pageSession.edited.push({ id, ...clamped })
    if (!pageSession.order.includes(id)) pageSession.order.push(id)
    return putPageSession(ensured.session, page, pageSession)
  }
  throw new Error(`Unknown region ${id} on page ${page.id}`)
}

/**
 * Deleting a suggestion records a persistent tombstone (and drops any edit of
 * it); deleting a manual region removes it from the additions. Surviving
 * tombstones for ids absent from the current suggestions are kept.
 */
export function deleteRegion(
  session: EditSession,
  page: { id: string; suggestions?: Suggestions },
  id: string,
): EditSession {
  const ensured = ensurePageSession(session, page)
  const pageSession = clonePageSession(ensured.pageSession)
  pageSession.added = pageSession.added.filter((region) => region.id !== id)
  pageSession.edited = pageSession.edited.filter((region) => region.id !== id)
  if (isSuggestedRegion(page, id) && !pageSession.deleted.includes(id)) {
    pageSession.deleted.push(id)
  }
  pageSession.order = pageSession.order.filter((regionId) => regionId !== id)
  return putPageSession(ensured.session, page, pageSession)
}

/** Remove a tombstone; the restored region reappears at the end of the order. */
export function restoreRegion(
  session: EditSession,
  page: { id: string; suggestions?: Suggestions },
  id: string,
): EditSession {
  const ensured = ensurePageSession(session, page)
  const pageSession = clonePageSession(ensured.pageSession)
  pageSession.deleted = pageSession.deleted.filter((regionId) => regionId !== id)
  if (!pageSession.order.includes(id)) pageSession.order.push(id)
  return putPageSession(ensured.session, page, pageSession)
}

export function reorderRegion(
  session: EditSession,
  page: { id: string; suggestions?: Suggestions },
  id: string,
  targetIndex: number,
): EditSession {
  const ensured = ensurePageSession(session, page)
  const pageSession = clonePageSession(ensured.pageSession)
  const survivors = effectiveRegions(page, buildOverride(page, pageSession)).map(
    (region) => region.id,
  )
  const from = survivors.indexOf(id)
  if (from < 0) throw new Error(`Region ${id} is not a survivor on page ${page.id}`)
  const to = Math.min(survivors.length - 1, Math.max(0, targetIndex))
  survivors.splice(to, 0, ...survivors.splice(from, 1))
  pageSession.order = survivors
  return putPageSession(ensured.session, page, pageSession)
}

/**
 * Build the exportable override for one page, reconciled against the CURRENT
 * suggestions: stale order ids are dropped and new detector suggestions append
 * in detector order, exactly like effective_regions.
 */
export function buildOverride(
  page: { suggestions?: Suggestions },
  pageSession: PageEditSession,
): PageOverride {
  const suggested = pageSuggestions(page)
  const deleted = new Set(pageSession.deleted)
  const edited = pageSession.edited.filter((region) => !deleted.has(region.id))
  // Survivors of the current merge: suggestions plus manual regions, minus
  // tombstones. Stale order ids (vanished suggestions) drop out here.
  const known = new Set<string>()
  for (const id of suggested.regions.map((region) => region.id)) {
    if (!deleted.has(id)) known.add(id)
  }
  for (const region of [...pageSession.added, ...edited]) known.add(region.id)
  const orderSeen = new Set<string>()
  const order: string[] = []
  for (const id of pageSession.order) {
    if (known.has(id) && !orderSeen.has(id)) {
      order.push(id)
      orderSeen.add(id)
    }
  }
  for (const id of suggested.order) {
    if (known.has(id) && !orderSeen.has(id)) {
      order.push(id)
      orderSeen.add(id)
    }
  }
  return {
    page_id: '',
    pdf_page_number: 0,
    added_regions: pageSession.added.map((region) => ({ ...region })),
    edited_regions: edited.map((region) => ({ ...region })),
    deleted_region_ids: [...pageSession.deleted],
    order,
  }
}

export function toDocument(
  session: EditSession,
  book: { id: string; sourceSha256: string; pages: ReaderPage[] },
): AnnotationDocument {
  const pages: PageOverride[] = []
  for (const page of book.pages) {
    const pageSession = session.pages.get(page.id)
    if (!pageSession) continue
    const override = buildOverride(page, pageSession)
    override.page_id = page.id
    override.pdf_page_number = page.pdfPageNumber
    if (overrideIsNonEmpty(page, override)) pages.push(override)
  }
  return {
    schema_version: 1,
    book_id: book.id,
    source_sha256: book.sourceSha256,
    pages,
  }
}

export function sessionHasEdits(session: EditSession): boolean {
  return session.pages.size > 0
}
