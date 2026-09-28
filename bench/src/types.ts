export interface NamedViewport {
  name: string
  label: string
  width: number
  height: number
  deviceScaleFactor: number
  isMobile: boolean
  hasTouch: boolean
}

export interface ResourceTimingMetric {
  name: string
  entryType: string
  startTime: number
  duration: number
  transferSize?: number
  decodedBodySize?: number
}

export interface ColdLoadResult {
  bookId: string
  viewport: string
  isEmulation: boolean
  firstPageDecodeMs: number
  resources: {
    manifestMs: number | null
    completeMs: number | null
    firstPageImageMs: number | null
  }
}

export interface WarmNavTurn {
  turn: number
  fromPage: number
  toPage: number
  latencyMs: number
}

export interface WarmNavResult {
  bookId: string
  viewport: string
  isEmulation: boolean
  totalTurns: number
  p50Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
  meanMs: number
  turns: WarmNavTurn[]
}

export interface MemorySample {
  pageIndex: number
  pdfPageNumber: number
  jsHeapUsedSizeMb: number
  jsHeapTotalSizeMb: number
  nodes: number
  documents: number
  pagesRequested: number
  pagesVisited: number
}

export interface ExtendedReadingResult {
  bookId: string
  viewport: string
  isEmulation: boolean
  totalPages: number
  pagesVisited: number
  pagesRequested: number
  pdfRequestsCount: number
  testDataRequestsCount: number
  domPageImageCountMax: number
  memorySamples: MemorySample[]
  finalHeapUsedSizeMb: number
  boundedPrefetchSatisfied: boolean
}

export interface OfflineObservation {
  bookId: string
  viewport: string
  cachedPage: {
    pdfPageNumber: number
    status: string | null
    imagePresent: boolean
    naturalWidth: number
    naturalHeight: number
    errorPanelPresent: boolean
    notes: string
  }
  unvisitedPage: {
    pdfPageNumber: number
    status: string | null
    imagePresent: boolean
    naturalWidth: number
    naturalHeight: number
    errorPanelPresent: boolean
    errorText: string
    retryButtonPresent: boolean
    previousButtonPresent: boolean
    notes: string
  }
}

export interface SystemInfo {
  chromiumVersion: string
  osPlatform: string
  osRelease: string
  osArch: string
  cpuModel: string
  cpuCores: number
  ramGb: number
  networkConditions: string
  cacheState: string
}

export interface BenchmarkReport {
  timestamp: string
  environment: SystemInfo
  coldLoads: ColdLoadResult[]
  warmNavigations: WarmNavResult[]
  extendedReadings: ExtendedReadingResult[]
  offlineObservations: OfflineObservation[]
}
