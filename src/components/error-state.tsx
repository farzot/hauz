import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'

import { logoutFn } from '../server/auth'
import { Alert, Button, Card, Page } from './ui'

/**
 * Rendered when a route fails outright — most plausibly because Appwrite is
 * unreachable, or because the deployment is pointed at the wrong project.
 *
 * Two things matter here.
 *
 * The message must not leak infrastructure detail. In production the visitor is
 * told what to do next and nothing else; the endpoint, project id and stack
 * stay on the server, where they were already logged. In development the real
 * message is shown, because that is the whole point of development.
 *
 * There must be a way out. A session that Appwrite rejects with anything other
 * than 401 is not cleared automatically — deliberately, since a transient
 * outage should not sign people out — so a browser holding one would otherwise
 * fail on every page, forever. "Start again" clears the cookie and returns to
 * the sign-in page, which always renders because a request without a session
 * never touches Appwrite.
 */
export function ErrorState({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const detail = import.meta.env.DEV && error instanceof Error ? error.message : null

  return (
    <Page>
      <Card
        title="Something went wrong"
        description="The application could not load this page. This is usually a temporary problem reaching Appwrite."
      >
        <div className="space-y-4">
          <Alert tone="error" title="Try again in a moment">
            If it keeps happening, the server logs record what actually failed.
          </Alert>

          {detail ? (
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {detail}
            </pre>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              pending={pending}
              onClick={async () => {
                setPending(true)
                try {
                  reset()
                  await router.invalidate()
                } finally {
                  setPending(false)
                }
              }}
            >
              Try again
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                setPending(true)
                try {
                  // Always clears the cookie, whatever Appwrite answers.
                  await logoutFn()
                  await router.invalidate()
                  await router.navigate({ to: '/login' })
                } finally {
                  setPending(false)
                }
              }}
            >
              Start again
            </Button>
          </div>
        </div>
      </Card>
    </Page>
  )
}
