export type Orientation = 'portrait' | 'landscape' | 'square'

export interface AssetRef {
  path: string
  sha256: string
  byte_size: number
  width: number
  height: number
}

export interface Region {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface Suggestions {
  detector: { name: string; version: string; configuration: Record<string, unknown>; run_id: string }
  regions: Region[]
  order: string[]
}

export interface ManifestPage {
  id: string
  pdf_page_number: number
  width: number
  height: number
  orientation: Orientation
  rotation_degrees: 0 | 90 | 180 | 270
  page: AssetRef
  thumbnail: AssetRef
  suggestions?: Suggestions
}

export interface Manifest {
  schema_version: 1
  book: { id: string; title: string }
  source: { sha256: string; byte_size: number; page_count: number }
  render_profile: {
    id: string
    format: 'webp' | 'jpeg' | 'png'
    quality: number
    long_edge_px: number
    resolution_policy: 'native-embedded-capped'
    thumbnail: { format: 'webp' | 'jpeg' | 'png'; quality: number; long_edge_px: number }
  }
  selection: 'all' | 'sample'
  page_order: string[]
  pages: ManifestPage[]
}
