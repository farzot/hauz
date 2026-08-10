import { createFileRoute, redirect } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { SignOutButton } from '../components/sign-out-button'
import { Card, Page } from '../components/ui'
import { landingPathFor } from '../../shared/auth-model'

/**
 * The authenticated page. `beforeLoad` runs on the server during SSR and again
 * on every client navigation, so a signed-out or half-registered visitor is
 * redirected before any of this markup is produced.
 *
 * Everything shown was read with the visitor's own session under row
 * permissions, so the page could not display someone else's records if it tried.
 */
export const Route = createFileRoute('/dashboard')({
  beforeLoad: ({ context }) => {
    if (context.auth.status !== 'ready') {
      throw redirect({ to: landingPathFor(context.auth) })
    }
    return { user: context.auth.user, hauz: context.auth.hauz }
  },

  component: DashboardPage,
})

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2.5 last:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="font-mono text-sm break-all text-slate-900 sm:text-right">{value}</dd>
    </div>
  )
}

function DashboardPage() {
  const { user, hauz } = Route.useRouteContext()

  return (
    <Page>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Signed in</p>
          <h1 className="text-xl font-semibold">
            {hauz.firstName} {hauz.lastName}
          </h1>
        </div>
        <SignOutButton />
      </div>

      <div className="space-y-6">
        <Card
          title="Appwrite Auth user"
          description="The registered human: the identity that owns the email address and the session."
        >
          <dl>
            <Row label="$id" value={user.id} />
            <Row label="email" value={user.email} />
            <Row label="name" value={user.name} />
            <Row label="emailVerification" value={String(user.emailVerified)} />
          </dl>
        </Card>

        <Card
          title="HAUZ Account"
          description="accounts — the account itself, separate from the Auth user above."
        >
          <dl>
            <Row label="$id" value={hauz.accountId} />
            <Row label="account_type" value={hauz.accountType} />
            <Row label="status" value={hauz.accountStatus} />
            <Row label="terminated_at" value={hauz.terminatedAt ?? '—'} />
            <Row label="current_access_grant_id" value={hauz.currentAccessGrantId ?? '—'} />
          </dl>
        </Card>

        <Card
          title="Access grant"
          description="account_access_grants — the row that connects the Auth user to this Account."
        >
          <dl>
            <Row label="$id" value={hauz.grantId} />
            <Row label="appwrite_user_id" value={user.id} />
            <Row label="account_id" value={hauz.accountId} />
            <Row label="revoked_at" value="—" />
            <Row label="granted" value={new Date(hauz.grantedAt).toLocaleString()} />
          </dl>
        </Card>

        <Card
          title="Personal Account"
          description="personal_accounts — the profile and Personal Role for this individual Account."
        >
          <dl>
            <Row label="$id" value={hauz.personalAccountId} />
            <Row label="first_name" value={hauz.firstName} />
            <Row label="last_name" value={hauz.lastName} />
            <Row label="contact_phone" value={hauz.contactPhone ?? '—'} />
            <Row label="role" value={hauz.role} />
          </dl>
        </Card>
      </div>
    </Page>
  )
}
