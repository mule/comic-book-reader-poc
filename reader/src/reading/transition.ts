import type { Frame } from './camera'

export const DEFAULT_TRANSITION_MS = 260

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - clamped, 3)
}

export function interpolateFrame(from: Frame, to: Frame, t: number): Frame {
  const e = easeOutCubic(t)
  return {
    scale: from.scale + (to.scale - from.scale) * e,
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    width: from.width + (to.width - from.width) * e,
    height: from.height + (to.height - from.height) * e,
  }
}

export type ScheduleFrame = (callback: () => void) => () => void

export const defaultScheduleFrame: ScheduleFrame = (callback) => {
  const id = requestAnimationFrame(callback)
  return () => cancelAnimationFrame(id)
}

export interface FrameAnimatorOptions {
  reducedMotion: boolean
  durationMs?: number
  scheduleFrame?: ScheduleFrame
  now?(): number
  onFrame(frame: Frame): void
  onSettled?(target: Frame): void
}

/**
 * Tween between camera frames with requestAnimationFrame. Retargeting always
 * continues from the current visual frame, so rapid repeated navigation is
 * deterministic: the newest target wins and the final state is exactly the
 * target frame. Under reduced motion nothing is ever scheduled.
 */
export class FrameAnimator {
  private readonly reducedMotion: boolean
  private readonly durationMs: number
  private readonly scheduleFrame: ScheduleFrame
  private readonly now: () => number
  private readonly onFrame: (frame: Frame) => void
  private readonly onSettled: (target: Frame) => void
  private cancelScheduled: (() => void) | null = null
  private visual: Frame | null = null
  private target: Frame | null = null
  private startValue: Frame | null = null
  private startTime = 0

  constructor(options: FrameAnimatorOptions) {
    this.reducedMotion = options.reducedMotion
    this.durationMs = options.durationMs ?? DEFAULT_TRANSITION_MS
    this.scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame
    this.now = options.now ?? (() => performance.now())
    this.onFrame = options.onFrame
    this.onSettled = options.onSettled ?? (() => {})
  }

  get currentVisual(): Frame | null {
    return this.visual
  }

  get currentTarget(): Frame | null {
    return this.target
  }

  /** Jump instantly to a frame (reduced motion, viewport refit, page swap). */
  snap(target: Frame): void {
    this.stop()
    this.visual = target
    this.target = target
    this.startValue = null
    this.onFrame(target)
    this.onSettled(target)
  }

  /** Animate from the current visual frame to target; retargets cleanly. */
  animateTo(target: Frame): void {
    this.stop()
    this.target = target
    if (this.reducedMotion || this.durationMs <= 0 || this.visual === null) {
      this.snap(target)
      return
    }
    this.startValue = this.visual
    this.startTime = this.now()
    this.tick()
  }

  cancel(): void {
    this.stop()
  }

  destroy(): void {
    this.stop()
    this.visual = null
    this.target = null
    this.startValue = null
  }

  private stop(): void {
    if (this.cancelScheduled !== null) {
      this.cancelScheduled()
      this.cancelScheduled = null
    }
  }

  private tick = (): void => {
    if (this.startValue === null || this.target === null) return
    const elapsed = this.now() - this.startTime
    const t = this.durationMs <= 0 ? 1 : elapsed / this.durationMs
    const frame = interpolateFrame(this.startValue, this.target, t)
    this.visual = frame
    this.onFrame(frame)
    if (t >= 1) {
      this.visual = this.target
      this.onFrame(this.target)
      this.startValue = null
      this.cancelScheduled = null
      this.onSettled(this.target)
      return
    }
    this.cancelScheduled = this.scheduleFrame(this.tick)
  }
}
