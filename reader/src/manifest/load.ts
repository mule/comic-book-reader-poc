import type { Manifest, Orientation, Suggestions } from './types'
import { validateManifest, type ManifestError } from './validate'

export interface ReaderPage {
  id: string
  orderIndex: number
  pdfPageNumber: number
  imageUrl: string
  thumbUrl: string
  width: number
  height: number
  orientation: Orientation
  suggestions?: Suggestions
}

export interface ReaderBook {
  packageId: string
  id: string
  title: string
  sourceSha256: string
  sourcePageCount: number
  selection: 'all' | 'sample'
  pages: ReaderPage[]
  byId: Map<string, ReaderPage>
}

export type BookLoadError =
  | { kind: 'network'; message: string }
  | { kind: 'package'; message: string }
  | { kind: 'integrity'; message: string }
  | { kind: 'parse'; message: string }
  | { kind: 'manifest'; error: ManifestError }

export type BookLoadResult = { ok: true; book: ReaderBook } | { ok: false; error: BookLoadError }

export function packagesUrl(relative: string): string {
  return `/packages/${relative}`
}

export function buildReaderBook(packageId: string, manifest: Manifest): ReaderBook {
  const pagesById = new Map(manifest.pages.map((page) => [page.id, page]))
  const pages: ReaderPage[] = manifest.page_order.map((id, orderIndex) => {
    const page = pagesById.get(id)
    if (!page) throw new Error(`page_order references unknown page ${id}`)
    return {
      id,
      orderIndex,
      pdfPageNumber: page.pdf_page_number,
      imageUrl: packagesUrl(`${packageId}/${page.page.path}`),
      thumbUrl: packagesUrl(`${packageId}/${page.thumbnail.path}`),
      width: page.width,
      height: page.height,
      orientation: page.orientation,
      suggestions: page.suggestions,
    }
  })
  return {
    packageId,
    id: manifest.book.id,
    title: manifest.book.title,
    sourceSha256: manifest.source.sha256,
    sourcePageCount: manifest.source.page_count,
    selection: manifest.selection,
    pages,
    byId: new Map(pages.map((page) => [page.id, page])),
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new HttpError(response.status, url)
  return response.json()
}

class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} for ${url}`)
  }
}

export async function loadBook(packageId: string): Promise<BookLoadResult> {
  let manifestText: string
  try {
    const response = await fetch(packagesUrl(`${packageId}/manifest.json`))
    if (response.status === 404) {
      return {
        ok: false,
        error: {
          kind: 'package',
          message:
            `Package "${packageId}" is not available: it is missing, incomplete ` +
            `(no COMPLETE.json marker) or not listed in the library.`,
        },
      }
    }
    if (!response.ok) throw new HttpError(response.status, response.url)
    manifestText = await response.text()
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return {
        ok: false,
        error: { kind: 'package', message: `Package "${packageId}" was not found on the server.` },
      }
    }
    return {
      ok: false,
      error: { kind: 'network', message: `Could not load the manifest: ${String(error)}` },
    }
  }

  let complete: { sha256?: unknown; byte_size?: unknown }
  try {
    const parsed = await fetchJson(packagesUrl(`${packageId}/COMPLETE.json`))
    complete = (parsed ?? {}) as { sha256?: unknown; byte_size?: unknown }
  } catch {
    return {
      ok: false,
      error: {
        kind: 'package',
        message:
          `Package "${packageId}" is incomplete: the COMPLETE.json marker is missing, ` +
          'so the reader refuses to open it.',
      },
    }
  }
  const manifestBytes = new TextEncoder().encode(manifestText)
  if (typeof complete.sha256 === 'string') {
    const actual = await sha256Hex(manifestBytes.buffer as ArrayBuffer)
    if (actual !== complete.sha256) {
      return {
        ok: false,
        error: {
          kind: 'integrity',
          message:
            'Manifest does not match the sha256 recorded in COMPLETE.json; the package is ' +
            'corrupt or was modified after publication.',
        },
      }
    }
  } else {
    return {
      ok: false,
      error: {
        kind: 'integrity',
        message: 'COMPLETE.json does not record a manifest sha256; the package is invalid.',
      },
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(manifestText)
  } catch (error) {
    return {
      ok: false,
      error: { kind: 'parse', message: `Manifest is not valid JSON: ${String(error)}` },
    }
  }
  const validated = validateManifest(parsed)
  if (!validated.ok) return { ok: false, error: { kind: 'manifest', error: validated.error } }
  return { ok: true, book: buildReaderBook(packageId, validated.value) }
}

export function describeLoadError(error: BookLoadError): string[] {
  switch (error.kind) {
    case 'manifest':
      return describeManifestErrorImported(error.error)
    default:
      return [error.message]
  }
}

function describeManifestErrorImported(error: ManifestError): string[] {
  if (error.kind === 'unsupported-version') return [error.message]
  return [error.message, ...error.issues]
}
