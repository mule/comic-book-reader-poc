export interface LibraryEntry {
  id: string
  title: string
  selection: 'all' | 'sample' | null
  page_count: number | null
  source_sha256: string | null
  manifest_ok: boolean
}

export interface LibraryIndex {
  packages: LibraryEntry[]
}

export function libraryIndexUrl(): string {
  return '/packages/index.json'
}

export async function fetchLibraryIndex(): Promise<LibraryEntry[]> {
  const response = await fetch(libraryIndexUrl())
  if (!response.ok) {
    throw new Error(`The package index could not be loaded (HTTP ${response.status}).`)
  }
  const data = (await response.json()) as Partial<LibraryIndex>
  if (!Array.isArray(data.packages)) {
    throw new Error('The package index is malformed: expected a "packages" array.')
  }
  return data.packages.filter(
    (entry): entry is LibraryEntry =>
      typeof entry?.id === 'string' && entry.id.length > 0 && typeof entry.title === 'string',
  )
}

interface CoverInfo {
  thumbUrl: string | null
}

const coverCache = new Map<string, Promise<CoverInfo>>()

export function loadCover(packageId: string): Promise<CoverInfo> {
  let cached = coverCache.get(packageId)
  if (!cached) {
    cached = (async () => {
      const response = await fetch(`/packages/${packageId}/manifest.json`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const manifest = (await response.json()) as {
        page_order?: string[]
        pages?: Array<{ id?: string; thumbnail?: { path?: string } }>
      }
      const firstId = manifest.page_order?.[0]
      const page = manifest.pages?.find((candidate) => candidate.id === firstId)
      const path = page?.thumbnail?.path
      return { thumbUrl: path ? `/packages/${packageId}/${path}` : null }
    })()
    coverCache.set(packageId, cached)
  }
  return cached
}
