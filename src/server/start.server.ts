import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

// CSRF protection, second lock after SameSite=Lax on the session cookie.
// Checks Sec-Fetch-Site, then Origin, then Referer; a request with none of them
// is refused.
//
// Only mutations: a GET check would reject the verification link, which arrives
// from a mail client as Sec-Fetch-Site: cross-site. GET server functions return
// JSON that a cross-origin caller cannot read without a CORS grant anyway.
const csrf = createCsrfMiddleware({
  filter: ({ request }) => request.method !== 'GET' && request.method !== 'HEAD',
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf],
}))
