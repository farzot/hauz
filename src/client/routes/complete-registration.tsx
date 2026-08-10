import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { SignOutButton } from '../components/sign-out-button'
import { Alert, Button, Card, Page } from '../components/ui'
import type { ActionError } from '../../shared/action-result'
import { landingPathFor } from '../../shared/auth-model'
import { completeRegistrationFn } from '../../server/auth/actions'

/**
 * Recovery for an account that exists in Appwrite Auth but has no HAUZ records.
 * Nothing has to be typed again: the profile was stored on the Auth user during
 * registration and the Function reads it from there. Retrying is safe because
 * provisioning is idempotent.
 */
export const Route = createFileRoute('/complete-registration')({
  beforeLoad: ({ context }) => {
    if (context.auth.status !== 'incomplete') {
      throw redirect({ to: landingPathFor(context.auth) })
    }
    return { user: context.auth.user }
  },

  component: CompleteRegistrationPage,
})

function CompleteRegistrationPage() {
  const router = useRouter()
  const { user } = Route.useRouteContext()

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ActionError | null>(null)

  async function retry() {
    setPending(true)
    setError(null)
    try {
      const result = await completeRegistrationFn()
      if (result.ok) {
        await router.invalidate()
        await router.navigate(
          result.data.redirectTo === '/verify-email' && !result.data.verificationSent
            ? { to: '/verify-email', search: { sent: 'failed' as const } }
            : { to: result.data.redirectTo },
        )
        return
      }
      setError(result.error)
    } catch {
      setError({
        code: 'network_error',
        message: 'Could not reach the server. Check your connection and try again.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Page>
      <Card
        title="Finish setting up your account"
        description={
          <>
            You are signed in as <strong>{user.email}</strong>, but your HAUZ records were not
            created. Registration is not complete until they are.
          </>
        }
        footer={
          <div className="flex items-center justify-between gap-4">
            <span>Prefer to start over?</span>
            <SignOutButton />
          </div>
        }
      >
        <div className="space-y-4">
          {error ? (
            <Alert tone="error" title="Still not working">
              {error.message}
            </Alert>
          ) : (
            <Alert tone="info">
              We kept the details from your registration, so there is nothing to re-enter.
            </Alert>
          )}

          <Button type="button" onClick={retry} pending={pending}>
            Complete registration
          </Button>
        </div>
      </Card>
    </Page>
  )
}
