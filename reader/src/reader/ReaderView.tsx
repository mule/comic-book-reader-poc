import { useEffect, useRef, useState } from 'react'
import { loadBook, describeLoadError, type BookLoadResult, type ReaderBook } from '../manifest/load'
import { resolveStartPosition, savePosition } from '../reading/progress'
import { clampIndex, pageLabel } from '../reading/nav'
import { usePageImages } from '../reading/usePageImages'
import { navigate } from '../hashRoute'
import { PageStage } from './PageStage'
import { ThumbnailStrip } from './ThumbnailStrip'
import { ErrorPanel } from './ErrorPanel'

interface ReaderViewProps {
  packageId: string
}

export function ReaderView({ packageId }: ReaderViewProps) {
  const [result, setResult] = useState<BookLoadResult | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [thumbnailsOpen, setThumbnailsOpen] = useState(false)
  const zoomControls = useRef<{ zoomIn(): void; zoomOut(): void; resetZoom(): void } | null>(null)
  const bookRef = useRef<ReaderBook | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    loadBook(packageId).then((loaded) => {
      if (cancelled) return
      setResult(loaded)
      if (loaded.ok) {
        bookRef.current = loaded.book
        const start = resolveStartPosition(loaded.book)
        setCurrentIndex(start.index)
        setNotice(start.notice)
      } else {
        bookRef.current = null
      }
    })
    return () => {
      cancelled = true
      bookRef.current = null
    }
  }, [packageId, reloadToken])

  const book = result?.ok ? result.book : null
  const images = usePageImages(book ? book.pages : [], book ? currentIndex : -1)

  useEffect(() => {
    if (!book) return
    const page = book.pages[currentIndex]
    if (page) savePosition(book.id, book.sourceSha256, page.id)
  }, [book, currentIndex])

  if (result === null) {
    return (
      <main className="reader reader-loading">
        <p className="status">Loading package “{packageId}”…</p>
      </main>
    )
  }

  if (!result.ok) {
    return (
      <main className="reader reader-error">
        <ErrorPanel
          title="This book could not be opened"
          messages={describeLoadError(result.error)}
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      </main>
    )
  }

  const currentBook = result.book
  const count = currentBook.pages.length
  const safeIndex = clampIndex(currentIndex, count)
  const page = currentBook.pages[safeIndex]

  return (
    <main className="reader">
      <header className="reader-bar">
        <button type="button" className="ghost" onClick={() => navigate('#/')}>
          ← Library
        </button>
        <div className="reader-bar-center">
          <span className="reader-title">{currentBook.title}</span>
          <span className="reader-page-label">{pageLabel(page, count)}</span>
        </div>
        <div className="reader-bar-actions">
          <button type="button" className="ghost" onClick={() => zoomControls.current?.zoomOut()} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="ghost" onClick={() => zoomControls.current?.zoomIn()} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="ghost" onClick={() => zoomControls.current?.resetZoom()} aria-label="Fit page">
            Fit
          </button>
          <button
            type="button"
            className="ghost"
            aria-expanded={thumbnailsOpen}
            onClick={() => setThumbnailsOpen((open) => !open)}
          >
            Pages
          </button>
        </div>
      </header>
      {notice ? (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button type="button" className="ghost" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      <PageStage
        book={currentBook}
        page={page}
        images={images}
        onNext={() => setCurrentIndex(clampIndex(safeIndex + 1, count))}
        onPrev={() => setCurrentIndex(clampIndex(safeIndex - 1, count))}
        onFirst={() => setCurrentIndex(0)}
        onLast={() => setCurrentIndex(count - 1)}
        onEscape={() => {
          if (thumbnailsOpen) setThumbnailsOpen(false)
          else zoomControls.current?.resetZoom()
        }}
        registerZoomControls={(controls) => {
          zoomControls.current = controls
        }}
      />
      {thumbnailsOpen ? (
        <ThumbnailStrip
          book={currentBook}
          currentIndex={safeIndex}
          onSelect={(index) => setCurrentIndex(clampIndex(index, count))}
        />
      ) : null}
    </main>
  )
}
