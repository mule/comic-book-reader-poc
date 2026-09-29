import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import type { Region } from '../../reader/src/manifest/types.js'
interface AnnotationDocument {
  schema_version: number; book_id: string; source_sha256: string
  pages: { page_id: string; pdf_page_number: number; added_regions: Region[]; edited_regions: Region[]; deleted_region_ids: string[]; order: string[] }[]
}
import type { NamedViewport } from './types.js'
import { NAMED_VIEWPORTS } from './viewports.js'
import { startReaderServer } from './server.js'
import { getSystemInfo } from './systemInfo.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
type Stop = { pageId: string; regionId: string | null; rect: Omit<Region, 'id'> }
const full = { x: 0, y: 0, width: 1, height: 1 }
export interface GuidedResult {
  bookId: string
  viewport: string
  checks: string[]
  samples: { pageId: string; regionId: string | null; direction: string; latencyMs: number }[]
  p50Ms: number
  p95Ms: number
}

async function openPanel(page: Page) {
  await page.getByTestId('annotations-button').click()
}
async function closePanel(page: Page) {
  await page.getByLabel('Close annotations panel').click()
}
async function exported(page: Page): Promise<AnnotationDocument> {
  return JSON.parse(await page.getByTestId('annotations-export').inputValue())
}
async function importFile(page: Page, file: string) {
  await openPanel(page)
  await page.getByLabel('Choose annotation file').setInputFiles(file)
  await page.locator('.panel-ok').waitFor()
}
async function selectPage(page: Page, id: string) {
  await page.getByRole('button', { name: 'Edit regions', exact: true }).click()
  await page.getByLabel('Page being edited').selectOption(id)
  await page.getByRole('button', { name: 'Guided', exact: true }).click()
}

// Verify the actual rendered transform against independently calculated region fit,
// not a timeout or an application-provided "settled" flag. Two frames follow decode.
async function settled(page: Page, stop: Stop) {
  await page.waitForFunction(({ stop }) => {
    const reader = document.querySelector('.reader')
    const stage = document.querySelector('.page-stage')
    const img = stage?.querySelector<HTMLImageElement>('.page-image')
    if (reader?.getAttribute('data-page-id') !== stop.pageId ||
        reader?.getAttribute('data-region-id') !== (stop.regionId ?? '') ||
        !img?.complete || !img.naturalWidth || stage?.getAttribute('data-page-status') !== 'loaded') return false
    const box = stage.getBoundingClientRect()
    const width = parseFloat(img.style.width), height = parseFloat(img.style.height)
    const r = stop.rect
    const scale = Math.min(box.width / (width * r.width), box.height / (height * r.height))
    const matrix = new DOMMatrixReadOnly(getComputedStyle(img).transform)
    return Math.abs(matrix.a - scale) < 0.0001 &&
      Math.abs(matrix.e - (box.width / 2 - (r.x + r.width / 2) * width * scale)) < 0.1 &&
      Math.abs(matrix.f - (box.height / 2 - (r.y + r.height / 2) * height * scale)) < 0.1
  }, { stop }, { timeout: 10000 })
  await page.locator('.page-image').evaluate(async (img) => {
    await (img as HTMLImageElement).decode()
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

export async function verifyGuided(browser: Browser, url: string, annotationFile: string, vp: NamedViewport): Promise<GuidedResult> {
  const doc = JSON.parse(fs.readFileSync(annotationFile, 'utf8')) as AnnotationDocument
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const result: GuidedResult = { bookId: doc.book_id, viewport: vp.name, checks: [], samples: [], p50Ms: 0, p95Ms: 0 }
  try {
    await page.goto(`${url}/#/book/${doc.book_id}`)
    await page.locator('.page-stage[data-page-status="loaded"]').waitFor()
    await importFile(page, annotationFile)
    assert.deepEqual(await exported(page), doc)
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: /^Download / }).click()
    const stream = await (await downloaded).createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), doc)
    result.checks.push('UI file import and downloaded export JSON-equal')
    for (const bad of ['{broken', JSON.stringify({ ...doc, book_id: 'wrong-book' }),
      JSON.stringify({ ...doc, source_sha256: '0'.repeat(64) }),
      JSON.stringify({ ...doc, pages: [{ ...doc.pages[0], page_id: 'unknown-page' }] }),
      JSON.stringify({ ...doc, schema_version: 999 })]) {
      await page.getByTestId('annotations-import').fill(bad)
      await page.getByRole('button', { name: 'Validate and import', exact: true }).click()
      await page.locator('.panel-error').waitFor()
      assert.deepEqual(await exported(page), doc)
    }
    result.checks.push('five invalid/mismatched imports rejected with edits intact')
    await closePanel(page)
    // Exercise editor gestures through the real DOM, then restore the imported document.
    const editing = doc.pages[0]
    await page.getByRole('button', { name: 'Edit regions', exact: true }).click()
    await page.getByLabel('Page being edited').selectOption(editing.page_id)
    await page.getByAltText(`Editing PDF page ${editing.pdf_page_number}`).waitFor()
    const canvas = await page.getByTestId('edit-overlay').boundingBox()
    assert(canvas)
    const drag = async (x: number, y: number, endX: number, endY: number) => {
      await page.mouse.move(canvas.x + x * canvas.width, canvas.y + y * canvas.height)
      await page.mouse.down()
      await page.mouse.move(canvas.x + endX * canvas.width, canvas.y + endY * canvas.height, { steps: 5 })
      await page.mouse.up()
    }
    await page.keyboard.down('Shift')
    await drag(.15, .15, .35, .35)
    await page.keyboard.up('Shift')
    await openPanel(page)
    const drawn = await exported(page)
    const editedPage = drawn.pages.find(p => p.page_id === editing.page_id)!
    assert.equal(editedPage.added_regions.length, editing.added_regions.length + 1)
    const added = editedPage.added_regions.at(-1)!
    assert(Math.abs(added.width - .2) < .001 && Math.abs(added.height - .2) < .001)
    await closePanel(page)
    await drag(.25, .25, 1.1, 1.1)
    await openPanel(page)
    const moved = (await exported(page)).pages.find(p => p.page_id === editing.page_id)!.added_regions.at(-1)!
    assert.equal(moved.width, added.width, 'Moving against the edge must not shrink a region')
    assert.equal(moved.height, added.height)
    assert(Math.abs(moved.x + moved.width - 1) < .001)
    await closePanel(page)
    const handle = await page.getByTestId('handle-nw').boundingBox()
    assert(handle)
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(canvas.x + .7 * canvas.width, canvas.y + .7 * canvas.height, { steps: 4 })
    await page.mouse.up()
    await page.getByLabel(`Move ${added.id} earlier`, { exact: true }).click()
    await openPanel(page)
    const resized = (await exported(page)).pages.find(p => p.page_id === editing.page_id)!
    assert(resized.added_regions.at(-1)!.width > moved.width)
    assert.equal(resized.order.at(-2), added.id)
    await closePanel(page)
    await page.getByLabel(`Delete ${added.id}`, { exact: true }).click()
    await openPanel(page)
    assert.deepEqual(await exported(page), doc)
    await closePanel(page)
    result.checks.push('UI draw, edge move without shrink, corner resize, reorder, delete restore original document')
    const manifest = await (await context.request.get(`${url}/packages/${doc.book_id}/manifest.json`)).json()
    for (const override of doc.pages) {
      const stops: Stop[] = override.order.map(id => {
        const r = [...override.added_regions, ...override.edited_regions].find(r => r.id === id)
        assert(r, 'Curated fixture must define each ordered region')
        return { pageId: override.page_id, regionId: id, rect: r }
      })
      const idx = manifest.page_order.indexOf(override.page_id)
      const previous: Stop | null = idx > 0 ? { pageId: manifest.page_order[idx - 1], regionId: null, rect: full } : null
      const next: Stop | null = idx < manifest.page_order.length - 1 ? { pageId: manifest.page_order[idx + 1], regionId: null, rect: full } : null
      await selectPage(page, override.page_id)
      await settled(page, stops[0])
      const step = async (target: Stop, direction: 'ArrowRight' | 'ArrowLeft') => {
        const t0 = performance.now()
        await page.keyboard.press(direction)
        await settled(page, target)
        result.samples.push({ pageId: target.pageId, regionId: target.regionId, direction, latencyMs: Math.round((performance.now() - t0) * 100) / 100 })
      }
      if (previous) { await step(previous, 'ArrowLeft'); await step(stops[0], 'ArrowRight') }
      for (const stop of stops.slice(1)) await step(stop, 'ArrowRight')
      if (next) {
        await step(next, 'ArrowRight')
        await page.reload()
        await page.locator('.reader[data-mode="guided"]').waitFor()
        await settled(page, next)
        await step(stops.at(-1)!, 'ArrowLeft')
      }
      for (const stop of stops.slice(0, -1).reverse()) await step(stop, 'ArrowLeft')
      result.checks.push(`page ${override.pdf_page_number}: all ${stops.length} regions forward/backward and adjacent fallback boundaries`)
      // Non-first panel progress must survive a genuine reload in the same context.
      await step(stops[1], 'ArrowRight')
      await page.reload()
      await page.locator('.reader[data-mode="guided"]').waitFor()
      await settled(page, stops[1])
      await openPanel(page); assert.deepEqual(await exported(page), doc); await closePanel(page)
      await page.setViewportSize({ width: vp.height, height: vp.width })
      await settled(page, stops[1])
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await settled(page, stops[1])
      // Exercise zoom and reset on a region, then retain it after resizing.
      await page.getByLabel('Zoom in', { exact: true }).click()
      await page.getByLabel('Fit page', { exact: true }).click()
      await settled(page, stops[1])
      await page.getByRole('button', { name: 'Full page', exact: true }).click()
      await settled(page, { pageId: override.page_id, regionId: null, rect: full })
      await page.getByRole('button', { name: 'Guided', exact: true }).click()
      await settled(page, stops[0])
      // Rapid physical key events without waiting for each animation to settle.
      for (let i = 1; i < stops.length; i++) await page.keyboard.press('ArrowRight')
      await settled(page, stops.at(-1)!)
      for (let i = 1; i < stops.length; i++) await page.keyboard.press('ArrowLeft')
      await settled(page, stops[0])
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
      // Sample every animation frame; reduced motion may have a commit boundary,
      // but must have no intermediate camera transforms after reaching the target.
      const frames = await page.evaluate(async () => {
        const values: string[] = []
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        for (let i = 0; i < 24; i++) {
          await new Promise(resolve => requestAnimationFrame(resolve))
          values.push((document.querySelector('.page-image') as HTMLElement).style.transform)
        }
        return values
      })
      await settled(page, stops[1])
      assert.equal(new Set(frames.slice(2)).size, 1, 'Reduced motion must not interpolate camera frames')
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      result.checks.push(`page ${override.pdf_page_number}: reload edits/progress, resize, zoom/reset, full-page, rapid navigation, reduced motion`)
    }
    assert.deepEqual(errors, [])
    const sorted = result.samples.map(s => s.latencyMs).sort((a,b) => a-b)
    result.p50Ms = sorted[Math.ceil(sorted.length * .5) - 1]
    result.p95Ms = sorted[Math.ceil(sorted.length * .95) - 1]
    return result
  } finally { await context.close() }
}

export async function runCuratedGuided(browser: Browser, url: string): Promise<GuidedResult[]> {
  const results: GuidedResult[] = []
  for (const name of fs.readdirSync(path.join(ROOT, 'corpus/curated-annotations')).sort()) {
    for (const vp of NAMED_VIEWPORTS) {
      const result = await verifyGuided(browser, url, path.join(ROOT, 'corpus/curated-annotations', name), vp)
      results.push(result)
      console.log(`Guided ${result.bookId} ${vp.name}: ${result.samples.length} steps, p50 ${result.p50Ms} / p95 ${result.p95Ms} ms`)
    }
  }
  return results
}

async function main() {
  const server = await startReaderServer(5197)
  const browser = await chromium.launch()
  try {
    const results = await runCuratedGuided(browser, server.url)
    fs.mkdirSync(path.join(ROOT, 'work/bench'), { recursive: true })
    fs.writeFileSync(path.join(ROOT, 'work/bench/guided.json'), JSON.stringify({ timestamp: new Date().toISOString(),
      environment: { ...getSystemInfo(browser), cacheState: 'fresh context per book/viewport; HTTP cache enabled' }, viewports: NAMED_VIEWPORTS,
      metric: 'Playwright keypress start to target region transform, decoded image and two animation frames; includes transition and driver overhead; nearest-rank percentiles', results }, null, 2) + '\n')
  } finally { await browser.close(); await server.stop() }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
