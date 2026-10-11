import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, } from 'react';
import { STAGE_HEIGHT, STAGE_WIDTH } from './stageConstants';
const StageContext = createContext({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    clientToStage: (x, y) => ({ x, y }),
});
export function useGameStage() {
    return useContext(StageContext);
}
export function GameStage({ children }) {
    const viewportRef = useRef(null);
    const stageRef = useRef(null);
    const [layout, setLayout] = useState({
        scale: 1,
        offsetX: 0,
        offsetY: 0,
    });
    useLayoutEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) {
            return;
        }
        const measure = () => {
            const vw = viewport.clientWidth;
            const vh = viewport.clientHeight;
            if (vw <= 0 || vh <= 0) {
                return;
            }
            const scale = Math.min(vw / STAGE_WIDTH, vh / STAGE_HEIGHT);
            const offsetX = (vw - STAGE_WIDTH * scale) / 2;
            const offsetY = (vh - STAGE_HEIGHT * scale) / 2;
            setLayout({ scale, offsetX, offsetY });
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(viewport);
        window.addEventListener('resize', measure);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, []);
    const clientToStage = useCallback((clientX, clientY) => {
        const viewport = viewportRef.current;
        if (!viewport || layout.scale <= 0) {
            return { x: clientX, y: clientY };
        }
        const vr = viewport.getBoundingClientRect();
        return {
            x: (clientX - vr.left - layout.offsetX) / layout.scale,
            y: (clientY - vr.top - layout.offsetY) / layout.scale,
        };
    }, [layout]);
    return (_jsx(StageContext.Provider, { value: { ...layout, clientToStage }, children: _jsx("div", { ref: viewportRef, className: "game-stage-viewport", children: _jsx("div", { ref: stageRef, className: "game-stage", style: {
                    width: STAGE_WIDTH,
                    height: STAGE_HEIGHT,
                    transform: `scale(${layout.scale})`,
                    transformOrigin: 'top left',
                    left: layout.offsetX,
                    top: layout.offsetY,
                }, children: children }) }) }));
}
