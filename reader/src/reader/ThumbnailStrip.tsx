import { useEffect, useRef } from 'react'
import type { ReaderBook } from '../manifest/load'

interface ThumbnailStripProps {
  book: ReaderBook
  currentIndex: number
  onSelect(index: number): void
}

export function ThumbnailStrip({ book, currentIndex, onSelect }: ThumbnailStripProps) {
  const currentRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' })
  }, [currentIndex])

  return (
    <div className="thumb-strip" role="region" aria-label="Page thumbnails">
      {book.pages.map((page) => (
        <button
          key={page.id}
          type="button"
          ref={page.orderIndex === currentIndex ? currentRef : undefined}
          className={`thumb-item${page.orderIndex === currentIndex ? ' current' : ''}`}
          onClick={() => onSelect(page.orderIndex)}
          aria-label={`Go to PDF page ${page.pdfPageNumber}`}
          aria-current={page.orderIndex === currentIndex}
        >
          <img src={page.thumbUrl} alt="" loading="lazy" decoding="async" draggable={false} />
          <span className="thumb-label">{page.pdfPageNumber}</span>
        </button>
      ))}
    </div>
  )
}
