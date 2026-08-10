import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'

import { Alert, Button, Card, Field, Page, PasswordInput, TextInput } from '../components/ui'
import { landingPathFor } from '../../shared/auth-model'
import type { AppPath } from '../../shared/auth-model'
import { loginSchema, safeRedirectPath } from '../../shared/auth-schemas'
import { useFormAction } from '../use-form-action'
import { loginFn } from '../../server/auth/actions'

type LoginSearch = {
  /** Where to go once signed in. Same-origin paths only. */
  next?: string
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const next = typeof search.next === 'string' ? safeRedirectPath(search.next, '') : ''
    return next ? { next } : {}
  },

  beforeLoad: ({ context, search }) => {
    if (context.auth.status !== 'anonymous') {
      // Honoured whatever state they are in: every route guards itself, so one
      // they may not be on will redirect them anyway. Filtering here too would
      // make `next` useless for its one real caller, the verification link,
      // which by definition is followed before the address is verified.
      // `href`, not `to`, because it may carry a query string.
      throw search.next
        ? redirect({ href: search.next })
        : redirect({ to: landingPathFor(context.auth) })
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
      // Same rule as the guard above.
      await (next ? router.navigate({ href: next }) : router.navigate({ to: redirectTo }))
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
              <PasswordInput {...props} name="password" autoComplete="current-password" required />
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
