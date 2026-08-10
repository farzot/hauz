// Wires a plain HTML form to a zod schema and a server function. The schema
// runs here for immediate feedback and again on the server, which is the one
// that counts. Only raw input is sent; the server produces what it stores.
import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import type { ZodType } from 'zod'

import type { ActionError, ActionResult } from '../shared/action-result'

export type FormActionState = {
  pending: boolean
  /** Concerns the form as a whole. */
  error: ActionError | null
  /** Belong next to a specific input. */
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
          // First message per field; later ones are usually consequences.
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

          // Stays pending so the form is disabled while the router navigates.
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
