import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import { verifyGuided } from './guided.js'
import { measureColdLoad } from './coldLoad.js'
import { startReaderServer } from './server.js'
import { NAMED_VIEWPORTS } from './viewports.js'
import { measureWarmNavigation } from './warmNav.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const SYNTHETIC_DIR = path.resolve(REPO_ROOT, 'work/synthetic-packages')
const SMOKE_BOOK_ID = 'synthetic-smoke-book'

async function ensureSyntheticPackage(): Promise<void> {
  const completePath = path.join(SYNTHETIC_DIR, SMOKE_BOOK_ID, 'COMPLETE.json')
  if (fs.existsSync(completePath)) return

  console.log('Generating synthetic smoke package...')
  try {
    execSync('uv run python scripts/create_synthetic_smoke_package.py', {
      cwd: path.resolve(REPO_ROOT, 'tools'),
      stdio: 'inherit',
    })
  } catch {
    execSync('python3 tools/scripts/create_synthetic_smoke_package.py', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    })
  }
  if (!fs.existsSync(completePath)) {
    throw new Error(`Failed to generate synthetic package at ${path.join(SYNTHETIC_DIR, SMOKE_BOOK_ID)}`)
  }
}

async function runSmoke(): Promise<void> {
  console.log('=== Running Bench Smoke Test (Synthetic Package) ===')
  await ensureSyntheticPackage()

  const port = 5222
  console.log(`Starting reader preview on port ${port} with synthetic packages...`)
  const server = await startReaderServer(port, SYNTHETIC_DIR)

  const browser = await chromium.launch({ headless: true })

  try {
    const desktopVp = NAMED_VIEWPORTS[0]

    // 1. Cold first-page load
    console.log('Measuring cold load on synthetic book...')
    const cold = await measureColdLoad(browser, server.url, SMOKE_BOOK_ID, desktopVp)
    console.log(`  -> First page decoded & visible: ${cold.firstPageDecodeMs} ms`)
    if (cold.firstPageDecodeMs <= 0) {
      throw new Error(`Invalid cold load decode time: ${cold.firstPageDecodeMs} ms`)
    }

    // 2. Warm navigation across pages (2 turns for a 3-page book)
    console.log('Measuring warm turns (2 turns)...')
    const warm = await measureWarmNavigation(browser, server.url, SMOKE_BOOK_ID, desktopVp, 2)
    console.log(`  -> p50: ${warm.p50Ms} ms | p95: ${warm.p95Ms} ms | mean: ${warm.meanMs} ms`)
    if (warm.turns.length !== 2) {
      throw new Error(`Expected 2 warm turns, got ${warm.turns.length}`)
    }

    // 3. Network audit: zero PDF and zero test-data requests
    const context = await browser.newContext()
    const forbiddenRequests: string[] = []
    const page = await context.newPage()
    page.on('request', (req) => {
      const u = req.url().toLowerCase()
      if (u.endsWith('.pdf') || u.includes('.pdf?') || u.includes('test-data')) {
        forbiddenRequests.push(req.url())
      }
    })

    await page.goto(`${server.url}/#/book/${SMOKE_BOOK_ID}`, { waitUntil: 'networkidle' })
    await context.close()

    if (forbiddenRequests.length > 0) {
      throw new Error(`Observed forbidden requests: ${forbiddenRequests.join(', ')}`)
    }
    console.log('  -> Zero .pdf or test-data requests confirmed.')

    // 4. Offline behavior check
    console.log('Testing offline cached vs unvisited handling...')
    const offlineContext = await browser.newContext()
    const offPage = await offlineContext.newPage()
    await offPage.goto(`${server.url}/#/book/${SMOKE_BOOK_ID}`, { waitUntil: 'commit' })
    await offPage.waitForSelector('.page-stage[data-page-status="loaded"] img.page-image', { state: 'visible' })

    // Visit page 2
    await offPage.keyboard.press('ArrowRight')
    await offPage.waitForFunction(() => {
      const label = (document.querySelector('.reader-page-label')?.textContent ?? '').toLowerCase()
      return label.includes('page 2')
    })
    await offPage.waitForSelector('.page-stage[data-page-status="loaded"] img.page-image', { state: 'visible' })

    // Set offline
    await offlineContext.setOffline(true)

    // Navigate back to cached page 1
    await offPage.keyboard.press('ArrowLeft')
    await offPage.waitForFunction(() => {
      const label = (document.querySelector('.reader-page-label')?.textContent ?? '').toLowerCase()
      return label.includes('page 1')
    })
    await offPage.waitForTimeout(200)

    const cachedStatus = await offPage.evaluate(() => {
      const stage = document.querySelector('.page-stage')
      const img = document.querySelector('img.page-image') as HTMLImageElement | null
      return {
        status: stage?.getAttribute('data-page-status'),
        imgNaturalWidth: img?.naturalWidth ?? 0,
      }
    })

    if (cachedStatus.status !== 'loaded' || cachedStatus.imgNaturalWidth <= 0) {
      throw new Error(`Cached page failed to load offline: ${JSON.stringify(cachedStatus)}`)
    }
    console.log(`  -> Cached page restored offline with naturalWidth=${cachedStatus.imgNaturalWidth}px`)

    await offlineContext.close()
    const manifest = JSON.parse(fs.readFileSync(path.join(SYNTHETIC_DIR, SMOKE_BOOK_ID, 'manifest.json'), 'utf8'))
    const annotationFile = path.join(SYNTHETIC_DIR, 'guided-smoke.json')
    fs.writeFileSync(annotationFile, JSON.stringify({
      schema_version: 1, book_id: SMOKE_BOOK_ID, source_sha256: manifest.source.sha256,
      pages: [{ page_id: manifest.pages[1].id, pdf_page_number: 2,
        added_regions: [
          { id: 'upper', x: 0, y: 0, width: 1, height: 0.4 },
          { id: 'lower', x: 0.1, y: 0.6, width: 0.8, height: 0.4 },
        ], edited_regions: [], deleted_region_ids: [], order: ['upper', 'lower'] }],
    }))
    const guided = await verifyGuided(browser, server.url, annotationFile, desktopVp)
    fs.mkdirSync(path.join(REPO_ROOT, 'work/bench'), { recursive: true })
    fs.writeFileSync(path.join(REPO_ROOT, 'work/bench/guided-smoke.json'), JSON.stringify(guided, null, 2) + '\n')
    console.log(`Guided smoke: ${guided.checks.length} checks; p50 ${guided.p50Ms} / p95 ${guided.p95Ms} ms`)
    console.log('=== Bench Smoke Test Passed Successfully ===')
  } finally {
    await browser.close()
    await server.stop()
  }
}

runSmoke().catch((err) => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})
