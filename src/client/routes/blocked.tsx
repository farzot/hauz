import { createFileRoute, redirect } from '@tanstack/react-router'

import { SignOutButton } from '../components/sign-out-button'
import { Alert, Card, Page } from '../components/ui'
import { landingPathFor } from '../../shared/auth-model'

// `accounts.status` is part of the supplied schema, so it is honoured: a
// blocked or terminated account does not reach the dashboard even with a valid,
// verified session.
export const Route = createFileRoute('/blocked')({
  beforeLoad: ({ context }) => {
    if (context.auth.status !== 'blocked') {
      throw redirect({ to: landingPathFor(context.auth) })
    }
    return { hauz: context.auth.hauz }
  },

  component: BlockedPage,
})

function BlockedPage() {
  const { hauz } = Route.useRouteContext()

  return (
    <Page>
      <Card
        title="This account is not active"
        footer={
          <div className="flex items-center justify-between gap-4">
            <span>Signed in with the wrong account?</span>
            <SignOutButton />
          </div>
        }
      >
        <Alert tone="error" title={hauz.terminatedAt ? 'Account terminated' : 'Account blocked'}>
          {hauz.terminatedAt
            ? `This HAUZ Account was terminated on ${new Date(hauz.terminatedAt).toLocaleDateString()}.`
            : 'This HAUZ Account has been blocked. Contact support to restore access.'}
        </Alert>
      </Card>
    </Page>
  )
}
