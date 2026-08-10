/**
 * Wiring between a plain HTML form, a zod schema, and a server function.
 *
 * The same schema runs twice. In the browser it turns a bad phone number into a
 * message next to the field instead of a round trip; on the server it runs
 * again against the raw values, because client-side validation is a
 * convenience and never a guarantee. Only untransformed input is sent — the
 * server produces the values it stores.
 *
 * `pending` also disables the submit button, which is the first line of defence
 * against the double submits that would otherwise reach registration.
 */
import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import type { ZodType } from 'zod'

import type { ActionError, ActionResult } from './appwrite/errors'

export type FormActionState = {
  pending: boolean
  /** A failure that concerns the form as a whole. */
  error: ActionError | null
  /** Failures that belong next to a specific input. */
  fieldErrors: Record<string, string>
}

export type FormAction = FormActionState & {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  reset: () => void
}

const EMPTY: FormActionState = { pending: false, error: null, fieldErrors: {} }

export function useFormAction<TInput extends Record<string, unknown>, TOutput, TData>({
  schema,
  submit,
  onSuccess,
}: {
  schema: ZodType<TOutput, TInput>
  submit: (values: TInput) => Promise<ActionResult<TData>>
  onSuccess: (data: TData) => void | Promise<void>
}): FormAction {
  const [state, setState] = useState<FormActionState>(EMPTY)

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (state.pending) return

      const values = Object.fromEntries(new FormData(event.currentTarget)) as TInput

      const parsed = schema.safeParse(values)
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {}
        for (const issue of parsed.error.issues) {
          const field = issue.path[0]
          // Keep the first message per field: later ones are usually
          // consequences of the first.
          if (typeof field === 'string' && !fieldErrors[field]) {
            fieldErrors[field] = issue.message
          }
        }
        setState({ pending: false, error: null, fieldErrors })
        return
      }

      setState({ pending: true, error: null, fieldErrors: {} })

      void (async () => {
        try {
          const result = await submit(values)

          if (!result.ok) {
            setState({
              pending: false,
              error: result.error,
              fieldErrors: result.error.field ? { [result.error.field]: result.error.message } : {},
            })
            return
          }

          // Left pending on success so the form stays disabled while the
          // router navigates away.
          await onSuccess(result.data)
        } catch (error) {
          console.error(error)
          setState({
            pending: false,
            error: {
              code: 'network_error',
              message: 'Could not reach the server. Check your connection and try again.',
              retryable: true,
            },
            fieldErrors: {},
          })
        }
      })()
    },
    [onSuccess, schema, state.pending, submit],
  )

  return { ...state, onSubmit, reset: () => setState(EMPTY) }
}
