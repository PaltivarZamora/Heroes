import fs from 'fs'
import { fileURLToPath } from 'url'

const file = fileURLToPath(new URL('../src/town/catalog.ts', import.meta.url))
let s = fs.readFileSync(file, 'utf8')

const start = '      // Halberdier base: DB may have max_range 1'
const end = '      tags: asIntIds(extra.tags),'
const i = s.indexOf(start)
const j = s.indexOf(end)
if (i < 0 || j < 0 || j <= i) {
  throw new Error(`slice ${i} ${j}`)
}
const replacement = `      max_range:
        maxRangeRaw == null || maxRangeRaw === '' ? 1 : asInt(maxRangeRaw),
      retaliation: asUnitRetaliation(extra.retaliation),
      abilities: asUnitCombatAbilities(extra.abilities),
      tags: asIntIds(extra.tags),`
s = s.slice(0, i) + replacement + s.slice(j)

s = s.replace(
  /blocks_los: \(\(\) => \{[\s\S]*?\}\)\(\),/m,
  'blocks_los: asBoolFlag(extra.blocks_los),',
)

s = s.replace(
  /upgrade_cost: asCost\(\n        \(row as \{ upgrade_cost\?: CostMap \| Record<string, number> \| null \}\)\n          \.upgrade_cost,\n      \),\n    \}/m,
  `upgrade_cost: asCost(
        (row as { upgrade_cost?: CostMap | Record<string, number> | null })
          .upgrade_cost,
      ),
      upgrade_unit_id: (() => {
        const raw = (row as { upgrade_unit_id?: unknown }).upgrade_unit_id
        if (raw == null || raw === '') return null
        const id = asInt(raw)
        return id > 0 ? id : null
      })(),
    }`,
)

s = s.replace(
  /\n  \{\n    const haveIds[\s\S]*?unit = \[\.\.\.unit, \.\.\.extras\]\n    \}\n  \}/m,
  '',
)

fs.writeFileSync(file, s)
console.log('patched', file)
