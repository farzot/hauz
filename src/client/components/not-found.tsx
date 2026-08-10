import { Link } from '@tanstack/react-router'

import { Alert, Card, Page } from './ui'

// Links to `/`, not a specific page: `/` redirects to whichever step the
// visitor is on, so the link is never one a guard would immediately bounce.
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
