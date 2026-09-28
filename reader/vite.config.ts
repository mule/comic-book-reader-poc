/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { comicPackagesPlugin } from './plugins/comic-packages'

export default defineConfig({
  plugins: [comicPackagesPlugin()],
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'plugins/**/*.test.ts'],
  },
})
