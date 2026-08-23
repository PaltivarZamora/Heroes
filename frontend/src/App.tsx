import { useCallback, useState } from 'react'
import { HexMap } from './hex/HexMap'
import { formatDebugText, type HeroHudState } from './hex/debug'
import { formatMovementPoints, MAX_MOVEMENT_POINTS } from './hex/hero'
import {
  DEFAULT_HEX_SCALE,
  HEX_SCALES,
  mapSizeLabel,
  type HexScaleName,
} from './hex/hexScale'
import {
  emptyWallet,
  formatResourceLine,
  formatResourceLines,
  RESOURCES,
  type ResourceWallet,
} from './hex/resources'
import { TownManagement } from './town/TownManagement'
import './App.css'

function App() {
  const [hexScale, setHexScale] = useState<HexScaleName>(DEFAULT_HEX_SCALE)
  const [mapInfo, setMapInfo] = useState<{
    width: number
    height: number
    seed: number
  } | null>(null)
  const [hero, setHero] = useState<HeroHudState | null>(null)
  const [wallet, setWallet] = useState<ResourceWallet>(emptyWallet)
  const onMapInfo = useCallback(
    (info: { width: number; height: number; seed: number }) => {
      setMapInfo(info)
    },
    [],
  )
  const onHeroState = useCallback((state: HeroHudState) => {
    setHero(state)
  }, [])
  const onResources = useCallback((next: ResourceWallet) => {
    setWallet(next)
  }, [])
  const [welcomeTown, setWelcomeTown] = useState<string | null>(null)
  const onTownWelcome = useCallback((townName: string) => {
    setWelcomeTown(townName)
  }, [])

  const hexSize = HEX_SCALES[hexScale]
  const mapLabel = mapInfo ? mapSizeLabel(mapInfo.width, mapInfo.height) : '…'
  const seedLabel = mapInfo ? String(mapInfo.seed) : '…'
  const stepsLabel = formatMovementPoints(
    hero?.remaining ?? MAX_MOVEMENT_POINTS,
  )
  const resourceLines = formatResourceLines(wallet)

  const debugText = formatDebugText({
    mapSize: mapLabel,
    hexSize: `${hexScale} (${hexSize})`,
    seed: seedLabel,
    heroQ: hero?.q ?? null,
    heroR: hero?.r ?? null,
    steps: stepsLabel,
    resources: resourceLines,
  })

  const copyDebug = useCallback(() => {
    void navigator.clipboard.writeText(debugText).catch((error) => {
      console.log('Failed to copy debug text:', error)
    })
  }, [debugText])

  return (
    <main className="app">
      <header className="map-hud">
        <p>Steps: {stepsLabel}</p>
        <div className="hex-scale-switch" role="group" aria-label="Hex scale">
          {(Object.keys(HEX_SCALES) as HexScaleName[]).map((name) => (
            <button
              key={name}
              type="button"
              className={name === hexScale ? 'active' : undefined}
              onClick={() => setHexScale(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="debug-copy">
          <button type="button" onClick={copyDebug}>
            Copy Debug
          </button>
          <pre className="debug-peek">{debugText}</pre>
        </div>
        <p className="resource-debug">
          {RESOURCES.map((resource) => (
            <span key={resource.name}>
              {formatResourceLine(resource.name, wallet[resource.name])}
            </span>
          ))}
        </p>
      </header>
      <HexMap
        hexSize={hexSize}
        onMapInfo={onMapInfo}
        onHeroState={onHeroState}
        onResources={onResources}
        onTownWelcome={onTownWelcome}
      />
      {welcomeTown ? (
        <TownManagement
          townName={welcomeTown}
          onExit={() => setWelcomeTown(null)}
        />
      ) : null}
    </main>
  )
}

export default App
