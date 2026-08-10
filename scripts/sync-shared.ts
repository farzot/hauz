/**
 * Mirrors `shared/` into the Appwrite Function.
 *
 *   npm run sync:shared    # write the copies
 *   npm run check:shared   # fail if they have drifted
 *
 * A Function is deployed as a self-contained directory, so nothing outside it
 * is included however it is pushed. Copying the canonical schema in keeps both
 * halves of the system describing the same tables, and check:shared runs in
 * `npm run verify` so a stale copy fails the build instead of shipping.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const SOURCE_DIR = join(repoRoot, 'shared')
const TARGET_DIR = join(repoRoot, 'functions', 'hauz-account-provisioning', 'src', 'shared')
const FILES = ['hauz-schema.ts', 'hauz-ids.ts']

const BANNER = [
  '/* eslint-disable */',
  '// -----------------------------------------------------------------------------',
  '// GENERATED FILE — DO NOT EDIT.',
  '// Copied from shared/<name> by scripts/sync-shared.ts.',
  '// Edit the original and run `npm run sync:shared`.',
  '// -----------------------------------------------------------------------------',
  '',
].join('\n')

function render(name: string): string {
  const source = readFileSync(join(SOURCE_DIR, name), 'utf8')
  return BANNER.replace('<name>', name) + source
}

const checkOnly = process.argv.includes('--check')
const drifted: string[] = []

if (!existsSync(TARGET_DIR)) {
  mkdirSync(TARGET_DIR, { recursive: true })
}

for (const name of FILES) {
  const target = join(TARGET_DIR, name)
  const expected = render(name)
  const actual = existsSync(target) ? readFileSync(target, 'utf8') : null

  if (actual === expected) {
    if (!checkOnly) console.log(`  = shared/${name}`)
    continue
  }

  if (checkOnly) {
    drifted.push(name)
    continue
  }

  writeFileSync(target, expected, 'utf8')
  console.log(`  ${actual === null ? '+' : '~'} shared/${name}`)
}

if (checkOnly) {
  if (drifted.length > 0) {
    console.error(
      `\nThe Appwrite Function's copies of ${drifted.join(', ')} are out of date.\n` +
        'Run `npm run sync:shared` and commit the result.\n',
    )
    process.exit(1)
  }
  console.log('Shared modules are in sync.')
} else {
  console.log('\nShared modules synced into the Appwrite Function.')
}
