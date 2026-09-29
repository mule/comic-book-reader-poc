import Ajv2020 from 'ajv/dist/2020'
import schema from '../../../format/annotations.schema.json'
import type { Manifest } from '../manifest/types'
import type { AnnotationDocument, PageOverride } from './merge'
import { pageSuggestions } from './merge'

export type AnnotationError =
  | { kind: 'parse'; message: string }
  | { kind: 'schema'; issues: string[]; message: string }
  | { kind: 'identity'; issues: string[]; message: string }
  | { kind: 'semantic'; issues: string[]; message: string }

export type AnnotationValidationResult =
  | { ok: true; value: AnnotationDocument }
  | { ok: false; error: AnnotationError }

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validateSchema = ajv.compile(schema)

export const SUPPORTED_ANNOTATION_VERSION = 1

function regionIssues(regions: PageOverride['added_regions'], label: string): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const region of regions) {
    if (seen.has(region.id)) issues.push(`Duplicate region id ${region.id} in ${label}.`)
    seen.add(region.id)
    if (
      !Number.isFinite(region.x) ||
      !Number.isFinite(region.y) ||
      !Number.isFinite(region.width) ||
      !Number.isFinite(region.height)
    ) {
      issues.push(`Region ${region.id} in ${label} has non-finite coordinates.`)
    } else if (
      region.width <= 0 ||
      region.height <= 0 ||
      region.x + region.width > 1 ||
      region.y + region.height > 1
    ) {
      issues.push(`Region ${region.id} in ${label} is out of bounds.`)
    }
  }
  return issues
}

/**
 * Validate a manual annotation document against the same canonical schema file
 * the Python CLI uses (format/annotations.schema.json), then apply the same
 * identity and semantic checks as `validate_annotations` in
 * tools/src/comicpoc/manifest.py. The manifest must already be validated.
 */
export function validateAnnotationDocument(
  raw: unknown,
  manifest: Manifest,
): AnnotationValidationResult {
  if (!validateSchema(raw)) {
    const issues = (validateSchema.errors ?? []).map((error) => {
      const at = error.instancePath === '' ? 'document' : error.instancePath
      return `${at}: ${error.message ?? 'invalid value'}`
    })
    return {
      ok: false,
      error: {
        kind: 'schema',
        issues,
        message:
          'The annotation document does not satisfy format/annotations.schema.json.',
      },
    }
  }
  const document = raw as unknown as AnnotationDocument
  const issues: string[] = []

  if (document.book_id !== manifest.book.id || document.source_sha256 !== manifest.source.sha256) {
    issues.push(
      `Document is bound to book "${document.book_id}" / source ${document.source_sha256.slice(0, 12)}… ` +
        `but this package is "${manifest.book.id}" / ${manifest.source.sha256.slice(0, 12)}….`,
    )
    return {
      ok: false,
      error: {
        kind: 'identity',
        issues,
        message: 'Annotation book/source mismatch.',
      },
    }
  }

  const pagesById = new Map(manifest.pages.map((page) => [page.id, page]))
  const pageIdsSeen = new Set<string>()
  for (const override of document.pages) {
    if (pageIdsSeen.has(override.page_id)) {
      issues.push(`Duplicate annotation page id ${override.page_id}.`)
    }
    pageIdsSeen.add(override.page_id)
    const page = pagesById.get(override.page_id)
    if (!page || page.pdf_page_number !== override.pdf_page_number) {
      issues.push(
        `Annotation page identity mismatch for ${override.page_id} ` +
          `(pdf_page_number ${override.pdf_page_number}).`,
      )
      continue
    }
    issues.push(...regionIssues(
      [...override.added_regions, ...override.edited_regions], `manual regions of ${override.page_id}`,
    ))
    const ids = new Set(
      [...override.added_regions, ...override.edited_regions].map((region) => region.id),
    )
    const deleted = new Set(override.deleted_region_ids)
    for (const id of ids) {
      if (deleted.has(id)) issues.push(`Region ${id} is both deleted and added/edited.`)
    }
    for (const id of override.order) {
      if (deleted.has(id)) issues.push(`Region ${id} is both deleted and ordered.`)
    }
    const suggested = new Set(pageSuggestions(page).regions.map((region) => region.id))
    for (const region of override.added_regions) {
      if (suggested.has(region.id)) {
        issues.push(`Added region ${region.id} collides with a suggestion.`)
      }
    }
    const orderSet = new Set(override.order)
    for (const id of ids) {
      if (!orderSet.has(id)) issues.push(`Manual region ${id} is missing from the order.`)
    }
    for (const id of orderSet) {
      if (!suggested.has(id) && !ids.has(id)) {
        issues.push(`Order references unknown region ${id}.`)
      }
    }
    const survivors = new Set([...suggested, ...ids])
    for (const id of survivors) {
      if (!deleted.has(id) && !orderSet.has(id)) {
        issues.push(`Manual order must include surviving region ${id}.`)
      }
    }
  }
  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        kind: 'semantic',
        issues,
        message: 'Annotation document violates the invariants documented in docs/format.md.',
      },
    }
  }
  return { ok: true, value: document }
}

export function parseAnnotationJson(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, message: `The file is not valid JSON: ${String(error)}` }
  }
}

export function describeAnnotationError(error: AnnotationError): string[] {
  if (error.kind === 'parse') return [error.message]
  return [error.message, ...error.issues]
}
