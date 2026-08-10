import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { ErrorState } from '../components/error-state'
import { getAuthState } from '../../server/auth/actions'
import appCss from '../styles.css?url'

/**
 * The session is resolved once per navigation, on the server, and handed to
 * every route through the context. Doing it here instead of per route means a
 * page cannot render before its guard has run, SSR included, so "logged-out
 * users cannot open the authenticated page" holds for the first byte of HTML.
 */
export const Route = createRootRoute({
  beforeLoad: async () => ({ auth: await getAuthState() }),

  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'HAUZ' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      // Explicit, so the browser stops probing /favicon.ico and hitting the
      // router with an unknown route on every load.
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),

  // Also set on the router, but this is the route that fails when Appwrite is
  // unreachable, since beforeLoad above is what talks to it.
  errorComponent: ErrorState,

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-slate-50">
        {children}
        {import.meta.env.DEV ? (
          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  )
}
