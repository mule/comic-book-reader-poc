/** Read-only browser check of explicitly supplied detected packages. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { startReaderServer } from './server.js'

const packageRoot = process.argv[2]
if (!packageRoot) throw new Error('Usage: pnpm exec tsx src/detectionSmoke.ts PATH_TO_DETECTED_PACKAGE_ROOT')
const output = path.resolve('../work/phase-b/reader-check')
fs.mkdirSync(output, { recursive: true })
const server = await startReaderServer(5237, packageRoot)
const browser = await chromium.launch({ headless: true })
const checks: unknown[] = []
try {
  const books = fs.readdirSync(packageRoot).filter((name) =>
    !name.startsWith('.') && fs.existsSync(path.join(packageRoot, name, 'COMPLETE.json')),
  )
  assert(books.length > 0, 'No complete packages supplied')
  for (const book of books) {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, book, 'manifest.json'), 'utf8'))
    const count = manifest.pages.reduce((sum: number, p: { suggestions?: { regions: unknown[] } }) =>
      sum + (p.suggestions?.regions.length ?? 0), 0)
    assert(count > 0, 'Expected a package with nonempty suggestions')
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const errors: string[] = []
    const forbidden: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (/\.pdf(?:$|\?)|test-data/i.test(request.url())) forbidden.push(request.url())
    })
    const response = page.waitForResponse((r) => r.url().endsWith(`/packages/${book}/manifest.json`))
    await page.goto(`${server.url}/#/book/${book}`)
    const served = await (await response).json()
    assert.deepEqual(served, manifest, 'Reader received a different manifest')
    await page.locator('.page-stage[data-page-status="loaded"] img.page-image').waitFor({ state: 'visible' })
    const image = await page.locator('img.page-image').evaluate((element) => {
      const img = element as HTMLImageElement
      return { complete: img.complete, width: img.naturalWidth, height: img.naturalHeight }
    })
    assert(image.complete && image.width > 0 && image.height > 0)
    const buttons = await page.getByRole('button').allTextContents()
    const stops = manifest.page_order.flatMap((pageId: string) => {
      const entry = manifest.pages.find((p: { id: string }) => p.id === pageId)
      assert(entry, 'Ordered page missing')
      if (!entry.suggestions?.regions.length) {
        return [{ pageId, regionId: null, rect: { x: 0, y: 0, width: 1, height: 1 } }]
      }
      return entry.suggestions.order.map((regionId: string) => {
        const rect = entry.suggestions.regions.find((r: { id: string }) => r.id === regionId)
        assert(rect, 'Ordered suggestion missing')
        return { pageId, regionId, rect }
      })
    }) as { pageId: string; regionId: string | null;
      rect: { x: number; y: number; width: number; height: number } }[]
    const verifyStop = async (stop: typeof stops[number]) => {
      await page.waitForFunction(({ stop }) => {
        const reader = document.querySelector('.reader')
        const stage = document.querySelector('.page-stage')
        const img = stage?.querySelector<HTMLImageElement>('.page-image')
        if (reader?.getAttribute('data-mode') !== 'guided' ||
            reader.getAttribute('data-page-id') !== stop.pageId ||
            reader.getAttribute('data-region-id') !== (stop.regionId ?? '') ||
            stage?.getAttribute('data-page-status') !== 'loaded' || !img?.complete || !img.naturalWidth) return false
        const box = stage.getBoundingClientRect()
        const width = parseFloat(img.style.width), height = parseFloat(img.style.height)
        const r = stop.rect
        const scale = Math.min(box.width / (width * r.width), box.height / (height * r.height))
        const matrix = new DOMMatrixReadOnly(getComputedStyle(img).transform)
        return Math.abs(matrix.a - scale) < 0.0001 &&
          Math.abs(matrix.e - (box.width / 2 - (r.x + r.width / 2) * width * scale)) < 0.1 &&
          Math.abs(matrix.f - (box.height / 2 - (r.y + r.height / 2) * height * scale)) < 0.1
      }, { stop }, { timeout: 10000 })
      assert.equal(await page.getByTestId('guided-outline').count(), stop.regionId === null ? 0 : 1)
    }
    await page.getByRole('button', { name: 'Guided', exact: true }).click()
    await verifyStop(stops[0])
    await page.screenshot({ path: path.join(output, `${book}-guided.png`) })
    for (const stop of stops.slice(1)) {
      await page.keyboard.press('ArrowRight')
      await verifyStop(stop)
    }
    await page.reload()
    await verifyStop(stops.at(-1)!)
    for (const stop of stops.slice(0, -1).reverse()) {
      await page.keyboard.press('ArrowLeft')
      await verifyStop(stop)
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(forbidden, [])
    await page.screenshot({ path: path.join(output, `${book}.png`) })
    checks.push({ book_id: book, suggestion_count: count, manifest_equal: true,
      image, buttons, guided_mode: 'verified stored suggestions with independent camera geometry',
      guided_stops: stops, forward_backward_verified: true, reload_progress_verified: true,
      page_errors: errors, forbidden_requests: forbidden })
    await context.close()
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ browser: browser.version(), checks }, null, 2) + '\n')
  console.log(JSON.stringify(checks, null, 2))
} finally {
  await browser.close()
  await server.stop()
}
