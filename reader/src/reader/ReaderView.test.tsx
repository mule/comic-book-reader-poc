import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createHash } from 'node:crypto'
import { ReaderView } from './ReaderView'
import { makeManifest, manifestText } from '../testing/manifestFixture'

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
      if (value.includes('missing')) {
        this.naturalWidth = 0
        this.naturalHeight = 0
        this.fire('error')
      } else {
        this.naturalWidth = 1000
        this.naturalHeight = 1500
        this.fire('load')
      }
    })
  }

  private fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function mockBookFetch(overrides: Record<string, { status?: number; body?: string }> = {}) {
  const text = manifestText(makeManifest())
  const routes: Record<string, { status?: number; body?: string }> = {
    '/packages/fixture-book/manifest.json': { body: text },
    '/packages/fixture-book/COMPLETE.json': {
      body: JSON.stringify({ sha256: sha256(text), byte_size: text.length }),
    },
    ...overrides,
  }
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const route = routes[String(input)]
    if (!route) return new Response('not found', { status: 404 })
    return new Response(route.body ?? '', { status: route.status ?? 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return text
}

beforeEach(() => {
  FakeImage.instances = []
  localStorage.clear()
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReaderView', () => {
  test('loads a book and renders the current page with its PDF page number', async () => {
    mockBookFetch()
    render(<ReaderView packageId="fixture-book" />)
    expect(await screen.findByText('PDF page 1 / 3')).toBeInTheDocument()
    await waitFor(() => {
      const image = document.querySelector('.page-image')
      expect(image).not.toBeNull()
      expect(image?.getAttribute('src')).toContain('/packages/fixture-book/pages/')
    })
  })

  test('navigates with the keyboard and keeps the original PDF page number visible', async () => {
    mockBookFetch()
    render(<ReaderView packageId="fixture-book" />)
    await screen.findByText('PDF page 1 / 3')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(await screen.findByText('PDF page 2 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'End' })
    expect(await screen.findByText('PDF page 3 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Home' })
    expect(await screen.findByText('PDF page 1 / 3')).toBeInTheDocument()
  })

  test('persists the reading position and restores it on the next visit', async () => {
    mockBookFetch()
    const { unmount } = render(<ReaderView packageId="fixture-book" />)
    await screen.findByText('PDF page 1 / 3')
    fireEvent.keyDown(window, { key: 'PageDown' })
    await screen.findByText('PDF page 2 / 3')
    const stored = localStorage.getItem(
      `comicpoc:reading-position:v1:fixture-book:${'a'.repeat(64)}`,
    )
    expect(stored).toContain('"pageId"')
    unmount()

    render(<ReaderView packageId="fixture-book" />)
    expect(await screen.findByText('PDF page 2 / 3')).toBeInTheDocument()
  })

  test('reports a stale saved position explicitly and falls back to the first page', async () => {
    mockBookFetch()
    localStorage.setItem(
      `comicpoc:reading-position:v1:fixture-book:${'a'.repeat(64)}`,
      JSON.stringify({
        bookId: 'fixture-book',
        sourceSha256: 'a'.repeat(64),
        pageId: 'p-gone',
        updatedAt: 1,
      }),
    )
    render(<ReaderView packageId="fixture-book" />)
    expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument()
    expect(await screen.findByText('PDF page 1 / 3')).toBeInTheDocument()
  })

  test('reports a source revision mismatch explicitly', async () => {
    mockBookFetch()
    localStorage.setItem(
      `comicpoc:reading-position:v1:fixture-book:${'b'.repeat(64)}`,
      JSON.stringify({
        bookId: 'fixture-book',
        sourceSha256: 'b'.repeat(64),
        pageId: 'whatever',
        updatedAt: 1,
      }),
    )
    render(<ReaderView packageId="fixture-book" />)
    expect(await screen.findByText(/different source revision/i)).toBeInTheDocument()
  })

  test('shows a recoverable error screen for missing packages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 })),
    )
    render(<ReaderView packageId="ghost-book" />)
    expect(await screen.findByText('This book could not be opened')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to library' })).toBeInTheDocument()
  })

  test('shows a missing-asset error with retry for a page that fails to load', async () => {
    const text = manifestText(makeManifest())
    const broken = JSON.parse(text) as ReturnType<typeof makeManifest>
    broken.pages[0].page.path = 'pages/missing-0001.webp'
    const brokenText = JSON.stringify(broken)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('manifest.json')) return new Response(brokenText)
        if (url.endsWith('COMPLETE.json')) {
          return new Response(
            JSON.stringify({ sha256: sha256(brokenText), byte_size: brokenText.length }),
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )
    render(<ReaderView packageId="fixture-book" />)
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  test('jumps to a page from the thumbnail strip', async () => {
    mockBookFetch()
    render(<ReaderView packageId="fixture-book" />)
    await screen.findByText('PDF page 1 / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }))
    const thumb = await screen.findByRole('button', { name: 'Go to PDF page 3' })
    fireEvent.click(thumb)
    expect(await screen.findByText('PDF page 3 / 3')).toBeInTheDocument()
  })

  test('releases page images that fall outside the bounded window', async () => {
    mockBookFetch()
    render(<ReaderView packageId="fixture-book" />)
    await screen.findByText('PDF page 1 / 3')
    await waitFor(() => {
      expect(FakeImage.instances.filter((image) => image.src !== '').length).toBeLessThanOrEqual(4)
    })
    fireEvent.keyDown(window, { key: 'End' })
    await screen.findByText('PDF page 3 / 3')
    await waitFor(() => {
      const live = FakeImage.instances.filter((image) => image.src !== '')
      expect(live.length).toBeLessThanOrEqual(4)
      expect(
        live.some((image) => image.src.includes('pages/p-' + 'a'.repeat(64) + '-0001.webp')),
      ).toBe(false)
    })
  })
})
