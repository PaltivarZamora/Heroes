import type { Texture } from 'pixi.js'
import { TOMBSTONE_ART } from '../combat/tombstone'
import { appendBattleAnimCombatLog } from '../combat/battleAnimLogBridge'
import { loadTextureUrl } from '../hex/terrainTextures'
import type { ReferenceCatalog, UnitRow } from './catalog'
import { townNameForUnit } from './catalog'
import { unitStaticPictureUrls } from './slotArt'
import { basicPartnerForAdvanced } from './unitUpgrade'
import { unitBattleSpriteStem } from '../combat/battleUnitSheet'

export const CORPSE_BODY_REST_HEIGHT_PX = 200

export type UnitCorpsePictureSource = 'own' | 'borrowed' | 'tombstone'

export type UnitCorpseArtCandidate = {
  url: string
  glow: boolean
  source: UnitCorpsePictureSource
  /** Bare filename for Dev log, e.g. Sentry_1_Dead.png */
  fileLabel: string
}

export type UnitCorpsePictureResolved =
  | {
      kind: 'body'
      url: string
      glow: boolean
      source: UnitCorpsePictureSource
      fileLabel: string
    }
  | { kind: 'none' }

const failedUrls = new Set<string>()
const resolvedByUnitId = new Map<number, UnitCorpsePictureResolved>()
const inflightByUnitId = new Map<number, Promise<UnitCorpsePictureResolved>>()
const loggedChoiceByUnitId = new Set<number>()

function deadFileFromStem(stem: string): string {
  return `${stem}_Dead.png`
}

function deadFileFromImagePath(imagePath: string | null | undefined): string | null {
  const stem = unitBattleSpriteStem({ image_path: imagePath } as UnitRow)
  return stem ? deadFileFromStem(stem) : null
}

/** Lookup order: own _Dead → Advanced basic partner _Dead (glow) → generic Dead.png. */
export function unitCorpseArtCandidates(
  catalog: ReferenceCatalog | null | undefined,
  unit: UnitRow | null | undefined,
): UnitCorpseArtCandidate[] {
  if (!unit) {
    return []
  }
  const town = townNameForUnit(catalog, unit)
  const out: UnitCorpseArtCandidate[] = []
  const ownDead = deadFileFromImagePath(unit.image_path?.trim() || null)
  if (ownDead) {
    for (const url of unitStaticPictureUrls(ownDead, town)) {
      out.push({ url, glow: false, source: 'own', fileLabel: ownDead })
    }
  }
  const partner = basicPartnerForAdvanced(catalog, unit)
  const partnerDead = deadFileFromImagePath(partner?.image_path?.trim() || null)
  if (partnerDead) {
    const partnerTown = townNameForUnit(catalog, partner)
    for (const url of unitStaticPictureUrls(partnerDead, partnerTown)) {
      out.push({
        url,
        glow: true,
        source: 'borrowed',
        fileLabel: partnerDead,
      })
    }
  }
  for (const url of unitStaticPictureUrls(TOMBSTONE_ART, town)) {
    out.push({
      url,
      glow: false,
      source: 'tombstone',
      fileLabel: TOMBSTONE_ART,
    })
  }
  return out
}

export function formatUnitCorpseCombatLogLine(
  unitDisplayName: string,
  resolved: UnitCorpsePictureResolved,
): string {
  if (resolved.kind !== 'body') {
    return `${unitDisplayName} Corpse: ${TOMBSTONE_ART} (tombstone)`
  }
  const tag =
    resolved.source === 'own'
      ? 'own'
      : resolved.source === 'borrowed'
        ? 'borrowed, glow'
        : 'tombstone'
  const bare = resolved.fileLabel.replace(/\.(png|webp|jpe?g)$/i, '')
  return `${unitDisplayName} Corpse: ${bare} (${tag})`
}

function logCorpseChoiceOnce(
  unitId: number,
  unitDisplayName: string,
  resolved: UnitCorpsePictureResolved,
): void {
  if (loggedChoiceByUnitId.has(unitId)) {
    return
  }
  loggedChoiceByUnitId.add(unitId)
  appendBattleAnimCombatLog(
    formatUnitCorpseCombatLogLine(unitDisplayName, resolved),
  )
}

export function resetUnitCorpsePictureSessionCache(): void {
  failedUrls.clear()
  resolvedByUnitId.clear()
  inflightByUnitId.clear()
  loggedChoiceByUnitId.clear()
}

async function tryLoadCorpseUrl(url: string): Promise<Texture | null> {
  const key = url.trim()
  if (!key || failedUrls.has(key)) {
    return null
  }
  const texture = await loadTextureUrl(key)
  if (texture) {
    return texture
  }
  failedUrls.add(key)
  return null
}

export function resolveUnitCorpsePicture(
  unitId: number,
  catalog: ReferenceCatalog,
  unit: UnitRow,
  unitDisplayName: string,
): Promise<UnitCorpsePictureResolved> {
  const cached = resolvedByUnitId.get(unitId)
  if (cached) {
    return Promise.resolve(cached)
  }
  const inflight = inflightByUnitId.get(unitId)
  if (inflight) {
    return inflight
  }
  const candidates = unitCorpseArtCandidates(catalog, unit)
  const promise = (async (): Promise<UnitCorpsePictureResolved> => {
    for (const candidate of candidates) {
      if (failedUrls.has(candidate.url.trim())) {
        continue
      }
      const texture = await tryLoadCorpseUrl(candidate.url)
      if (texture) {
        const result: UnitCorpsePictureResolved = {
          kind: 'body',
          url: candidate.url,
          glow: candidate.glow,
          source: candidate.source,
          fileLabel: candidate.fileLabel,
        }
        resolvedByUnitId.set(unitId, result)
        logCorpseChoiceOnce(unitId, unitDisplayName, result)
        return result
      }
    }
    const none: UnitCorpsePictureResolved = { kind: 'none' }
    resolvedByUnitId.set(unitId, none)
    logCorpseChoiceOnce(unitId, unitDisplayName, none)
    return none
  })()
  inflightByUnitId.set(unitId, promise)
  return promise.finally(() => {
    inflightByUnitId.delete(unitId)
  })
}
