export type HeroHudState = {
  id: string
  q: number
  r: number
  remaining: number
}

export type TableLoadStatus = {
  table: string
  ok: boolean
  rowCount: number
  error: string | null
}

export type DataStatus = {
  ok: boolean
  tables: TableLoadStatus[]
  fetchError?: string
}

export type DebugSnapshot = {
  mapSize: string
  hexSize: string
  seed: string
  heroName: string
  heroQ: number | null
  heroR: number | null
  steps: string
  resources: string[]
  dataStatus: DataStatus | null
}

function formatDataLoadSection(dataStatus: DataStatus | null): string[] {
  if (dataStatus == null) {
    return ['Data Load Errors: …']
  }
  if (dataStatus.fetchError) {
    return [
      'Data Load Errors:',
      `  status endpoint — ${dataStatus.fetchError}`,
    ]
  }
  const failures = dataStatus.tables.filter((table) => !table.ok)
  if (failures.length === 0) {
    return []
  }
  return [
    'Data Load Errors:',
    ...failures.map((table) => {
      const detail = table.error?.trim() || 'load failed'
      return `  ${table.table} — ${detail}`
    }),
  ]
}

/** One labeled line per field — add lines here as more testable state exists. */
export function formatDebugText(snapshot: DebugSnapshot): string {
  const hero =
    snapshot.heroQ === null || snapshot.heroR === null
      ? `Hero: ${snapshot.heroName}`
      : `Hero: ${snapshot.heroName} q=${snapshot.heroQ}, r=${snapshot.heroR}`
  return [
    `Map Size: ${snapshot.mapSize}`,
    `Hex Size: ${snapshot.hexSize}`,
    `Seed Number: ${snapshot.seed}`,
    hero,
    `Steps: ${snapshot.steps}`,
    ...snapshot.resources,
    ...formatDataLoadSection(snapshot.dataStatus),
  ].join('\n')
}
