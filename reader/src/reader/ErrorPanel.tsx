import type { ReactNode } from 'react'

interface ErrorPanelProps {
  title: string
  messages: string[]
  onRetry?: () => void
  extra?: ReactNode
}

export function ErrorPanel({ title, messages, onRetry, extra }: ErrorPanelProps) {
  return (
    <div className="error-panel" role="alert">
      <h2>{title}</h2>
      <ul>
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
      <div className="error-panel-actions">
        {onRetry ? (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        <button type="button" onClick={() => { window.location.hash = '#/' }}>
          Back to library
        </button>
        {extra}
      </div>
    </div>
  )
}
