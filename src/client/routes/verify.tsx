import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { Alert, Button, Card, Page } from '../components/ui'
import type { ActionError } from '../../shared/action-result'
import { completeVerificationFn } from '../../server/auth/actions'

type VerifySearch = {
  userId?: string
  secret?: string
}

/**
 * Where the verification link lands. Appwrite appends `userId` and `secret`;
 * the exchange runs on the server, so the secret is never touched by code in
 * the page.
 */
export const Route = createFileRoute('/verify')({
  validateSearch: (search: Record<string, unknown>): VerifySearch => ({
    userId: typeof search.userId === 'string' ? search.userId : undefined,
    secret: typeof search.secret === 'string' ? search.secret : undefined,
  }),

  component: VerifyPage,
})

type Phase = 'working' | 'done' | 'invalid-link' | 'needs-login' | 'error'

function VerifyPage() {
  const router = useRouter()
  const { userId, secret } = Route.useSearch()

  const [phase, setPhase] = useState<Phase>(userId && secret ? 'working' : 'invalid-link')
  const [error, setError] = useState<ActionError | null>(null)
  // React runs effects twice in development and the token is single-use, so the
  // second run would report "already used" on a link that just worked.
  const attempted = useRef(false)

  useEffect(() => {
    if (!userId || !secret || attempted.current) return
    attempted.current = true

    void (async () => {
      try {
        const result = await completeVerificationFn({ data: { userId, secret } })

        if (result.ok) {
          setPhase('done')
          await router.invalidate()
          await router.navigate({ to: result.data.redirectTo })
          return
        }

        setError(result.error)
        setPhase(result.error.code === 'needs_login' ? 'needs-login' : 'error')
      } catch {
        setError({
          code: 'network_error',
          message: 'Could not reach the server. Check your connection and try again.',
        })
        setPhase('error')
      }
    })()
  }, [router, secret, userId])

  return (
    <Page>
      <Card title="Confirming your email address">
        {phase === 'working' ? <Alert tone="info">One moment…</Alert> : null}

        {phase === 'done' ? (
          <Alert tone="success">Your email address is confirmed. Taking you through…</Alert>
        ) : null}

        {phase === 'invalid-link' ? (
          <div className="space-y-4">
            <Alert tone="error" title="This link is incomplete">
              Open the most recent verification email, or request a new one after signing in.
            </Alert>
            <Button type="button" onClick={() => router.navigate({ to: '/login' })}>
              Go to sign in
            </Button>
          </div>
        ) : null}

        {phase === 'needs-login' ? (
          <div className="space-y-4">
            <Alert tone="info" title="Sign in to finish">
              This link was opened in a browser that is not signed in. Sign in and we will bring you
              straight back here.
            </Alert>
            <Button
              type="button"
              onClick={() =>
                router.navigate({
                  to: '/login',
                  search: { next: `/verify?userId=${userId}&secret=${secret}` },
                })
              }
            >
              Go to sign in
            </Button>
          </div>
        ) : null}

        {phase === 'error' && error ? (
          <div className="space-y-4">
            <Alert tone="error" title="We could not confirm this link">
              {error.message}
            </Alert>
            <Button type="button" onClick={() => router.navigate({ to: '/login' })}>
              Go to sign in
            </Button>
          </div>
        ) : null}
      </Card>
    </Page>
  )
}
