import { useRef, type ReactNode } from 'react'

const PAD = 8
const GAP = 6

function placeTip(anchor: HTMLElement, body: HTMLElement) {
  const contain = anchor.closest('[data-tip-contain]')
  if (!(contain instanceof HTMLElement)) {
    return
  }
  body.style.left = '50%'
  body.style.top = 'auto'
  body.style.bottom = `calc(100% + ${GAP}px)`
  body.style.transform = 'translateX(-50%)'
  const box = contain.getBoundingClientRect()
  const inner = {
    left: box.left + contain.clientLeft,
    top: box.top + contain.clientTop,
    right: box.left + contain.clientLeft + contain.clientWidth,
    bottom: box.top + contain.clientTop + contain.clientHeight,
  }
  const trigger = anchor.getBoundingClientRect()
  const size = body.getBoundingClientRect()
  if (size.width === 0 || size.height === 0) {
    return
  }
  let top = trigger.top - GAP - size.height
  if (top < inner.top + PAD) {
    top = trigger.bottom + GAP
  }
  if (top + size.height > inner.bottom - PAD) {
    top = inner.bottom - PAD - size.height
  }
  if (top < inner.top + PAD) {
    top = inner.top + PAD
  }
  let left = trigger.left + trigger.width / 2 - size.width / 2
  if (left < inner.left + PAD) {
    left = inner.left + PAD
  }
  if (left + size.width > inner.right - PAD) {
    left = inner.right - PAD - size.width
  }
  if (left < inner.left + PAD) {
    left = inner.left + PAD
  }
  const parent =
    (body.offsetParent instanceof HTMLElement
      ? body.offsetParent.getBoundingClientRect()
      : trigger)
  body.style.bottom = 'auto'
  body.style.transform = 'none'
  body.style.left = `${left - parent.left}px`
  body.style.top = `${top - parent.top}px`
}

function clearTip(body: HTMLElement) {
  body.style.left = ''
  body.style.top = ''
  body.style.bottom = ''
  body.style.transform = ''
}

export function AbilityTip({
  description,
  children,
}: {
  description: string
  children: ReactNode
}) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const bodyRef = useRef<HTMLSpanElement>(null)
  if (!description) {
    return children
  }
  return (
    <span
      ref={rootRef}
      className="ability-tip"
      onMouseEnter={() => {
        const root = rootRef.current
        const body = bodyRef.current
        if (!root || !body) {
          return
        }
        window.requestAnimationFrame(() => placeTip(root, body))
      }}
      onMouseLeave={() => {
        if (bodyRef.current) {
          clearTip(bodyRef.current)
        }
      }}
    >
      {children}
      <span ref={bodyRef} className="ability-tip-body" role="tooltip">
        {description}
      </span>
    </span>
  )
}
