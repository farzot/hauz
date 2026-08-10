import { createFileRoute, redirect } from '@tanstack/react-router'

import { landingPathFor } from '../../shared/auth-model'

// No content of its own: sends people to whichever step they are on.
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    throw redirect({ to: landingPathFor(context.auth) })
  },
})
