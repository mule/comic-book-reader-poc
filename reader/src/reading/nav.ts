import type { ReaderBook } from '../manifest/load'

export function clampIndex(index: number, count: number): number {
  if (count <= 0) throw new Error('No pages to navigate.')
  return Math.min(count - 1, Math.max(0, index))
}

export function stepIndex(index: number, count: number, delta: number): number {
  return clampIndex(index + delta, count)
}

export function indexForPageId(book: ReaderBook, pageId: string): number | null {
  const page = book.byId.get(pageId)
  return page ? page.orderIndex : null
}

export function pageLabel(page: { orderIndex: number; pdfPageNumber: number }, count: number): string {
  const position = page.orderIndex + 1
  if (position === page.pdfPageNumber) return `PDF page ${page.pdfPageNumber} / ${count}`
  return `Page ${position} / ${count} (PDF page ${page.pdfPageNumber})`
}
