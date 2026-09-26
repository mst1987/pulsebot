import { useEffect, useRef, useState, type PointerEvent } from "react";
import { DEFAULT_MAP_SIZE, mapHeight, parseMapSize, type MapSize } from "../../../../lib/raidplan";

/**
 * The map's height: a step (S / M / L) or a custom height dragged at the
 * splitter under the map, remembered per browser. Small screens open on S.
 */
export function useMapSize() {
    const [mapSize, setMapSize] = useState<MapSize>(() => { try { const raw = window.localStorage.getItem("eh.raidplan.mapSize"); return raw === null && window.innerHeight <= 1000 ? { step: "S" as const, px: 0 } : parseMapSize(raw); } catch { return DEFAULT_MAP_SIZE; } });
    const [winH, setWinH] = useState(() => window.innerHeight);
    const [splitting, setSplitting] = useState(false);
    const splitRef = useRef({ y: 0, h: 0 });
    const mapPx = mapHeight(mapSize, winH);
    /** Sets and remembers the map's height. */
    const chooseMapSize = (size: MapSize) => {
        const next = size.step === "C" ? { step: "C" as const, px: mapHeight(size, winH) } : size;
        setMapSize(next);
        try { window.localStorage.setItem("eh.raidplan.mapSize", JSON.stringify(next)); } catch { /* private window */ }
    };
    const startSplit = (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        splitRef.current = { y: e.clientY, h: mapPx };
        setSplitting(true);
    };
    useEffect(() => {
        const size = () => setWinH(window.innerHeight);
        window.addEventListener("resize", size);
        return () => window.removeEventListener("resize", size);
    }, []);
    useEffect(() => {
        if (!splitting) return undefined;
        const move = (e: globalThis.PointerEvent) => setMapSize({ step: "C", px: mapHeight({ step: "C", px: splitRef.current.h + e.clientY - splitRef.current.y }, window.innerHeight) });
        const up = (e: globalThis.PointerEvent) => { setSplitting(false); chooseMapSize({ step: "C", px: splitRef.current.h + e.clientY - splitRef.current.y }); };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [splitting]);
    return { mapSize, mapPx, chooseMapSize, startSplit };
}
