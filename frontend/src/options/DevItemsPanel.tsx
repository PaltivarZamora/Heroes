import { useState, useSyncExternalStore } from 'react'
import { centerMapOnHex, getSelectedMapHeroId } from '../hex/HexMap'
import { equippedItemBonuses } from '../items/bonuses'
import {
  heroDailyRegenBase,
  heroDailyRegenFromItems,
  heroDailyRegenEffective,
} from '../items/heroRegen'
import {
  rolledItemDisplayName,
  rolledItemPicturePath,
  rolledItemRarityColor,
  rolledItemRarityName,
  rolledItemStatLines,
} from '../items/display'
import { grantRolledItemToHero } from '../items/grant'
import { moveHeroItem, parseItemLocation } from '../items/move'
import {
  apiItemToRolled,
  rollDebugItemsFromServer,
  type ApiRolledItem,
} from '../items/api'
import { EQUIPMENT_SLOT_IDS } from '../items/types'
import { activePlayer } from '../session/accessors'
import { getSession, subscribe, updateSession } from '../session/store'
import type { GameSession, MapFeature } from '../session/types'
import {
  getCachedCatalog,
  heroEffectiveStats,
  heroEffectiveStatsForHero,
  subscribeCatalog,
} from '../town/catalog'
import { heroDisplayStats, statNameForHeroColumn } from '../town/statCatalog'
import type { ReferenceCatalog } from '../town/catalog'
import type { RolledItem } from '../items/types'
import { devToolsEnabled } from '../settings/playerSettings'

type DevItemsPanelProps = {
  inCombat: boolean
  onNotice: (text: string) => void
}

function defaultHeroId(session: GameSession): string | null {
  const id = getSelectedMapHeroId()
  if (id && session.heroes.some((row) => row.id === id)) {
    return id
  }
  return session.heroes[0]?.id ?? null
}

function renderItemBlock(
  catalog: ReferenceCatalog,
  item: RolledItem,
  label: string,
) {
  const color = rolledItemRarityColor(catalog, item)
  const name = rolledItemDisplayName(catalog, item)
  const stats = rolledItemStatLines(catalog, item)
  return (
    <div key={`${label}-${item.uid}`} className="dev-items-slot">
      <div className="dev-items-slot-label">{label}</div>
      <div style={{ color }}>{name}</div>
      <div className="dev-items-meta">{rolledItemRarityName(catalog, item)}</div>
      <div className="dev-items-meta">{rolledItemPicturePath(catalog, item)}</div>
      {stats.map((line) => (
        <div key={line} className="dev-items-stat-line">{line}</div>
      ))}
    </div>
  )
}

export function DevItemsPanel({ inCombat, onNotice }: DevItemsPanelProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const [rollCount, setRollCount] = useState(20)
  const [rollSeed, setRollSeed] = useState(1)
  const [grantSeed, setGrantSeed] = useState(1)
  const [moveFrom, setMoveFrom] = useState('bp:0')
  const [moveTo, setMoveTo] = useState('eq:1')
  const [rollPreview, setRollPreview] = useState<ApiRolledItem[]>([])
  const [heroId, setHeroId] = useState<string | null>(() =>
    defaultHeroId(getSession()),
  )

  if (!devToolsEnabled() || !catalog) {
    return null
  }

  const resolvedHeroId =
    heroId && session.heroes.some((row) => row.id === heroId)
      ? heroId
      : defaultHeroId(session)
  const hero =
    resolvedHeroId
      ? session.heroes.find((row) => row.id === resolvedHeroId) ?? null
      : null
  const human = activePlayer(session)
  const heroReadOnly =
    !hero || !human || hero.player_id !== human.id || human.is_ai

  const onRoll = async () => {
    try {
      const result = await rollDebugItemsFromServer(rollCount, rollSeed)
      setRollPreview(result.items)
      onNotice(`Rolled ${result.items.length} item(s)`)
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Roll failed')
    }
  }

  const onGrant = async () => {
    if (!hero) {
      onNotice('No active hero')
      return
    }
    if (heroReadOnly) {
      onNotice('Grant is only for your own heroes')
      return
    }
    try {
      const result = await grantRolledItemToHero(
        getSession(),
        catalog,
        hero.id,
        grantSeed,
      )
      if (!result.ok) {
        onNotice(result.message)
        return
      }
      updateSession(() => result.session)
      onNotice('Item granted (equip or backpack)')
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Grant failed')
    }
  }

  const onMove = () => {
    if (!hero) {
      onNotice('No active hero')
      return
    }
    if (heroReadOnly) {
      onNotice('Move is only for your own heroes')
      return
    }
    const from = parseItemLocation(moveFrom)
    const to = parseItemLocation(moveTo)
    if (!from || !to) {
      onNotice('From/To must be bp:0–14 or eq:1–6')
      return
    }
    const result = moveHeroItem(
      getSession(),
      catalog,
      hero.id,
      from,
      to,
      inCombat,
    )
    if (!result.ok) {
      onNotice(result.message)
      return
    }
    updateSession(() => result.session)
    onNotice('Item moved')
  }

  const level = hero?.current_level ?? 1
  const base = hero
    ? heroEffectiveStats(catalog, hero.class_id, level)
    : null
  const effective = hero ? heroEffectiveStatsForHero(catalog, hero) : null
  const itemBonus = hero ? equippedItemBonuses(catalog, hero).hero : {}
  const regenBase = hero ? heroDailyRegenBase(catalog, hero) : null
  const regenItems = hero ? heroDailyRegenFromItems(catalog, hero) : null
  const regenEffective = hero ? heroDailyRegenEffective(catalog, hero) : null

  return (
    <section className="dev-items-section" aria-labelledby="dev-items-title">
      <h2 id="dev-items-title">Items</h2>
      <div className="dev-items-controls">
        <label>
          Count
          <input
            type="number"
            min={1}
            max={500}
            value={rollCount}
            onChange={(e) => setRollCount(Number(e.target.value) || 1)}
          />
        </label>
        <label>
          Seed
          <input
            type="number"
            value={rollSeed}
            onChange={(e) => setRollSeed(Number(e.target.value) || 0)}
          />
        </label>
        <button type="button" onClick={() => void onRoll()}>
          Roll
        </button>
      </div>
      {rollPreview.length > 0 ? (
        <div className="dev-items-roll-list">
          {rollPreview.map((row, index) => {
            const preview = apiItemToRolled(row, `preview-${index}`)
            return renderItemBlock(catalog, preview, `#${index + 1}`)
          })}
        </div>
      ) : null}
      <label className="dev-items-controls">
        Hero
        <select
          value={resolvedHeroId ?? ''}
          onChange={(e) => setHeroId(e.target.value)}
        >
          {session.heroes.map((row) => {
            const owner = session.players.find((p) => p.id === row.player_id)
            const tag = owner?.is_ai ? ' (AI)' : ''
            return (
              <option key={row.id} value={row.id}>
                {row.name}{tag}
              </option>
            )
          })}
        </select>
      </label>
      {heroReadOnly && hero ? (
        <p className="dev-items-meta">View only (AI or other player)</p>
      ) : null}
      <div className="dev-items-controls">
        <label>
          Grant seed
          <input
            type="number"
            value={grantSeed}
            onChange={(e) => setGrantSeed(Number(e.target.value) || 0)}
          />
        </label>
        <button
          type="button"
          onClick={() => void onGrant()}
          disabled={heroReadOnly}
        >
          Grant item
        </button>
      </div>
      <div className="dev-items-controls">
        <label>
          From
          <input value={moveFrom} onChange={(e) => setMoveFrom(e.target.value)} />
        </label>
        <label>
          To
          <input value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
        </label>
        <button type="button" onClick={onMove} disabled={heroReadOnly}>
          Move
        </button>
      </div>
      <h3>World items (chests + ground)</h3>
      <div className="dev-items-world-list">
        {(session.features ?? [])
          .filter(
            (
              row,
            ): row is Extract<MapFeature, { kind: 'chest' }> =>
              row.kind === 'chest' && row.item != null,
          )
          .map((chest) => {
            const item = chest.item!
            const name = rolledItemDisplayName(catalog, item)
            const stats = rolledItemStatLines(catalog, item)
            return (
              <button
                key={chest.id}
                type="button"
                className="dev-items-world-row"
                onClick={() => {
                  centerMapOnHex(chest.position.q, chest.position.r)
                  onNotice(`Centered on chest @ ${chest.position.q},${chest.position.r}`)
                }}
              >
                <div>
                  ({chest.position.q},{chest.position.r}) L{chest.level}
                  {chest.open ? ' · Open' : ''}
                </div>
                <div style={{ color: rolledItemRarityColor(catalog, item) }}>
                  {name}
                </div>
                <div className="dev-items-meta">
                  {rolledItemRarityName(catalog, item)}
                </div>
                {stats.map((line) => (
                  <div key={line} className="dev-items-stat-line">{line}</div>
                ))}
              </button>
            )
          })}
        {(session.features ?? [])
          .filter(
            (
              row,
            ): row is Extract<MapFeature, { kind: 'ground_item' }> =>
              row.kind === 'ground_item',
          )
          .map((ground) => {
            const item = ground.item
            const name = rolledItemDisplayName(catalog, item)
            const stats = rolledItemStatLines(catalog, item)
            const placement =
              ground.pocket_id != null
                ? `pocket #${ground.pocket_id} T${ground.pocket_tier ?? '?'}`
                : ground.guard
                  ? `standalone · guard (${ground.guard.q},${ground.guard.r}) T${ground.guard_tier ?? '?'}`
                  : 'standalone'
            return (
              <button
                key={ground.id}
                type="button"
                className="dev-items-world-row"
                onClick={() => {
                  centerMapOnHex(ground.position.q, ground.position.r)
                  onNotice(
                    `Centered on ground item @ ${ground.position.q},${ground.position.r}`,
                  )
                }}
              >
                <div>
                  ({ground.position.q},{ground.position.r}) · {placement}
                </div>
                <div style={{ color: rolledItemRarityColor(catalog, item) }}>
                  {name}
                </div>
                <div className="dev-items-meta">
                  {rolledItemRarityName(catalog, item)}
                </div>
                {stats.map((line) => (
                  <div key={line} className="dev-items-stat-line">{line}</div>
                ))}
              </button>
            )
          })}
      </div>
      {hero ? (
        <>
          <h3>Hero items — {hero.name}</h3>
          <div className="dev-items-inventory">
            {EQUIPMENT_SLOT_IDS.map((slotId) => {
              const item = hero.equipment[slotId]
              return item
                ? renderItemBlock(catalog, item, `eq:${slotId}`)
                : (
                    <div key={`eq-${slotId}`} className="dev-items-slot dev-items-empty">
                      eq:{slotId} (empty)
                    </div>
                  )
            })}
            {hero.backpack.map((item, index) =>
              item
                ? renderItemBlock(catalog, item, `bp:${index}`)
                : (
                    <div
                      key={`bp-${index}`}
                      className="dev-items-slot dev-items-empty"
                    >
                      bp:{index} (empty)
                    </div>
                  ),
            )}
          </div>
          <table className="dev-items-stat-table">
            <thead>
              <tr>
                <th>Stat</th>
                <th>Base</th>
                <th>Items</th>
                <th>Effective</th>
              </tr>
            </thead>
            <tbody>
              {heroDisplayStats(catalog).map(({ column }) => (
                <tr key={column}>
                  <td>{statNameForHeroColumn(catalog, column)}</td>
                  <td>{base ? base[column] : '—'}</td>
                  <td>{itemBonus[column] ?? 0}</td>
                  <td>{effective ? effective[column] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="dev-items-stat-table">
            <thead>
              <tr>
                <th>Daily regen</th>
                <th>Base</th>
                <th>Items</th>
                <th>Effective</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Mana Regen</td>
                <td>{regenBase?.mana ?? '—'}</td>
                <td>{regenItems?.mana ?? '—'}</td>
                <td>{regenEffective?.mana ?? '—'}</td>
              </tr>
              <tr>
                <td>Energy Regen</td>
                <td>{regenBase?.energy ?? '—'}</td>
                <td>{regenItems?.energy ?? '—'}</td>
                <td>{regenEffective?.energy ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : (
        <p>No hero on the map.</p>
      )}
    </section>
  )
}
