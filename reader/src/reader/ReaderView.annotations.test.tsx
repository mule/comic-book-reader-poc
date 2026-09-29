import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createHash } from 'node:crypto'
import { ReaderView } from './ReaderView'
import { makeManifest, makePage, manifestText, FIXTURE_SHA } from '../testing/manifestFixture'
import type { Suggestions } from '../manifest/types'

class FakeImage {
  static instances: FakeImage[] = []
  private listeners = new Map<string, Array<() => void>>()
  private srcValue = ''
  complete = false
  naturalWidth = 0
  naturalHeight = 0
  decoding = ''

  constructor() {
    FakeImage.instances.push(this)
  }

  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? []
    this.listeners.set(type, list.filter((item) => item !== listener))
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.srcValue = ''
  }

  get src(): string {
    return this.srcValue
  }

  set src(value: string) {
    this.srcValue = value
    if (!value) return
    queueMicrotask(() => {
      this.complete = true
      this.naturalWidth = 1000
      this.naturalHeight = 1500
      this.fire('load')
    })
  }

  private fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
}

function suggestions(...regions: { id: string; x: number; y: number; width: number; height: number }[]): Suggestions {
  return {
    detector: { name: 'synthetic', version: '1', configuration: {}, run_id: 'one' },
    regions,
    order: regions.map((region) => region.id),
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function guidedManifestText(): string {
  const pages = [
    makePage(1, {
      suggestions: suggestions(
        { id: 'r1', x: 0, y: 0, width: 1, height: 0.5 },
        { id: 'r2', x: 0, y: 0.5, width: 1, height: 0.5 },
      ),
    }),
    makePage(2),
    makePage(3, { suggestions: suggestions({ id: 'b1', x: 0, y: 0, width: 1, height: 1 }) }),
  ]
  return manifestText(makeManifest({ pages, page_order: pages.map((page) => page.id) }))
}

function plainManifestText(): string {
  return manifestText(makeManifest())
}

function mockBookFetch(manifestTextValue: string) {
  const routes: Record<string, { status?: number; body?: string }> = {
    '/packages/fixture-book/manifest.json': { body: manifestTextValue },
    '/packages/fixture-book/COMPLETE.json': {
      body: JSON.stringify({ sha256: sha256(manifestTextValue), byte_size: manifestTextValue.length }),
    },
  }
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const route = routes[String(input)]
    if (!route) return new Response('not found', { status: 404 })
    return new Response(route.body ?? '', { status: route.status ?? 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
}

const POSITION_KEY = `comicpoc:reading-position:v1:fixture-book:${FIXTURE_SHA}`
const ANNOTATIONS_KEY = `comicpoc:annotations:v1:fixture-book:${FIXTURE_SHA}`

function overlayRect(element: Element) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 1500, width: 1000, height: 1500,
    toJSON: () => ({}),
  } as DOMRect)
}

beforeEach(() => {
  FakeImage.instances = []
  localStorage.clear()
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ReaderView guided mode', () => {
  test('steps through effective regions across pages and back, exactly inverted', async () => {
    mockBookFetch(guidedManifestText())
    render(<ReaderView packageId="fixture-book" />)
    await screen.findByText('PDF page 1 / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Guided' }))
    await waitFor(() => {
      expect(screen.getByText(/Panel 1 \/ 4/)).toBeInTheDocument()
    })

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByText(/Panel 2 \/ 4/)).toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(POSITION_KEY) ?? '{}').regionId).toBe('r2')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByText(/Full page · step 3 \/ 4/)).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'End' })
    await waitFor(() => expect(screen.getByText(/Panel 4 \/ 4/)).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'Home' })
    await waitFor(() => expect(screen.getByText(/Panel 1 \/ 4/)).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'PageDown' })
    fireEvent.keyDown(window, { key: 'PageDown' })
    fireEvent.keyDown(window, { key: 'PageDown' })
    await waitFor(() => expect(screen.getByText(/Panel 4 \/ 4/)).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'PageUp' })
    await waitFor(() => expect(screen.getByText(/Full page · step 3 \/ 4/)).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'PageUp' })
    await waitFor(() => expect(screen.getByText(/Panel 2 \/ 4/)).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'PageUp' })
    await waitFor(() => expect(screen.getByText(/Panel 1 \/ 4/)).toBeInTheDocument())
  })

  test('multiple navigation events in one render batch do not skip steps', async () => {
    mockBookFetch(guidedManifestText())
    render(<ReaderView packageId="fixture-book" />)
    await screen.findByText('PDF page 1 / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Guided' }))
    act(() => {
      for (let i = 0; i < 3; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    })
    await waitFor(() => expect(screen.getByText(/Panel 4 \/ 4/)).toBeInTheDocument())
    act(() => {
      for (let i = 0; i < 3; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    })
    await waitFor(() => expect(screen.getByText(/Panel 1 \/ 4/)).toBeInTheDocument())
  })

  test('full page mode remains reachable and pages without regions fall back', async () => {
    mockBookFetch(guidedManifestText())
    render(<ReaderView packageId="fixture-book" />)
    await screen.findByText('PDF page 1 / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Guided' }))
    await waitFor(() => expect(screen.getByText(/Panel 1 \/ 4/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Full page' }))
    await waitFor(() => expect(screen.getByText('PDF page 1 / 3')).toBeInTheDocument())
  })

  test('a saved panel position is restored in guided mode; stale panels are reported', async () => {
    mockBookFetch(guidedManifestText())
    const { unmount } = render(<ReaderView packageId="fixture-book" />)
    await screen.findByText('PDF page 1 / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Guided' }))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByText(/Panel 2 \/ 4/)).toBeInTheDocument())
    unmount()

    const restored = render(<ReaderView packageId="fixture-book" />)
    await waitFor(() => expect(screen.getByText(/Panel 2 \/ 4/)).toBeInTheDocument())
    restored.unmount()

    localStorage.setItem(
      POSITION_KEY,
      JSON.stringify({
        bookId: 'fixture-book',
        sourceSha256: FIXTURE_SHA,
        pageId: `p-${FIXTURE_SHA}-0001`,
        regionId: 'r-vanished',
        updatedAt: 1,
      }),
    )
    const { unmount: unmount2 } = render(<ReaderView packageId="fixture-book" />)
    await screen.findByText(/no longer/i)
    expect(screen.getByText('PDF page 1 / 3')).toBeInTheDocument()
    unmount2()
  })
})

describe('ReaderView annotations', () => {
  test('draw a region, persist locally, export, reject a bad import, round-trip a good one', async () => {
    mockBookFetch(plainManifestText())
    render(<ReaderView packageId="fixture-book" />)
    await screen.findByText('PDF page 1 / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Edit regions' }))
    const overlay = await screen.findByTestId('edit-overlay')
    overlayRect(overlay)

    fireEvent.pointerDown(overlay, { pointerId: 1, button: 0, clientX: 100, clientY: 150 })
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 600, clientY: 900 })
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 600, clientY: 900 })
    await screen.findByTestId('region-item-m-1')

    await waitFor(() => {
      const stored = localStorage.getItem(ANNOTATIONS_KEY)
      expect(stored).toContain('"m-1"')
      expect(stored).toContain('"book_id":"fixture-book"')
    })

    fireEvent.click(screen.getByTestId('annotations-button'))
    const exportArea = await screen.findByTestId('annotations-export')
    const exported = (exportArea as HTMLTextAreaElement).value
    expect(exported).toContain('"m-1"')

    const mismatched = JSON.parse(exported) as Record<string, unknown>
    mismatched.book_id = 'another-book'
    const importArea = screen.getByTestId('annotations-import')
    fireEvent.change(importArea, { target: { value: JSON.stringify(mismatched) } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate and import' }))
    await screen.findByText("The import was rejected; your local edits are unchanged.")
    expect(screen.getByTestId('region-item-m-1')).toBeInTheDocument()
    expect(localStorage.getItem(ANNOTATIONS_KEY)).toContain('"m-1"')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Clear local edits' }))
    await waitFor(() => expect(screen.queryByTestId('region-item-m-1')).toBeNull())
    await waitFor(() => expect(localStorage.getItem(ANNOTATIONS_KEY)).toBeNull())

    fireEvent.change(screen.getByTestId('annotations-import'), { target: { value: exported } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate and import' }))
    await screen.findByText(/Imported\./i)
    expect(await screen.findByTestId('region-item-m-1')).toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem(ANNOTATIONS_KEY)).toContain('"m-1"'))
  })

  test('an edited document from another source revision is rejected without touching edits', async () => {
    mockBookFetch(plainManifestText())
    render(<ReaderView packageId="fixture-book" />)
    await screen.findByText('PDF page 1 / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Edit regions' }))
    const overlay = await screen.findByTestId('edit-overlay')
    overlayRect(overlay)
    fireEvent.pointerDown(overlay, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 500, clientY: 750 })
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 500, clientY: 750 })
    await screen.findByTestId('region-item-m-1')

    fireEvent.click(screen.getByTestId('annotations-button'))
    const bad = {
      schema_version: 1,
      book_id: 'fixture-book',
      source_sha256: 'f'.repeat(64),
      pages: [],
    }
    fireEvent.change(screen.getByTestId('annotations-import'), { target: { value: JSON.stringify(bad) } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate and import' }))
    await screen.findByText("The import was rejected; your local edits are unchanged.")
    expect(screen.getByTestId('region-item-m-1')).toBeInTheDocument()
  })

  test('drawing on the guided sequence: manual regions are read in guided mode', async () => {
    mockBookFetch(plainManifestText())
    render(<ReaderView packageId="fixture-book" />)
    await screen.findByText('PDF page 1 / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Edit regions' }))
    const overlay = await screen.findByTestId('edit-overlay')
    overlayRect(overlay)
    fireEvent.pointerDown(overlay, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 500, clientY: 750 })
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 500, clientY: 750 })
    await screen.findByTestId('region-item-m-1')
    fireEvent.pointerDown(overlay, { pointerId: 2, button: 0, clientX: 0, clientY: 800 })
    fireEvent.pointerMove(overlay, { pointerId: 2, clientX: 500, clientY: 1400 })
    fireEvent.pointerUp(overlay, { pointerId: 2, clientX: 500, clientY: 1400 })
    await screen.findByTestId('region-item-m-2')

    fireEvent.click(screen.getByRole('button', { name: 'Guided' }))
    await waitFor(() => expect(screen.getByText(/Panel 1 \/ 4/)).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByText(/Panel 2 \/ 4/)).toBeInTheDocument())
  })
})
