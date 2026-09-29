import { describe, expect, test } from 'vitest'
import { FrameAnimator, interpolateFrame, easeOutCubic } from './transition'
import type { Frame } from './camera'

function frame(x: number, scale: number): Frame {
  return { x, y: x * 2, scale, width: 1000 * scale, height: 1500 * scale }
}

function manualHarness(reducedMotion: boolean) {
  const frames: Frame[] = []
  const settled: Frame[] = []
  let now = 0
  let pending: (() => void) | null = null
  const animator = new FrameAnimator({
    reducedMotion,
    durationMs: 200,
    now: () => now,
    scheduleFrame: (callback) => {
      pending = callback
      return () => {
        pending = null
      }
    },
    onFrame: (value) => frames.push(value),
    onSettled: (target) => settled.push(target),
  })
  const flush = () => {
    while (pending !== null) {
      const callback = pending
      pending = null
      now += 16
      callback()
    }
  }
  const tick = () => {
    const callback = pending
    pending = null
    now += 16
    callback?.()
  }
  return { animator, frames, settled, tick, flush }
}

describe('interpolateFrame', () => {
  test('eases between frames and lands exactly on the target', () => {
    expect(interpolateFrame(frame(0, 1), frame(100, 2), 0)).toEqual(frame(0, 1))
    const middle = interpolateFrame(frame(0, 1), frame(100, 2), 0.5)
    expect(middle.x).toBeGreaterThan(0)
    expect(middle.x).toBeLessThan(100)
    expect(interpolateFrame(frame(0, 1), frame(100, 2), 1)).toEqual(frame(100, 2))
    expect(interpolateFrame(frame(0, 1), frame(100, 2), 5)).toEqual(frame(100, 2))
  })

  test('easeOutCubic stays in [0, 1]', () => {
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875)
    expect(easeOutCubic(2)).toBe(1)
  })
})

describe('FrameAnimator', () => {
  test('reduced motion snaps immediately without scheduling any frame', () => {
    const h = manualHarness(true)
    h.animator.animateTo(frame(100, 2))
    expect(h.frames).toEqual([frame(100, 2)])
    expect(h.settled).toEqual([frame(100, 2)])
    h.animator.animateTo(frame(50, 3))
    expect(h.frames).toEqual([frame(100, 2), frame(50, 3)])
  })

  test('animates through scheduled frames to the exact target', () => {
    const h = manualHarness(false)
    h.animator.snap(frame(0, 1))
    h.animator.animateTo(frame(100, 2))
    expect(h.frames[h.frames.length - 1]).toEqual(frame(0, 1))
    h.tick()
    h.tick()
    expect(h.frames[h.frames.length - 1].x).toBeGreaterThan(0)
    expect(h.frames[h.frames.length - 1].x).toBeLessThan(100)
    for (let i = 0; i < 30; i += 1) h.tick()
    expect(h.frames[h.frames.length - 1]).toEqual(frame(100, 2))
    expect(h.settled[h.settled.length - 1]).toEqual(frame(100, 2))
  })

  test('retargeting mid-flight continues from the visual frame and the newest target wins', () => {
    const h = manualHarness(false)
    h.animator.animateTo(frame(100, 2))
    h.tick()
    h.tick()
    const visual = h.frames[h.frames.length - 1]
    h.animator.animateTo(frame(-40, 0.5))
    h.tick()
    expect(h.frames[h.frames.length - 1].x).toBeLessThan(visual.x)
    for (let i = 0; i < 30; i += 1) h.tick()
    expect(h.frames[h.frames.length - 1]).toEqual(frame(-40, 0.5))
    expect(h.settled[h.settled.length - 1]).toEqual(frame(-40, 0.5))
  })

  test('rapid repeated navigation is deterministic: final state is always the last target', () => {
    const h = manualHarness(false)
    h.animator.animateTo(frame(10, 1))
    h.animator.animateTo(frame(20, 1.5))
    h.animator.animateTo(frame(30, 2))
    h.animator.animateTo(frame(40, 2.5))
    for (let i = 0; i < 60; i += 1) h.tick()
    expect(h.animator.currentVisual).toEqual(frame(40, 2.5))
    expect(h.settled[h.settled.length - 1]).toEqual(frame(40, 2.5))
  })

  test('snap bypasses animation and destroy stops scheduled work', () => {
    const h = manualHarness(false)
    h.animator.snap(frame(7, 1))
    expect(h.frames).toEqual([frame(7, 1)])
    h.animator.animateTo(frame(9, 1))
    h.animator.destroy()
    h.tick()
    expect(h.animator.currentVisual).toBeNull()
  })
})
