import { afterEach, describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Library } from './Library'

const indexPayload = {
  packages: [
    {
      id: 'book-a',
      title: 'Book A',
      selection: 'all',
      page_count: 10,
      source_sha256: '1'.repeat(64),
      manifest_ok: true,
    },
    {
      id: 'book-b',
      title: 'Book B',
      selection: 'sample',
      page_count: 20,
      source_sha256: null,
      manifest_ok: false,
    },
  ],
}



afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Library', () => {
  test('lists complete packages from the index', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/packages/index.json') {
          return new Response(JSON.stringify(indexPayload))
        }
        return new Response('not found', { status: 404 })
      }),
    )
    render(<Library />)
    expect(await screen.findByText('Book A')).toBeInTheDocument()
    expect(screen.getByText('Book B')).toBeInTheDocument()
    expect(screen.getByText(/manifest.json is unreadable/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Book A'))
    expect(window.location.hash).toBe('#/book/book-a')
  })

  test('shows a retryable error when the index cannot be loaded', async () => {
    let fail = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (fail) return new Response('boom', { status: 500 })
        return new Response(JSON.stringify(indexPayload))
      }),
    )
    render(<Library />)
    expect(await screen.findByText('Library unavailable')).toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Book A')).toBeInTheDocument())
  })

  test('explains when no complete packages exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ packages: [] }))),
    )
    render(<Library />)
    expect(await screen.findByText(/No complete packages found/)).toBeInTheDocument()
  })
})
