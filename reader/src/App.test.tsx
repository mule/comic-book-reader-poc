import { expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from './App'

test('renders the foundation page', () => {
  expect(renderToStaticMarkup(<App />)).toContain('<h1>Comic POC</h1>')
})
