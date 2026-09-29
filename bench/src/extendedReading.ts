import type { Browser } from 'playwright'
import type { ExtendedReadingResult, MemorySample, NamedViewport } from './types.js'

export async function measureExtendedReading(
  browser: Browser,
  serverUrl: string,
  bookId: string,
  totalPages: number,
  viewport: NamedViewport,
): Promise<ExtendedReadingResult> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    ignoreHTTPSErrors: true,
  })

  const pdfRequests: string[] = []
  const testDataRequests: string[] = []
  const pageImageRequests: string[] = []

  try {
    await context.addInitScript(() => {
      try {
        localStorage.clear()
      } catch {
        // ignore
      }
    })

    const page = await context.newPage()

    page.on('request', (req) => {
      const url = req.url()
      if (url.toLowerCase().endsWith('.pdf') || url.includes('.pdf?')) {
        pdfRequests.push(url)
      }
      if (url.includes('test-data')) {
        testDataRequests.push(url)
      }
      if (url.includes('/pages/')) {
        pageImageRequests.push(url)
      }
    })

    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')

    await page.goto(`${serverUrl}/#/book/${bookId}`, { waitUntil: 'commit' })

    // Wait for first page to load
    await page.waitForSelector('.page-stage[data-page-status="loaded"] img.page-image', {
      state: 'visible',
      timeout: 30000,
    })

    const memorySamples: MemorySample[] = []
    let domPageImageCountMax = 0
    let boundedPrefetchSatisfied = true

    const sampleMemory = async (pageIdx: number, pdfPageNum: number): Promise<void> => {
      const perfMetrics = await cdp.send('Performance.getMetrics')
      const metricsMap = new Map(perfMetrics.metrics.map((m) => [m.name, m.value]))

      const domInfo = await page.evaluate(() => {
        const perfMem = (performance as unknown as { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number } }).memory
        const imgCount = document.querySelectorAll('.page-image').length
        return {
          usedJSHeapSize: perfMem?.usedJSHeapSize ?? 0,
          totalJSHeapSize: perfMem?.totalJSHeapSize ?? 0,
          imgCount,
        }
      })

      if (domInfo.imgCount > domPageImageCountMax) {
        domPageImageCountMax = domInfo.imgCount
      }

      const jsHeapUsedFromCDP = metricsMap.get('JSHeapUsedSize') ?? domInfo.usedJSHeapSize
      const jsHeapTotalFromCDP = metricsMap.get('JSHeapTotalSize') ?? domInfo.totalJSHeapSize
      const nodes = metricsMap.get('Nodes') ?? 0
      const documents = metricsMap.get('Documents') ?? 0

      memorySamples.push({
        pageIndex: pageIdx,
        pdfPageNumber: pdfPageNum,
        jsHeapUsedSizeMb: Math.round((jsHeapUsedFromCDP / (1024 * 1024)) * 100) / 100,
        jsHeapTotalSizeMb: Math.round((jsHeapTotalFromCDP / (1024 * 1024)) * 100) / 100,
        nodes,
        documents,
        pagesRequested: pageImageRequests.length,
        pagesVisited: pageIdx + 1,
      })
    }

    // Sample initial state at page 1
    await sampleMemory(0, 1)

    // Page through the entire book
    for (let current = 1; current < totalPages; current++) {
      const targetPageNum = current + 1
      await page.keyboard.press('ArrowRight')

      await page.waitForFunction(
        (target) => {
          const label = (document.querySelector('.reader-page-label')?.textContent ?? '').toLowerCase()
          const stage = document.querySelector('.page-stage')
          const img = document.querySelector('img.page-image') as HTMLImageElement | null
          return (
            label.includes(`page ${target}`) &&
            stage?.getAttribute('data-page-status') === 'loaded' &&
            img !== null &&
            img.complete
          )
        },
        targetPageNum,
        { timeout: 10000 },
      )

      // Bounded prefetch check: at page index `current`, max allowed image requests is current + 3
      if (pageImageRequests.length > current + 3) {
        boundedPrefetchSatisfied = false
      }

      // Sample every 25 pages or on final page
      if (targetPageNum % 25 === 0 || targetPageNum === totalPages) {
        await sampleMemory(current, targetPageNum)
      }

      await page.waitForTimeout(50)
    }

    // Final sample at the end
    if (memorySamples[memorySamples.length - 1]?.pdfPageNumber !== totalPages) {
      await sampleMemory(totalPages - 1, totalPages)
    }

    const finalSample = memorySamples[memorySamples.length - 1]

    return {
      bookId,
      viewport: viewport.name,
      isEmulation: viewport.name.includes('emulation') || viewport.isMobile,
      totalPages,
      pagesVisited: totalPages,
      pagesRequested: pageImageRequests.length,
      pdfRequestsCount: pdfRequests.length,
      testDataRequestsCount: testDataRequests.length,
      domPageImageCountMax,
      memorySamples,
      finalHeapUsedSizeMb: finalSample?.jsHeapUsedSizeMb ?? 0,
      boundedPrefetchSatisfied,
    }
  } finally {
    await context.close()
  }
}
