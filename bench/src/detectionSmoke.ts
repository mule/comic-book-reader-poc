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
    const guidedControls = await page.getByRole('button', { name: /guided/i }).count()
    // The tested main revision lacks #6; do not claim guided rendering from data acceptance.
    assert.equal(guidedControls, 0, 'Reader capability changed: inspect and extend this check')
    assert.deepEqual(errors, [])
    assert.deepEqual(forbidden, [])
    await page.screenshot({ path: path.join(output, `${book}.png`) })
    checks.push({ book_id: book, suggestion_count: count, manifest_equal: true,
      image, buttons, guided_mode: 'not implemented on tested main revision',
      page_errors: errors, forbidden_requests: forbidden })
    await context.close()
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ browser: browser.version(), checks }, null, 2) + '\n')
  console.log(JSON.stringify(checks, null, 2))
} finally {
  await browser.close()
  await server.stop()
}
