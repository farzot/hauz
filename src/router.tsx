import { createRouter as createTanStackRouter } from '@tanstack/react-router'

import { NotFound } from './components/not-found'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Without this, an unknown URL renders TanStack Router's bare "Not Found"
    // placeholder — and logs a warning on every stray request the browser makes.
    defaultNotFoundComponent: NotFound,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
