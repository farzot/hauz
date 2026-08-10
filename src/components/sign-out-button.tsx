import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { logoutFn } from '../server/auth'
import { Button } from './ui'

/**
 * Ends the session and returns to the sign-in page.
 *
 * `router.invalidate()` before navigating forces the root route to re-resolve
 * the session, so nothing rendered from the signed-in state survives the
 * transition — including anything the router had already prefetched.
 */
export function SignOutButton({ variant = 'secondary' }: { variant?: 'primary' | 'secondary' }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <Button
      type="button"
      variant={variant}
      pending={pending}
      onClick={async () => {
        setPending(true)
        try {
          const result = await logoutFn()
          await router.invalidate()
          await router.navigate({
            to: result.ok ? result.data.redirectTo : '/login',
          })
        } finally {
          setPending(false)
        }
      }}
    >
      Sign out
    </Button>
  )
}
