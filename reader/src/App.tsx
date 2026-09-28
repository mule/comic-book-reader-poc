import { useHashRoute } from './hashRoute'
import { Library } from './library/Library'
import { ReaderView } from './reader/ReaderView'

export const title = 'Comic POC'

export function App() {
  const route = useHashRoute()
  if (route.view === 'book') {
    return <ReaderView key={route.packageId} packageId={route.packageId} />
  }
  return <Library />
}
