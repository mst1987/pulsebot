// The council's filter as one bar instead of three boxes (Filter, Gear-Stand,
// Simulation): who is counted, which loot counts, which raid category, which
// BiS list — and on the right two badges saying where the gear comes from and
// how much is simulated. Every explanation that used to be a paragraph is the
// tooltip of the control it explains.
import { useRef, useState } from "react";
import type { LootCouncilData } from "../../api";
import { Badge, Button, Segment } from "../../components/ui";
import { ChevronDownIcon } from "../../components/icons";
import { ROLE_ICON, ROLE_LABEL, categoryNote, type FilterView } from "./council";
import { useDismiss } from "../../hooks/useDismiss";

// The short name a tier wears on its badge.
const TIER_SHORT: Record<string, string> = { t4: "T4", t5: "T5", t6: "T6", t65: "SWP" };

/** A funnel — a pure UI glyph, so a line icon rather than a WoW icon. */
function FunnelIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5h16l-6 8v6l-4-2v-4z" />
        </svg>
    );
}

/** The content filter: a select-like button with the chosen tiers/raids as badges, the choices in a popover. */
function ContentFilter({ data, view, patch }: {
    data: LootCouncilData;
    view: FilterView;
    patch: (p: Partial<FilterView>) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const o = data.options;

    useDismiss(ref, open, () => setOpen(false));

    const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    const tiers = o.tiers.filter((t) => view.tiers.includes(t.id));
    const contents = o.contents.filter((c) => view.contents.includes(c.id));

    return (
        <div className="lc-pop" ref={ref}>
            <button
                type="button"
                className="lc-selbtn"
                aria-haspopup="true"
                aria-expanded={open}
                data-tip="Content"
                data-tip-sub="Welche Raids beim Loot zählen. Ohne Auswahl zählt aller Loot; Tiers und einzelne Raids lassen sich kombinieren („T5 plus Hyjal“), wenn die Gilde gerade wechselt."
                onClick={() => setOpen((v) => !v)}
            >
                <FunnelIcon />
                <span>Content</span>
                {tiers.map((t) => <span key={t.id} className={`lc-cbadge lc-h-${t.id}`}>{TIER_SHORT[t.id] || t.label}</span>)}
                {contents.map((c) => <span key={c.id} className={`lc-cbadge lc-h-${c.id}`}>{c.short}</span>)}
                {!tiers.length && !contents.length ? <span className="lc-muted">alle</span> : null}
                <ChevronDownIcon />
            </button>
            {open ? (
                <div className="lc-popmenu" role="dialog" aria-label="Content wählen">
                    <div className="kicker">Tier</div>
                    <div className="lc-popbtns">
                        {o.tiers.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                className={`btn btn-sm lc-filter lc-filter-tier lc-h-${t.id}${view.tiers.includes(t.id) ? " on" : ""}`}
                                data-tip={`Ganze Stufe ${t.label} ein-/ausschalten`}
                                onClick={() => patch({ tiers: toggleIn(view.tiers, t.id) })}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <div className="kicker">Raids</div>
                    <div className="lc-popbtns">
                        {o.contents.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                className={`btn btn-sm lc-filter lc-h-${c.id}${view.contents.includes(c.id) ? " on" : ""}`}
                                data-tip={c.label}
                                onClick={() => patch({ contents: toggleIn(view.contents, c.id) })}
                            >
                                {c.short}
                            </button>
                        ))}
                    </div>
                    {view.tiers.length || view.contents.length ? (
                        <Button variant="ghost" size="sm" onClick={() => patch({ tiers: [], contents: [] })}>Zurücksetzen</Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

export default function FilterBar({ data, view, patch, armoryCount, simulated, simulatable }: {
    data: LootCouncilData;
    view: FilterView;
    patch: (p: Partial<FilterView>) => void;
    /** Raiders judged on armory gear rather than on the last evaluation. */
    armoryCount: number;
    /** Raiders with a simulated DPS, out of those the sim can answer. */
    simulated: number;
    simulatable: number;
}) {
    const o = data.options;
    const derivedTier = data.filter.bisTierDerived ? o.bisTiers.find((t) => t.id === data.filter.bisTier) : null;
    const note = categoryNote(data);
    const roster = data.roster.length;

    return (
        <div className="lc-panel lc-filterbar">
            <Segment
                ariaLabel="Rolle"
                value={view.role}
                onChange={(role) => patch({ role })}
                options={[
                    ...o.roles.map((r) => ({ value: r.id, label: ROLE_LABEL[r.id] || r.label, icon: ROLE_ICON[r.id] })),
                    { value: "", label: "Alle" },
                ]}
            />
            <ContentFilter data={data} view={view} patch={patch} />
            <select
                className="lc-sel"
                aria-label="Raid-Kategorie"
                value={view.category}
                onChange={(e) => patch({ category: e.target.value })}
            >
                <option value="">Alle Raid-Kategorien</option>
                {o.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span
                className="lc-selwrap"
                data-tip={derivedTier ? `Aus dem neuesten Loot abgeleitet: ${derivedTier.label}` : undefined}
                data-tip-sub={derivedTier ? "Gemessen wird gegen die Liste des Tiers, aus dem der neueste Loot der Gilde stammt." : undefined}
            >
                <select
                    className="lc-sel"
                    aria-label="BiS-Liste"
                    value={view.bisTier}
                    onChange={(e) => patch({ bisTier: e.target.value })}
                >
                    <option value="">BiS-Liste {derivedTier ? `${TIER_SHORT[derivedTier.id] || derivedTier.label} (auto)` : "automatisch"}</option>
                    {o.bisTiers.map((t) => <option key={t.id} value={t.id}>BiS-Liste {TIER_SHORT[t.id] || t.label}</option>)}
                </select>
            </span>
            <span className="lc-filterbar-badges">
                {note ? (
                    <Badge tone={note.empty ? "bad" : undefined} icon="achievement_guildperk_everybodysfriend" tip={note.head} tipSub={note.sub}>
                        {note.empty ? "Kategorie leer" : `${data.filter.skipped.category + data.filter.skipped.excluded} ausgeblendet`}
                    </Badge>
                ) : null}
                <Badge
                    tone={armoryCount ? "accent" : undefined}
                    icon="inv_shield_06"
                    tip="Gear-Stand"
                    tipSub={`${armoryCount
                        ? `${armoryCount} von ${roster} Raider(n) mit Gear aus der Armory, der Rest aus der letzten Auswertung.`
                        : "Alles Gear stammt aus der letzten Auswertung — wer seitdem etwas angezogen hat, wird mit dem alten Set bewertet."} Verzauberungen kommen weiter aus den Auswertungen: Blizzards Verzauberungs-IDs sind nicht die, die WoWSims erwartet. Ein seitdem neues Teil wird unverzaubert gerechnet und fällt etwas zu niedrig aus.`}
                >
                    {armoryCount ? `Gear: ${armoryCount} Armory` : "Gear: Auswertung"}
                </Badge>
                {data.sim.available ? (
                    <Badge
                        tone={simulatable && simulated >= simulatable ? "ok" : undefined}
                        icon="inv_gizmo_02"
                        tip={`WoWSims ${data.sim.version}`}
                        tipSub={`${simulated} von ${simulatable} simulierbaren Raidern haben eine DPS. Ein Zugewinn erscheint erst mit einer Simulation — die Seite zeigt keine Schätzungen aus Stat-Gewichten.`}
                    >
                        Sim {simulated}/{simulatable}
                    </Badge>
                ) : (
                    <Badge tone="bad" icon="inv_gizmo_02" tip="Keine Simulation" tipSub={data.sim.hint}>Sim aus</Badge>
                )}
            </span>
        </div>
    );
}
