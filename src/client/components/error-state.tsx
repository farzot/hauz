import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'

import { logoutFn } from '../../server/auth/actions'
import { Alert, Button, Card, Page } from './ui'

/**
 * Shown when a route fails outright, usually because Appwrite is unreachable or
 * the deployment points at the wrong project. Production sees no infrastructure
 * detail; development sees the real message.
 *
 * "Start again" exists because a session Appwrite rejects with anything other
 * than 401 is deliberately not cleared, since an outage should not sign people
 * out. Without it a browser holding one would fail on every page forever.
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
                } catch (thrown) {
                  // This page is already the failure case; there is nowhere
                  // better to escalate to than the log and the retry button.
                  console.error(thrown)
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
