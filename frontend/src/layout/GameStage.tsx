import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { STAGE_HEIGHT, STAGE_WIDTH } from './stageConstants'

type StageLayout = {
  scale: number
  offsetX: number
  offsetY: number
}

type StageContextValue = StageLayout & {
  /** Map viewport client coords → stage pixels (1920×1080 space). */
  clientToStage: (clientX: number, clientY: number) => { x: number; y: number }
}

const StageContext = createContext<StageContextValue>({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  clientToStage: (x, y) => ({ x, y }),
})

export function useGameStage(): StageContextValue {
  return useContext(StageContext)
}

type GameStageProps = {
  children: ReactNode
}

export function GameStage({ children }: GameStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<StageLayout>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  })

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const measure = () => {
      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      if (vw <= 0 || vh <= 0) {
        return
      }
      const scale = Math.min(vw / STAGE_WIDTH, vh / STAGE_HEIGHT)
      const offsetX = (vw - STAGE_WIDTH * scale) / 2
      const offsetY = (vh - STAGE_HEIGHT * scale) / 2
      setLayout({ scale, offsetX, offsetY })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(viewport)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const clientToStage = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current
      if (!viewport || layout.scale <= 0) {
        return { x: clientX, y: clientY }
      }
      const vr = viewport.getBoundingClientRect()
      return {
        x: (clientX - vr.left - layout.offsetX) / layout.scale,
        y: (clientY - vr.top - layout.offsetY) / layout.scale,
      }
    },
    [layout],
  )

  return (
    <StageContext.Provider value={{ ...layout, clientToStage }}>
      <div ref={viewportRef} className="game-stage-viewport">
        <div
          ref={stageRef}
          className="game-stage"
          style={{
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            transform: `scale(${layout.scale})`,
            transformOrigin: 'top left',
            left: layout.offsetX,
            top: layout.offsetY,
          }}
        >
          {children}
        </div>
      </div>
    </StageContext.Provider>
  )
}
