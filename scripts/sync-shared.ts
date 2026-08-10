/**
 * Keeps the Appwrite Function's copy of the shared modules in step with
 * `shared/`.
 *
 *   npm run sync:shared    # write the copies
 *   npm run check:shared   # fail if they have drifted
 *
 * An Appwrite Function is deployed as a self-contained directory: whichever way
 * it is pushed — CLI, console upload, or a Git integration — nothing outside
 * that directory is included. The canonical schema therefore lives in
 * `shared/`, and this script mirrors it into the function so both halves of the
 * system are provably describing the same tables. `check:shared` runs as part
 * of `npm run verify`, so a drifted copy fails the build instead of shipping.
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
