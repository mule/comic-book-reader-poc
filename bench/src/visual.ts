/** Local-only DEV fidelity captures; source comparisons are built by compare_visual.py. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { settled } from './guided.js'
import { startReaderServer } from './server.js'

const root = path.resolve('..')
const out = path.join(root, 'work/visual')
fs.mkdirSync(out, { recursive: true })
const server = await startReaderServer(5196)
const browser = await chromium.launch()
const records: object[] = []
try {
  for (const file of fs.readdirSync(path.join(root, 'corpus/curated-annotations')).sort()) {
    const doc = JSON.parse(fs.readFileSync(path.join(root, 'corpus/curated-annotations', file), 'utf8'))
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    await page.goto(`${server.url}/#/book/${doc.book_id}`)
    await page.locator('.page-stage[data-page-status="loaded"]').waitFor()
    await page.getByTestId('annotations-button').click()
    await page.getByLabel('Choose annotation file').setInputFiles(path.join(root, 'corpus/curated-annotations', file))
    await page.locator('.panel-ok').waitFor()
    await page.getByLabel('Close annotations panel').click()
    // One sequence per book, plus the Harbinger spread.
    const selected = doc.book_id.startsWith('harbinger') ? doc.pages : doc.pages.slice(0, 1)
    for (const annotation of selected) {
      await page.getByRole('button', { name: 'Edit regions', exact: true }).click()
      await page.getByLabel('Page being edited').selectOption(annotation.page_id)
      await page.getByRole('button', { name: 'Full page', exact: true }).click()
      const full = { x: 0, y: 0, width: 1, height: 1 }
      const capture = async (mode: string, regionId: string | null, rect: typeof full) => {
        await settled(page, { pageId: annotation.page_id, regionId, rect })
        const name = `${doc.book_id}-p${annotation.pdf_page_number}-${mode}`
        await page.screenshot({ path: path.join(out, `${name}-reader.png`) })
        await page.locator('.page-stage').screenshot({ path: path.join(out, `${name}-stage.png`) })
        const geometry = await page.locator('.page-image').evaluate(img => {
          const stage = img.parentElement!.getBoundingClientRect()
          const box = img.getBoundingClientRect()
          return { stage: { width: stage.width, height: stage.height }, image: { x: box.x-stage.x, y: box.y-stage.y, width: box.width, height: box.height } }
        })
        records.push({ bookId: doc.book_id, pdfPageNumber: annotation.pdf_page_number, mode, regionId, rect, name, geometry })
      }
      await capture('page', null, full)
      await page.getByRole('button', { name: 'Guided', exact: true }).click()
      for (const [i, id] of annotation.order.entries()) {
        const rect = annotation.added_regions.find((r: { id: string }) => r.id === id)
        assert(rect)
        if (i) await page.keyboard.press('ArrowRight')
        await capture(`panel-${i+1}`, id, rect)
      }
    }
    await context.close()
  }
  fs.writeFileSync(path.join(root, 'work/bench/visual.json'), JSON.stringify(records, null, 2)+'\n')
} finally { await browser.close(); await server.stop() }
