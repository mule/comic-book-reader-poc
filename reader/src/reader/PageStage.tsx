import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReaderBook, ReaderPage } from '../manifest/load'
import type { PageImagesApi } from '../reading/usePageImages'
import {
  IDENTITY_CAMERA,
  computeFrame,
  isIdentity,
  panBy,
  zoomAt,
  type Camera,
  type Size,
} from '../reading/camera'
import { FULL_PAGE_RECT } from '../reading/camera'

interface PageStageProps {
  book: ReaderBook
  page: ReaderPage
  images: PageImagesApi
  onNext(): void
  onPrev(): void
  onFirst(): void
  onLast(): void
  onEscape(): void
  registerZoomControls(controls: { zoomIn(): void; zoomOut(): void; resetZoom(): void }): void
}
interface PointerState {
  x: number
  y: number
}

const DOUBLE_TAP_ZOOM = 2.5
const SWIPE_MIN_DISTANCE = 60
const SWIPE_MAX_DURATION_MS = 600
const DOUBLE_TAP_WINDOW_MS = 300
const DOUBLE_TAP_MAX_DISTANCE = 40

export function PageStage(props: PageStageProps) {
  const { book, page, images, onNext, onPrev, onFirst, onLast, onEscape, registerZoomControls } = props
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 })
  const [camera, setCamera] = useState<Camera>(IDENTITY_CAMERA)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setViewport({
        width: rect.width || window.innerWidth,
        height: rect.height || window.innerHeight,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setCamera(IDENTITY_CAMERA)
  }, [page.id])

  const zoomIn = useCallback(() => {
    const { width, height } = viewportRef.current
    setCamera((current) =>
      zoomAt(
        { width, height },
        { width: page.width, height: page.height },
        FULL_PAGE_RECT,
        current,
        { x: width / 2, y: height / 2 },
        1.25,
      ),
    )
  }, [page.width, page.height])

  const zoomOut = useCallback(() => {
    const { width, height } = viewportRef.current
    setCamera((current) =>
      zoomAt(
        { width, height },
        { width: page.width, height: page.height },
        FULL_PAGE_RECT,
        current,
        { x: width / 2, y: height / 2 },
        1 / 1.25,
      ),
    )
  }, [page.width, page.height])

  const resetZoom = useCallback(() => setCamera(IDENTITY_CAMERA), [])

  useEffect(() => {
    registerZoomControls({ zoomIn, zoomOut, resetZoom })
  }, [zoomIn, zoomOut, resetZoom, registerZoomControls])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const factor = Math.exp(-event.deltaY * 0.0015)
      setCamera((current) =>
        zoomAt(viewportRef.current, { width: page.width, height: page.height }, FULL_PAGE_RECT, current, anchor, factor),
      )
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [page.width, page.height])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
          event.preventDefault()
          onNext()
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          event.preventDefault()
          onPrev()
          break
        case 'Home':
          event.preventDefault()
          onFirst()
          break
        case 'End':
          event.preventDefault()
          onLast()
          break
        case '+':
        case '=':
          event.preventDefault()
          zoomIn()
          break
        case '-':
        case '_':
          event.preventDefault()
          zoomOut()
          break
        case '0':
          event.preventDefault()
          resetZoom()
          break
        case 'Escape':
          event.preventDefault()
          onEscape()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onNext, onPrev, onFirst, onLast, onEscape, zoomIn, zoomOut, resetZoom])

  const pointers = useRef(new Map<number, PointerState>())
  const gesture = useRef<{
    mode: 'idle' | 'pan' | 'pinch'
    startX: number
    startY: number
    startTime: number
    startCamera: Camera
    pinchStartDistance: number
    moved: boolean
    lastPointerType: string
    lastTapTime: number
    lastTapX: number
    lastTapY: number
  }>({
    mode: 'idle',
    startX: 0,
    startY: 0,
    startTime: 0,
    startCamera: IDENTITY_CAMERA,
    pinchStartDistance: 0,
    moved: false,
    lastPointerType: 'mouse',
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
  })

  const localPoint = (event: React.PointerEvent): PointerState => {
    const rect = stageRef.current?.getBoundingClientRect()
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    }
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    const state = gesture.current
    state.lastPointerType = event.pointerType
    const point = localPoint(event)
    pointers.current.set(event.pointerId, point)
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    if (pointers.current.size === 1) {
      state.mode = 'pan'
      state.startX = point.x
      state.startY = point.y
      state.startTime = performance.now()
      state.startCamera = cameraRef.current
      state.moved = false
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      state.mode = 'pinch'
      state.pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y) || 1
      state.startCamera = cameraRef.current
      state.moved = true
    }
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return
    const point = localPoint(event)
    pointers.current.set(event.pointerId, point)
    const state = gesture.current
    const pageSize = { width: page.width, height: page.height }
    if (state.mode === 'pan' && pointers.current.size === 1) {
      const dx = point.x - state.startX
      const dy = point.y - state.startY
      if (Math.hypot(dx, dy) > 4) state.moved = true
      setCamera(
        panBy(viewportRef.current, pageSize, FULL_PAGE_RECT, state.startCamera, { x: dx, y: dy }),
      )
    } else if (state.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const factor = distance / state.pinchStartDistance
      setCamera(
        zoomAt(viewportRef.current, pageSize, FULL_PAGE_RECT, state.startCamera, mid, factor),
      )
    }
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    const point = localPoint(event)
    pointers.current.delete(event.pointerId)
    const state = gesture.current
    const wasMode = state.mode
    if (pointers.current.size === 0) state.mode = 'idle'
    else if (pointers.current.size === 1) {
      const [remaining] = [...pointers.current.values()]
      state.mode = 'pan'
      state.startX = remaining.x
      state.startY = remaining.y
      state.startTime = performance.now()
      state.startCamera = cameraRef.current
      state.moved = true
    }
    const duration = performance.now() - state.startTime
    const dx = point.x - state.startX
    if (wasMode === 'pan' && !state.moved) {
      const now = performance.now()
      const isDoubleTap =
        now - state.lastTapTime < DOUBLE_TAP_WINDOW_MS &&
        Math.hypot(point.x - state.lastTapX, point.y - state.lastTapY) < DOUBLE_TAP_MAX_DISTANCE
      state.lastTapTime = now
      state.lastTapX = point.x
      state.lastTapY = point.y
      if (isDoubleTap) {
        state.lastTapTime = 0
        const current = cameraRef.current
        const target = current.zoom > 1 ? 1 : DOUBLE_TAP_ZOOM
        setCamera(
          zoomAt(viewportRef.current, { width: page.width, height: page.height }, FULL_PAGE_RECT, current, point, target / current.zoom),
        )
        return
      }
    }
    if (
      wasMode === 'pan' &&
      state.moved &&
      duration < SWIPE_MAX_DURATION_MS &&
      isIdentity(state.startCamera)
    ) {
      if (dx <= -SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(point.y - state.startY)) {
        onNext()
      } else if (dx >= SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(point.y - state.startY)) {
        onPrev()
      }
    }
  }

  const handleDoubleClick = (event: React.MouseEvent) => {
    if (gesture.current.lastPointerType === 'touch') return
    const rect = stageRef.current?.getBoundingClientRect()
    const point = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
    const current = cameraRef.current
    const target = current.zoom > 1 ? 1 : DOUBLE_TAP_ZOOM
    setCamera(
      zoomAt(viewportRef.current, { width: page.width, height: page.height }, FULL_PAGE_RECT, current, point, target / current.zoom),
    )
  }

  const frame =
    viewport.width > 0 && viewport.height > 0
      ? computeFrame(viewport, { width: page.width, height: page.height }, FULL_PAGE_RECT, camera)
      : null

  const entry = images.entries.get(page.id)
  const status = entry?.status ?? 'loading'

  return (
    <div
      className="page-stage"
      ref={stageRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      data-page-status={status}
    >
      {frame && entry && status === 'loaded' ? (
        <img
          key={page.id}
          src={entry.url}
          alt={`PDF page ${page.pdfPageNumber} of ${book.title}`}
          className="page-image"
          draggable={false}
          style={{
            transform: `translate3d(${frame.x}px, ${frame.y}px, 0) scale(${frame.scale})`,
            transformOrigin: '0 0',
            width: `${page.width}px`,
            height: `${page.height}px`,
          }}
        />
      ) : null}
      {status === 'loading' ? (
        <div className="page-status">
          <div className="spinner" aria-hidden="true" />
          <p>Loading PDF page {page.pdfPageNumber}…</p>
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="page-status page-status-error" role="alert">
          <p>
            Page image could not be loaded (missing or corrupt asset
            {entry ? `: ${entry.url}` : ''}).
          </p>
          <div className="error-panel-actions">
            <button type="button" onClick={() => images.retry(page.id)}>
              Retry
            </button>
            <button type="button" onClick={onPrev}>
              Previous page
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
