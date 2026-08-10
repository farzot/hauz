import { createRouter as createTanStackRouter } from '@tanstack/react-router'

import { ErrorState } from './components/error-state'
import { NotFound } from './components/not-found'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Otherwise an unknown URL renders TanStack Router's bare placeholder and a
    // failed route renders a raw stack trace.
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: ErrorState,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
