import { createFileRoute, redirect } from '@tanstack/react-router'

import { landingPathFor } from '../lib/auth/model'

/**
 * The entry point has no content of its own: it sends people to whichever step
 * of registration they are actually on.
 */
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    throw redirect({ to: landingPathFor(context.auth) })
  },
})
