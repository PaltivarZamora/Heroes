import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { formatAmount } from '../hex/resources'
import { getSession, updateSession } from '../session/store'
import {
  dropHeldArmyStack,
  findTownById,
  placeArmyStack,
  returnHeldArmyStack,
  splitArmyStack,
  visitingHeroId,
  type ArmyRowId,
  type ArmySlotRef,
} from '../session/accessors'
import type { GameSession } from '../session/types'
import type { ReferenceCatalog } from './catalog'
import { heroPortraitUrl } from './slotArt'

export type ArmyRowSpec = {
  row: ArmyRowId
  heroId?: string | null
  portraitLabel: string
  portraitFilename: string | null
}

function PortraitFace({
  label,
  filename,
}: {
  label: string
  filename: string | null
}) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    setMissing(false)
  }, [filename])
  if (!filename) {
    return label
  }
  if (missing) {
    return <span className="town-building-slot-filename">{filename}</span>
  }
  return (
    <img
      src={heroPortraitUrl(filename)}
      alt={label}
      onError={() => setMissing(true)}
    />
  )
}

function stackLabel(
  session: GameSession,
  stackId: string | null | undefined,
  catalog: ReferenceCatalog | null,
): string {
  if (!stackId) {
    return 'Empty'
  }
  const stack = session.units.find((row) => row.id === stackId)
  if (!stack) {
    return 'Empty'
  }
  const unit = catalog?.unit.find((row) => row.id === stack.unit_id)
  return `${unit?.name ?? 'Unknown'} - ${formatAmount(stack.qty)}`
}

function emptySlots(): Array<string | null> {
  return [null, null, null, null, null, null]
}

function rowSlotIds(
  session: GameSession,
  townId: string,
  row: ArmyRowId,
  heroId?: string | null,
): Array<string | null> {
  if (row === 'hero' && heroId) {
    const hero = session.heroes.find((item) => item.id === heroId)
    const slots = hero?.army.slots_1_to_6 ?? []
    return [0, 1, 2, 3, 4, 5].map((index) => slots[index] ?? null)
  }
  const town = findTownById(session, townId)
  if (!town) {
    return emptySlots()
  }
  if (row === 'garrison') {
    const slots = town.garrison.slots_1_to_6
    return [0, 1, 2, 3, 4, 5].map((index) => slots[index] ?? null)
  }
  const visiting = visitingHeroId(session, town, heroId)
  const hero = visiting
    ? session.heroes.find((item) => item.id === visiting)
    : null
  const slots = hero?.army.slots_1_to_6 ?? []
  return [0, 1, 2, 3, 4, 5].map((index) => slots[index] ?? null)
}

function stackAt(
  session: GameSession,
  townId: string,
  ref: ArmySlotRef,
) {
  const id = rowSlotIds(session, townId, ref.row, ref.heroId)[ref.slot - 1]
  return id ? session.units.find((row) => row.id === id) ?? null : null
}

function slotFromPoint(x: number, y: number): ArmySlotRef | 'portrait' | null {
  const el = document.elementFromPoint(x, y)
  if (!(el instanceof Element)) {
    return null
  }
  if (el.closest('[data-portrait]')) {
    return 'portrait'
  }
  const slotEl = el.closest('[data-row][data-slot]')
  if (!(slotEl instanceof HTMLElement)) {
    return null
  }
  const row = slotEl.dataset.row
  const slot = Number(slotEl.dataset.slot)
  if ((row !== 'garrison' && row !== 'hero') || !Number.isInteger(slot)) {
    return null
  }
  const heroId = slotEl.dataset.heroId
  return { row, slot, heroId: heroId || undefined }
}

export function ArmyTransfer({
  session,
  townId,
  catalog,
  rows,
}: {
  session: GameSession
  townId: string
  catalog: ReferenceCatalog | null
  rows: ArmyRowSpec[]
}) {
  const [menu, setMenu] = useState<{
    slot: ArmySlotRef
    x: number
    y: number
  } | null>(null)
  const [splitSlot, setSplitSlot] = useState<ArmySlotRef | null>(null)
  const [splitText, setSplitText] = useState('1')
  const [held, setHeld] = useState<{
    stackId: string
    origin: ArmySlotRef
  } | null>(null)
  const [dragging, setDragging] = useState<ArmySlotRef | null>(null)
  const [ghost, setGhost] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
  const [armyMessage, setArmyMessage] = useState<string | null>(null)
  const heldRef = useRef(held)
  const draggingRef = useRef(dragging)
  heldRef.current = held
  draggingRef.current = dragging

  const cancelHeld = (notice: string | null) => {
    const current = heldRef.current
    if (!current) {
      return
    }
    updateSession((currentSession) =>
      returnHeldArmyStack(
        currentSession,
        townId,
        current.stackId,
        current.origin,
      ),
    )
    heldRef.current = null
    setHeld(null)
    setGhost(null)
    setArmyMessage(notice)
  }

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const currentHeld = heldRef.current
      const currentDrag = draggingRef.current
      if (!currentHeld && !currentDrag) {
        return
      }
      const text = currentHeld
        ? stackLabel(getSession(), currentHeld.stackId, catalog)
        : currentDrag
          ? stackLabel(
              getSession(),
              rowSlotIds(
                getSession(),
                townId,
                currentDrag.row,
                currentDrag.heroId,
              )[currentDrag.slot - 1],
              catalog,
            )
          : ''
      setGhost({ x: event.clientX, y: event.clientY, text })
    }
    const onUp = (event: PointerEvent) => {
      const target = slotFromPoint(event.clientX, event.clientY)
      const currentHeld = heldRef.current
      const currentDrag = draggingRef.current
      if (currentHeld) {
        if (!target || target === 'portrait') {
          cancelHeld(
            target === 'portrait'
              ? "Can't drop on the portrait."
              : 'Split stack returned to its origin.',
          )
          return
        }
        let error: string | null = null
        updateSession((currentSession) => {
          const result = dropHeldArmyStack(
            currentSession,
            townId,
            currentHeld.stackId,
            currentHeld.origin,
            target,
          )
          if (result.error) {
            error = result.error
            return returnHeldArmyStack(
              currentSession,
              townId,
              currentHeld.stackId,
              currentHeld.origin,
            )
          }
          return result.session
        })
        heldRef.current = null
        setHeld(null)
        setGhost(null)
        setArmyMessage(error)
        return
      }
      if (!currentDrag) {
        return
      }
      if (target && target !== 'portrait') {
        let error: string | null = null
        updateSession((currentSession) => {
          const result = placeArmyStack(
            currentSession,
            townId,
            currentDrag,
            target,
          )
          error = result.error
          return result.error ? currentSession : result.session
        })
        setArmyMessage(error)
      } else if (target === 'portrait') {
        setArmyMessage("Can't drop on the portrait.")
      }
      draggingRef.current = null
      setDragging(null)
      setGhost(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (heldRef.current) {
        cancelHeld('Split stack returned to its origin.')
      }
      draggingRef.current = null
      setDragging(null)
      setGhost(null)
      setMenu(null)
      setSplitSlot(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [catalog, townId])

  useEffect(() => {
    return () => {
      const current = heldRef.current
      if (current) {
        updateSession((currentSession) =>
          returnHeldArmyStack(
            currentSession,
            townId,
            current.stackId,
            current.origin,
          ),
        )
      }
    }
  }, [townId])

  const confirmSplit = () => {
    if (!splitSlot) {
      return
    }
    const qty = Number.parseInt(splitText, 10)
    let error: string | null = null
    let heldStackId: string | null = null
    updateSession((currentSession) => {
      const result = splitArmyStack(currentSession, townId, splitSlot, qty)
      error = result.error
      heldStackId = result.heldStackId
      return result.error ? currentSession : result.session
    })
    if (error || !heldStackId) {
      setArmyMessage(error)
      return
    }
    const nextHeld = { stackId: heldStackId, origin: splitSlot }
    heldRef.current = nextHeld
    setHeld(nextHeld)
    setSplitSlot(null)
    setMenu(null)
    setArmyMessage('Drop the split stack on a slot (Esc cancels).')
  }

  return (
    <div className="town-army-rows">
      {rows.map((spec, index) => (
        <ArmyRow
          key={`${spec.row}:${spec.heroId ?? index}`}
          row={spec.row}
          heroId={spec.heroId}
          portraitLabel={spec.portraitLabel}
          portraitFilename={spec.portraitFilename}
          armyLabels={rowSlotIds(session, townId, spec.row, spec.heroId).map(
            (id) => stackLabel(session, id, catalog),
          )}
          onSlotPointerDown={(slot, event) => {
            if (event.button !== 0 || held) {
              return
            }
            const ref: ArmySlotRef = {
              row: spec.row,
              slot,
              heroId: spec.heroId,
            }
            if (!stackAt(session, townId, ref)) {
              return
            }
            event.preventDefault()
            draggingRef.current = ref
            setDragging(ref)
            setMenu(null)
            setArmyMessage(null)
          }}
          onSlotContextMenu={(slot, event) => {
            const ref: ArmySlotRef = {
              row: spec.row,
              slot,
              heroId: spec.heroId,
            }
            if (held || !stackAt(session, townId, ref)) {
              return
            }
            event.preventDefault()
            setMenu({ slot: ref, x: event.clientX, y: event.clientY })
            setSplitSlot(null)
          }}
        />
      ))}
      {armyMessage ? (
        <p className="town-army-message">{armyMessage}</p>
      ) : null}
      {held ? (
        <p className="town-army-message">
          Holding {stackLabel(session, held.stackId, catalog)}
        </p>
      ) : null}
      {menu ? (
        <div
          className="town-army-menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            onClick={() => {
              setSplitSlot(menu.slot)
              setSplitText('1')
              setMenu(null)
            }}
          >
            Split
          </button>
        </div>
      ) : null}
      {splitSlot ? (
        <div className="town-army-split">
          <label className="town-recruit-qty">
            Split quantity
            <input
              type="number"
              min={1}
              max={Math.max(1, (stackAt(session, townId, splitSlot)?.qty ?? 1) - 1)}
              value={splitText}
              onChange={(event) => setSplitText(event.target.value)}
            />
          </label>
          <div className="town-recruit-actions">
            <button type="button" onClick={confirmSplit}>
              Confirm
            </button>
            <button type="button" onClick={() => setSplitSlot(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {ghost ? (
        <div
          className="town-army-ghost"
          style={{ left: ghost.x + 12, top: ghost.y + 12 }}
        >
          {ghost.text}
        </div>
      ) : null}
    </div>
  )
}

function ArmyRow({
  row,
  heroId,
  portraitLabel,
  portraitFilename,
  armyLabels,
  onSlotPointerDown,
  onSlotContextMenu,
}: {
  row: ArmyRowId
  heroId?: string | null
  portraitLabel: string
  portraitFilename: string | null
  armyLabels: string[]
  onSlotPointerDown: (slot: number, event: ReactPointerEvent) => void
  onSlotContextMenu: (slot: number, event: ReactMouseEvent) => void
}) {
  return (
    <div className="town-army-row">
      <div
        className="town-army-box town-army-portrait"
        data-portrait={row}
        aria-label={portraitLabel}
      >
        <PortraitFace label={portraitLabel} filename={portraitFilename} />
      </div>
      {armyLabels.map((text, index) => (
        <button
          key={index}
          type="button"
          className="town-army-box town-army-slot"
          data-row={row}
          data-slot={index + 1}
          data-hero-id={heroId ?? undefined}
          onPointerDown={(event) => onSlotPointerDown(index + 1, event)}
          onContextMenu={(event) => onSlotContextMenu(index + 1, event)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
