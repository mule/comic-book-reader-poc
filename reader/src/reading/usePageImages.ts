import { useEffect, useRef, useState } from 'react'
import { PageWindow, DEFAULT_WINDOW_SPEC, type WindowSpec } from './pageWindow'
import type { ReaderPage } from '../manifest/load'

export interface PageImageEntry {
  status: 'loading' | 'loaded' | 'error'
  url: string
  image: HTMLImageElement
  naturalWidth: number | null
  naturalHeight: number | null
}

type EntryMap = Map<string, PageImageEntry>

export interface PageImagesApi {
  entries: EntryMap
  retry(pageId: string): void
  activeCount(): number
  windowSpec: WindowSpec
}

interface PreloadHandle {
  pageId: string
  url: string
  image: HTMLImageElement
  onLoad: () => void
  onError: () => void
}

function preload(page: ReaderPage, onSettled: (pageId: string, ok: boolean) => void): PreloadHandle {
  const image = new Image()
  image.decoding = 'async'
  const handle = {} as PreloadHandle
  handle.onLoad = () => onSettled(page.id, true)
  handle.onError = () => onSettled(page.id, false)
  image.addEventListener('load', handle.onLoad)
  image.addEventListener('error', handle.onError)
  handle.pageId = page.id
  handle.url = page.imageUrl
  handle.image = image
  image.src = page.imageUrl
  return handle
}

function releaseHandle(handle: PreloadHandle): void {
  handle.image.removeEventListener('load', handle.onLoad)
  handle.image.removeEventListener('error', handle.onError)
  handle.image.removeAttribute('src')
}

export function usePageImages(pages: ReaderPage[], currentIndex: number): PageImagesApi {
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const [, setTick] = useState(0)
  const forceUpdate = () => setTick((tick) => tick + 1)
  const outcomesRef = useRef(new Map<string, boolean>())
  const windowRef = useRef<PageWindow<string, PreloadHandle> | null>(null)

  if (windowRef.current === null && pages.length > 0) {
    const settled = (pageId: string, ok: boolean) => {
      outcomesRef.current.set(pageId, ok)
      forceUpdate()
    }
    windowRef.current = new PageWindow<string, PreloadHandle>({
      keys: pages.map((page) => page.id),
      spec: DEFAULT_WINDOW_SPEC,
      acquire: (pageId) => {
        const page = pagesRef.current.find((candidate) => candidate.id === pageId)
        if (!page) throw new Error(`Unknown page ${pageId}`)
        outcomesRef.current.delete(pageId)
        return preload(page, settled)
      },
      release: (handle) => {
        releaseHandle(handle)
        outcomesRef.current.delete(handle.pageId)
      },
      onChange: () => forceUpdate(),
    })
  }

  useEffect(() => {
    const window = windowRef.current
    return () => window?.destroy()
  }, [])

  useEffect(() => {
    if (currentIndex < 0) return
    windowRef.current?.setIndex(currentIndex)
  }, [currentIndex, pages])

  const computeEntries = (): EntryMap => {
    const map: EntryMap = new Map()
    const window = windowRef.current
    if (!window) return map
    for (const pageId of window.activeKeys()) {
      const active = window.get(pageId)
      if (!active) continue
      const { image, url } = active.handle
      const outcome = outcomesRef.current.get(pageId)
      const failed = outcome === false || (image.complete && image.naturalWidth === 0 && image.src !== '')
      const loaded = outcome === true || (image.complete && image.naturalWidth > 0 && !failed)
      const status: PageImageEntry['status'] = failed ? 'error' : loaded ? 'loaded' : 'loading'
      map.set(pageId, {
        status,
        url,
        image,
        naturalWidth: image.naturalWidth || null,
        naturalHeight: image.naturalHeight || null,
      })
    }
    return map
  }

  const entries = computeEntries()

  return {
    entries,
    windowSpec: DEFAULT_WINDOW_SPEC,
    activeCount: () => windowRef.current?.size ?? 0,
    retry: (pageId: string) => {
      windowRef.current?.refresh(pageId)
    },
  }
}
