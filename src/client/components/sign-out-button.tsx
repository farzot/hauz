import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { logoutFn } from '../../server/auth/actions'
import { Button } from './ui'

/**
 * `router.invalidate()` before navigating re-resolves the session, so nothing
 * rendered from the signed-in state survives, including prefetched routes.
 *
 * A failure is shown rather than swallowed: `logoutFn` clears the cookie
 * whatever Appwrite answers, so the only way to end up still signed in is for
 * the request not to arrive, and someone on a shared machine needs telling.
 */
export function SignOutButton({ variant = 'secondary' }: { variant?: 'primary' | 'secondary' }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={variant}
        pending={pending}
        onClick={async () => {
          setPending(true)
          setFailed(false)
          try {
            const result = await logoutFn()
            await router.invalidate()
            await router.navigate({
              to: result.ok ? result.data.redirectTo : '/login',
            })
          } catch (error) {
            console.error(error)
            setFailed(true)
          } finally {
            setPending(false)
          }
        }}
      >
        Sign out
      </Button>

      {failed ? (
        <p role="alert" className="text-right text-xs text-red-700">
          You are still signed in — we could not reach the server. Try again.
        </p>
      ) : null}
    </div>
  )
}
