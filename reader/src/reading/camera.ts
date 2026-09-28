export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface Camera {
  zoom: number
  panX: number
  panY: number
}

export const IDENTITY_CAMERA: Camera = { zoom: 1, panX: 0, panY: 0 }

export const MIN_ZOOM = 1
export const MAX_ZOOM = 8

export const FULL_PAGE_RECT: Rect = { x: 0, y: 0, width: 1, height: 1 }

export interface Frame {
  scale: number
  x: number
  y: number
  width: number
  height: number
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function isIdentity(camera: Camera): boolean {
  return camera.zoom === 1 && camera.panX === 0 && camera.panY === 0
}

export function focusFitScale(viewport: Size, page: Size, focus: Rect): number {
  const focusWidth = Math.max(1e-6, focus.width * page.width)
  const focusHeight = Math.max(1e-6, focus.height * page.height)
  return Math.min(viewport.width / focusWidth, viewport.height / focusHeight)
}

export function computeFrame(viewport: Size, page: Size, focus: Rect, camera: Camera): Frame {
  const base = focusFitScale(viewport, page, focus)
  const scale = base * camera.zoom
  const width = page.width * scale
  const height = page.height * scale
  const focusCenterX = (focus.x + focus.width / 2) * page.width * scale
  const focusCenterY = (focus.y + focus.height / 2) * page.height * scale
  const x = viewport.width / 2 + camera.panX - focusCenterX
  const y = viewport.height / 2 + camera.panY - focusCenterY
  return { scale, x, y, width, height }
}

export function clampPan(value: number, viewportSpan: number, contentSpan: number): number {
  if (contentSpan <= viewportSpan) return 0
  const limit = (contentSpan - viewportSpan) / 2
  return Math.min(limit, Math.max(-limit, value))
}

export function clampCamera(viewport: Size, page: Size, focus: Rect, camera: Camera): Camera {
  const frame = computeFrame(viewport, page, focus, { zoom: camera.zoom, panX: 0, panY: 0 })
  return {
    zoom: camera.zoom,
    panX: clampPan(camera.panX, viewport.width, frame.width),
    panY: clampPan(camera.panY, viewport.height, frame.height),
  }
}

export function zoomAt(
  viewport: Size,
  page: Size,
  focus: Rect,
  camera: Camera,
  anchor: { x: number; y: number },
  factor: number,
): Camera {
  const zoom = clampZoom(camera.zoom * factor)
  if (zoom === camera.zoom) return camera
  if (zoom === MIN_ZOOM) return IDENTITY_CAMERA
  const frame = computeFrame(viewport, page, focus, camera)
  const pagePointX = (anchor.x - frame.x) / frame.scale
  const pagePointY = (anchor.y - frame.y) / frame.scale
  const nextFrameScale = frame.scale * (zoom / camera.zoom)
  const focusCenterX = (focus.x + focus.width / 2) * page.width
  const focusCenterY = (focus.y + focus.height / 2) * page.height
  return {
    zoom,
    panX: anchor.x - pagePointX * nextFrameScale - viewport.width / 2 + focusCenterX * nextFrameScale,
    panY: anchor.y - pagePointY * nextFrameScale - viewport.height / 2 + focusCenterY * nextFrameScale,
  }
}

export function panBy(
  viewport: Size,
  page: Size,
  focus: Rect,
  camera: Camera,
  delta: { x: number; y: number },
): Camera {
  return clampCamera(viewport, page, focus, {
    zoom: camera.zoom,
    panX: camera.panX + delta.x,
    panY: camera.panY + delta.y,
  })
}
