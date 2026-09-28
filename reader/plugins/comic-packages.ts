import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'

export const PACKAGES_BASE = '/packages'
export const DEFAULT_PACKAGES_DIR = '../work/packages'

const SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const FORBIDDEN_DIRNAMES = new Set(['test-data'])

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

export interface ComicPackagesOptions {
  rootDir?: string
}

export interface LibraryIndexEntry {
  id: string
  title: string
  selection: 'all' | 'sample' | null
  page_count: number | null
  source_sha256: string | null
  manifest_ok: boolean
}

interface ResolvedRoot {
  rootPath: string
  realPath: string
}

function resolveRoot(configured: string): ResolvedRoot {
  const rootPath = path.resolve(process.cwd(), configured)
  for (const candidate of [rootPath, path.resolve(rootPath)]) {
    const parts = candidate.split(path.sep)
    if (parts.some((part) => FORBIDDEN_DIRNAMES.has(part))) {
      throw new Error(
        `comic-packages plugin refuses to serve from ${candidate}: test-data is never exposed.`,
      )
    }
  }
  const realPath = fs.realpathSync(rootPath)
  if (realPath.split(path.sep).some((part) => FORBIDDEN_DIRNAMES.has(part))) {
    throw new Error(
      `comic-packages plugin refuses to serve from ${realPath} (resolves into test-data).`,
    )
  }
  const stat = fs.statSync(realPath)
  if (!stat.isDirectory()) throw new Error(`Packages directory ${realPath} is not a directory.`)
  return { rootPath, realPath }
}

function safeSegments(rest: string): string[] | null {
  if (rest.length === 0 || rest.includes('\\') || rest.includes('\0')) return null
  const segments = rest.split('/')
  if (segments.some((segment) => !SEGMENT.test(segment))) return null
  return segments
}

function allowedAssetPath(segments: string[]): boolean {
  if (segments.length === 2 && (segments[0] === 'pages' || segments[0] === 'thumbs')) return true
  if (segments.length === 1 && (segments[0] === 'manifest.json' || segments[0] === 'COMPLETE.json')) {
    return true
  }
  return false
}

function sendJson(res: ServerResponse, status: number, body: unknown, cacheControl: string): void {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', cacheControl)
  res.setHeader('Content-Length', Buffer.byteLength(text))
  res.end(text)
}

function sendFile(res: ServerResponse, filePath: string, cacheControl: string): void {
  const ext = path.extname(filePath).toLowerCase()
  const stat = fs.statSync(filePath)
  res.statusCode = 200
  res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream')
  res.setHeader('Content-Length', stat.size)
  res.setHeader('Cache-Control', cacheControl)
  fs.createReadStream(filePath)
    .on('error', () => {
      if (!res.headersSent) res.statusCode = 500
      res.end()
    })
    .pipe(res)
}

function readLibraryIndex(root: ResolvedRoot): LibraryIndexEntry[] {
  const entries: LibraryIndexEntry[] = []
  let dirents: fs.Dirent[]
  try {
    dirents = fs.readdirSync(root.realPath, { withFileTypes: true })
  } catch {
    return entries
  }
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue
    if (!SEGMENT.test(dirent.name)) continue
    const bookDir = path.join(root.realPath, dirent.name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(bookDir)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    const complete = path.join(bookDir, 'COMPLETE.json')
    const manifestPath = path.join(bookDir, 'manifest.json')
    if (!fs.existsSync(complete) || !fs.existsSync(manifestPath)) continue
    const entry: LibraryIndexEntry = {
      id: dirent.name,
      title: dirent.name,
      selection: null,
      page_count: null,
      source_sha256: null,
      manifest_ok: true,
    }
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        book?: { title?: unknown }
        source?: { sha256?: unknown; page_count?: unknown }
        selection?: unknown
      }
      if (typeof manifest.book?.title === 'string' && manifest.book.title.length > 0) {
        entry.title = manifest.book.title
      }
      if (manifest.selection === 'all' || manifest.selection === 'sample') {
        entry.selection = manifest.selection
      }
      if (typeof manifest.source?.sha256 === 'string') entry.source_sha256 = manifest.source.sha256
      if (typeof manifest.source?.page_count === 'number') {
        entry.page_count = manifest.source.page_count
      }
    } catch {
      entry.manifest_ok = false
    }
    entries.push(entry)
  }
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return entries
}

export function createComicPackagesMiddleware(options: ComicPackagesOptions = {}) {
  let root: ResolvedRoot | null = null

  const getRoot = (): ResolvedRoot => {
    if (!root) {
      const configured = options.rootDir ?? process.env.COMIC_PACKAGES_DIR ?? DEFAULT_PACKAGES_DIR
      root = resolveRoot(configured)
    }
    return root
  }

  const handleIndex = (res: ServerResponse): void => {
    sendJson(res, 200, { packages: readLibraryIndex(getRoot()) }, 'no-store')
  }

  const handleAsset = (res: ServerResponse, urlPath: string): boolean => {
    const rest = urlPath.slice(PACKAGES_BASE.length + 1)
    if (rest === 'index.json') {
      handleIndex(res)
      return true
    }
    const slash = rest.indexOf('/')
    if (slash <= 0) return false
    const bookId = rest.slice(0, slash)
    if (!SEGMENT.test(bookId)) return false
    const segments = safeSegments(rest.slice(slash + 1))
    if (!segments || !allowedAssetPath(segments)) return false
    if (segments.some((segment) => segment.toLowerCase().endsWith('.pdf'))) {
      sendJson(
        res,
        403,
        { error: 'PDF sources are never served by the reader.' },
        'no-store',
      )
      return true
    }
    let bookRoot: string
    try {
      bookRoot = fs.realpathSync(path.join(getRoot().realPath, bookId))
    } catch {
      sendJson(res, 404, { error: `Unknown package: ${bookId}` }, 'no-store')
      return true
    }
    const filePath = path.join(bookRoot, ...segments)
    let resolved: string
    try {
      resolved = fs.realpathSync(filePath)
    } catch {
      sendJson(res, 404, { error: `Asset not found: ${rest}` }, 'no-store')
      return true
    }
    if (resolved !== bookRoot && !resolved.startsWith(bookRoot + path.sep)) {
      sendJson(res, 403, { error: 'Path escapes the package.' }, 'no-store')
      return true
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(resolved)
    } catch {
      sendJson(res, 404, { error: `Asset not found: ${rest}` }, 'no-store')
      return true
    }
    if (!stat.isFile()) {
      sendJson(res, 404, { error: `Asset not found: ${rest}` }, 'no-store')
      return true
    }
    const cacheControl = segments[0] === 'pages' || segments[0] === 'thumbs'
      ? 'public, max-age=3600'
      : 'no-cache'
    sendFile(res, resolved, cacheControl)
    return true
  }

  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = req.url ?? ''
    const queryAt = url.indexOf('?')
    const urlPath = queryAt === -1 ? url : url.slice(0, queryAt)
    if (urlPath === PACKAGES_BASE || urlPath === PACKAGES_BASE + '/') {
      handleIndex(res)
      return
    }
    if (!urlPath.startsWith(PACKAGES_BASE + '/')) {
      next()
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Read-only package server.' }, 'no-store')
      return
    }
    if (handleAsset(res, urlPath)) return
    sendJson(res, 404, { error: `Not found: ${urlPath}` }, 'no-store')
  }
}

export function comicPackagesPlugin(options: ComicPackagesOptions = {}): Plugin {
  const middleware = createComicPackagesMiddleware(options)
  const install = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use((req, res, next) => {
      middleware(req, res, () => {
        next()
      })
    })
  }
  return {
    name: 'comic-packages',
    configureServer(server) {
      install(server)
    },
    configurePreviewServer(server) {
      install(server)
    },
  }
}
