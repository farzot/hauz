// What every server action returns. Kept apart from the Appwrite error mapping
// that produces it, and free of any import, so a component can name the type
// without pulling the Appwrite SDK toward the browser.

/** `field` lets a form highlight the input that was wrong. */
export type ActionError = {
  code: string
  message: string
  field?: 'email' | 'password' | 'firstName' | 'lastName' | 'role' | 'contactPhone'
  /** `true` when trying again later is likely to succeed. */
  retryable?: boolean
}

export type ActionResult<TData = undefined> =
  { ok: true; data: TData } | { ok: false; error: ActionError }

export const ok = <TData>(data: TData): ActionResult<TData> => ({
  ok: true,
  data,
})

export const fail = (error: ActionError): ActionResult<never> => ({
  ok: false,
  error,
})
