import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App'

test('renders the library at the root route', async () => {
  window.location.hash = ''
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ packages: [] }))),
  )
  render(<App />)
  expect(await screen.findByText('Comic library')).toBeInTheDocument()
  vi.unstubAllGlobals()
})
