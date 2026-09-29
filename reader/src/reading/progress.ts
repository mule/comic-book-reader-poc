import type { ReaderBook } from '../manifest/load'

const KEY_PREFIX = 'comicpoc:reading-position:v1:'

export interface SavedPosition {
  bookId: string
  sourceSha256: string
  pageId: string
  /** Current guided region, or null for the full-page fallback/full mode. */
  regionId: string | null
  updatedAt: number
}

export type StartResolution =
  | { status: 'restored'; index: number; pageId: string; regionId: string | null; notice: string | null }
  | { status: 'fallback'; index: 0; notice: string }

function storage(): Storage {
  const store = globalThis.localStorage
  if (!store) throw new Error('localStorage is not available in this environment.')
  return store
}

function positionKey(bookId: string, sourceSha256: string): string {
  return `${KEY_PREFIX}${bookId}:${sourceSha256}`
}

export function savePosition(
  bookId: string,
  sourceSha256: string,
  pageId: string,
  regionId: string | null = null,
): void {
  const value: SavedPosition = { bookId, sourceSha256, pageId, regionId, updatedAt: Date.now() }
  storage().setItem(positionKey(bookId, sourceSha256), JSON.stringify(value))
}

export function loadPosition(bookId: string, sourceSha256: string): SavedPosition | null {
  const raw = storage().getItem(positionKey(bookId, sourceSha256))
  return parsePosition(raw, bookId, sourceSha256)
}

export function findPositionForBook(bookId: string): SavedPosition[] {
  const store = storage()
  const found: SavedPosition[] = []
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i)
    if (!key || !key.startsWith(KEY_PREFIX)) continue
    const raw = store.getItem(key)
    const parsed = parsePosition(raw, bookId, null)
    if (parsed) found.push(parsed)
  }
  return found
}

function parsePosition(
  raw: string | null,
  bookId: string,
  sourceSha256: string | null,
): SavedPosition | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Partial<SavedPosition>
  if (
    typeof candidate.bookId !== 'string' ||
    typeof candidate.sourceSha256 !== 'string' ||
    typeof candidate.pageId !== 'string' ||
    candidate.bookId !== bookId
  ) {
    return null
  }
  if (sourceSha256 !== null && candidate.sourceSha256 !== sourceSha256) return null
  return {
    bookId: candidate.bookId,
    sourceSha256: candidate.sourceSha256,
    pageId: candidate.pageId,
    regionId: typeof candidate.regionId === 'string' ? candidate.regionId : null,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
  }
}

export function clearPosition(bookId: string, sourceSha256: string): void {
  storage().removeItem(positionKey(bookId, sourceSha256))
}

export function resolveStartPosition(book: ReaderBook): StartResolution {
  const saved = findPositionForBook(book.id)
  if (saved.length === 0) {
    return { status: 'restored', index: 0, pageId: book.pages[0].id, regionId: null, notice: null }
  }
  const exact = saved.find((entry) => entry.sourceSha256 === book.sourceSha256)
  if (!exact) {
    const other = saved.map((entry) => entry.sourceSha256.slice(0, 12)).join(', ')
    return {
      status: 'fallback',
      index: 0,
      notice:
        `A saved reading position exists for a different source revision of this book ` +
        `(sha256 ${other}…). Positions never migrate across source changes; ` +
        'starting from the first page.',
    }
  }
  const page = book.byId.get(exact.pageId)
  if (!page) {
    return {
      status: 'fallback',
      index: 0,
      notice:
        `The saved reading position references page ${exact.pageId}, which no longer exists ` +
        'in this package. Starting from the first page.',
    }
  }
  const notice =
    page.orderIndex === book.pages.length - 1
      ? 'Restored your position at the last page.'
      : null
  return {
    status: 'restored',
    index: page.orderIndex,
    pageId: page.id,
    regionId: exact.regionId,
    notice,
  }
}
