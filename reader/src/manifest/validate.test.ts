import { describe, expect, test } from 'vitest'
import { validateManifest, describeManifestError, type ManifestError, type ManifestResult } from './validate'
import { makeManifest, makePage } from '../testing/manifestFixture'

function semantic(result: ManifestResult): string {
  if (!result.ok && result.error.kind === 'semantic') return result.error.issues.join('\n')
  throw new Error('expected a semantic error')
}

function schema(result: ManifestResult): string {
  if (!result.ok && result.error.kind === 'schema') return result.error.issues.join('\n')
  throw new Error('expected a schema error')
}

function unsupported(result: ManifestResult): Extract<ManifestError, { kind: 'unsupported-version' }> {
  if (!result.ok && result.error.kind === 'unsupported-version') return result.error
  throw new Error('expected an unsupported-version error')
}

describe('validateManifest', () => {
  test('accepts a valid manifest', () => {
    const result = validateManifest(makeManifest())
    expect(result.ok).toBe(true)
  })

  test('rejects an unsupported schema_version with a dedicated error', () => {
    const manifest = makeManifest()
    const result = validateManifest({ ...manifest, schema_version: 2 })
    expect(result.ok).toBe(false)
    const error = unsupported(result)
    expect(error.version).toBe(2)
    expect(error.message).toContain('schema_version')
    expect(describeManifestError(unsupported(result))[0]).toContain('schema_version')
  })

  test('reports schema violations for malformed manifests', () => {
    const result = validateManifest({ nope: true })
    expect(result.ok).toBe(false)
    expect(schema(result).length).toBeGreaterThan(0)
  })

  test('rejects page_order referencing an unknown page', () => {
    const manifest = makeManifest({ page_order: ['p-a-0001', 'unknown-page'] })
    expect(semantic(validateManifest(manifest))).toContain('unknown page unknown-page')
  })

  test('rejects a page missing from page_order', () => {
    const manifest = makeManifest()
    manifest.page_order = manifest.page_order.slice(0, 2)
    expect(semantic(validateManifest(manifest))).toContain('never referenced by page_order')
  })

  test('rejects duplicate page ids', () => {
    const first = makePage(1)
    const clone = makePage(1)
    const third = makePage(3)
    const manifest = makeManifest({ pages: [first, clone, third], page_order: [first.id, third.id] })
    expect(semantic(validateManifest(manifest))).toContain('Duplicate page id')
  })

  test('rejects pdf_page_number outside the source page count', () => {
    const pages = [makePage(1), makePage(9)]
    const manifest = makeManifest({ pages, page_order: pages.map((page) => page.id) })
    expect(semantic(validateManifest(manifest))).toContain('exceeds source page_count 3')
  })

  test('rejects duplicate pdf_page_numbers', () => {
    const first = makePage(1)
    const twin = makePage(1, { id: 'p-clone' })
    const manifest = makeManifest({ pages: [first, twin], page_order: [first.id, twin.id] })
    expect(semantic(validateManifest(manifest))).toContain('Duplicate pdf_page_number')
  })

  test('rejects selection "all" with missing source pages', () => {
    const pages = [makePage(1)]
    const manifest = makeManifest({ pages, page_order: [pages[0].id] })
    expect(semantic(validateManifest(manifest))).toContain('PDF page 2 is missing')
  })

  test('allows sample selections that omit pages', () => {
    const pages = [makePage(1), makePage(3)]
    const manifest = makeManifest({
      selection: 'sample',
      pages,
      page_order: pages.map((page) => page.id),
    })
    const result = validateManifest(manifest)
    expect(result.ok).toBe(true)
  })

  test('rejects duplicate asset paths across pages', () => {
    const first = makePage(1)
    const second = makePage(2, { page: { ...first.page } })
    const third = makePage(3)
    const manifest = makeManifest({
      pages: [first, second, third],
      page_order: [first.id, second.id, third.id],
    })
    expect(semantic(validateManifest(manifest))).toContain('Duplicate asset path')
  })

  test('rejects a region that extends beyond the page', () => {
    const page = makePage(1, {
      suggestions: {
        detector: { name: 'det', version: '1', configuration: {}, run_id: 'r1' },
        regions: [{ id: 'r1', x: 0.5, y: 0.5, width: 0.75, height: 0.5 }],
        order: ['r1'],
      },
    })
    const manifest = makeManifest({ pages: [page, makePage(2), makePage(3)] })
    expect(semantic(validateManifest(manifest))).toContain('extends beyond the page')
  })

  test('rejects a region order that misses a region', () => {
    const page = makePage(1, {
      suggestions: {
        detector: { name: 'det', version: '1', configuration: {}, run_id: 'r1' },
        regions: [
          { id: 'r1', x: 0, y: 0, width: 0.5, height: 0.5 },
          { id: 'r2', x: 0.5, y: 0, width: 0.5, height: 0.5 },
        ],
        order: ['r1'],
      },
    })
    const manifest = makeManifest({ pages: [page, makePage(2), makePage(3)] })
    expect(semantic(validateManifest(manifest))).toContain('missing from the order')
  })

  test('rejects orientation contradicting dimensions', () => {
    const wide = makePage(1, { width: 2000, height: 1000, orientation: 'portrait' })
    const manifest = makeManifest({ pages: [wide, makePage(2), makePage(3)] })
    expect(semantic(validateManifest(manifest))).toContain('orientation says portrait')
  })
})
