// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { AddressInfo } from 'node:net'
import { createComicPackagesMiddleware } from './comic-packages'

let root: string
let server: http.Server
let baseUrl: string

const BOOK = 'book-a'
const OTHER = 'book-b'

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'comic-packages-test-'))
  const bookDir = path.join(root, BOOK)
  fs.mkdirSync(path.join(bookDir, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(bookDir, 'thumbs'), { recursive: true })
  fs.writeFileSync(path.join(bookDir, 'manifest.json'), '{"schema_version":1}')
  fs.writeFileSync(path.join(bookDir, 'COMPLETE.json'), '{"sha256":"x"}')
  fs.writeFileSync(path.join(bookDir, 'pages', 'p1.webp'), 'webp-bytes')
  const incomplete = path.join(root, OTHER)
  fs.mkdirSync(path.join(incomplete, 'pages'), { recursive: true })
  fs.writeFileSync(path.join(incomplete, 'manifest.json'), '{"schema_version":1}')

  const middleware = createComicPackagesMiddleware({ rootDir: root })
  server = http.createServer((req, res) => {
    try {
      middleware(req, res, () => {
        res.statusCode = 404
        res.end('unhandled')
      })
    } catch (error) {
      res.statusCode = 500
      res.end(String(error))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(root, { recursive: true, force: true })
})

describe('comic packages middleware', () => {
  test('index.json lists only complete packages', async () => {
    const response = await fetch(`${baseUrl}/packages/index.json`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as { packages: Array<{ id: string }> }
    expect(body.packages.map((entry) => entry.id)).toEqual([BOOK])
  })

  test('serves manifest and page assets read-only', async () => {
    const manifest = await fetch(`${baseUrl}/packages/${BOOK}/manifest.json`)
    expect(manifest.status).toBe(200)
    expect(manifest.headers.get('content-type')).toContain('application/json')
    const page = await fetch(`${baseUrl}/packages/${BOOK}/pages/p1.webp`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('image/webp')
    expect(await page.text()).toBe('webp-bytes')
  })

  test('refuses PDF requests with 403', async () => {
    const response = await fetch(`${baseUrl}/packages/${BOOK}/pages/source.pdf`)
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('PDF')
  })

  test('rejects write attempts with 405', async () => {
    const response = await fetch(`${baseUrl}/packages/${BOOK}/manifest.json`, {
      method: 'DELETE',
    })
    expect(response.status).toBe(405)
  })

  test('returns 404 for missing assets and unknown packages', async () => {
    const missing = await fetch(`${baseUrl}/packages/${BOOK}/pages/nope.webp`)
    expect(missing.status).toBe(404)
    const unknown = await fetch(`${baseUrl}/packages/ghost/manifest.json`)
    expect(unknown.status).toBe(404)
  })

  test('blocks traversal attempts', async () => {
    const traversal = await fetch(`${baseUrl}/packages/${BOOK}/pages/..%2f..%2fsecret.webp`)
    expect(traversal.status).toBe(404)
    const escaped = await fetch(`${baseUrl}/packages/../etc/passwd`)
    expect([404, 403]).toContain(escaped.status)
  })

  test('blocks symlink escapes out of the package', async () => {
    const outside = path.join(root, 'outside.webp')
    fs.writeFileSync(outside, 'secret')
    const linkPath = path.join(root, BOOK, 'pages', 'escape.webp')
    fs.symlinkSync(outside, linkPath)
    try {
      const response = await fetch(`${baseUrl}/packages/${BOOK}/pages/escape.webp`)
      expect(response.status).toBe(403)
    } finally {
      fs.rmSync(linkPath)
      fs.rmSync(outside)
    }
  })

  test('refuses to serve from test-data', async () => {
    const testRoot = fs.realpathSync(root)
    const testDataDir = path.join(root, 'test-data', 'pkg')
    fs.mkdirSync(testDataDir, { recursive: true })
    fs.writeFileSync(path.join(testDataDir, 'manifest.json'), '{}')
    fs.writeFileSync(path.join(testDataDir, 'COMPLETE.json'), '{}')
    const bad = createComicPackagesMiddleware({
      rootDir: path.join(testRoot, 'test-data'),
    })
    const badServer = http.createServer((req, res) => {
      try {
        bad(req, res, () => {
          res.statusCode = 404
          res.end()
        })
      } catch (error) {
        res.statusCode = 500
        res.end(String(error))
      }
    })
    await new Promise<void>((resolve) => badServer.listen(0, '127.0.0.1', resolve))
    const port = (badServer.address() as AddressInfo).port
    try {
      const response = await fetch(`http://127.0.0.1:${port}/packages/index.json`)
      expect(response.status).toBe(500)
      expect(await response.text()).toContain('test-data')
    } finally {
      await new Promise<void>((resolve) => badServer.close(() => resolve()))
    }
  })
})
