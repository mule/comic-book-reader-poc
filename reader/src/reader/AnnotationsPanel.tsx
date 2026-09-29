import { useRef, useState } from 'react'

export interface ImportOutcome {
  ok: boolean
  messages: string[]
}

interface AnnotationsPanelProps {
  open: boolean
  bookTitle: string
  fileName: string
  exportJson: string
  editedPageCount: number
  onValidateAndImport(text: string): ImportOutcome
  onClear(): void
  onClose(): void
}

export function AnnotationsPanel(props: AnnotationsPanelProps) {
  const { open, bookTitle, fileName, exportJson, editedPageCount, onValidateAndImport, onClear, onClose } = props
  const [importText, setImportText] = useState('')
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  if (!open) return null

  const runImport = (text: string) => {
    if (text.trim().length === 0) {
      setOutcome({ ok: false, messages: ['Paste or choose an annotation document first.'] })
      return
    }
    const result = onValidateAndImport(text)
    setOutcome(result)
    if (result.ok) setImportText('')
  }

  const download = () => {
    const blob = new Blob([exportJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="panel-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="annotations-panel" role="dialog" aria-modal="true" aria-label="Annotations">
        <header>
          <h2>Annotations — {bookTitle}</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close annotations panel">
            ✕
          </button>
        </header>

        <div className="panel-section">
          <h3>Local edits</h3>
          <p>
            {editedPageCount === 0
              ? 'No local edits yet.'
              : `${editedPageCount} page${editedPageCount === 1 ? '' : 's'} with manual overrides are saved in this browser.`}
          </p>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (window.confirm('Discard all local edits for this book? This cannot be undone.')) {
                onClear()
                setOutcome({ ok: true, messages: ['Local edits cleared.'] })
              }
            }}
            disabled={editedPageCount === 0}
          >
            Clear local edits
          </button>
        </div>

        <div className="panel-section">
          <h3>Export</h3>
          <p>
            Export produces an annotation document bound to this book and source revision
            (schema_version 1). Save it as <code>work/annotations/{fileName}</code> and run{' '}
            <code>comicpoc validate &lt;package&gt; --annotations work/annotations/{fileName}</code>.
            The static server never writes edits to disk.
          </p>
          <button type="button" onClick={download}>Download {fileName}</button>
          <textarea
            readOnly
            aria-label="Exported annotation document"
            data-testid="annotations-export"
            value={exportJson}
            rows={8}
            spellCheck={false}
          />
        </div>

        <div className="panel-section">
          <h3>Import</h3>
          <p>
            Imports are validated against <code>format/annotations.schema.json</code> plus book,
            source and page identity. A rejected import never touches your current edits.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            aria-label="Choose annotation file"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const text = await file.text()
              setImportText(text)
              runImport(text)
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
          />
          <textarea
            aria-label="Paste annotation document to import"
            data-testid="annotations-import"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            rows={6}
            spellCheck={false}
            placeholder='{"schema_version": 1, …}'
          />
          <button type="button" onClick={() => runImport(importText)}>Validate and import</button>
          {outcome ? (
            <div
              className={outcome.ok ? 'panel-ok' : 'panel-error'}
              role="status"
              data-testid="annotations-import-result"
            >
              {outcome.ok ? (
                <p>Imported. Local edits were replaced by the imported document.</p>
              ) : (
                <div>
                  <p>The import was rejected; your local edits are unchanged.</p>
                  <ul>
                    {outcome.messages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
