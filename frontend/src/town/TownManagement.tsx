import { useState } from 'react'

const BUILDING_SLOTS = [
  { id: 1, label: 'Resource Generator' },
  { id: 2, label: 'Tavern' },
  { id: 3, label: 'Fort / Citadel / Castle' },
  { id: 4, label: 'Army Tier 1' },
  { id: 5, label: 'Army Tier 2' },
  { id: 6, label: 'Army Tier 3' },
  { id: 7, label: 'Army Tier 4' },
  { id: 8, label: 'Army Tier 5' },
  { id: 9, label: 'Army Tier 6' },
] as const

const SKYLINE_URL = '/assets/towns/Necropolis_Skyline.jpg'

type TownManagementProps = {
  townName: string
  onExit: () => void
}

export function TownManagement({ townName, onExit }: TownManagementProps) {
  const [slotMessage, setSlotMessage] = useState('Click a building slot')

  return (
    <div
      className="town-management"
      role="dialog"
      aria-modal="true"
      aria-labelledby="town-management-title"
    >
      <div
        className="town-management-skyline"
        style={{ backgroundImage: `url(${SKYLINE_URL})` }}
      >
        <header className="town-management-bar">
          <h1 id="town-management-title">{townName}</h1>
          <button type="button" onClick={onExit}>
            Exit Town
          </button>
        </header>
      </div>
      <div className="town-management-panel">
        <div className="town-building-grid">
          {BUILDING_SLOTS.map((slot) => (
            <button
              key={slot.id}
              type="button"
              className="town-building-slot"
              onClick={() =>
                setSlotMessage(`Slot ${slot.id} clicked — ${slot.label}`)
              }
            >
              <span className="town-building-slot-id">{slot.id}</span>
              <span>{slot.label}</span>
            </button>
          ))}
        </div>
        <p className="town-slot-status">{slotMessage}</p>
      </div>
    </div>
  )
}
