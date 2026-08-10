// The presentational pieces the auth screens need. Visual design is not part of
// the assignment, so this stays plain: enough structure to keep the routes
// readable, plus correct labelling and error wiring.
import { useState } from 'react'
import type { ReactNode } from 'react'

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto w-full max-w-xl">{children}</div>
    </div>
  )
}

export function Card({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="mt-2 text-sm text-slate-600">{description}</p> : null}
      <div className="mt-6">{children}</div>
      {footer ? (
        <div className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-600">{footer}</div>
      ) : null}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

const ALERT_STYLES = {
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
} as const

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: keyof typeof ALERT_STYLES
  title?: string
  children: ReactNode
}) {
  return (
    <div
      // `alert` announces immediately; `status` waits for a pause.
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${ALERT_STYLES[tone]}`}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                               */
/* -------------------------------------------------------------------------- */

type FieldProps = {
  name: string
  label: string
  error?: string
  hint?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode
}

export function Field({ name, label, error, hint, children }: FieldProps) {
  const hintId = hint ? `${name}-hint` : undefined
  const errorId = error ? `${name}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children({
        id: name,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {error ? (
        // Announced when it appears, so it does not sit silently under an input
        // the person has already moved past.
        <p id={errorId} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

const CONTROL_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm ' +
  'outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-100 aria-[invalid]:border-red-400'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={CONTROL_CLASS} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={CONTROL_CLASS} />
}

/** The toggle only changes what is on screen; the submitted value is the same. */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} className={`${CONTROL_CLASS} pr-10`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-slate-500 outline-none hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          {visible ? (
            <>
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2.5 2.5 0 0 0 3.5 3.5" />
              <path d="M9.4 5.3A9.8 9.8 0 0 1 12 5c5 0 8.6 3.9 10 7-.4 1-1.2 2.3-2.4 3.5M6.2 6.7C4.2 8.1 2.8 10.1 2 12c1.4 3.1 5 7 10 7 1.5 0 2.9-.3 4.1-.9" />
            </>
          ) : (
            <>
              <path d="M2 12c1.4-3.1 5-7 10-7s8.6 3.9 10 7c-1.4 3.1-5 7-10 7S3.4 15.1 2 12Z" />
              <circle cx="12" cy="12" r="2.5" />
            </>
          )}
        </svg>
      </button>
    </div>
  )
}

const BUTTON_VARIANTS = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
} as const

export function Button({
  variant = 'primary',
  pending = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS
  /** Disabled while a request is in flight, which is what stops double submits. */
  pending?: boolean
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || pending}
      aria-busy={pending || undefined}
      className={
        'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium ' +
        'transition disabled:cursor-not-allowed disabled:opacity-60 ' +
        BUTTON_VARIANTS[variant]
      }
    >
      {pending ? 'Working…' : children}
    </button>
  )
}
