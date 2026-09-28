import type { Manifest } from '../manifest/types'

export const FIXTURE_SHA = 'a'.repeat(64)
export const FIXTURE_SHA_2 = 'b'.repeat(64)

export function makePage(n: number, overrides: Partial<Manifest['pages'][number]> = {}): Manifest['pages'][number] {
  const id = `p-${FIXTURE_SHA}-${String(n).padStart(4, '0')}`
  return {
    id,
    pdf_page_number: n,
    width: 1000,
    height: 1500,
    orientation: 'portrait',
    rotation_degrees: 0,
    page: {
      path: `pages/${id}.webp`,
      sha256: `${String(n).repeat(64)}`,
      byte_size: 1000 + n,
      width: 1000,
      height: 1500,
    },
    thumbnail: {
      path: `thumbs/${id}.webp`,
      sha256: `${String(n).repeat(64)}`,
      byte_size: 100 + n,
      width: 240,
      height: 360,
    },
    ...overrides,
  }
}

export function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  const pages = [makePage(1), makePage(2), makePage(3)]
  return {
    schema_version: 1,
    book: { id: 'fixture-book', title: 'Fixture Book' },
    source: { sha256: FIXTURE_SHA, byte_size: 12345, page_count: 3 },
    render_profile: {
      id: 'render-0123456789abcdef',
      format: 'webp',
      quality: 90,
      long_edge_px: 3056,
      resolution_policy: 'native-embedded-capped',
      thumbnail: { format: 'webp', quality: 80, long_edge_px: 360 },
    },
    selection: 'all',
    page_order: pages.map((page) => page.id),
    pages,
    ...overrides,
  }
}

export function manifestText(manifest: Manifest): string {
  return JSON.stringify(manifest)
}
