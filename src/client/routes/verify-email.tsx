import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { SignOutButton } from '../components/sign-out-button'
import { Alert, Button, Card, Page } from '../components/ui'
import type { ActionError } from '../../shared/action-result'
import { landingPathFor } from '../../shared/auth-model'
import { resendVerificationFn } from '../../server/auth/actions'

type VerifyEmailSearch = {
  /** Set when the account exists but the email could not be sent. */
  sent?: 'failed'
}

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch =>
    search.sent === 'failed' ? { sent: 'failed' } : {},

  beforeLoad: ({ context }) => {
    if (context.auth.status !== 'unverified') {
      throw redirect({ to: landingPathFor(context.auth) })
    }
    return { user: context.auth.user }
  },

  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { sent } = Route.useSearch()

  const [pending, setPending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<ActionError | null>(null)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function resend() {
    setPending(true)
    setError(null)
    setResent(false)
    try {
      const result = await resendVerificationFn()

      if (result.ok) {
        // The wait comes from the server, which enforces it, so the countdown
        // cannot disagree with the rule.
        setResent(result.data.sent)
        setCooldown(result.data.retryAfterSeconds)
        // Stale once an email has gone out; leaving it would render "we could
        // not send the email" above "email sent".
        if (result.data.sent && sent === 'failed') {
          await router.navigate({ to: '/verify-email', search: {}, replace: true })
        }
      } else {
        setError(result.error)
        if (result.error.code === 'general_rate_limit_exceeded') setCooldown(60)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Page>
      <Card
        title="Confirm your email address"
        description={
          <>
            Your HAUZ account has been created for <strong>{user.email}</strong>, but registration
            is not finished until the address is confirmed.
          </>
        }
        footer={
          <div className="flex items-center justify-between gap-4">
            <span>Wrong account?</span>
            <SignOutButton />
          </div>
        }
      >
        <div className="space-y-4">
          {sent === 'failed' ? (
            <Alert tone="error" title="We could not send the email">
              Your account and HAUZ records are in place. Use the button below to try sending the
              verification email again.
            </Alert>
          ) : (
            <Alert tone="info">
              Open the link in the email we sent you. If it has expired, request a new one below.
            </Alert>
          )}

          {resent ? <Alert tone="success">Verification email sent.</Alert> : null}
          {!resent && cooldown > 0 && !error ? (
            <Alert tone="info">
              An email went out recently. You can request another one in {cooldown} seconds.
            </Alert>
          ) : null}
          {error ? <Alert tone="error">{error.message}</Alert> : null}

          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={resend} pending={pending} disabled={cooldown > 0}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
            </Button>

            {/* Re-runs the root loader, which re-reads the session from Appwrite. */}
            <Button type="button" variant="secondary" onClick={() => router.invalidate()}>
              I have confirmed it
            </Button>
          </div>
        </div>
      </Card>
    </Page>
  )
}
