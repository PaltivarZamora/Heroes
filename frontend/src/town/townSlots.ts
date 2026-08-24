export type SlotState = {
  level: number
  buildingId: number | null
  recruitQty: number
}

const slotsByTown = new Map<string, SlotState[]>()

const SLOT_COUNT = 12

function emptySlots(): SlotState[] {
  return Array.from({ length: SLOT_COUNT }, () => ({
    level: 0,
    buildingId: null,
    recruitQty: 0,
  }))
}

export function getTownSlots(townName: string): SlotState[] {
  let slots = slotsByTown.get(townName)
  if (!slots) {
    slots = emptySlots()
    slotsByTown.set(townName, slots)
  } else if (slots.length < SLOT_COUNT) {
    slots = [...slots, ...emptySlots().slice(slots.length)]
    slotsByTown.set(townName, slots)
  }
  return slots
}

export function patchTownSlot(
  townName: string,
  slotIndex: number,
  next: SlotState,
): SlotState[] {
  const slots = getTownSlots(townName).slice()
  slots[slotIndex] = next
  slotsByTown.set(townName, slots)
  return slots
}
