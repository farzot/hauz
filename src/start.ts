import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

const csrf = createCsrfMiddleware({
  filter: ({ request }) => request.method !== 'GET' && request.method !== 'HEAD',
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf],
}))
