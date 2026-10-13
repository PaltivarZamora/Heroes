/**
 * Fail if `src/` contains `.js`/`.jsx` siblings of `.ts`/`.tsx` files.
 * Those are almost always accidental `tsc` emit into `src/` and shadow real sources in Vite.
 */
import { existsSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src')

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path, files)
    } else if (extname(name) === '.js' || extname(name) === '.jsx') {
      files.push(path)
    }
  }
  return files
}

const stale = walk(srcRoot).filter((path) => {
  const base = path.replace(/\.(js|jsx)$/, '')
  return existsSync(`${base}.ts`) || existsSync(`${base}.tsx`)
})

if (stale.length > 0) {
  console.error(
    `Stale compiled files in frontend/src (delete them; do not commit):\n${stale
      .map((p) => `  ${p.replace(srcRoot + '\\', '').replace(srcRoot + '/', '')}`)
      .join('\n')}`,
  )
  process.exit(1)
}
