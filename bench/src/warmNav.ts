import type { Browser } from 'playwright'
import type { NamedViewport, WarmNavResult, WarmNavTurn } from './types.js'

export async function measureWarmNavigation(
  browser: Browser,
  serverUrl: string,
  bookId: string,
  viewport: NamedViewport,
  maxTurns = 40,
): Promise<WarmNavResult> {
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

    // Wait for initial page to load completely
    await page.waitForSelector('.page-stage[data-page-status="loaded"] img.page-image', {
      state: 'visible',
      timeout: 30000,
    })

    // Allow initial prefetch window (+1, +2) to settle
    await page.waitForTimeout(400)

    const turns: WarmNavTurn[] = []

    for (let turn = 1; turn <= maxTurns; turn++) {
      const fromPage = turn
      const toPage = turn + 1

      const t0 = performance.now()
      await page.keyboard.press('ArrowRight')

      // Wait for reader-page-label to reflect target page and page stage to be loaded
      await page.waitForFunction(
        (target) => {
          const label = (document.querySelector('.reader-page-label')?.textContent ?? '').toLowerCase()
          const stage = document.querySelector('.page-stage')
          const img = document.querySelector('img.page-image') as HTMLImageElement | null
          return (
            label.includes(`page ${target}`) &&
            stage?.getAttribute('data-page-status') === 'loaded' &&
            img !== null &&
            img.complete &&
            img.naturalWidth > 0
          )
        },
        toPage,
        { timeout: 10000 },
      )

      // Ensure frame painted
      await page.evaluate(async () => {
        const img = document.querySelector('img.page-image') as HTMLImageElement | null
        if (img && img.decode) {
          await img.decode()
        }
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })

      const latencyMs = Math.round((performance.now() - t0) * 100) / 100
      turns.push({ turn, fromPage, toPage, latencyMs })

      // Small pacing delay between turns to mimic human reading and allow bounded prefetch
      await page.waitForTimeout(80)
    }

    const latencies = turns.map((t) => t.latencyMs).sort((a, b) => a - b)
    const p50Ms = latencies[Math.floor(latencies.length * 0.5)] ?? 0
    const p95Ms = latencies[Math.floor(latencies.length * 0.95)] ?? 0
    const minMs = latencies[0] ?? 0
    const maxMs = latencies[latencies.length - 1] ?? 0
    const meanMs =
      latencies.length > 0
        ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100
        : 0

    return {
      bookId,
      viewport: viewport.name,
      isEmulation: viewport.name.includes('emulation') || viewport.isMobile,
      totalTurns: turns.length,
      p50Ms,
      p95Ms,
      minMs,
      maxMs,
      meanMs,
      turns,
    }
  } finally {
    await context.close()
  }
}

// ============================================================================
// Real guided UI checks and camera-settled latency, shared by pnpm guided and the suite.
export { runCuratedGuided as measurePanelNavigationLatency } from './guided.js'
