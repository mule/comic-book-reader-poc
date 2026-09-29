import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')
const READER_DIR = path.resolve(REPO_ROOT, 'reader')

export interface ServerInstance {
  url: string
  port: number
  stop: () => Promise<void>
}

export async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${url}/packages/index.json`)
      if (resp.ok) return
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Timed out waiting for reader preview server at ${url}`)
}

export async function startReaderServer(
  port = 5199,
  packagesDir?: string,
): Promise<ServerInstance> {
  const resolvedPackagesDir = packagesDir
    ? path.resolve(packagesDir)
    : path.resolve(REPO_ROOT, 'work/packages')

  const proc: ChildProcess = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--port', String(port), '--host', '127.0.0.1', '--strictPort'],
    {
      cwd: READER_DIR,
      env: {
        ...process.env,
        COMIC_PACKAGES_DIR: resolvedPackagesDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let stderr = ''
  proc.stderr?.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  const url = `http://127.0.0.1:${port}`

  try {
    await waitForServer(url, 15000)
  } catch (err) {
    proc.kill('SIGTERM')
    throw new Error(`Failed to start reader server on port ${port}: ${err}\nStderr: ${stderr}`)
  }

  const stop = async (): Promise<void> => {
    if (!proc.killed) {
      proc.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve())
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL')
          resolve()
        }, 3000)
      })
    }
  }

  return { url, port, stop }
}
