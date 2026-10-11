import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getSession, updateSession } from '../session/store'
import {
  dropHeldArmyStack,
  humanPlayer,
  placeArmyStack,
  returnHeldArmyStack,
  splitArmyStack,
  splitArmyStackEvenly,
  stackUpgradeOffer,
  upgradeArmyStack,
  type ArmyRowId,
  type ArmySlotRef,
} from '../session/accessors'
import {
  logArmyBuyAll,
  logArmyStackUpgraded,
  logArmyUpgradeAll,
} from '../session/gameLog'
import type { GameSession } from '../session/types'
import { formatCost, unitById, type ReferenceCatalog } from './catalog'
import { ArmyRow } from './ArmyRow'
import { ArmySplitPopup } from './ArmySplitPopup'
import {
  applyBuyAllGarrison,
  applyUpgradeAll,
  canAffordFullStackUpgrade,
  canSplitStack,
  portraitUpgradeAllAvailable,
  previewUpgradeAllConfirm,
  previewBuyAllGarrison,
} from './armyOps'
import {
  setArmyConfirmHandler,
  setArmyPopupOpen,
  setArmyUpgradeAllHandler,
} from './armyKeybindBridge'
import { loadPlayerSettings } from '../settings/playerSettings'
import { stackView, UnitStackFace } from './unitStack'
import {
  formatToolkitRows,
  sessionUnitToolkitRows,
} from './UnitToolkitTip'
import { heroTooltipText } from './HeroTooltip'
import { AbilityTip } from './AbilityTip'

export type ArmyRowSpec = {
  row: ArmyRowId
  heroId?: string | null
  portraitLabel: string
  portraitFilename: string | null
  portraitTip?: string | null
  onPortraitClick?: () => void
  orientation?: 'horizontal' | 'vertical'
  showPortrait?: boolean
  padSlotsTo?: number
  portraitOverlay?: ReactNode
  showBuyAll?: boolean
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
  const town = session.towns.find((item) => item.id === townId)
  if (!town) {
    return [null, null, null, null, null, null]
  }
  if (row === 'garrison') {
    return [0, 1, 2, 3, 4, 5].map((index) => town.garrison.slots_1_to_6[index] ?? null)
  }
  return [null, null, null, null, null, null]
}

function stackAt(session: GameSession, townId: string, ref: ArmySlotRef) {
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

function unitName(catalog: ReferenceCatalog | null, unitId: number): string {
  return unitById(catalog, unitId)?.name ?? 'Unit'
}

export function ArmyTransfer({
  session,
  townId,
  catalog,
  rows,
  primaryHeroId = null,
  readOnly = false,
  leading = null,
}: {
  session: GameSession
  townId: string
  catalog: ReferenceCatalog | null
  rows: ArmyRowSpec[]
  primaryHeroId?: string | null
  readOnly?: boolean
  leading?: ReactNode
}) {
  const [splitSlot, setSplitSlot] = useState<ArmySlotRef | null>(null)
  const [splitQty, setSplitQty] = useState(1)
  const [evenlyFrom, setEvenlyFrom] = useState<ArmySlotRef | null>(null)
  const [held, setHeld] = useState<{ stackId: string; origin: ArmySlotRef } | null>(null)
  const [heldView, setHeldView] = useState<{ filename: string | null; qty: number } | null>(null)
  const [dragging, setDragging] = useState<ArmySlotRef | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const [armyMessage, setArmyMessage] = useState<string | null>(null)
  const [confirmUpgradeAll, setConfirmUpgradeAll] = useState<{
    row: ArmyRowId
    heroId: string | null
    lines: string[]
    total: string
    willUpgrade: number
  } | null>(null)
  const [confirmUpgradeOne, setConfirmUpgradeOne] = useState<{
    ref: ArmySlotRef
    label: string
  } | null>(null)

  const heldRef = useRef(held)
  const draggingRef = useRef(dragging)
  const splitQtyRef = useRef(splitQty)
  heldRef.current = held
  draggingRef.current = dragging
  splitQtyRef.current = splitQty

  const popupOpen =
    splitSlot != null ||
    confirmUpgradeAll != null ||
    confirmUpgradeOne != null

  useEffect(() => {
    setArmyPopupOpen(popupOpen)
    return () => setArmyPopupOpen(false)
  }, [popupOpen])

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
    setHeldView(null)
    setGhost(null)
    setArmyMessage(notice)
  }

  const runUpgradeAll = (row: ArmyRowId, heroId: string | null) => {
    if (!catalog || readOnly) {
      return
    }
    const preview = previewUpgradeAllConfirm(
      session,
      catalog,
      townId,
      row,
      heroId,
      primaryHeroId,
      formatCost,
    )
    if (preview.willUpgrade === 0) {
      return
    }
    const settings = loadPlayerSettings()
    if (settings.confirmUpgradeAll) {
      setConfirmUpgradeAll({
        row,
        heroId,
        lines: preview.lines,
        total: preview.total,
        willUpgrade: preview.willUpgrade,
      })
      return
    }
    commitUpgradeAll(row, heroId, preview.willUpgrade)
  }

  const commitUpgradeAll = (row: ArmyRowId, heroId: string | null, expected: number) => {
    if (!catalog) {
      return
    }
    const player = humanPlayer(getSession())
    updateSession((current) => {
      const applied = applyUpgradeAll(
        current,
        catalog,
        townId,
        row,
        heroId,
        primaryHeroId,
      )
      let next = applied.session
      if (player && applied.upgraded > 0) {
        next = logArmyUpgradeAll(
          next,
          player.id,
          townId,
          applied.upgraded,
          formatCost(applied.totalCost),
        )
      }
      return next
    })
    setConfirmUpgradeAll(null)
    setArmyMessage(
      expected > 0 ? `Upgraded ${expected} stack(s).` : 'No upgrades applied.',
    )
  }

  const commitSingleUpgrade = (ref: ArmySlotRef) => {
    if (!catalog || readOnly) {
      return
    }
    const before = stackAt(getSession(), townId, ref)
    const offer = before
      ? stackUpgradeOffer(getSession(), catalog, townId, before)
      : null
    let error: string | null = null
    updateSession((currentSession) => {
      const result = upgradeArmyStack(currentSession, townId, ref, catalog)
      error = result.error
      if (result.error || !before || !offer) {
        return result.error ? currentSession : result.session
      }
      const player = humanPlayer(result.session)
      if (!player) {
        return result.session
      }
      return logArmyStackUpgraded(
        result.session,
        player.id,
        townId,
        unitName(catalog, before.unit_id),
        offer.advanced.name,
        before.qty,
        formatCost(offer.total),
      )
    })
    setConfirmUpgradeOne(null)
    setArmyMessage(error)
  }

  useEffect(() => {
    setArmyUpgradeAllHandler(() => {
      if (readOnly || !catalog) {
        return
      }
      const heroRow = rows.find((row) => row.row === 'hero' && row.heroId === primaryHeroId)
      const garrisonRow = rows.find((row) => row.row === 'garrison')
      if (
        heroRow &&
        portraitUpgradeAllAvailable(
          getSession(),
          catalog,
          townId,
          'hero',
          heroRow.heroId ?? null,
          primaryHeroId,
        )
      ) {
        runUpgradeAll('hero', heroRow.heroId ?? null)
        return
      }
      if (
        garrisonRow &&
        portraitUpgradeAllAvailable(
          getSession(),
          catalog,
          townId,
          'garrison',
          null,
          primaryHeroId,
        )
      ) {
        runUpgradeAll('garrison', null)
      }
    })
    return () => setArmyUpgradeAllHandler(null)
  }, [catalog, townId, rows, primaryHeroId, readOnly, session])

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (heldRef.current || draggingRef.current) {
        setGhost({ x: event.clientX, y: event.clientY })
      }
    }
    const onUp = (event: PointerEvent) => {
      const target = slotFromPoint(event.clientX, event.clientY)
      const currentHeld = heldRef.current
      const currentDrag = draggingRef.current
      if (currentHeld) {
        if (!target || target === 'portrait') {
          if (target !== 'portrait') {
            return
          }
          cancelHeld("Can't drop on the portrait.")
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
            primaryHeroId,
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
        setHeldView(null)
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
            primaryHeroId,
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
      const busy =
        heldRef.current != null ||
        draggingRef.current != null ||
        splitSlot != null ||
        evenlyFrom != null ||
        confirmUpgradeAll != null ||
        confirmUpgradeOne != null
      if (!busy) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      if (heldRef.current) {
        cancelHeld(null)
        return
      }
      draggingRef.current = null
      setDragging(null)
      setGhost(null)
      setSplitSlot(null)
      setEvenlyFrom(null)
      setConfirmUpgradeAll(null)
      setConfirmUpgradeOne(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [
    splitSlot,
    evenlyFrom,
    confirmUpgradeAll,
    confirmUpgradeOne,
    townId,
    primaryHeroId,
  ])

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

  const pickUpSplit = (qty: number) => {
    if (!splitSlot || !catalog) {
      return
    }
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
    const stack = getSession().units.find((row) => row.id === heldStackId)
    const view = stackView(getSession(), heldStackId, catalog)
    const nextHeld = { stackId: heldStackId, origin: splitSlot }
    heldRef.current = nextHeld
    setHeld(nextHeld)
    setHeldView({ filename: view.filename, qty: stack?.qty ?? qty })
    setSplitSlot(null)
    setArmyMessage(null)
  }

  useEffect(() => {
    if (!splitSlot) {
      setArmyConfirmHandler(null)
      return
    }
    setArmyConfirmHandler(() => {
      pickUpSplit(splitQtyRef.current)
      return true
    })
    return () => setArmyConfirmHandler(null)
  }, [splitSlot, townId, catalog])

  const splitStack = splitSlot ? stackAt(session, townId, splitSlot) : null
  const splitUnitName = splitStack
    ? unitName(catalog, splitStack.unit_id)
    : 'Unit'

  const buyPreview =
    catalog && rows.some((row) => row.showBuyAll)
      ? previewBuyAllGarrison(session, catalog, townId)
      : null

  const confirmHost = document.querySelector('.game-stage')

  return (
    <>
      <div className="town-army-rows town-army-dock-columns">
        {leading}
        {rows.map((spec, index) => (
          <ArmyRow
            key={`${spec.row}:${spec.heroId ?? index}`}
            row={spec.row}
            heroId={spec.heroId}
            portraitLabel={spec.portraitLabel}
            portraitFilename={spec.portraitFilename}
            orientation={spec.orientation}
            showPortrait={spec.showPortrait}
            padSlotsTo={spec.padSlotsTo}
            portraitOverlay={spec.portraitOverlay}
            onPortraitClick={spec.onPortraitClick}
            evenlyPickHighlight={evenlyFrom != null}
            portraitUpgrade={
              catalog && !readOnly
                ? {
                    show: portraitUpgradeAllAvailable(
                      session,
                      catalog,
                      townId,
                      spec.row,
                      spec.heroId ?? null,
                      primaryHeroId,
                    ),
                    tip: 'Upgrade all affordable stacks',
                    onClick: () => runUpgradeAll(spec.row, spec.heroId ?? null),
                  }
                : undefined
            }
            portraitTip={
              spec.portraitTip ??
              (catalog && spec.heroId
                ? (() => {
                    const h = session.heroes.find((row) => row.id === spec.heroId)
                    return h ? heroTooltipText(catalog, h, session) : null
                  })()
                : null)
            }
            armyStacks={rowSlotIds(session, townId, spec.row, spec.heroId).map(
              (id) => stackView(session, id, catalog),
            )}
            slotTip={(slot, stack) => {
              if (!catalog || stack.empty) {
                return null
              }
              const unit = stackAt(session, townId, {
                row: spec.row,
                slot,
                heroId: spec.heroId,
              })
              if (!unit) {
                return null
              }
              return formatToolkitRows(
                sessionUnitToolkitRows(catalog, unit.unit_id, unit.qty),
              )
            }}
            slotActions={(slot, stack) => {
              if (stack.empty || readOnly || !catalog) {
                return {}
              }
              const ref: ArmySlotRef = {
                row: spec.row,
                slot,
                heroId: spec.heroId,
              }
              return {
                canUpgrade: canAffordFullStackUpgrade(
                  session,
                  catalog,
                  townId,
                  ref,
                  primaryHeroId,
                ),
                canSplit: canSplitStack(session, townId, ref, readOnly),
                onUpgrade: () => {
                  const stackRow = stackAt(session, townId, ref)
                  const offer = stackRow
                    ? stackUpgradeOffer(session, catalog, townId, stackRow)
                    : null
                  if (!stackRow || !offer) {
                    return
                  }
                  const label = `${stackRow.qty} ${unitName(catalog, stackRow.unit_id)} → ${offer.advanced.name}: ${formatCost(offer.total)}`
                  if (loadPlayerSettings().confirmUpgrade) {
                    setConfirmUpgradeOne({ ref, label })
                    return
                  }
                  commitSingleUpgrade(ref)
                },
                onSplit: () => {
                  setSplitQty(1)
                  setSplitSlot(ref)
                },
              }
            }}
            onSlotPointerDown={(slot, event) => {
              if (event.button !== 0 || held || evenlyFrom) {
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
              setArmyMessage(null)
            }}
            onEmptySlotPointerDown={(slot, event) => {
              if (event.button !== 0 || held) {
                return
              }
              if (evenlyFrom) {
                event.preventDefault()
                const target: ArmySlotRef = {
                  row: spec.row,
                  slot,
                  heroId: spec.heroId,
                }
                let error: string | null = null
                updateSession((currentSession) => {
                  const result = splitArmyStackEvenly(
                    currentSession,
                    townId,
                    evenlyFrom,
                    target,
                    primaryHeroId,
                  )
                  error = result.error
                  return result.error ? currentSession : result.session
                })
                setEvenlyFrom(null)
                setArmyMessage(error)
                return
              }
            }}
            trailingSlot={
              spec.showBuyAll && catalog
                ? (() => {
                    const tip =
                      buyPreview && buyPreview.lines.length > 0
                        ? [
                            'Buy All',
                            ...buyPreview.lines.map(
                              (line) =>
                                `+${line.qty} ${line.unitName} (${formatCost(line.cost)})`,
                            ),
                            `Total: ${formatCost(buyPreview.total)}`,
                          ].join('\n')
                        : 'Nothing available to buy for the garrison.'
                    const btn = (
                      <button
                        type="button"
                        className={`town-army-box town-army-slot army-buy-all-slot${buyPreview?.canBuy ? '' : ' is-disabled'}`}
                        disabled={!buyPreview?.canBuy || readOnly}
                        onClick={() => {
                          if (!catalog || readOnly || !buyPreview?.canBuy) {
                            return
                          }
                          const player = humanPlayer(getSession())
                          updateSession((current) => {
                            const result = applyBuyAllGarrison(
                              current,
                              catalog,
                              townId,
                            )
                            if (result.error) {
                              return current
                            }
                            let next = result.session
                            if (player) {
                              for (const line of result.lines) {
                                next = logArmyBuyAll(
                                  next,
                                  player.id,
                                  townId,
                                  line.unitName,
                                  line.qty,
                                  formatCost(line.cost),
                                )
                              }
                            }
                            return next
                          })
                        }}
                      >
                        Buy All
                      </button>
                    )
                    return (
                      <AbilityTip key="buy-all" description={tip}>
                        {btn}
                      </AbilityTip>
                    )
                  })()
                : undefined
            }
          />
        ))}
        {armyMessage ? (
          <p className="town-army-message">{armyMessage}</p>
        ) : null}
      </div>

      <ArmySplitPopup
        open={splitSlot != null}
        unitName={splitUnitName}
        stackQty={splitStack?.qty ?? 1}
        qty={splitQty}
        onQtyChange={setSplitQty}
        onPickUp={() => pickUpSplit(splitQty)}
        onHalf={() => {
          const half = Math.floor((splitStack?.qty ?? 2) / 2)
          pickUpSplit(Math.max(1, half))
        }}
        onEvenly={() => {
          if (splitSlot) {
            setEvenlyFrom(splitSlot)
            setSplitSlot(null)
            setArmyMessage('Click an open slot in an army to split evenly.')
          }
        }}
        onCancel={() => setSplitSlot(null)}
      />

      {ghost && heldView
        ? createPortal(
            <div
              className="town-army-ghost town-army-ghost-stack"
              style={{ left: ghost.x + 12, top: ghost.y + 12 }}
            >
              <UnitStackFace
                empty={false}
                filename={heldView.filename}
                qty={heldView.qty}
              />
            </div>,
            document.body,
          )
        : null}

      {confirmHost && confirmUpgradeAll
        ? createPortal(
            <div className="army-confirm-popup" role="dialog">
              <p className="army-confirm-title">Upgrade All</p>
              <ul className="army-confirm-lines">
                {confirmUpgradeAll.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p>Total: {confirmUpgradeAll.total}</p>
              <div className="army-split-popup-actions">
                <button
                  type="button"
                  onClick={() =>
                    commitUpgradeAll(
                      confirmUpgradeAll.row,
                      confirmUpgradeAll.heroId,
                      confirmUpgradeAll.willUpgrade,
                    )
                  }
                >
                  Confirm
                </button>
                <button type="button" onClick={() => setConfirmUpgradeAll(null)}>
                  Cancel
                </button>
              </div>
            </div>,
            confirmHost,
          )
        : null}

      {confirmHost && confirmUpgradeOne
        ? createPortal(
            <div className="army-confirm-popup" role="dialog">
              <p className="army-confirm-title">Upgrade stack</p>
              <p>{confirmUpgradeOne.label}</p>
              <div className="army-split-popup-actions">
                <button
                  type="button"
                  onClick={() => commitSingleUpgrade(confirmUpgradeOne.ref)}
                >
                  Confirm
                </button>
                <button type="button" onClick={() => setConfirmUpgradeOne(null)}>
                  Cancel
                </button>
              </div>
            </div>,
            confirmHost,
          )
        : null}
    </>
  )
}
