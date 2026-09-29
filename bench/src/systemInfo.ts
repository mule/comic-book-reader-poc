import os from 'node:os'
import type { Browser } from 'playwright'
import type { SystemInfo } from './types.js'

export function getSystemInfo(browser: Browser, network = 'localhost', cacheState = 'fresh-context-cache-disabled'): SystemInfo {
  const cpus = os.cpus()
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown'
  const totalRamGb = Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 100) / 100

  return {
    chromiumVersion: browser.version(),
    osPlatform: os.platform(),
    osRelease: os.release(),
    osArch: os.arch(),
    cpuModel,
    cpuCores: cpus.length,
    ramGb: totalRamGb,
    networkConditions: network,
    cacheState,
  }
}
