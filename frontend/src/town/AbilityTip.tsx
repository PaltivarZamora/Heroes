import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const PAD = 8
const GAP = 6

function placeTipBeside(anchor: HTMLElement, body: HTMLElement, side: 'right' | 'left') {
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
  let left =
    side === 'right'
      ? trigger.right + GAP
      : trigger.left - GAP - size.width
  let top = trigger.top + trigger.height / 2 - size.height / 2
  if (left + size.width > inner.right - PAD) {
    left = inner.right - PAD - size.width
  }
  if (left < inner.left + PAD) {
    left = inner.left + PAD
  }
  if (top < inner.top + PAD) {
    top = inner.top + PAD
  }
  if (top + size.height > inner.bottom - PAD) {
    top = inner.bottom - PAD - size.height
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
  body.style.position = ''
}

function placeTipPortal(anchor: HTMLElement, body: HTMLElement, side: 'right' | 'left') {
  const trigger = anchor.getBoundingClientRect()
  body.style.display = 'block'
  body.style.position = 'fixed'
  body.style.bottom = 'auto'
  body.style.transform = 'none'
  const size = body.getBoundingClientRect()
  if (size.width === 0 || size.height === 0) {
    return
  }
  let left =
    side === 'right'
      ? trigger.right + GAP
      : trigger.left - GAP - size.width
  let top = trigger.top + trigger.height / 2 - size.height / 2
  if (left + size.width > window.innerWidth - PAD) {
    left = window.innerWidth - PAD - size.width
  }
  if (left < PAD) {
    left = PAD
  }
  if (top + size.height > window.innerHeight - PAD) {
    top = window.innerHeight - PAD - size.height
  }
  if (top < PAD) {
    top = PAD
  }
  body.style.left = `${left}px`
  body.style.top = `${top}px`
}

export function AbilityTip({
  description,
  children,
  className,
  style,
  placement = 'default',
}: {
  description: string
  children: ReactNode
  className?: string
  style?: CSSProperties
  placement?: 'default' | 'beside-right' | 'beside-left' | 'portal-right' | 'portal-left'
}) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const bodyRef = useRef<HTMLSpanElement>(null)
  const [portalHover, setPortalHover] = useState(false)
  const portal =
    placement === 'portal-right' || placement === 'portal-left'
  const portalSide = placement === 'portal-left' ? 'left' : 'right'
  if (!description) {
    return children
  }
  return (
    <span
      ref={rootRef}
      className={className ? `ability-tip ${className}` : 'ability-tip'}
      style={style}
      onMouseEnter={() => {
        if (portal) {
          setPortalHover(true)
          return
        }
        const root = rootRef.current
        const body = bodyRef.current
        if (!root || !body) {
          return
        }
        window.requestAnimationFrame(() => {
          if (placement === 'beside-right') {
            placeTipBeside(root, body, 'right')
          } else if (placement === 'beside-left') {
            placeTipBeside(root, body, 'left')
          } else {
            placeTip(root, body)
          }
        })
      }}
      onMouseLeave={() => {
        if (portal) {
          setPortalHover(false)
          return
        }
        if (bodyRef.current) {
          clearTip(bodyRef.current)
        }
      }}
    >
      {children}
      {portal
        ? portalHover
          ? createPortal(
              <span
                ref={(node) => {
                  bodyRef.current = node
                  const root = rootRef.current
                  if (node && root) {
                    window.requestAnimationFrame(() =>
                      placeTipPortal(root, node, portalSide),
                    )
                  }
                }}
                className="ability-tip-body ability-tip-body-floating"
                role="tooltip"
              >
                {description}
              </span>,
              document.body,
            )
          : null
        : (
            <span ref={bodyRef} className="ability-tip-body" role="tooltip">
              {description}
            </span>
          )}
    </span>
  )
}
