import type { AnnotationDocument, PageOverride } from './merge'

const KEY_PREFIX = 'comicpoc:annotations:v1:'

export interface AnnotationStoreEntry {
  document: AnnotationDocument
  updatedAt: number
}

function storage(): Storage {
  const store = globalThis.localStorage
  if (!store) throw new Error('localStorage is not available in this environment.')
  return store
}

export function annotationKey(bookId: string, sourceSha256: string): string {
  return `${KEY_PREFIX}${bookId}:${sourceSha256}`
}

export function saveAnnotations(
  bookId: string,
  sourceSha256: string,
  document: AnnotationDocument,
): void {
  const entry: AnnotationStoreEntry = { document, updatedAt: Date.now() }
  storage().setItem(annotationKey(bookId, sourceSha256), JSON.stringify(entry))
}

export function clearAnnotations(bookId: string, sourceSha256: string): void {
  storage().removeItem(annotationKey(bookId, sourceSha256))
}

export function loadAnnotations(
  bookId: string,
  sourceSha256: string,
): { entry: AnnotationStoreEntry | null; warning: string | null } {
  const raw = storage().getItem(annotationKey(bookId, sourceSha256))
  if (raw === null) return { entry: null, warning: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      entry: null,
      warning:
        'Locally saved annotations for this book could not be parsed and were ignored; ' +
        'the stored value remains untouched until the next save.',
    }
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as AnnotationStoreEntry).updatedAt !== 'number' ||
    !isAnnotationDocument((parsed as AnnotationStoreEntry).document)
  ) {
    return {
      entry: null,
      warning:
        'Locally saved annotations for this book have an unexpected shape and were ignored.',
    }
  }
  const entry = parsed as AnnotationStoreEntry
  if (
    entry.document.book_id !== bookId ||
    entry.document.source_sha256 !== sourceSha256 ||
    entry.document.schema_version !== 1
  ) {
    return {
      entry: null,
      warning:
        'Locally saved annotations are bound to a different book or source revision ' +
        'and were ignored.',
    }
  }
  return { entry, warning: null }
}

function isAnnotationDocument(value: unknown): value is AnnotationDocument {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AnnotationDocument>
  if (
    candidate.schema_version !== 1 ||
    typeof candidate.book_id !== 'string' ||
    typeof candidate.source_sha256 !== 'string' ||
    !Array.isArray(candidate.pages)
  ) {
    return false
  }
  return candidate.pages.every((page): page is PageOverride => isPageOverride(page))
}

function isPageOverride(value: unknown): value is PageOverride {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<PageOverride>
  return (
    typeof candidate.page_id === 'string' &&
    typeof candidate.pdf_page_number === 'number' &&
    Array.isArray(candidate.added_regions) &&
    Array.isArray(candidate.edited_regions) &&
    Array.isArray(candidate.deleted_region_ids) &&
    Array.isArray(candidate.order)
  )
}
