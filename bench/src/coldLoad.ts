import type { Browser } from 'playwright'
import type { ColdLoadResult, NamedViewport } from './types.js'

export async function measureColdLoad(
  browser: Browser,
  serverUrl: string,
  bookId: string,
  viewport: NamedViewport,
): Promise<ColdLoadResult> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    ignoreHTTPSErrors: true,
  })

  try {
    // Clear localStorage to ensure we start cold at page 1
    await context.addInitScript(() => {
      try {
        localStorage.clear()
      } catch {
        // ignore
      }
    })

    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

    const t0 = performance.now()
    await page.goto(`${serverUrl}/#/book/${bookId}`, { waitUntil: 'commit' })

    // Wait for stage to reach loaded state with visible image
    await page.waitForSelector('.page-stage[data-page-status="loaded"] img.page-image', {
      state: 'visible',
      timeout: 30000,
    })

    // Ensure the image bitmap decode has completed
    await page.evaluate(async () => {
      const img = document.querySelector('img.page-image') as HTMLImageElement | null
      if (!img) throw new Error('Missing page image in DOM')
      if (!img.complete) {
        await new Promise((resolve) => {
          img.onload = resolve
          img.onerror = resolve
        })
      }
      if (img.decode) {
        await img.decode()
      }
      // Wait for next animation frame paint
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    const t1 = performance.now()
    const firstPageDecodeMs = Math.round((t1 - t0) * 100) / 100

    const resources = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      const manifest = entries.find((e) => e.name.includes('manifest.json'))
      const complete = entries.find((e) => e.name.includes('COMPLETE.json'))
      const firstImg = entries.find((e) => e.name.includes('/pages/'))
      return {
        manifestMs: manifest ? Math.round(manifest.duration * 100) / 100 : null,
        completeMs: complete ? Math.round(complete.duration * 100) / 100 : null,
        firstPageImageMs: firstImg ? Math.round(firstImg.duration * 100) / 100 : null,
      }
    })

    return {
      bookId,
      viewport: viewport.name,
      isEmulation: viewport.name.includes('emulation') || viewport.isMobile,
      firstPageDecodeMs,
      resources,
    }
  } finally {
    await context.close()
  }
}
