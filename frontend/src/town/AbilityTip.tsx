import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  clampBoxInRect,
  gameWindowTipInnerRect,
  type ClientRect,
} from '../layout/gameWindowTips'

const PAD = 8
const GAP = 6

function tipInnerBounds(anchor: HTMLElement): ClientRect | null {
  const game = gameWindowTipInnerRect(anchor)
  if (game) {
    return game
  }
  const contain = anchor.closest('[data-tip-contain]')
  if (!(contain instanceof HTMLElement)) {
    return null
  }
  const box = contain.getBoundingClientRect()
  return {
    left: box.left + contain.clientLeft + PAD,
    top: box.top + contain.clientTop + PAD,
    right: box.left + contain.clientLeft + contain.clientWidth - PAD,
    bottom: box.top + contain.clientTop + contain.clientHeight - PAD,
  }
}

function placeTipBeside(anchor: HTMLElement, body: HTMLElement, side: 'right' | 'left') {
  const inner = tipInnerBounds(anchor)
  if (!inner) {
    return
  }
  body.style.left = '50%'
  body.style.top = 'auto'
  body.style.bottom = `calc(100% + ${GAP}px)`
  body.style.transform = 'translateX(-50%)'
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
  const clamped = clampBoxInRect(left, top, size.width, size.height, inner)
  left = clamped.left
  top = clamped.top
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
  const inner = tipInnerBounds(anchor)
  if (!inner) {
    return
  }
  body.style.left = '50%'
  body.style.top = 'auto'
  body.style.bottom = `calc(100% + ${GAP}px)`
  body.style.transform = 'translateX(-50%)'
  const trigger = anchor.getBoundingClientRect()
  const size = body.getBoundingClientRect()
  if (size.width === 0 || size.height === 0) {
    return
  }
  let top = trigger.top - GAP - size.height
  if (top < inner.top) {
    top = trigger.bottom + GAP
  }
  let left = trigger.left + trigger.width / 2 - size.width / 2
  const clamped = clampBoxInRect(left, top, size.width, size.height, inner)
  left = clamped.left
  top = clamped.top
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
  const inner =
    gameWindowTipInnerRect(anchor) ?? {
      left: PAD,
      top: PAD,
      right: window.innerWidth - PAD,
      bottom: window.innerHeight - PAD,
    }
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
  const clamped = clampBoxInRect(left, top, size.width, size.height, inner)
  body.style.left = `${clamped.left}px`
  body.style.top = `${clamped.top}px`
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
