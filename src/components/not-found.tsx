import { Link } from '@tanstack/react-router'

import { Alert, Card, Page } from './ui'

/**
 * Shown for any URL the router does not recognise.
 *
 * It links to `/` rather than to a specific page, because `/` redirects to
 * whichever step of registration the visitor is actually on — so this stays
 * correct for a signed-out visitor and a signed-in one alike, and never offers
 * a link that a route guard would immediately bounce.
 */
export function NotFound() {
  return (
    <Page>
      <Card title="Page not found">
        <div className="space-y-4">
          <Alert tone="info">
            That address does not exist. It may have been mistyped, or the link may be out of date.
          </Alert>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Take me back
          </Link>
        </div>
      </Card>
    </Page>
  )
}
