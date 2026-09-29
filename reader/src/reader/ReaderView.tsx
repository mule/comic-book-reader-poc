import { useEffect, useMemo, useRef, useState } from 'react'
import { loadBook, describeLoadError, type BookLoadResult } from '../manifest/load'
import { resolveStartPosition, savePosition } from '../reading/progress'
import { clampIndex, pageLabel } from '../reading/nav'
import { usePageImages } from '../reading/usePageImages'
import { navigate } from '../hashRoute'
import { FULL_PAGE_RECT } from '../reading/camera'
import {
  buildGuidedSequence,
  stepForward,
  stepBackward,
  findStep,
  firstStepOfPage,
} from '../reading/sequence'
import {
  EMPTY_SESSION,
  addRegion,
  buildOverride,
  deleteRegion,
  effectiveRegionsWithOrigins,
  getPageSession,
  reorderRegion,
  restoreRegion,
  sessionFromDocument,
  toDocument,
  updateRegionRect,
  type EditSession,
} from '../annotations/session'
import { clearAnnotations, loadAnnotations, saveAnnotations } from '../annotations/store'
import { describeAnnotationError, parseAnnotationJson, validateAnnotationDocument } from '../annotations/validate'
import { PageStage } from './PageStage'
import { EditStage } from './EditStage'
import { AnnotationsPanel, type ImportOutcome } from './AnnotationsPanel'
import { ThumbnailStrip } from './ThumbnailStrip'
import { ErrorPanel } from './ErrorPanel'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

type ReaderMode = 'full' | 'guided' | 'edit'

interface GuidedKey {
  pageId: string
  regionId: string | null
}

interface ReaderViewProps {
  packageId: string
}

export function ReaderView({ packageId }: ReaderViewProps) {
  const [result, setResult] = useState<BookLoadResult | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [thumbnailsOpen, setThumbnailsOpen] = useState(false)
  const [mode, setMode] = useState<ReaderMode>('full')
  const [guidedKey, setGuidedKey] = useState<GuidedKey | null>(null)
  const [session, setSession] = useState<EditSession>(EMPTY_SESSION)
  const [sessionReady, setSessionReady] = useState(false)
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const reducedMotion = usePrefersReducedMotion()
  const zoomControls = useRef<{ zoomIn(): void; zoomOut(): void; resetZoom(): void } | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    setSessionReady(false)
    setSession(EMPTY_SESSION)
    setGuidedKey(null)
    setMode('full')
    setSelectedRegionId(null)
    loadBook(packageId).then((loaded) => {
      if (cancelled) return
      setResult(loaded)
      if (!loaded.ok) return
      const book = loaded.book
      const stored = loadAnnotations(book.id, book.sourceSha256)
      const restoredSession = sessionFromDocument(stored.entry?.document ?? null)
      setSession(restoredSession)
      setSessionReady(true)
      const start = resolveStartPosition(book)
      setCurrentIndex(start.index)
      let startNotice = start.notice
      if (stored.warning && startNotice === null) startNotice = stored.warning
      if (start.status === 'restored' && start.regionId !== null) {
        const steps = buildGuidedSequence(book, (page) => {
          const pageSession = restoredSession.pages.get(page.id)
          return pageSession ? buildOverride(page, pageSession) : null
        })
        const stepIndex = findStep(steps, start.pageId, start.regionId)
        if (stepIndex !== null) {
          setMode('guided')
          setGuidedKey({ pageId: start.pageId, regionId: start.regionId })
        } else if (startNotice === null) {
          startNotice =
            `The saved reading position refers to panel ${start.regionId}, which no longer ` +
            'exists on this page. Starting from the page in full-page mode.'
        }
      }
      setNotice(startNotice)
    })
    return () => {
      cancelled = true
    }
  }, [packageId, reloadToken])

  const book = result?.ok ? result.book : null

  const steps = useMemo(() => {
    if (!book) return []
    return buildGuidedSequence(book, (page) => {
      const pageSession = session.pages.get(page.id)
      return pageSession ? buildOverride(page, pageSession) : null
    })
  }, [book, session])

  const guidedIndex = useMemo(() => {
    if (!guidedKey || steps.length === 0) return 0
    return findStep(steps, guidedKey.pageId, guidedKey.regionId) ?? firstStepOfPage(steps, guidedKey.pageId) ?? 0
  }, [guidedKey, steps])
  const guidedStep = steps[guidedIndex] ?? null

  const count = book ? book.pages.length : 0
  const safeIndex = count > 0 ? clampIndex(currentIndex, count) : 0
  const page = book ? book.pages[safeIndex] : null

  const images = usePageImages(book ? book.pages : [], book ? safeIndex : -1)

  // Panel-level reading progress: page id plus region id (or null for the
  // full-page fallback and full-page mode), keyed by (book, source revision).
  useEffect(() => {
    if (!book || !page) return
    if (mode === 'guided' && guidedStep) {
      savePosition(book.id, book.sourceSha256, guidedStep.pageId, guidedStep.regionId)
    } else {
      savePosition(book.id, book.sourceSha256, page.id, null)
    }
  }, [book, page, mode, guidedStep?.pageId, guidedStep?.regionId])

  // Local persistence of manual annotations, separate from reading positions.
  useEffect(() => {
    if (!book || !sessionReady) return
    const document = toDocument(session, book)
    if (document.pages.length > 0) {
      saveAnnotations(book.id, book.sourceSha256, document)
    } else {
      clearAnnotations(book.id, book.sourceSha256)
    }
  }, [book, session, sessionReady])

  const goToStep = (index: number) => {
    const step = steps[index]
    if (!step) return
    setGuidedKey({ pageId: step.pageId, regionId: step.regionId })
    setCurrentIndex(step.pageIndex)
  }

  const enterMode = (next: ReaderMode) => {
    if (next === 'guided' && book) {
      const target = book.pages[safeIndex]
      if (target) {
        const stepIndex = firstStepOfPage(steps, target.id) ?? 0
        goToStep(stepIndex)
      }
    }
    setMode(next)
    if (next !== 'edit') setSelectedRegionId(null)
  }

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
  const currentPage = currentBook.pages[safeIndex]
  const guidedPanelLabel =
    mode === 'guided' && guidedStep
      ? guidedStep.regionId === null
        ? `Full page · step ${guidedIndex + 1} / ${steps.length}`
        : `Panel ${guidedIndex + 1} / ${steps.length}`
      : null

  const handleNext =
    mode === 'guided'
      ? () => goToStep(stepForward(steps, guidedIndex))
      : () => setCurrentIndex(clampIndex(safeIndex + 1, count))
  const handlePrev =
    mode === 'guided'
      ? () => goToStep(stepBackward(steps, guidedIndex))
      : () => setCurrentIndex(clampIndex(safeIndex - 1, count))
  const handleFirst = mode === 'guided' ? () => goToStep(0) : () => setCurrentIndex(0)
  const handleLast =
    mode === 'guided' ? () => goToStep(steps.length - 1) : () => setCurrentIndex(count - 1)

  const pageSession = getPageSession(session, currentPage)
  const editRegions = mode === 'edit' ? effectiveRegionsWithOrigins(currentPage, pageSession) : []

  const exportDocument = toDocument(session, currentBook)
  const exportJson = JSON.stringify(exportDocument, null, 2)

  const validateAndImport = (text: string): ImportOutcome => {
    const parsed = parseAnnotationJson(text)
    if (!parsed.ok) return { ok: false, messages: [parsed.message] }
    const validation = validateAnnotationDocument(parsed.value, currentBook.manifest)
    if (!validation.ok) {
      return { ok: false, messages: describeAnnotationError(validation.error) }
    }
    setSession(sessionFromDocument(validation.value))
    setSelectedRegionId(null)
    return { ok: true, messages: [] }
  }

  return (
    <main className="reader" data-mode={mode}>
      <header className="reader-bar">
        <button type="button" className="ghost" onClick={() => navigate('#/')}>
          ← Library
        </button>
        <div className="reader-bar-center">
          <span className="reader-title">{currentBook.title}</span>
          <span className="reader-page-label">
            {pageLabel(currentPage, count)}
            {guidedPanelLabel ? ` · ${guidedPanelLabel}` : ''}
          </span>
        </div>
        <div className="reader-bar-actions">
          <div className="mode-switch" role="group" aria-label="Reading mode">
            <button
              type="button"
              aria-pressed={mode === 'full'}
              className={mode === 'full' ? 'active' : ''}
              onClick={() => enterMode('full')}
            >
              Full page
            </button>
            <button
              type="button"
              aria-pressed={mode === 'guided'}
              className={mode === 'guided' ? 'active' : ''}
              onClick={() => enterMode('guided')}
            >
              Guided
            </button>
            <button
              type="button"
              aria-pressed={mode === 'edit'}
              className={mode === 'edit' ? 'active' : ''}
              onClick={() => enterMode('edit')}
            >
              Edit regions
            </button>
          </div>
          {mode !== 'edit' ? (
            <>
              <button type="button" className="ghost" onClick={() => zoomControls.current?.zoomOut()} aria-label="Zoom out">
                −
              </button>
              <button type="button" className="ghost" onClick={() => zoomControls.current?.zoomIn()} aria-label="Zoom in">
                +
              </button>
              <button type="button" className="ghost" onClick={() => zoomControls.current?.resetZoom()} aria-label="Fit page">
                Fit
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="ghost"
            onClick={() => setPanelOpen(true)}
            data-testid="annotations-button"
          >
            Annotations{exportDocument.pages.length > 0 ? ` (${exportDocument.pages.length})` : ''}
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
      {mode === 'edit' ? (
        <EditStage
          book={currentBook.pages}
          page={currentPage}
          imageUrl={
            images.entries.get(currentPage.id)?.status === 'loaded'
              ? images.entries.get(currentPage.id)?.url ?? null
              : null
          }
          imageStatus={images.entries.get(currentPage.id)?.status ?? 'loading'}
          regions={editRegions}
          tombstones={pageSession?.deleted ?? []}
          selectedRegionId={selectedRegionId}
          onSelect={setSelectedRegionId}
          onAdd={(rect) => {
            const added = addRegion(session, currentPage, rect)
            setSession(added.session)
            setSelectedRegionId(added.regionId)
          }}
          onUpdate={(id, rect) => setSession(updateRegionRect(session, currentPage, id, rect))
          }
          onDelete={(id) => {
            setSession(deleteRegion(session, currentPage, id))
            if (selectedRegionId === id) setSelectedRegionId(null)
          }}
          onRestore={(id) => setSession(restoreRegion(session, currentPage, id))}
          onReorder={(id, targetIndex) => setSession(reorderRegion(session, currentPage, id, targetIndex))}
          onSelectPage={(pageId: string) => {
            const target = currentBook.byId.get(pageId)
            if (target) {
              setCurrentIndex(target.orderIndex)
              setSelectedRegionId(null)
            }
          }}
        />
      ) : (
        <PageStage
          book={currentBook}
          page={currentPage}
          images={images}
          focus={mode === 'guided' && guidedStep ? guidedStep.rect : FULL_PAGE_RECT}
          cameraKey={
            mode === 'guided' && guidedStep
              ? `${guidedStep.pageId}#${guidedStep.regionId ?? 'full'}`
              : currentPage.id
          }
          reducedMotion={reducedMotion}
          showFocusOutline={mode === 'guided' && guidedStep?.regionId !== null && guidedStep !== null}
          onNext={handleNext}
          onPrev={handlePrev}
          onFirst={handleFirst}
          onLast={handleLast}
          onEscape={() => {
            if (thumbnailsOpen) setThumbnailsOpen(false)
            else zoomControls.current?.resetZoom()
          }}
          registerZoomControls={(controls) => {
            zoomControls.current = controls
          }}
        />
      )}
      {thumbnailsOpen ? (
        <ThumbnailStrip
          book={currentBook}
          currentIndex={safeIndex}
          onSelect={(index) => {
            setCurrentIndex(index)
            if (mode === 'guided') {
              const target = currentBook.pages[index]
              if (target) goToStep(firstStepOfPage(steps, target.id) ?? 0)
            }
          }}
        />
      ) : null}
      <AnnotationsPanel
        open={panelOpen}
        bookTitle={currentBook.title}
        fileName={`${currentBook.id}.annotations.json`}
        exportJson={exportJson}
        editedPageCount={exportDocument.pages.length}
        onValidateAndImport={validateAndImport}
        onClear={() => setSession(EMPTY_SESSION)}
        onClose={() => setPanelOpen(false)}
      />
    </main>
  )
}
