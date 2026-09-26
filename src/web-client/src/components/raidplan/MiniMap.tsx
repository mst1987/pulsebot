import { useRef, type PointerEvent } from "react";
import { visibleRect, type BoardView } from "../../lib/raidplan/boardView";

/**
 * A small overview of the whole picture with a rectangle for what the frame shows now (when zoomed in): a click or a drag on it moves the view there.
 * The map is drawn without the objects; the frame and the mini map share the picture's aspect.
 */
export default function MiniMap({ mapUrl, view, onCenter, label }: { mapUrl: string; view: BoardView; onCenter: (cx: number, cy: number) => void; label: string }) {
    const box = useRef<HTMLDivElement>(null);
    const at = (e: PointerEvent<HTMLDivElement>) => {
        const r = box.current ? box.current.getBoundingClientRect() : null;
        if (!r || !r.width || !r.height) return;
        onCenter(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
    };
    const v = visibleRect(view);
    return (
        <div
            className="rp-minimap" ref={box} role="img" aria-label={label} data-tip={label}
            onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
            onPointerMove={(e) => { if (e.buttons === 1) at(e); }}
        >
            {mapUrl ? <img src={mapUrl} alt="" draggable={false} /> : <div className="rp-minimap-grid" />}
            <span className="rp-minimap-view" style={{ left: `${v.x * 100}%`, top: `${v.y * 100}%`, width: `${v.w * 100}%`, height: `${v.h * 100}%` }} />
        </div>
    );
}
