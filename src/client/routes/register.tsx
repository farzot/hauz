import { Link, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'

import {
  Alert,
  Button,
  Card,
  Field,
  Page,
  PasswordInput,
  Select,
  TextInput,
} from '../components/ui'
import { landingPathFor } from '../../shared/auth-model'
import { registerSchema } from '../../shared/auth-schemas'
import { useFormAction } from '../use-form-action'
import { registerFn } from '../../server/auth/actions'
import type { RegisterOutcome } from '../../server/auth/actions'

export const Route = createFileRoute('/register')({
  // Someone part-way through registration goes to the step they are on rather
  // than being offered a second account.
  beforeLoad: ({ context }) => {
    if (context.auth.status !== 'anonymous') {
      throw redirect({ to: landingPathFor(context.auth) })
    }
  },
  component: RegisterPage,
})

function RegisterPage() {
  const router = useRouter()

  const onSuccess = useCallback(
    async (outcome: RegisterOutcome) => {
      await router.invalidate()
      // `sent=failed` only means anything on the page that offers to resend.
      await router.navigate(
        outcome.redirectTo === '/verify-email' && !outcome.verificationSent
          ? { to: '/verify-email', search: { sent: 'failed' as const } }
          : { to: outcome.redirectTo },
      )
    },
    [router],
  )

  const form = useFormAction({
    schema: registerSchema,
    submit: (values) => registerFn({ data: values }),
    onSuccess,
  })

  return (
    <Page>
      <Card
        title="Create your HAUZ account"
        description="Registration creates your Personal Account and sends a verification email."
        footer={
          <>
            Already registered?{' '}
            <Link to="/login" className="font-medium text-slate-900 underline">
              Sign in
            </Link>
          </>
        }
      >
        {/* `method="post"` never runs once the page is hydrated, because the
            handler below preventDefault()s. It matters for the window before
            that: a default form submit is a GET, which would put the password in
            the URL, the history and the access log. */}
        <form method="post" onSubmit={form.onSubmit} noValidate className="space-y-5">
          {form.error && !form.error.field ? (
            <Alert tone="error" title="Registration did not complete">
              {form.error.message}
            </Alert>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field name="firstName" label="First name" error={form.fieldErrors.firstName}>
              {(props) => (
                <TextInput
                  {...props}
                  name="firstName"
                  autoComplete="given-name"
                  maxLength={100}
                  required
                />
              )}
            </Field>

            <Field name="lastName" label="Last name" error={form.fieldErrors.lastName}>
              {(props) => (
                <TextInput
                  {...props}
                  name="lastName"
                  autoComplete="family-name"
                  maxLength={100}
                  required
                />
              )}
            </Field>
          </div>

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

          <Field
            name="password"
            label="Password"
            hint="At least 8 characters."
            error={form.fieldErrors.password}
          >
            {(props) => (
              <PasswordInput
                {...props}
                name="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            )}
          </Field>

          <Field
            name="role"
            label="I am a"
            hint="This becomes the Personal Role on your account."
            error={form.fieldErrors.role}
          >
            {(props) => (
              <Select {...props} name="role" defaultValue="consumer" required>
                <option value="consumer">Consumer</option>
                <option value="realtor">Realtor</option>
              </Select>
            )}
          </Field>

          <Field
            name="contactPhone"
            label="Contact phone (optional)"
            hint="International format, for example +998901234567."
            error={form.fieldErrors.contactPhone}
          >
            {(props) => (
              <TextInput
                {...props}
                name="contactPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+998901234567"
              />
            )}
          </Field>

          <Button type="submit" pending={form.pending}>
            Create account
          </Button>
        </form>
      </Card>
    </Page>
  )
}
