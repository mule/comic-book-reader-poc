import { useState } from 'react'
import type { ReaderPage } from '../manifest/load'
import type { AnnotatedRegion } from '../annotations/session'

interface RegionListProps {
  book: ReaderPage[]
  page: ReaderPage
  regions: AnnotatedRegion[]
  tombstones: string[]
  selectedRegionId: string | null
  onSelect(id: string | null): void
  onDelete(id: string): void
  onRestore(id: string): void
  onReorder(id: string, targetIndex: number): void
  onSelectPage(pageId: string): void
}

export function RegionList(props: RegionListProps) {
  const {
    book,
    page,
    regions,
    tombstones,
    selectedRegionId,
    onSelect,
    onDelete,
    onRestore,
    onReorder,
    onSelectPage,
  } = props
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const changePage = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onSelectPage(event.target.value)
  }

  return (
    <aside className="region-list" data-testid="region-list" aria-label="Reading regions">
      <div className="region-list-header">
        <h3>Regions</h3>
        <select value={page.id} onChange={changePage} aria-label="Page being edited">
          {book.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              PDF page {candidate.pdfPageNumber}
            </option>
          ))}
        </select>
      </div>
      <p className="region-list-hint">
        Drag on the page to draw a region. Drag regions or their corners to move and resize.
        Alt+↑/↓ moves the selected region in the reading order.
      </p>
      {regions.length === 0 ? (
        <p className="region-list-empty">
          No regions yet. This page currently reads as one full-page panel.
        </p>
      ) : (
        <ol className="region-items">
          {regions.map((entry, index) => (
            <li
              key={entry.region.id}
              className={`region-item origin-${entry.origin}${
                entry.region.id === selectedRegionId ? ' selected' : ''
              }${index === dropIndex ? ' drop-target' : ''}`}
              draggable
              data-testid={`region-item-${entry.region.id}`}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => {
                event.preventDefault()
                setDropIndex(index)
              }}
              onDragEnd={() => {
                setDragIndex(null)
                setDropIndex(null)
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragIndex !== null && dragIndex !== index) {
                  const moved = regions[dragIndex]
                  if (moved) onReorder(moved.region.id, index)
                }
                setDragIndex(null)
                setDropIndex(null)
              }}
            >
              <button
                type="button"
                className="region-select"
                onClick={() => onSelect(entry.region.id)}
                aria-current={entry.region.id === selectedRegionId}
              >
                <span className="region-number">{index + 1}</span>
                <span className="region-id">{entry.region.id}</span>
                <span className={`region-origin origin-${entry.origin}`}>{entry.origin}</span>
              </button>
              <span className="region-item-actions">
                <button
                  type="button"
                  aria-label={`Move ${entry.region.id} earlier`}
                  disabled={index === 0}
                  onClick={() => onReorder(entry.region.id, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${entry.region.id} later`}
                  disabled={index === regions.length - 1}
                  onClick={() => onReorder(entry.region.id, index + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="danger"
                  aria-label={`Delete ${entry.region.id}`}
                  onClick={() => onDelete(entry.region.id)}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {tombstones.length > 0 ? (
        <div className="region-tombstones">
          <h4>Deleted suggestions</h4>
          <p className="region-list-hint">
            Tombstones persist: even if a later detector run omits these ids, they stay deleted.
          </p>
          <ul>
            {tombstones.map((id) => (
              <li key={id}>
                <code>{id}</code>
                <button type="button" onClick={() => onRestore(id)} aria-label={`Restore ${id}`}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  )
}
