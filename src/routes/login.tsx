import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'

import { Alert, Button, Card, Field, Page, TextInput } from '../components/ui'
import { landingPathFor } from '../lib/auth/model'
import type { AppPath } from '../lib/auth/model'
import { loginSchema, safeRedirectPath } from '../lib/auth/schemas'
import { useFormAction } from '../lib/use-form-action'
import { loginFn } from '../server/auth'

type LoginSearch = {
  /** Where to return to once signed in. Same-origin paths only. */
  next?: string
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const next = typeof search.next === 'string' ? safeRedirectPath(search.next, '') : ''
    return next ? { next } : {}
  },

  beforeLoad: ({ context, search }) => {
    if (context.auth.status !== 'anonymous') {
      // A `next` from a guard wins, but only once the state machine agrees the
      // person may go there — otherwise they land back on their real next step.
      // `href` rather than `to`, because `next` may carry a query string.
      const landing = landingPathFor(context.auth)
      throw landing === '/dashboard' && search.next
        ? redirect({ href: search.next })
        : redirect({ to: landing })
    }
  },

  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const { next } = Route.useSearch()

  const onSuccess = useCallback(
    async ({ redirectTo }: { redirectTo: AppPath }) => {
      await router.invalidate()
      // `next` only applies when nothing else is outstanding; an unverified
      // account still has to verify first. `href` preserves its query string.
      await (redirectTo === '/dashboard' && next
        ? router.navigate({ href: next })
        : router.navigate({ to: redirectTo }))
    },
    [next, router],
  )

  const form = useFormAction({
    schema: loginSchema,
    submit: (values) => loginFn({ data: values }),
    onSuccess,
  })

  return (
    <Page>
      <Card
        title="Sign in"
        description="Use the email address and password you registered with."
        footer={
          <>
            No account yet?{' '}
            <Link to="/register" className="font-medium text-slate-900 underline">
              Create one
            </Link>
          </>
        }
      >
        <form onSubmit={form.onSubmit} noValidate className="space-y-5">
          {form.error && !form.error.field ? (
            <Alert tone="error" title="Could not sign you in">
              {form.error.message}
            </Alert>
          ) : null}

          <Field name="email" label="Email" error={form.fieldErrors.email}>
            {(props) => (
              <TextInput
                {...props}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
              />
            )}
          </Field>

          <Field name="password" label="Password" error={form.fieldErrors.password}>
            {(props) => (
              <TextInput
                {...props}
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            )}
          </Field>

          <Button type="submit" pending={form.pending}>
            Sign in
          </Button>
        </form>
      </Card>
    </Page>
  )
}
