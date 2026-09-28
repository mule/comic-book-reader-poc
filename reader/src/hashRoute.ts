import { useEffect, useState } from 'react'

export type Route = { view: 'library' } | { view: 'book'; packageId: string }

const SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, '')
  const prefix = '/book/'
  if (clean.startsWith(prefix)) {
    const id = decodeURIComponent(clean.slice(prefix.length))
    if (SEGMENT.test(id)) return { view: 'book', packageId: id }
  }
  return { view: 'library' }
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(hash: string): void {
  window.location.hash = hash
}
