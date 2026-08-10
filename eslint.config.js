//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  {
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      '.output/**',
      '.nitro/**',
      'dist/**',
      'src/routeTree.gen.ts',
      // Built output and generated copies of shared/ — checked at their source.
      'functions/**/dist/**',
      'functions/**/src/shared/**',
    ],
  },
  ...tanstackConfig,
  {
    rules: {
      'import/no-cycle': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
]
