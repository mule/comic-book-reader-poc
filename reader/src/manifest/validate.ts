import Ajv2020 from 'ajv/dist/2020'
import schema from '../../../format/manifest.schema.json'
import type { Manifest, ManifestPage, Region } from './types'

export const SUPPORTED_SCHEMA_VERSION = 1

export type ManifestError =
  | { kind: 'unsupported-version'; version: number; message: string }
  | { kind: 'schema'; issues: string[]; message: string }
  | { kind: 'semantic'; issues: string[]; message: string }

export type ManifestResult = { ok: true; value: Manifest } | { ok: false; error: ManifestError }

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validateSchema = ajv.compile(schema)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkRegions(pageId: string, suggestions: unknown, issues: string[]): void {
  if (!isRecord(suggestions)) return
  const regions = suggestions.regions
  const order = suggestions.order
  if (!Array.isArray(regions) || !Array.isArray(order)) return
  const seen = new Set<string>()
  for (const region of regions as Region[]) {
    if (!isRecord(region)) continue
    if (seen.has(region.id)) issues.push(`Page ${pageId}: duplicate region id ${region.id}.`)
    seen.add(region.id)
    if (!(region.width > 0) || !(region.height > 0)) {
      issues.push(`Page ${pageId}: region ${region.id} has non-positive dimensions.`)
    }
    if (region.x + region.width > 1 + 1e-9 || region.y + region.height > 1 + 1e-9) {
      issues.push(`Page ${pageId}: region ${region.id} extends beyond the page.`)
    }
  }
  const orderSeen = new Set<string>()
  for (const id of order) {
    if (orderSeen.has(id)) issues.push(`Page ${pageId}: duplicate region order reference ${id}.`)
    orderSeen.add(id)
  }
  for (const id of orderSeen) {
    if (!seen.has(id)) issues.push(`Page ${pageId}: order references unknown region ${id}.`)
  }
  for (const id of seen) {
    if (!orderSeen.has(id)) issues.push(`Page ${pageId}: region ${id} is missing from the order.`)
  }
}

function checkOrientation(page: ManifestPage, issues: string[]): void {
  const { width, height, orientation } = page
  if (orientation === 'landscape' && width <= height - 2) {
    issues.push(
      `Page ${page.id}: orientation says landscape but width ${width} <= height ${height}.`,
    )
  }
  if (orientation === 'portrait' && height <= width - 2) {
    issues.push(
      `Page ${page.id}: orientation says portrait but height ${height} <= width ${width}.`,
    )
  }
  if (orientation === 'square' && Math.abs(width - height) > 2) {
    issues.push(`Page ${page.id}: orientation says square but dimensions are ${width}x${height}.`)
  }
}

function semanticIssues(manifest: Manifest): string[] {
  const issues: string[] = []
  const pagesById = new Map<string, ManifestPage>()
  for (const page of manifest.pages) {
    if (pagesById.has(page.id)) issues.push(`Duplicate page id ${page.id}.`)
    pagesById.set(page.id, page)
  }
  const orderSeen = new Set<string>()
  for (const id of manifest.page_order) {
    if (orderSeen.has(id)) issues.push(`page_order references ${id} more than once.`)
    orderSeen.add(id)
    if (!pagesById.has(id)) issues.push(`page_order references unknown page ${id}.`)
  }
  for (const id of pagesById.keys()) {
    if (!orderSeen.has(id)) issues.push(`Page ${id} is never referenced by page_order.`)
  }
  const pdfNumbers = new Set<number>()
  const assetPaths = new Set<string>()
  for (const page of manifest.pages) {
    if (pdfNumbers.has(page.pdf_page_number)) {
      issues.push(`Duplicate pdf_page_number ${page.pdf_page_number} (page ${page.id}).`)
    }
    pdfNumbers.add(page.pdf_page_number)
    if (page.pdf_page_number > manifest.source.page_count) {
      issues.push(
        `Page ${page.id}: pdf_page_number ${page.pdf_page_number} exceeds source page_count ` +
          `${manifest.source.page_count}.`,
      )
    }
    if (!page.page.path.startsWith('pages/')) {
      issues.push(`Page ${page.id}: page asset path must start with pages/.`)
    }
    if (!page.thumbnail.path.startsWith('thumbs/')) {
      issues.push(`Page ${page.id}: thumbnail asset path must start with thumbs/.`)
    }
    for (const assetPath of [page.page.path, page.thumbnail.path]) {
      if (assetPaths.has(assetPath)) {
        issues.push(`Duplicate asset path ${assetPath} across pages.`)
      }
      assetPaths.add(assetPath)
    }
    checkOrientation(page, issues)
    if (page.suggestions !== undefined) checkRegions(page.id, page.suggestions, issues)
  }
  if (manifest.selection === 'all') {
    for (let n = 1; n <= manifest.source.page_count; n += 1) {
      if (!pdfNumbers.has(n)) {
        issues.push(`selection is "all" but PDF page ${n} is missing.`)
        break
      }
    }
    if (manifest.pages.length !== manifest.source.page_count) {
      issues.push(
        `selection is "all" but manifest has ${manifest.pages.length} pages, ` +
          `source declares ${manifest.source.page_count}.`,
      )
    }
  }
  return issues
}

export function validateManifest(raw: unknown): ManifestResult {
  if (isRecord(raw) && typeof raw.schema_version === 'number' && raw.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        kind: 'unsupported-version',
        version: raw.schema_version,
        message:
          `This reader supports manifest schema_version ${SUPPORTED_SCHEMA_VERSION}, ` +
          `but the package declares ${raw.schema_version}.`,
      },
    }
  }
  if (!validateSchema(raw)) {
    const issues = (validateSchema.errors ?? []).map((error) => {
      const at = error.instancePath === '' ? 'manifest' : error.instancePath
      return `${at}: ${error.message ?? 'invalid value'}`
    })
    return {
      ok: false,
      error: {
        kind: 'schema',
        issues,
        message: 'Manifest does not satisfy the comic package schema (format/manifest.schema.json).',
      },
    }
  }
  const manifest = raw as unknown as Manifest
  const issues = semanticIssues(manifest)
  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        kind: 'semantic',
        issues,
        message: 'Manifest violates the semantic invariants documented in docs/format.md.',
      },
    }
  }
  return { ok: true, value: manifest }
}

export function describeManifestError(error: ManifestError): string[] {
  if (error.kind === 'unsupported-version') return [error.message]
  return [error.message, ...error.issues]
}
