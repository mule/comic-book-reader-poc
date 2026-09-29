import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReaderPage } from '../manifest/load'
import type { AnnotatedRegion } from '../annotations/session'
import type { Rect } from '../reading/camera'
import { RegionList } from './RegionList'
import { capturePointer } from './pointer'

interface EditStageProps {
  book: ReaderPage[]
  page: ReaderPage
  imageUrl: string | null
  imageStatus: 'loading' | 'loaded' | 'error'
  regions: AnnotatedRegion[]
  tombstones: string[]
  selectedRegionId: string | null
  onSelect(id: string | null): void
  onAdd(rect: Rect): void
  onUpdate(id: string, rect: Rect): void
  onDelete(id: string): void
  onRestore(id: string): void
  onReorder(id: string, targetIndex: number): void
  onSelectPage(pageId: string): void
}

type DragState =
  | { kind: 'draw'; anchor: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: 'move'; id: string; grab: { x: number; y: number }; rect: Rect }
  | { kind: 'resize'; id: string; corner: 'nw' | 'ne' | 'sw' | 'se'; anchor: Rect; start: { x: number; y: number } }

const MIN_DRAW_PX = 10
const FIT_PADDING = 0.96

type Corner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

function normalize(rect: { x: number; y: number; width: number; height: number }): Rect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }
}

function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return normalize({
    x: a.x,
    y: a.y,
    width: b.x - a.x,
    height: b.y - a.y,
  })
}

export function EditStage(props: EditStageProps) {
  const {
    book,
    page,
    imageUrl,
    imageStatus,
    regions,
    tombstones,
    selectedRegionId,
    onSelect,
    onAdd,
    onUpdate,
    onDelete,
    onRestore,
    onReorder,
    onSelectPage,
  } = props
  const stageRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const scale = Math.min(
        (rect.width * FIT_PADDING) / page.width,
        (rect.height * FIT_PADDING) / page.height,
      )
      const width = page.width * scale
      const height = page.height * scale
      setFit({
        left: (rect.width - width) / 2,
        top: (rect.height - height) / 2,
        width,
        height,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [page.width, page.height])

  const pointerNormalized = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  const handleBackgroundDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    capturePointer(event.currentTarget as HTMLElement, event.pointerId)
    const point = pointerNormalized(event)
    onSelect(null)
    setDrag({ kind: 'draw', anchor: point, current: point })
  }

  const handleRegionDown = (event: React.PointerEvent, id: string) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    capturePointer(event.currentTarget as HTMLElement, event.pointerId)
    const point = pointerNormalized(event)
    const region = regions.find((entry) => entry.region.id === id)?.region
    if (!region) return
    onSelect(id)
    setDrag({
      kind: 'move',
      id,
      grab: { x: point.x - region.x, y: point.y - region.y },
      rect: { x: region.x, y: region.y, width: region.width, height: region.height },
    })
  }

  const handleHandleDown = (event: React.PointerEvent, id: string, corner: Corner) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    capturePointer(event.currentTarget as HTMLElement, event.pointerId)
    const region = regions.find((entry) => entry.region.id === id)?.region
    if (!region) return
    setDrag({
      kind: 'resize',
      id,
      corner,
      anchor: { x: region.x, y: region.y, width: region.width, height: region.height },
      start: pointerNormalized(event),
    })
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!drag) return
    const point = pointerNormalized(event)
    if (drag.kind === 'draw') {
      setDrag({ ...drag, current: point })
    } else if (drag.kind === 'move') {
      onUpdate(drag.id, {
        x: point.x - drag.grab.x,
        y: point.y - drag.grab.y,
        width: drag.rect.width,
        height: drag.rect.height,
      })
    } else if (drag.kind === 'resize') {
      const anchor = drag.anchor
      const left = drag.corner === 'nw' || drag.corner === 'sw'
      const top = drag.corner === 'nw' || drag.corner === 'ne'
      const fixedX = left ? anchor.x + anchor.width : anchor.x
      const fixedY = top ? anchor.y + anchor.height : anchor.y
      const width = Math.abs(point.x - fixedX)
      const height = Math.abs(point.y - fixedY)
      onUpdate(drag.id, {
        x: left ? fixedX - width : fixedX,
        y: top ? fixedY - height : fixedY,
        width,
        height,
      })
    }
  }

  const handlePointerUp = () => {
    if (drag?.kind === 'draw') {
      const rect = rectFromPoints(drag.anchor, drag.current)
      const overlay = overlayRef.current?.getBoundingClientRect()
      const px =
        overlay && overlay.width > 0 && overlay.height > 0
          ? Math.abs(rect.width) * overlay.width + Math.abs(rect.height) * overlay.height
          : 0
      if (px >= MIN_DRAW_PX) {
        onAdd(normalize({
          x: Math.min(drag.anchor.x, drag.current.x),
          y: Math.min(drag.anchor.y, drag.current.y),
          width: Math.abs(rect.width),
          height: Math.abs(rect.height),
        }))
      }
    }
    setDrag(null)
  }

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      if (!selectedRegionId) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        onDelete(selectedRegionId)
      } else if (event.key === 'ArrowUp' && event.altKey) {
        event.preventDefault()
        const index = regions.findIndex((entry) => entry.region.id === selectedRegionId)
        if (index > 0) onReorder(selectedRegionId, index - 1)
      } else if (event.key === 'ArrowDown' && event.altKey) {
        event.preventDefault()
        const index = regions.findIndex((entry) => entry.region.id === selectedRegionId)
        if (index >= 0 && index < regions.length - 1) onReorder(selectedRegionId, index + 1)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onSelect(null)
      }
    },
    [selectedRegionId, regions, onDelete, onReorder, onSelect],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const percentRect = (rect: Rect) => ({
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  })

  const drawPreview: Rect | null =
    drag?.kind === 'draw'
      ? normalize({
          x: Math.min(drag.anchor.x, drag.current.x),
          y: Math.min(drag.anchor.y, drag.current.y),
          width: Math.abs(drag.current.x - drag.anchor.x),
          height: Math.abs(drag.current.y - drag.anchor.y),
        })
      : null

  return (
    <div className="edit-stage" data-testid="edit-stage">
      <div className="edit-canvas" ref={stageRef}>
        {fit ? (
          <div
            className="edit-page"
            style={{ left: fit.left, top: fit.top, width: fit.width, height: fit.height }}
          >
            {imageUrl && imageStatus === 'loaded' ? (
              <img
                src={imageUrl}
                alt={`Editing PDF page ${page.pdfPageNumber}`}
                draggable={false}
              />
            ) : (
              <div className="edit-page-status">
                {imageStatus === 'error' ? 'Page image failed to load.' : 'Loading page…'}
              </div>
            )}
            <div
              className="edit-overlay"
              ref={overlayRef}
              data-testid="edit-overlay"
              onPointerDown={handleBackgroundDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {regions.map((entry, index) => (
                <div
                  key={entry.region.id}
                  className={`edit-region origin-${entry.origin}${
                    entry.region.id === selectedRegionId ? ' selected' : ''
                  }`}
                  style={percentRect(entry.region)}
                  data-region-id={entry.region.id}
                  data-testid={`edit-region-${entry.region.id}`}
                  onPointerDown={(event) => handleRegionDown(event, entry.region.id)}
                >
                  <span className="edit-region-number">{index + 1}</span>
                  {entry.region.id === selectedRegionId
                    ? CORNERS.map((corner) => (
                        <span
                          key={corner}
                          className={`edit-handle handle-${corner}`}
                          data-testid={`handle-${corner}`}
                          onPointerDown={(event) => handleHandleDown(event, entry.region.id, corner)}
                        />
                      ))
                    : null}
                </div>
              ))}
              {drawPreview ? (
                <div className="edit-region draw-preview" style={percentRect(drawPreview)} />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <RegionList
        book={book}
        page={page}
        regions={regions}
        tombstones={tombstones}
        selectedRegionId={selectedRegionId}
        onSelect={onSelect}
        onDelete={onDelete}
        onRestore={onRestore}
        onReorder={onReorder}
        onSelectPage={onSelectPage}
      />
    </div>
  )
}
