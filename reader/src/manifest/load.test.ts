import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { loadBook, buildReaderBook, packagesUrl } from './load'
import { makeManifest, makePage, manifestText } from '../testing/manifestFixture'

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function mockFetch(routes: Record<string, { status?: number; body?: string }>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const route = routes[url]
    if (!route) return new Response('not found', { status: 404 })
    return new Response(route.body ?? '', { status: route.status ?? 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const PKG = 'fixture-book'

function happyRoutes(text: string, completeSha: string): Record<string, { body: string }> {
  return {
    [packagesUrl(`${PKG}/manifest.json`)]: { body: text },
    [packagesUrl(`${PKG}/COMPLETE.json`)]: {
      body: JSON.stringify({ sha256: completeSha, byte_size: text.length }),
    },
  }
}

let text: string

beforeEach(() => {
  text = manifestText(makeManifest())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadBook', () => {
  test('loads and validates a complete package', async () => {
    mockFetch(happyRoutes(text, sha256(text)))
    const result = await loadBook(PKG)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.book.title).toBe('Fixture Book')
      expect(result.book.pages).toHaveLength(3)
      expect(result.book.pages[0].imageUrl).toBe('/packages/fixture-book/pages/p-' + 'a'.repeat(64) + '-0001.webp')
    }
  })

  test('reports a missing or incomplete package when the manifest is absent', async () => {
    mockFetch({})
    const result = await loadBook('missing-book')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('package')
  })

  test('reports an incomplete package when COMPLETE.json is absent', async () => {
    mockFetch({
      [packagesUrl(`${PKG}/manifest.json`)]: { body: text },
    })
    const result = await loadBook(PKG)
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.kind === 'package') {
      expect(result.error.message).toContain('incomplete')
    } else throw new Error('expected a package error')
  })

  test('reports an integrity failure when the manifest hash does not match COMPLETE.json', async () => {
    mockFetch(happyRoutes(text, '0'.repeat(64)))
    const result = await loadBook(PKG)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('integrity')
  })

  test('reports a parse failure for non-JSON manifests', async () => {
    mockFetch(happyRoutes('not json at all', sha256('not json at all')))
    const result = await loadBook(PKG)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('parse')
  })

  test('rejects an unsupported manifest version with a clear message', async () => {
    const future = JSON.stringify({ ...makeManifest(), schema_version: 7 })
    mockFetch(happyRoutes(future, sha256(future)))
    const result = await loadBook(PKG)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('manifest')
    if (result.error.kind !== 'manifest') return
    expect(result.error.error.kind).toBe('unsupported-version')
  })
})

describe('buildReaderBook', () => {
  test('follows page_order rather than array order', () => {
    const pages = [makePage(1), makePage(2), makePage(3)]
    const manifest = makeManifest({
      pages,
      page_order: [pages[2].id, pages[0].id, pages[1].id],
    })
    const book = buildReaderBook(PKG, manifest)
    expect(book.pages.map((page) => page.pdfPageNumber)).toEqual([3, 1, 2])
    expect(book.pages.map((page) => page.orderIndex)).toEqual([0, 1, 2])
    expect(book.byId.get(pages[1].id)?.orderIndex).toBe(2)
  })
})
