import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import { measureColdLoad } from './coldLoad.js'
import { measureExtendedReading } from './extendedReading.js'
import { measureOfflineBehavior } from './offline.js'
import { startReaderServer } from './server.js'
import { getSystemInfo } from './systemInfo.js'
import type {
  BenchmarkReport,
  ColdLoadResult,
  ExtendedReadingResult,
  OfflineObservation,
  WarmNavResult,
} from './types.js'
import { NAMED_VIEWPORTS } from './viewports.js'
import { measureWarmNavigation } from './warmNav.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const INVENTORY_PATH = path.resolve(REPO_ROOT, 'corpus/inventory.json')
const BENCH_OUT_DIR = path.resolve(REPO_ROOT, 'work/bench')

interface InventoryBook {
  book_id: string
  page_count: number
}

async function main() {
  console.log('=== Comic Book Reader POC: Automated Evaluation Benchmark ===')

  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8')) as {
    books: InventoryBook[]
  }
  const books = inventory.books

  const port = 5188
  console.log(`Starting reader preview server on port ${port}...`)
  const server = await startReaderServer(port)
  console.log(`Reader preview server running at ${server.url}`)

  const browser = await chromium.launch({
    headless: true,
  })

  try {
    const systemInfo = getSystemInfo(browser)
    console.log(`Chromium: ${systemInfo.chromiumVersion} | OS: ${systemInfo.osPlatform} ${systemInfo.osRelease} | CPU: ${systemInfo.cpuModel} (${systemInfo.cpuCores} cores) | RAM: ${systemInfo.ramGb} GB`)

    const coldLoads: ColdLoadResult[] = []
    const warmNavigations: WarmNavResult[] = []
    const extendedReadings: ExtendedReadingResult[] = []
    const offlineObservations: OfflineObservation[] = []

    // 1. Cold first-page loads across named viewports
    console.log('\n--- 1. Cold First-Page Load Measurements ---')
    for (const book of books) {
      for (const vp of NAMED_VIEWPORTS) {
        console.log(`Measuring cold load: ${book.book_id} on ${vp.label}...`)
        const result = await measureColdLoad(browser, server.url, book.book_id, vp)
        coldLoads.push(result)
        console.log(`  -> First page decoded & visible: ${result.firstPageDecodeMs} ms (manifest: ${result.resources.manifestMs} ms, image: ${result.resources.firstPageImageMs} ms)`)
      }
    }

    // 2. Warm page navigation latency
    console.log('\n--- 2. Warm Page Navigation Latency (p50 / p95) ---')
    const primaryDesktopVp = NAMED_VIEWPORTS[0]
    for (const book of books) {
      console.log(`Measuring warm navigation: ${book.book_id} (40 consecutive turns)...`)
      const result = await measureWarmNavigation(
        browser,
        server.url,
        book.book_id,
        primaryDesktopVp,
        40,
      )
      warmNavigations.push(result)
      console.log(`  -> p50: ${result.p50Ms} ms | p95: ${result.p95Ms} ms | min: ${result.minMs} ms | max: ${result.maxMs} ms | mean: ${result.meanMs} ms`)
    }

    // Also measure warm navigation on tablet emulation for Harbinger
    const tabletVp = NAMED_VIEWPORTS[1]
    console.log(`Measuring warm navigation: harbinger-vol-1-omega-rising on ${tabletVp.label} (40 turns)...`)
    const tabletWarm = await measureWarmNavigation(
      browser,
      server.url,
      'harbinger-vol-1-omega-rising',
      tabletVp,
      40,
    )
    warmNavigations.push(tabletWarm)
    console.log(`  -> (Tablet Emulation) p50: ${tabletWarm.p50Ms} ms | p95: ${tabletWarm.p95Ms} ms | mean: ${tabletWarm.meanMs} ms`)

    // 3. Extended reading across all 3 books through ALL pages
    console.log('\n--- 3. Extended Reading & Memory (End-to-End Books) ---')
    for (const book of books) {
      console.log(`Reading all ${book.page_count} pages of ${book.book_id}...`)
      const result = await measureExtendedReading(
        browser,
        server.url,
        book.book_id,
        book.page_count,
        primaryDesktopVp,
      )
      extendedReadings.push(result)
      console.log(`  -> Visited: ${result.pagesVisited}/${result.totalPages} | Requests: ${result.pagesRequested} | Zero PDF requests: ${result.pdfRequestsCount === 0} | Zero test-data requests: ${result.testDataRequestsCount === 0} | Max DOM images: ${result.domPageImageCountMax} | Final JS heap used: ${result.finalHeapUsedSizeMb} MB | Bounded prefetch: ${result.boundedPrefetchSatisfied}`)
    }

    // 4. Offline behavior tests
    console.log('\n--- 4. Offline Behaviour Verification ---')
    for (const vp of [NAMED_VIEWPORTS[0], NAMED_VIEWPORTS[2]]) {
      console.log(`Testing offline behavior for harbinger-vol-1-omega-rising on ${vp.label}...`)
      const obs = await measureOfflineBehavior(
        browser,
        server.url,
        'harbinger-vol-1-omega-rising',
        vp,
      )
      offlineObservations.push(obs)
      console.log(`  -> Cached page 1: imagePresent=${obs.cachedPage.imagePresent}, naturalWidth=${obs.cachedPage.naturalWidth}, status=${obs.cachedPage.status}`)
      console.log(`  -> Unvisited page: errorPanelPresent=${obs.unvisitedPage.errorPanelPresent}, status=${obs.unvisitedPage.status}, retryBtn=${obs.unvisitedPage.retryButtonPresent}, prevBtn=${obs.unvisitedPage.previousButtonPresent}`)
    }

    const report: BenchmarkReport = {
      timestamp: new Date().toISOString(),
      environment: systemInfo,
      coldLoads,
      warmNavigations,
      extendedReadings,
      offlineObservations,
    }

    fs.mkdirSync(BENCH_OUT_DIR, { recursive: true })
    const outJsonPath = path.join(BENCH_OUT_DIR, 'reader-benchmark.json')
    fs.writeFileSync(outJsonPath, JSON.stringify(report, null, 2) + '\n')
    console.log(`\nSuccessfully wrote full benchmark JSON to: ${outJsonPath}`)

    // Also write a formatted Markdown summary
    const md = generateMarkdownSummary(report)
    const outMdPath = path.join(BENCH_OUT_DIR, 'reader-benchmark.md')
    fs.writeFileSync(outMdPath, md)
    console.log(`Successfully wrote benchmark Markdown summary to: ${outMdPath}`)
  } finally {
    await browser.close()
    await server.stop()
  }
}

function generateMarkdownSummary(report: BenchmarkReport): string {
  const env = report.environment
  const lines: string[] = [
    '# Reader Performance Evaluation Summary',
    '',
    `**Date / Timestamp:** ${report.timestamp}  `,
    `**Chromium Version:** ${env.chromiumVersion}  `,
    `**OS:** ${env.osPlatform} ${env.osRelease} (${env.osArch})  `,
    `**CPU:** ${env.cpuModel} (${env.cpuCores} cores)  `,
    `**System RAM:** ${env.ramGb} GB  `,
    `**Network:** ${env.networkConditions}  `,
    `**Cache State:** ${env.cacheState}  `,
    '',
    '## 1. Cold First-Page Load',
    '',
    '*Measured in fresh browser contexts with cache disabled (`Network.setCacheDisabled: true`).*',
    '',
    '| Book ID | Viewport | Decode & Visible (ms) | Manifest (ms) | COMPLETE (ms) | Page 1 Image (ms) |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
  ]

  for (const c of report.coldLoads) {
    lines.push(
      `| \`${c.bookId}\` | ${c.viewport} | **${c.firstPageDecodeMs}** | ${c.resources.manifestMs ?? '-'} | ${c.resources.completeMs ?? '-'} | ${c.resources.firstPageImageMs ?? '-'} |`,
    )
  }

  lines.push(
    '',
    '## 2. Warm Page Navigation Latency',
    '',
    '*Sequential page turns measured from keypress until DOM updated and new frame rendered.*',
    '',
    '| Book ID | Viewport | Turns | p50 (ms) | p95 (ms) | Min (ms) | Max (ms) | Mean (ms) |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  )

  for (const w of report.warmNavigations) {
    lines.push(
      `| \`${w.bookId}\` | ${w.viewport} | ${w.totalTurns} | **${w.p50Ms}** | **${w.p95Ms}** | ${w.minMs} | ${w.maxMs} | ${w.meanMs} |`,
    )
  }

  lines.push(
    '',
    '## 3. Extended Reading & Memory (All 389 Pages Across Corpus)',
    '',
    '*Each book navigated end-to-end page by page with CDP performance & memory metrics sampled.*',
    '',
    '| Book ID | Pages Visited | Page Requests | Zero PDF / Test-Data Requests | Max DOM Image Elements | Final JS Heap (MB) | Bounded Prefetch Satisfied |',
    '| --- | ---: | ---: | :---: | :---: | ---: | :---: |',
  )

  for (const e of report.extendedReadings) {
    const zeroOk = e.pdfRequestsCount === 0 && e.testDataRequestsCount === 0 ? '✓ (0 / 0)' : 'FAILED'
    const boundedOk = e.boundedPrefetchSatisfied ? '✓' : 'FAILED'
    lines.push(
      `| \`${e.bookId}\` | ${e.pagesVisited} / ${e.totalPages} | ${e.pagesRequested} | ${zeroOk} | ${e.domPageImageCountMax} | ${e.finalHeapUsedSizeMb} | ${boundedOk} |`,
    )
  }

  lines.push(
    '',
    '## 4. Offline Behaviour Observations',
    '',
    '*Script observation when context is set offline after initial page load and cached page turn.*',
    '',
    '| Book ID | Viewport | Recently Visited Page (Cached) | Unvisited Page (Uncached) | Error Panel Observed | Action Buttons |',
    '| --- | --- | --- | --- | :---: | --- |',
  )

  for (const o of report.offlineObservations) {
    const cachedDesc = o.cachedPage.imagePresent && o.cachedPage.naturalWidth > 0
      ? `Rendered (naturalWidth=${o.cachedPage.naturalWidth}px)`
      : 'Failed'
    const unvisitedDesc = o.unvisitedPage.errorPanelPresent
      ? `Error status (${o.unvisitedPage.status})`
      : 'Loaded'
    const buttons = [
      o.unvisitedPage.retryButtonPresent ? 'Retry' : null,
      o.unvisitedPage.previousButtonPresent ? 'Previous page' : null,
    ]
      .filter(Boolean)
      .join(', ')

    lines.push(
      `| \`${o.bookId}\` | ${o.viewport} | ${cachedDesc} | ${unvisitedDesc} | ${o.unvisitedPage.errorPanelPresent ? '✓' : '✗'} | ${buttons || 'None'} |`,
    )
  }

  lines.push('')
  return lines.join('\n')
}

main().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
