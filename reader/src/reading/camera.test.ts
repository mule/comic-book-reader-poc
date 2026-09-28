import { describe, expect, test } from 'vitest'
import {
  FULL_PAGE_RECT,
  IDENTITY_CAMERA,
  clampCamera,
  clampPan,
  computeFrame,
  focusFitScale,
  isIdentity,
  panBy,
  zoomAt,
  type Rect,
} from './camera'

const VIEWPORT = { width: 1000, height: 800 }
const PORTRAIT_PAGE = { width: 1000, height: 1500 }
const LANDSCAPE_PAGE = { width: 2000, height: 1500 }

describe('computeFrame', () => {
  test('fits a portrait page inside the viewport without cropping', () => {
    const frame = computeFrame(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, IDENTITY_CAMERA)
    expect(frame.width).toBeLessThanOrEqual(VIEWPORT.width)
    expect(frame.height).toBeLessThanOrEqual(VIEWPORT.height)
    expect(frame.height).toBe(VIEWPORT.height)
    expect(frame.x).toBeCloseTo((VIEWPORT.width - frame.width) / 2)
    expect(frame.y).toBeCloseTo(0)
  })

  test('fits a landscape spread page inside the viewport', () => {
    const frame = computeFrame(VIEWPORT, LANDSCAPE_PAGE, FULL_PAGE_RECT, IDENTITY_CAMERA)
    expect(frame.width).toBeLessThanOrEqual(VIEWPORT.width)
    expect(frame.height).toBeLessThanOrEqual(VIEWPORT.height)
  })

  test('zoom scales the page around the fit baseline', () => {
    const fit = computeFrame(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, IDENTITY_CAMERA)
    const zoomed = computeFrame(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, { zoom: 2, panX: 0, panY: 0 })
    expect(zoomed.scale).toBeCloseTo(2 * fit.scale)
    expect(zoomed.width).toBeCloseTo(2 * fit.width)
  })

  test('centers an arbitrary focus rect: the guided-reading primitive', () => {
    const focus: Rect = { x: 0, y: 0, width: 0.5, height: 0.25 }
    const frame = computeFrame(VIEWPORT, PORTRAIT_PAGE, focus, IDENTITY_CAMERA)
    expect(focusFitScale(VIEWPORT, PORTRAIT_PAGE, focus)).toBeCloseTo(
      Math.min(1000 / 500, 800 / 375),
    )
    const focusCenterX = frame.x + 0.25 * frame.width
    const focusCenterY = frame.y + 0.125 * frame.height
    expect(focusCenterX).toBeCloseTo(VIEWPORT.width / 2)
    expect(focusCenterY).toBeCloseTo(VIEWPORT.height / 2)
  })
})

describe('clampCamera / clampPan', () => {
  test('forces zero pan when the page fits inside the viewport', () => {
    expect(clampPan(120, VIEWPORT.width, 400)).toBe(0)
    const camera = clampCamera(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, { zoom: 1, panX: 50, panY: 70 })
    expect(camera).toEqual({ zoom: 1, panX: 0, panY: 0 })
  })

  test('limits pan to keep the zoomed page covering the viewport', () => {
    const zoomed = { zoom: 4, panX: 0, panY: 0 }
    const frame = computeFrame(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, zoomed)
    const limitX = (frame.width - VIEWPORT.width) / 2
    const camera = clampCamera(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, { ...zoomed, panX: limitX * 10, panY: -limitX * 10 })
    expect(camera.panX).toBeCloseTo(limitX)
    expect(camera.panY).toBeLessThanOrEqual((frame.height - VIEWPORT.height) / 2 + 1e-9)
  })

  test('panBy clamps while dragging', () => {
    const camera = panBy(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, IDENTITY_CAMERA, { x: 500, y: 500 })
    expect(isIdentity(camera)).toBe(true)
  })
})

describe('zoomAt', () => {
  test('keeps the page point under the anchor fixed', () => {
    const anchor = { x: 300, y: 200 }
    const before = computeFrame(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, IDENTITY_CAMERA)
    const next = zoomAt(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, IDENTITY_CAMERA, anchor, 2)
    const after = computeFrame(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, next)
    const pageXBefore = (anchor.x - before.x) / before.scale
    const pageXAfter = (anchor.x - after.x) / after.scale
    expect(pageXAfter).toBeCloseTo(pageXBefore, 6)
    expect(next.zoom).toBe(2)
  })

  test('clamps zoom to the configured range', () => {
    const tooFar = zoomAt(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, IDENTITY_CAMERA, { x: 0, y: 0 }, 100)
    expect(tooFar.zoom).toBe(8)
    const tooClose = zoomAt(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, { zoom: 1.2, panX: 0, panY: 0 }, { x: 0, y: 0 }, 0.01)
    expect(tooClose.zoom).toBe(1)
    expect(tooClose.panX).toBe(0)
    expect(tooClose.panY).toBe(0)
  })

  test('returns the same camera when zoom does not change', () => {
    const camera = { zoom: 1, panX: 0, panY: 0 }
    expect(zoomAt(VIEWPORT, PORTRAIT_PAGE, FULL_PAGE_RECT, camera, { x: 10, y: 10 }, 1)).toBe(camera)
  })
})
