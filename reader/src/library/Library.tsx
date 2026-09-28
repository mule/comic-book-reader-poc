import { useEffect, useRef, useState } from 'react'
import { fetchLibraryIndex, loadCover, type LibraryEntry } from '../libraryApi'
import { navigate } from '../hashRoute'
import { ErrorPanel } from '../reader/ErrorPanel'

function LazyCover({ packageId }: { packageId: string }) {
  const holder = useRef<HTMLDivElement | null>(null)
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)

  useEffect(() => {
    const element = holder.current
    if (!element) return
    let cancelled = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        loadCover(packageId)
          .then((info) => {
            if (!cancelled) setThumbUrl(info.thumbUrl)
          })
          .catch(() => {
            if (!cancelled) setThumbUrl(null)
          })
      },
      { rootMargin: '200px' },
    )
    observer.observe(element)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [packageId])

  return (
    <div className="cover" ref={holder}>
      {thumbUrl ? (
        <img src={thumbUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="cover-placeholder" aria-hidden="true" />
      )}
    </div>
  )
}

function BookCard({ entry }: { entry: LibraryEntry }) {
  return (
    <button
      className="book-card"
      onClick={() => navigate(`#/book/${encodeURIComponent(entry.id)}`)}
    >
      <LazyCover packageId={entry.id} />
      <div className="book-card-body">
        <div className="book-card-title">{entry.title}</div>
        <div className="book-card-meta">
          {entry.page_count !== null ? `${entry.page_count} pages` : 'unknown page count'}
          {entry.selection ? ` · ${entry.selection}` : ''}
          {entry.source_sha256 ? ` · sha256 ${entry.source_sha256.slice(0, 12)}…` : ''}
        </div>
        {!entry.manifest_ok ? (
          <div className="book-card-warning">manifest.json is unreadable</div>
        ) : null}
      </div>
    </button>
  )
}

export function Library() {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; entries: LibraryEntry[] }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    fetchLibraryIndex()
      .then((entries) => {
        if (!cancelled) setState({ status: 'ready', entries })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="library">
      <header className="library-header">
        <h1>Comic library</h1>
        <p className="library-sub">
          Complete packages served read-only from the local packages directory.
        </p>
      </header>
      {state.status === 'loading' ? <p className="status">Loading library…</p> : null}
      {state.status === 'error' ? (
        <ErrorPanel
          title="Library unavailable"
          messages={[state.message]}
          onRetry={() => {
            setState({ status: 'loading' })
            fetchLibraryIndex()
              .then((entries) => setState({ status: 'ready', entries }))
              .catch((error: unknown) => setState({ status: 'error', message: String(error) }))
          }}
        />
      ) : null}
      {state.status === 'ready' && state.entries.length === 0 ? (
        <p className="status">
          No complete packages found. Import books with <code>comicpoc import</code> first.
        </p>
      ) : null}
      {state.status === 'ready' && state.entries.length > 0 ? (
        <div className="library-grid">
          {state.entries.map((entry) => (
            <BookCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : null}
    </main>
  )
}
