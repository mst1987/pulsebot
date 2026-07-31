// The Roster page's header band: the line "51 Charakter(e) · 19 mit
// Gear-Problemen" used to be a grey caption in the card head. It is the answer
// to "wie steht mein Raid da", so it gets the room a headline deserves — one
// hero figure, a row of stat tiles with meters, and the class composition as a
// strip you can filter with.
//
// Design rules this follows (see the project's other hero bands):
//   - exactly one hero figure per view — the character count
//   - a meter's fill carries the state, its track is the same hue lightened,
//     so "19 von 44" reads across the whole bar and not just from the digits
//   - text never wears the class colour; a coloured mark sits next to it. The
//     legend is always present, so the strip's identity never rides on colour
//     alone (the table below stays the exhaustive view)
//   - every number here is folded server-side (web/rosterStats.js) over the
//     same rows the table renders, so header and table cannot disagree
import type { RosterStats } from "../api";

/** Percent for a meter, clamped and safe for an empty roster. */
function share(part: number, whole: number): number {
    if (!whole || whole <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

type Tone = "accent" | "warn" | "ok";

function StatTile({ label, value, of, meter, tone, sub, title, onClick, active }: {
    label: string;
    value: number | string;
    /** Denominator shown next to the value ("19 / 44") and used by the meter. */
    of?: number;
    /** Show a meter; needs `of`. */
    meter?: boolean;
    tone?: Tone;
    sub?: React.ReactNode;
    title?: string;
    /** Makes the tile a filter toggle instead of a read-only figure. */
    onClick?: () => void;
    active?: boolean;
}) {
    const pct = meter && of !== undefined ? share(Number(value) || 0, of) : 0;
    const cls = `stat-tile${tone ? ` is-${tone}` : ""}${onClick ? " is-toggle" : ""}${active ? " is-active" : ""}`;
    const body = (
        <>
            <span className="stat-tile-label">{label}</span>
            <span className="stat-tile-value">
                {value}
                {of !== undefined && <span className="stat-tile-of">/ {of}</span>}
            </span>
            {meter && (
                <span className="stat-meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
            )}
            {!!sub && <span className="stat-tile-sub">{sub}</span>}
        </>
    );
    if (!onClick) return <div className={cls} title={title}>{body}</div>;
    return (
        <button type="button" className={cls} title={title} aria-pressed={active} onClick={onClick}>
            {body}
        </button>
    );
}

export function RosterHero({ stats, activeClass, onToggleClass, onlyIssues, onToggleIssues }: {
    stats: RosterStats;
    /** Class currently filtered on ("" = none), driven by the legend chips. */
    activeClass: string;
    onToggleClass: (className: string) => void;
    onlyIssues: boolean;
    onToggleIssues: () => void;
}) {
    const { total, categories, uncategorized, loot, evaluated, withIssues, issues, highIssues, assigned, fromLootOnly } = stats;
    const unevaluated = Math.max(0, total - evaluated);
    const avgLoot = total ? Math.round((loot / total) * 10) / 10 : 0;
    const segments = stats.classes.filter((c) => c.count > 0);
    const classTotal = segments.reduce((n, c) => n + c.count, 0);

    return (
        <header className="page-hero stat-hero">
            <div className="stat-hero-main">
                <div className="stat-hero-lead">
                    <span className="hero-kicker">Roster</span>
                    <div className="stat-hero-figure">
                        <span className="stat-hero-value">{total}</span>
                        <span className="stat-hero-unit">Charakter{total === 1 ? "" : "e"}</span>
                    </div>
                    <p className="stat-hero-sub">
                        in {categories} Raid-Kategorie{categories === 1 ? "" : "n"}
                        {!!uncategorized && ` · ${uncategorized} ohne Kategorie`}
                    </p>
                </div>

                <div className="stat-tiles">
                    <StatTile
                        label="Gear-Probleme"
                        value={withIssues}
                        of={evaluated}
                        meter
                        tone={withIssues ? "warn" : "ok"}
                        active={onlyIssues}
                        onClick={onToggleIssues}
                        title={onlyIssues ? "Filter aufheben — wieder alle Charaktere zeigen" : "Nur Charaktere mit Gear-Problemen zeigen"}
                        sub={issues
                            ? <>{issues} Befund{issues === 1 ? "" : "e"}{highIssues ? `, ${highIssues} schwer` : ""}</>
                            : <>keine Befunde</>}
                    />
                    <StatTile
                        label="Ausgewertet"
                        value={evaluated}
                        of={total}
                        meter
                        tone="accent"
                        title="Charaktere, die in einer der letzten Auswertungen vorkamen"
                        sub={unevaluated ? <>{unevaluated} ohne Auswertung</> : <>vollständig</>}
                    />
                    <StatTile
                        label="Zugeordnet"
                        value={assigned}
                        of={total}
                        meter
                        tone="accent"
                        title="Charaktere mit einer Raider-Zuordnung im Raid-Detail"
                        sub={fromLootOnly ? <>{fromLootOnly} nur aus Loot</> : <>alle zugeordnet</>}
                    />
                    <StatTile
                        label="Loot-Items"
                        value={loot}
                        title="Importierte Items über den gesamten Roster"
                        sub={<>Ø {avgLoot} je Charakter</>}
                    />
                </div>
            </div>

            {!!segments.length && (
                <div className="stat-hero-foot">
                    <div className="stat-strip-head">
                        <span className="hero-stat-label">Klassenverteilung</span>
                        <span className="sub">
                            {segments.length} Klasse{segments.length === 1 ? "" : "n"}
                            {activeClass ? ` · gefiltert auf ${activeClass}` : ""}
                        </span>
                    </div>
                    {/* Part-to-whole: the 2px gaps are the surface showing through,
                        not borders — the segments carry no stroke of their own. */}
                    <div className="stat-strip">
                        {segments.map((c) => (
                            <span
                                key={c.className}
                                className={`stat-seg${c.classColor ? " class-fill" : " is-unknown"}${activeClass && activeClass !== c.className ? " is-dim" : ""}`}
                                style={{ flexGrow: c.count, ...(c.classColor ? { "--cc": c.classColor } as React.CSSProperties : {}) }}
                                title={`${c.className} — ${c.count} (${share(c.count, classTotal)} %)`}
                            />
                        ))}
                    </div>
                    <div className="stat-legend">
                        {segments.map((c) => {
                            // "Unbekannt" and the folded "Weitere" carry no class
                            // colour and cannot be filtered on — there is no single
                            // class behind them to narrow the table to.
                            const filterable = !!c.classColor;
                            const on = activeClass === c.className;
                            return (
                                <button
                                    key={c.className}
                                    type="button"
                                    className={`stat-chip${on ? " is-active" : ""}`}
                                    aria-pressed={on}
                                    disabled={!filterable}
                                    title={filterable
                                        ? (on ? "Klassenfilter aufheben" : `Nur ${c.className} zeigen`)
                                        : "Sammelposten — kein einzelner Klassenfilter möglich"}
                                    onClick={() => filterable && onToggleClass(on ? "" : c.className)}
                                >
                                    <i
                                        className={`stat-dot${c.classColor ? " class-fill" : " is-unknown"}`}
                                        style={c.classColor ? { "--cc": c.classColor } as React.CSSProperties : undefined}
                                    />
                                    {c.className}
                                    <b>{c.count}</b>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </header>
    );
}
