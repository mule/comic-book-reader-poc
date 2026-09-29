import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { PageStage } from './PageStage'
import type { ReaderBook, ReaderPage } from '../manifest/load'
import type { PageImagesApi } from '../reading/usePageImages'
import { computeFrame, FULL_PAGE_RECT, type Rect } from '../reading/camera'

const REGION_TOP: Rect = { x: 0, y: 0, width: 1, height: 0.5 }
const REGION_BOTTOM: Rect = { x: 0, y: 0.5, width: 1, height: 0.5 }

function makePage(): ReaderPage {
  return {
    id: 'p-1',
    orderIndex: 0,
    pdfPageNumber: 1,
    imageUrl: 'u',
    thumbUrl: 't',
    width: 1000,
    height: 1500,
    orientation: 'portrait',
  }
}

function makeBook(page: ReaderPage): ReaderBook {
  return {
    packageId: 'fixture-book',
    id: 'fixture-book',
    title: 'Fixture Book',
    sourceSha256: 'a'.repeat(64),
    sourcePageCount: 1,
    selection: 'all',
    pages: [page],
    byId: new Map([[page.id, page]]),
    manifest: {} as ReaderBook['manifest'],
  }
}

function makeImages(): PageImagesApi {
  return {
    entries: new Map([
      ['p-1', {
        status: 'loaded',
        url: 'page.webp',
        image: {} as HTMLImageElement,
        naturalWidth: 1000,
        naturalHeight: 1500,
      }],
    ]),
    retry: () => {},
    activeCount: () => 1,
    windowSpec: { back: 1, ahead: 2 },
  }
}

function noop() {}

function props(overrides: Partial<Parameters<typeof PageStage>[0]> = {}) {
  const page = makePage()
  return {
    book: makeBook(page),
    page,
    images: makeImages(),
    focus: FULL_PAGE_RECT,
    cameraKey: 'k1',
    reducedMotion: false,
    onNext: noop,
    onPrev: noop,
    onFirst: noop,
    onLast: noop,
    onEscape: noop,
    registerZoomControls: noop,
    ...overrides,
  }
}

let rafCallbacks: Array<() => void>
let clock: number
let stageRect: { width: number; height: number }

class ControllableResizeObserver {
  static instances: ControllableResizeObserver[] = []
  private callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
    ControllableResizeObserver.instances.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  trigger(): void {
    this.callback()
  }
}

function flushFrame() {
  const callbacks = [...rafCallbacks]
  rafCallbacks.length = 0
  clock += 16
  for (const callback of callbacks) callback()
}

beforeEach(() => {
  rafCallbacks = []
  clock = 0
  stageRect = { width: 800, height: 600 }
  ControllableResizeObserver.instances = []
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    rafCallbacks.push(callback)
    return rafCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', ControllableResizeObserver)
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('page-stage')) {
      return {
        x: 0, y: 0, left: 0, top: 0, right: stageRect.width, bottom: stageRect.height,
        width: stageRect.width, height: stageRect.height, toJSON: () => ({}),
      } as DOMRect
    }
    return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function transformOf(container: HTMLElement): string {
  const image = container.querySelector('.page-image') as HTMLElement | null
  return image?.style.transform ?? ''
}

describe('PageStage guided transitions', () => {
  test('reduced motion: region changes never schedule an animation', async () => {
    const initial = props({ focus: REGION_TOP, cameraKey: 'p-1#r1', reducedMotion: true })
    const { container, rerender } = render(<PageStage {...initial} />)
    await waitFor(() => expect(transformOf(container)).toContain('scale('))
    rafCallbacks.length = 0

    rerender(<PageStage {...initial} focus={REGION_BOTTOM} cameraKey="p-1#r2" />)
    await waitFor(() => {
      const expected = computeFrame(
        { width: 800, height: 600 },
        { width: 1000, height: 1500 },
        REGION_BOTTOM,
        { zoom: 1, panX: 0, panY: 0 },
      )
      expect(transformOf(container)).toBe(
        `translate3d(${expected.x}px, ${expected.y}px, 0) scale(${expected.scale})`,
      )
    })
    expect(rafCallbacks.length).toBe(0)
  })

  test('region changes animate and land exactly on the target frame', async () => {
    const initial = props({ focus: REGION_TOP, cameraKey: 'p-1#r1' })
    const { container, rerender } = render(<PageStage {...initial} />)
    await waitFor(() => expect(transformOf(container)).toContain('scale('))
    rafCallbacks.length = 0

    rerender(<PageStage {...initial} focus={REGION_BOTTOM} cameraKey="p-1#r2" />)
    const target = computeFrame(
      { width: 800, height: 600 },
      { width: 1000, height: 1500 },
      REGION_BOTTOM,
      { zoom: 1, panX: 0, panY: 0 },
    )
    const targetTransform = `translate3d(${target.x}px, ${target.y}px, 0) scale(${target.scale})`
    await waitFor(() => expect(rafCallbacks.length).toBeGreaterThan(0))
    expect(transformOf(container)).not.toBe(targetTransform)
    for (let i = 0; i < 40; i += 1) flushFrame()
    await waitFor(() => expect(transformOf(container)).toBe(targetTransform))
  })

  test('rapid region changes are deterministic: the last target wins', async () => {
    const initial = props({ focus: REGION_TOP, cameraKey: 'p-1#r1' })
    const { container, rerender } = render(<PageStage {...initial} />)
    await waitFor(() => expect(transformOf(container)).toContain('scale('))
    rafCallbacks.length = 0

    rerender(<PageStage {...initial} focus={REGION_BOTTOM} cameraKey="p-1#r2" />)
    rerender(<PageStage {...initial} focus={REGION_TOP} cameraKey="p-1#r1" />)
    rerender(<PageStage {...initial} focus={FULL_PAGE_RECT} cameraKey="p-1#full" />)
    for (let i = 0; i < 40; i += 1) flushFrame()
    const target = computeFrame(
      { width: 800, height: 600 },
      { width: 1000, height: 1500 },
      FULL_PAGE_RECT,
      { zoom: 1, panX: 0, panY: 0 },
    )
    await waitFor(() =>
      expect(transformOf(container)).toBe(
        `translate3d(${target.x}px, ${target.y}px, 0) scale(${target.scale})`,
      ),
    )
  })

  test('resize preserves the active region and refits it', async () => {
    const initial = props({ focus: REGION_BOTTOM, cameraKey: 'p-1#r2' })
    const { container } = render(<PageStage {...initial} />)
    await waitFor(() => expect(transformOf(container)).toContain('scale('))

    stageRect = { width: 400, height: 300 }
    const observer = ControllableResizeObserver.instances[0]
    observer?.trigger()

    const target = computeFrame(
      { width: 400, height: 300 },
      { width: 1000, height: 1500 },
      REGION_BOTTOM,
      { zoom: 1, panX: 0, panY: 0 },
    )
    await waitFor(() => {
      expect(transformOf(container)).toBe(
        `translate3d(${target.x}px, ${target.y}px, 0) scale(${target.scale})`,
      )
    })
  })
})
