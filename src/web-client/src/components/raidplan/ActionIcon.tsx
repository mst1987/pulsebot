import { ACTION_GROUP, ACTION_PATH, TIMING_PATH } from "../../lib/steps";

/** The icon of a tactic action: a line icon on a tile in the colour of its group (tanks, control, position, support, flow). */
export function ActionIcon({ action, size = 30, label }: { action: string; size?: number; label?: string }) {
    const paths = ACTION_PATH[action] || ACTION_PATH.note;
    return (
        <span className={`rp-acticon is-${ACTION_GROUP[action] || "flow"}`} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
            <svg viewBox="0 0 24 24" width={Math.round(size * 0.57)} height={Math.round(size * 0.57)}>{paths.map((d) => <path key={d} d={d} />)}</svg>
        </span>
    );
}

/** The small icon of a timing kind (clock, curve, arrows, bolt). */
export function TimingIcon({ kind }: { kind: string }) {
    const d = TIMING_PATH[kind];
    if (!d) return null;
    return <svg className="rp-tmicon" viewBox="0 0 24 24" width={12} height={12} aria-hidden="true"><path d={d} /></svg>;
}
