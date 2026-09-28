import type { Browser } from 'playwright'
import type { NamedViewport, OfflineObservation } from './types.js'

export async function measureOfflineBehavior(
  browser: Browser,
  serverUrl: string,
  bookId: string,
  viewport: NamedViewport,
): Promise<OfflineObservation> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    ignoreHTTPSErrors: true,
  })

  try {
    await context.addInitScript(() => {
      try {
        localStorage.clear()
      } catch {
        // ignore
      }
    })

    const page = await context.newPage()
    await page.goto(`${serverUrl}/#/book/${bookId}`, { waitUntil: 'commit' })

    // Wait for page 1 to be fully loaded
    await page.waitForSelector('.page-stage[data-page-status="loaded"] img.page-image', {
      state: 'visible',
      timeout: 30000,
    })

    // Settle prefetch window (+1, +2)
    await page.waitForTimeout(400)

    // Navigate to page 2 so both page 1 and page 2 are visited and stored in HTTP cache
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => {
      const label = (document.querySelector('.reader-page-label')?.textContent ?? '').toLowerCase()
      return label.includes('page 2')
    })
    await page.waitForSelector('.page-stage[data-page-status="loaded"] img.page-image', {
      state: 'visible',
      timeout: 10000,
    })

    // Now go OFFLINE
    await context.setOffline(true)

    // 1. Navigate to a recently visited page (page 1)
    await page.keyboard.press('ArrowLeft')
    await page.waitForFunction(() => {
      const label = (document.querySelector('.reader-page-label')?.textContent ?? '').toLowerCase()
      return label.includes('page 1')
    })

    // Allow render to settle
    await page.waitForTimeout(300)

    const cachedObservation = await page.evaluate(() => {
      const stage = document.querySelector('.page-stage')
      const img = document.querySelector('img.page-image') as HTMLImageElement | null
      const errorPanel = document.querySelector('.page-status-error')
      return {
        pdfPageNumber: 1,
        status: stage?.getAttribute('data-page-status') ?? null,
        imagePresent: img !== null,
        naturalWidth: img?.naturalWidth ?? 0,
        naturalHeight: img?.naturalHeight ?? 0,
        errorPanelPresent: errorPanel !== null,
        notes:
          img && img.naturalWidth > 0 && !errorPanel
            ? 'Recently visited page served successfully from browser HTTP cache while offline.'
            : 'Recently visited page failed to render while offline.',
      }
    })

    // 2. Navigate to an unvisited page outside prefetch cache (turn forward past prefetch window, e.g. to page 10)
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(80)
    }

    // Wait for image error or timeout
    try {
      await page.waitForSelector('.page-status-error', { timeout: 5000 })
    } catch {
      // if not found immediately, give extra time
      await page.waitForTimeout(500)
    }

    const unvisitedObservation = await page.evaluate(() => {
      const stage = document.querySelector('.page-stage')
      const img = document.querySelector('img.page-image') as HTMLImageElement | null
      const errorPanel = document.querySelector('.page-status-error')
      const label = document.querySelector('.reader-page-label')?.textContent ?? ''
      const pageMatch = label.match(/Page (\d+)/)
      const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : 0

      let retryFound = false
      let prevFound = false
      const btnEls = errorPanel ? errorPanel.querySelectorAll('button') : []
      for (let i = 0; i < btnEls.length; i++) {
        const text = btnEls[i].textContent || ''
        if (text.includes('Retry')) retryFound = true
        if (text.includes('Previous page')) prevFound = true
      }

      return {
        pdfPageNumber: pageNum,
        status: stage?.getAttribute('data-page-status') ?? null,
        imagePresent: img !== null,
        naturalWidth: img?.naturalWidth ?? 0,
        naturalHeight: img?.naturalHeight ?? 0,
        errorPanelPresent: errorPanel !== null,
        errorText: errorPanel?.querySelector('p')?.textContent?.trim() ?? '',
        retryButtonPresent: retryFound,
        previousButtonPresent: prevFound,
        notes:
          errorPanel !== null
            ? 'Unvisited page triggered per-page error panel when network fetch failed offline.'
            : 'Error panel did not appear within expected window.',
      }
    })

    return {
      bookId,
      viewport: viewport.name,
      cachedPage: cachedObservation,
      unvisitedPage: unvisitedObservation,
    }
  } finally {
    await context.close()
  }
}
