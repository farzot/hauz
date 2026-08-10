import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

/**
 * `src/` is split by where the code runs — `client/`, `server/`, `shared/` —
 * so the entry points TanStack Start would otherwise look for at the root of
 * `src/` are pointed at their halves here. Everything below is a path; no
 * behaviour is configured.
 */
const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart({
      router: {
        routesDirectory: 'client/routes',
        generatedRouteTree: 'client/routeTree.gen.ts',
        entry: 'client/router.tsx',
      },
      start: { entry: 'start.ts' },
    }),
    viteReact(),
  ],
})

export default config
