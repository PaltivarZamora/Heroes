type ReservedCornerProps = {
  onHero: () => void
  onTown: () => void
  onScrolls: () => void
}

export function ReservedCorner({
  onHero,
  onTown,
  onScrolls,
}: ReservedCornerProps) {
  return (
    <div className="town-reserved-corner" aria-label="Reserved">
      <button type="button" onClick={onHero}>
        H
      </button>
      <button type="button" onClick={onTown}>
        T
      </button>
      <button type="button" onClick={onScrolls}>
        S
      </button>
    </div>
  )
}
