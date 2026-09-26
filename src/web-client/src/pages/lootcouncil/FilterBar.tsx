// The council's filter as one bar instead of three boxes (Filter, Gear-Stand,
// Simulation): who is counted, which loot counts, which raid category, which
// BiS list — and on the right two badges saying where the gear comes from and
// how much is simulated. Every explanation that used to be a paragraph is the
// tooltip of the control it explains.
import { useRef, useState } from "react";
import type { LootCouncilData } from "../../api";
import { Badge, Button, Segment } from "../../components/ui";
import { ChevronDownIcon } from "../../components/icons";
import { ROLE_ICON, categoryNote, roleLabel, type FilterView } from "./council";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../i18n";

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
    const t = useT();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const o = data.options;

    useDismiss(ref, open, () => setOpen(false));

    const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    const tiers = o.tiers.filter((tier) => view.tiers.includes(tier.id));
    const contents = o.contents.filter((c) => view.contents.includes(c.id));

    return (
        <div className="lc-pop" ref={ref}>
            <button
                type="button"
                className="lc-selbtn"
                aria-haspopup="true"
                aria-expanded={open}
                data-tip={t("lootcouncil.filter.content")}
                data-tip-sub={t("lootcouncil.filter.contentTipSub")}
                onClick={() => setOpen((v) => !v)}
            >
                <FunnelIcon />
                <span>{t("lootcouncil.filter.content")}</span>
                {tiers.map((tier) => <span key={tier.id} className={`lc-cbadge lc-h-${tier.id}`}>{TIER_SHORT[tier.id] || tier.label}</span>)}
                {contents.map((c) => <span key={c.id} className={`lc-cbadge lc-h-${c.id}`}>{c.short}</span>)}
                {!tiers.length && !contents.length ? <span className="lc-muted">{t("lootcouncil.filter.all")}</span> : null}
                <ChevronDownIcon />
            </button>
            {open ? (
                <div className="lc-popmenu" role="dialog" aria-label={t("lootcouncil.filter.chooseContent")}>
                    <div className="kicker">{t("lootcouncil.filter.tier")}</div>
                    <div className="lc-popbtns">
                        {o.tiers.map((tier) => (
                            <button
                                key={tier.id}
                                type="button"
                                className={`btn btn-sm lc-filter lc-filter-tier lc-h-${tier.id}${view.tiers.includes(tier.id) ? " on" : ""}`}
                                data-tip={t("lootcouncil.filter.tierToggle", { tier: tier.label })}
                                onClick={() => patch({ tiers: toggleIn(view.tiers, tier.id) })}
                            >
                                {tier.label}
                            </button>
                        ))}
                    </div>
                    <div className="kicker">{t("lootcouncil.filter.raids")}</div>
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
                        <Button variant="ghost" size="sm" onClick={() => patch({ tiers: [], contents: [] })}>{t("common.reset")}</Button>
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
    const t = useT();
    const o = data.options;
    const derivedTier = data.filter.bisTierDerived ? o.bisTiers.find((b) => b.id === data.filter.bisTier) : null;
    const note = categoryNote(data);
    const roster = data.roster.length;

    return (
        <div className="lc-panel lc-filterbar">
            <Segment
                ariaLabel={t("lootcouncil.filter.role")}
                value={view.role}
                onChange={(role) => patch({ role })}
                options={[
                    ...o.roles.map((r) => ({ value: r.id, label: roleLabel(r.id, r.label), icon: ROLE_ICON[r.id] })),
                    { value: "", label: t("common.all") },
                ]}
            />
            <ContentFilter data={data} view={view} patch={patch} />
            <select
                className="lc-sel"
                aria-label={t("lootcouncil.filter.category")}
                value={view.category}
                onChange={(e) => patch({ category: e.target.value })}
            >
                <option value="">{t("lootcouncil.filter.allCategories")}</option>
                {o.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span
                className="lc-selwrap"
                data-tip={derivedTier ? t("lootcouncil.filter.derivedTip", { tier: derivedTier.label }) : undefined}
                data-tip-sub={derivedTier ? t("lootcouncil.filter.derivedTipSub") : undefined}
            >
                <select
                    className="lc-sel"
                    aria-label={t("lootcouncil.filter.bisList")}
                    value={view.bisTier}
                    onChange={(e) => patch({ bisTier: e.target.value })}
                >
                    <option value="">{derivedTier ? t("lootcouncil.filter.bisAuto", { tier: TIER_SHORT[derivedTier.id] || derivedTier.label }) : t("lootcouncil.filter.bisAutomatic")}</option>
                    {o.bisTiers.map((b) => <option key={b.id} value={b.id}>{t("lootcouncil.filter.bisTier", { tier: TIER_SHORT[b.id] || b.label })}</option>)}
                </select>
            </span>
            <span className="lc-filterbar-badges">
                {note ? (
                    <Badge tone={note.empty ? "bad" : undefined} icon="achievement_guildperk_everybodysfriend" tip={note.head} tipSub={note.sub}>
                        {note.empty ? t("lootcouncil.filter.categoryEmpty") : t("lootcouncil.filter.hidden", { count: data.filter.skipped.category + data.filter.skipped.excluded })}
                    </Badge>
                ) : null}
                <Badge
                    tone={armoryCount ? "accent" : undefined}
                    icon="inv_shield_06"
                    tip={t("lootcouncil.filter.gearTip")}
                    tipSub={`${armoryCount
                        ? t("lootcouncil.filter.gearArmory", { armory: armoryCount, count: roster })
                        : t("lootcouncil.filter.gearAllLog")} ${t("lootcouncil.filter.gearEnchants")}`}
                >
                    {armoryCount ? t("lootcouncil.filter.gearBadgeArmory", { count: armoryCount }) : t("lootcouncil.filter.gearBadgeLog")}
                </Badge>
                {data.sim.available ? (
                    <Badge
                        tone={simulatable && simulated >= simulatable ? "ok" : undefined}
                        icon="inv_gizmo_02"
                        tip={`WoWSims ${data.sim.version}`}
                        tipSub={t("lootcouncil.filter.simTipSub", { done: simulated, total: simulatable })}
                    >
                        Sim {simulated}/{simulatable}
                    </Badge>
                ) : (
                    <Badge tone="bad" icon="inv_gizmo_02" tip={t("lootcouncil.sim.noSim")} tipSub={data.sim.hint}>{t("lootcouncil.filter.simOff")}</Badge>
                )}
            </span>
        </div>
    );
}
