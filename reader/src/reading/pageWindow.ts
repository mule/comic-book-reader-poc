export interface WindowSpec {
  back: number
  ahead: number
}

export const DEFAULT_WINDOW_SPEC: WindowSpec = { back: 1, ahead: 2 }

export const MAX_WINDOW_ENTRIES = 8

export function assertWindowSpec(spec: WindowSpec): void {
  const entries = spec.back + spec.ahead + 1
  if (
    !Number.isInteger(spec.back) ||
    !Number.isInteger(spec.ahead) ||
    spec.back < 0 ||
    spec.ahead < 0
  ) {
    throw new Error(`Invalid window spec {back: ${spec.back}, ahead: ${spec.ahead}}.`)
  }
  if (entries < 1 || entries > MAX_WINDOW_ENTRIES) {
    throw new Error(
      `Window of ${entries} pages exceeds the explicit cap of ${MAX_WINDOW_ENTRIES}.`,
    )
  }
}

export function windowIndices(count: number, index: number, spec: WindowSpec): number[] {
  if (count === 0) return []
  if (index < 0 || index >= count) throw new Error(`Index ${index} out of range for ${count} pages.`)
  assertWindowSpec(spec)
  const first = Math.max(0, index - spec.back)
  const last = Math.min(count - 1, index + spec.ahead)
  const indices: number[] = []
  for (let i = first; i <= last; i += 1) indices.push(i)
  return indices
}

export interface PageWindowCallbacks<K, T> {
  keys: readonly K[]
  spec?: WindowSpec
  acquire(key: K): T
  release(handle: T, key: K): void
  onChange?(): void
}

export interface ActiveEntry<T> {
  handle: T
  generation: number
}

export class PageWindow<K, T> {
  private readonly keys: readonly K[]
  private readonly spec: WindowSpec
  private readonly acquire: (key: K) => T
  private readonly release: (handle: T, key: K) => void
  private readonly onChange?: () => void
  private readonly active = new Map<K, ActiveEntry<T>>()
  private currentIndex = -1
  private generation = 0

  constructor(options: PageWindowCallbacks<K, T>) {
    if (options.keys.length === 0) throw new Error('PageWindow requires at least one key.')
    this.keys = options.keys
    this.spec = options.spec ?? DEFAULT_WINDOW_SPEC
    assertWindowSpec(this.spec)
    this.acquire = options.acquire
    this.release = options.release
    this.onChange = options.onChange
  }

  get size(): number {
    return this.active.size
  }

  get cap(): number {
    return this.spec.back + this.spec.ahead + 1
  }

  get index(): number {
    return this.currentIndex
  }

  setIndex(index: number): void {
    if (index === this.currentIndex) return
    const desired = windowIndices(this.keys.length, index, this.spec)
    for (const key of [...this.active.keys()]) {
      if (!desired.some((i) => this.keys[i] === key)) {
        this.dropKey(key)
      }
    }
    this.currentIndex = index
    for (const i of desired) {
      const key = this.keys[i]
      if (!this.active.has(key)) {
        this.generation += 1
        this.active.set(key, { handle: this.acquire(key), generation: this.generation })
      }
    }
    this.onChange?.()
  }

  refresh(key: K): boolean {
    const entry = this.active.get(key)
    if (!entry) return false
    this.release(entry.handle, key)
    this.generation += 1
    this.active.set(key, { handle: this.acquire(key), generation: this.generation })
    this.onChange?.()
    return true
  }

  has(key: K): boolean {
    return this.active.has(key)
  }

  get(key: K): ActiveEntry<T> | undefined {
    return this.active.get(key)
  }

  activeKeys(): K[] {
    return [...this.active.keys()]
  }

  destroy(): void {
    for (const key of [...this.active.keys()]) this.dropKey(key)
    this.currentIndex = -1
    this.onChange?.()
  }

  private dropKey(key: K): void {
    const entry = this.active.get(key)
    if (!entry) return
    this.active.delete(key)
    this.release(entry.handle, key)
  }
}
