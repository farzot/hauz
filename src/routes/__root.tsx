import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { ErrorState } from '../components/error-state'
import { getAuthState } from '../server/auth'
import appCss from '../styles.css?url'

/**
 * The session is resolved once per navigation, on the server, and handed to
 * every route through the router context.
 *
 * Doing it here rather than in each route means a page can never render before
 * its guard has run — during SSR included. That is what makes "logged-out users
 * cannot open the authenticated page" true of the first byte of HTML, not just
 * of what the browser does after hydration.
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
      // Declared explicitly so the browser stops probing /favicon.ico, which
      // would otherwise reach the router as an unknown route on every load.
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),

  // Set explicitly as well as on the router: `beforeLoad` above resolves the
  // session, so this route is the one that fails when Appwrite is unreachable.
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
