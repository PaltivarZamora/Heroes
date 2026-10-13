import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  resetAllInventoryDetails,
  subscribeInventoryDetailReset,
} from '../items/inventoryDetailReset'
import { moveHeroItem } from '../items/move'
import { moveTradeItem } from '../items/tradeMove'
import {
  rolledItemDisplayName,
  rolledItemRarityColor,
  rolledItemRarityName,
  rolledItemArtUrl,
  rolledItemSlotTypeId,
} from '../items/display'
import {
  equippedSummaryStatLines,
  inventoryEmptySlotTooltip,
  inventoryItemDetailLines,
  inventorySlotSummaryLines,
  inventorySlotTypeName,
} from '../items/inventoryDisplay'
import type { ItemLocation, RolledItem } from '../items/types'
import { BACKPACK_SIZE, EQUIPMENT_SLOT_IDS } from '../items/types'
import type { GameSession, Hero } from '../session/types'
import { useGameStage } from '../layout/GameStage'
import { getSession, updateSession } from '../session/store'
import type { ReferenceCatalog } from './catalog'
import { AbilityTip } from './AbilityTip'

const LEFT_SLOTS = [1, 3, 5] as const
const RIGHT_SLOTS = [2, 4, 6] as const
const DRAG_START_THRESHOLD_PX = 5

type PendingDrag = {
  item: RolledItem
  from: ItemLocation
  startX: number
  startY: number
  pointerId: number
}

export type HeroInventoryProps = {
  catalog: ReferenceCatalog
  hero: Hero
  inCombat?: boolean
  /** Other hero id when shown in friendly trade (enables cross-hero drag). */
  tradePeerHeroId?: string | null
  /** Panel title; defaults to hero name only on hero screen. */
  headerTitle?: string
}

function isEquipped(hero: Hero, item: RolledItem): boolean {
  for (const slotId of EQUIPMENT_SLOT_IDS) {
    const row = hero.equipment[slotId]
    if (row?.uid === item.uid) {
      return true
    }
  }
  return false
}

function locKey(loc: ItemLocation): string {
  return loc.kind === 'backpack' ? `bp:${loc.index}` : `eq:${loc.slotId}`
}

function parseInvLocAttr(raw: string | null): ItemLocation | 'middle' | null {
  if (!raw) {
    return null
  }
  if (raw === 'middle') {
    return 'middle'
  }
  if (raw.startsWith('eq:')) {
    const slotId = Number(raw.slice(3))
    if (EQUIPMENT_SLOT_IDS.includes(slotId as (typeof EQUIPMENT_SLOT_IDS)[number])) {
      return { kind: 'equipment', slotId }
    }
    return null
  }
  if (raw.startsWith('bp:')) {
    const index = Number(raw.slice(3))
    if (Number.isInteger(index) && index >= 0 && index < BACKPACK_SIZE) {
      return { kind: 'backpack', index }
    }
  }
  return null
}

type DropTarget = {
  heroId: string
  loc: ItemLocation | 'middle'
}

function resolveDropTarget(
  clientX: number,
  clientY: number,
): DropTarget | null {
  const stack = document.elementsFromPoint(clientX, clientY)
  for (const el of stack) {
    if (!(el instanceof Element)) {
      continue
    }
    const host = el.closest('[data-inv-loc]')
    if (!(host instanceof HTMLElement)) {
      continue
    }
    const panel = host.closest('[data-inv-hero]')
    if (!(panel instanceof HTMLElement)) {
      continue
    }
    const heroId = panel.getAttribute('data-inv-hero')
    if (!heroId) {
      continue
    }
    const loc = parseInvLocAttr(host.getAttribute('data-inv-loc'))
    if (loc) {
      return { heroId, loc }
    }
  }
  return null
}

function ItemArt({
  catalog,
  item,
}: {
  catalog: ReferenceCatalog
  item: RolledItem
}) {
  const [missing, setMissing] = useState(false)
  const url = rolledItemArtUrl(catalog, item)
  useEffect(() => {
    setMissing(false)
  }, [url])
  if (!url || missing) {
    return (
      <span className="town-building-slot-filename hero-inventory-missing-art">
        missing art
      </span>
    )
  }
  return (
    <img
      className="hero-inventory-item-img"
      src={url}
      alt=""
      draggable={false}
      onError={() => setMissing(true)}
    />
  )
}

type DragState = {
  item: RolledItem
  from: ItemLocation
  heroId: string
}

export function HeroInventory({
  catalog,
  hero,
  inCombat = false,
  tradePeerHeroId = null,
  headerTitle,
}: HeroInventoryProps) {
  const { scale: stageScale } = useGameStage()
  const ghostSizePx = 113 * stageScale
  const [focusItem, setFocusItem] = useState<RolledItem | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const pendingDragRef = useRef<PendingDrag | null>(null)
  dragRef.current = drag

  const header = headerTitle ?? hero.name

  const detailItem = drag?.item ?? focusItem
  const showCompare =
    detailItem != null && !isEquipped(hero, detailItem)

  useEffect(() => {
    if (!message) {
      return
    }
    const t = window.setTimeout(() => setMessage(null), 2800)
    return () => window.clearTimeout(t)
  }, [message])

  useEffect(() => subscribeInventoryDetailReset(() => setFocusItem(null)), [])

  const clearDetail = () => {
    setFocusItem(null)
  }

  const applyMove = useCallback((
    current: DragState,
    target: DropTarget,
    to: ItemLocation,
  ) => {
    if (
      target.heroId === current.heroId &&
      locKey(to) === locKey(current.from)
    ) {
      clearDetail()
      resetAllInventoryDetails()
      return
    }

    const session = getSession()
    let result:
      | { session: GameSession; ok: true }
      | { session: GameSession; ok: false; message: string }
    if (target.heroId === current.heroId) {
      result = moveHeroItem(
        session,
        catalog,
        current.heroId,
        current.from,
        to,
        inCombat,
      )
    } else if (
      tradePeerHeroId &&
      current.heroId === hero.id &&
      target.heroId === tradePeerHeroId
    ) {
      result = moveTradeItem(
        session,
        catalog,
        hero.id,
        current.from,
        tradePeerHeroId,
        to,
        inCombat,
      )
    } else if (
      tradePeerHeroId &&
      current.heroId === tradePeerHeroId &&
      target.heroId === hero.id
    ) {
      result = moveTradeItem(
        session,
        catalog,
        tradePeerHeroId,
        current.from,
        hero.id,
        to,
        inCombat,
      )
    } else {
      result = { session, ok: false, message: 'Invalid trade target' }
    }
    if (!result.ok) {
      setMessage(result.message)
      clearDetail()
      resetAllInventoryDetails()
      return
    }
    updateSession(() => result.session)
    clearDetail()
    resetAllInventoryDetails()
  }, [catalog, hero.id, inCombat, tradePeerHeroId])

  const equipFromBackpack = useCallback((item: RolledItem, from: ItemLocation) => {
    if (inCombat) {
      setMessage('Cannot move items during combat')
      return
    }
    if (from.kind !== 'backpack') {
      return
    }
    const slotId = rolledItemSlotTypeId(catalog, item)
    if (slotId == null) {
      setMessage('Wrong slot')
      return
    }
    applyMove(
      { item, from, heroId: hero.id },
      { heroId: hero.id, loc: { kind: 'equipment', slotId } },
      { kind: 'equipment', slotId },
    )
  }, [applyMove, hero.id, inCombat, catalog])

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const pending = pendingDragRef.current
      if (pending && !dragRef.current && pending.pointerId === event.pointerId) {
        const dx = event.clientX - pending.startX
        const dy = event.clientY - pending.startY
        if (Math.hypot(dx, dy) >= DRAG_START_THRESHOLD_PX) {
          dragRef.current = {
            item: pending.item,
            from: pending.from,
            heroId: hero.id,
          }
          setDrag({
            item: pending.item,
            from: pending.from,
            heroId: hero.id,
          })
          setGhost({ x: event.clientX, y: event.clientY })
          pendingDragRef.current = null
        }
      }
      if (dragRef.current) {
        setGhost({ x: event.clientX, y: event.clientY })
      }
    }
    const onUp = (event: PointerEvent) => {
      if (
        pendingDragRef.current &&
        pendingDragRef.current.pointerId === event.pointerId
      ) {
        pendingDragRef.current = null
      }
      const current = dragRef.current
      if (!current) {
        return
      }
      const target = resolveDropTarget(event.clientX, event.clientY)
      dragRef.current = null
      setDrag(null)
      setGhost(null)

      if (!target) {
        clearDetail()
        resetAllInventoryDetails()
        return
      }

      let to: ItemLocation | null = null
      if (target.loc === 'middle') {
        const slotId = rolledItemSlotTypeId(catalog, current.item)
        if (slotId == null) {
          setMessage('Wrong slot')
          clearDetail()
          resetAllInventoryDetails()
          return
        }
        to = { kind: 'equipment', slotId }
      } else {
        to = target.loc
      }

      applyMove(current, target, to)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [applyMove, hero.id])

  const onItemPointerDown = (
    event: ReactPointerEvent,
    item: RolledItem,
    from: ItemLocation,
  ) => {
    if (inCombat) {
      setMessage('Cannot move items during combat')
      return
    }
    event.preventDefault()
    pendingDragRef.current = {
      item,
      from,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    }
    setFocusItem(item)
  }

  const renderSlot = (
    loc: ItemLocation,
    item: RolledItem | null,
    emptyTip?: string,
  ) => {
    const key = locKey(loc)
    const isDragSource =
      drag != null && locKey(drag.from) === key
    const inner = item ? (
      <button
        type="button"
        className="hero-inventory-slot-btn"
        style={{ backgroundColor: rolledItemRarityColor(catalog, item) }}
        onPointerDown={(event) => onItemPointerDown(event, item, loc)}
        onDoubleClick={(event) => {
          event.preventDefault()
          pendingDragRef.current = null
          if (loc.kind === 'backpack') {
            equipFromBackpack(item, loc)
          }
        }}
        onMouseEnter={() => setFocusItem(item)}
        onMouseLeave={() => {
          if (!dragRef.current) {
            setFocusItem(null)
          }
        }}
      >
        <ItemArt catalog={catalog} item={item} />
      </button>
    ) : (
      <div className="hero-inventory-slot-empty">
        {emptyTip ? (
          <AbilityTip description={emptyTip} placement="portal-right">
            <span className="hero-inventory-empty-hit" aria-hidden="true" />
          </AbilityTip>
        ) : (
          <span className="hero-inventory-empty-hit" aria-hidden="true" />
        )}
      </div>
    )
    return (
      <div
        key={key}
        className={
          isDragSource
            ? 'hero-inventory-slot hero-inventory-slot-drag-source'
            : 'hero-inventory-slot'
        }
        data-inv-loc={key}
      >
        {inner}
      </div>
    )
  }

  const slotLines = inventorySlotSummaryLines(catalog, hero)
  const statLines = equippedSummaryStatLines(catalog, hero)

  const leftEquipRows: Array<{ slotId: number; row: number }> = [
    { slotId: LEFT_SLOTS[0], row: 1 },
    { slotId: LEFT_SLOTS[1], row: 2 },
    { slotId: LEFT_SLOTS[2], row: 3 },
  ]
  const rightEquipRows: Array<{ slotId: number; row: number }> = [
    { slotId: RIGHT_SLOTS[0], row: 1 },
    { slotId: RIGHT_SLOTS[1], row: 2 },
    { slotId: RIGHT_SLOTS[2], row: 3 },
  ]

  return (
    <div
      className="hero-inventory"
      aria-label="Inventory"
      data-inv-hero={hero.id}
      onMouseLeave={() => {
        if (!dragRef.current) {
          clearDetail()
          resetAllInventoryDetails()
        }
      }}
    >
      <header className="hero-inventory-header">{header}</header>
      <div className="hero-inventory-grid">
        {leftEquipRows.map(({ slotId, row }) => (
          <div
            key={`eq-${slotId}`}
            className="hero-inventory-grid-cell"
            style={{ gridColumn: 1, gridRow: row }}
          >
            {renderSlot(
              { kind: 'equipment', slotId },
              hero.equipment[slotId] ?? null,
              inventoryEmptySlotTooltip(catalog, slotId),
            )}
          </div>
        ))}
        <div
          className="hero-inventory-middle"
          data-inv-loc="middle"
          style={{ gridColumn: '2 / 5', gridRow: '1 / 4' }}
          onMouseLeave={() => {
            if (!dragRef.current) {
              setFocusItem(null)
            }
          }}
        >
          {detailItem ? (
            <div className="hero-inventory-detail">
              <div
                className="hero-inventory-detail-name"
                style={{ color: rolledItemRarityColor(catalog, detailItem) }}
              >
                {rolledItemDisplayName(catalog, detailItem)}
              </div>
              <div className="hero-inventory-detail-meta">
                {rolledItemRarityName(catalog, detailItem)} -{' '}
                {(() => {
                  const slotId = rolledItemSlotTypeId(catalog, detailItem)
                  return slotId != null
                    ? inventorySlotTypeName(catalog, slotId)
                    : 'Item'
                })()}
              </div>
              {inventoryItemDetailLines(
                catalog,
                hero,
                detailItem,
                showCompare,
              ).map((line, index) => (
                <div key={`${index}-${line.left}`} className="hero-inventory-detail-stat">
                  <span>{line.left}</span>
                  {line.compare ? (
                    <span
                      className={
                        line.compareTone === 'gain'
                          ? 'hero-inventory-cmp-gain'
                          : 'hero-inventory-cmp-loss'
                      }
                    >
                      {line.compare}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="hero-inventory-summary">
              {slotLines.map((line) => (
                <div
                  key={line.text}
                  className="hero-inventory-summary-slot"
                  style={line.color ? { color: line.color } : undefined}
                >
                  {line.text}
                </div>
              ))}
              <div className="hero-inventory-summary-divider" />
              {statLines.map((line) => (
                <div key={line} className="hero-inventory-summary-stat">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
        {rightEquipRows.map(({ slotId, row }) => (
          <div
            key={`eq-${slotId}`}
            className="hero-inventory-grid-cell"
            style={{ gridColumn: 5, gridRow: row }}
          >
            {renderSlot(
              { kind: 'equipment', slotId },
              hero.equipment[slotId] ?? null,
              inventoryEmptySlotTooltip(catalog, slotId),
            )}
          </div>
        ))}
        {Array.from({ length: BACKPACK_SIZE }, (_, index) => {
          const col = (index % 5) + 1
          const row = Math.floor(index / 5) + 4
          return (
            <div
              key={`bp-${index}`}
              className="hero-inventory-grid-cell"
              style={{ gridColumn: col, gridRow: row }}
            >
              {renderSlot(
                { kind: 'backpack', index },
                hero.backpack[index] ?? null,
              )}
            </div>
          )
        })}
      </div>
      {message ? (
        <p className="hero-inventory-message" role="status">{message}</p>
      ) : null}
      {drag && ghost
        ? createPortal(
            <div
              className="hero-inventory-ghost"
              style={{
                left: ghost.x,
                top: ghost.y,
                width: ghostSizePx,
                height: ghostSizePx,
                backgroundColor: rolledItemRarityColor(catalog, drag.item),
              }}
            >
              <ItemArt catalog={catalog} item={drag.item} />
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
