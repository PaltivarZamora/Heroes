import { execSync } from 'child_process'
import fs from 'fs'
import { fileURLToPath } from 'url'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const catalogPath = fileURLToPath(new URL('../src/town/catalog.ts', import.meta.url))
const gitLines = execSync('git show HEAD:frontend/src/town/catalog.ts', {
  cwd: repo,
  encoding: 'utf8',
}).split(/\r?\n/)
const chunk = gitLines.slice(3580, 3934).join('\n')
let catalog = fs.readFileSync(catalogPath, 'utf8')
const marker = 'function asResistStat(value: unknown)'
const idx = catalog.indexOf(marker)
if (idx < 0) {
  throw new Error('asResistStat not found')
}
catalog = catalog.slice(0, idx) + chunk + '\n\n' + catalog.slice(idx)
fs.writeFileSync(catalogPath, catalog)
console.log('restored', chunk.split('\n').length, 'lines before asResistStat')
