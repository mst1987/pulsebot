// The council's filter as ONE line under the tabs: who is counted (the role
// segment) and a single "Filter · 3 aktiv" button that opens everything else —
// which loot counts (Content), the raid category, the BiS list, and the two
// read-only facts the old chips showed (where the gear comes from, how much is
// simulated). A change applies live, like it always did; "Zurücksetzen" clears
// the three real filters and "Fertig" closes the box. Every explanation that
// used to be a paragraph is the tooltip of the control it explains.
import { useRef, useState } from "react";
import type { LootCouncilData } from "../../api";
import { Badge, Button, Segment } from "../../components/ui";
import { ChevronDownIcon, FunnelIcon } from "../../components/icons";
import { ROLE_ICON, categoryNote, roleLabel, type FilterView } from "./council";
import { useDismiss } from "../../hooks/useDismiss";
import { tParts, useT } from "../../i18n";

// The short name a tier wears on its badge.
const TIER_SHORT: Record<string, string> = { t4: "T4", t5: "T5", t6: "T6", t65: "SWP" };

/** The content filter's choices: the tiers and raids as toggle buttons, with the chosen ones lit. */
function ContentFilter({ data, view, patch }: {
    data: LootCouncilData;
    view: FilterView;
    patch: (p: Partial<FilterView>) => void;
}) {
    const t = useT();
    const o = data.options;
    const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    const any = view.tiers.length > 0 || view.contents.length > 0;

    return (
        <div className="lc-field lc-field-wide" role="group" aria-label={t("lootcouncil.filter.chooseContent")}>
            <span className="kicker tipped" tabIndex={0} data-tip={t("lootcouncil.filter.content")} data-tip-sub={t("lootcouncil.filter.contentTipSub")}>
                {t("lootcouncil.filter.content")}
                {!any ? <span className="lc-muted"> · {t("lootcouncil.filter.all")}</span> : null}
            </span>
            <div className="lc-popbtns">
                {o.tiers.map((tier) => (
                    <button
                        key={tier.id}
                        type="button"
                        className={`btn btn-sm lc-filter lc-filter-tier lc-h-${tier.id}${view.tiers.includes(tier.id) ? " on" : ""}`}
                        data-tip={t("lootcouncil.filter.tierToggle", { tier: tier.label })}
                        onClick={() => patch({ tiers: toggleIn(view.tiers, tier.id) })}
                    >
                        {TIER_SHORT[tier.id] ? <span className={`lc-cbadge lc-h-${tier.id}`}>{TIER_SHORT[tier.id]}</span> : null}
                        {tier.label}
                    </button>
                ))}
            </div>
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
        </div>
    );
}

export default function FilterBar({ data, view, patch, armoryCount, simulated, simulatable, reachesGame = false, canWrite = false }: {
    data: LootCouncilData;
    view: FilterView;
    patch: (p: Partial<FilterView>) => void;
    /** Raiders judged on armory gear rather than on the last evaluation. */
    armoryCount: number;
    /** Raiders with a simulated DPS, out of those the sim can answer. */
    simulated: number;
    simulatable: number;
    /** The picked category runs as Loot-Council: its filters are stored and drive the in-game council. */
    reachesGame?: boolean;
    canWrite?: boolean;
}) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useDismiss(ref, open, () => setOpen(false));
    const o = data.options;
    const derivedTier = data.filter.bisTierDerived ? o.bisTiers.find((b) => b.id === data.filter.bisTier) : null;
    const note = categoryNote(data);
    const roster = data.roster.length;
    // The three filters the button counts: Content (tiers and raids together),
    // the raid category and the BiS list. Gear source and simulation are facts.
    const active = (view.tiers.length || view.contents.length ? 1 : 0) + (view.category ? 1 : 0) + (view.bisTier ? 1 : 0);

    return (
        <div className="lc-filterline">
            <Segment
                ariaLabel={t("lootcouncil.filter.role")}
                value={view.role}
                onChange={(role) => patch({ role })}
                options={[
                    ...o.roles.map((r) => ({ value: r.id, label: roleLabel(r.id, r.label), icon: ROLE_ICON[r.id] })),
                    { value: "", label: t("common.all") },
                ]}
            />
            <div className="lc-fpop" ref={ref}>
                <button
                    type="button"
                    className={`lc-selbtn lc-fbtn${active ? " on" : ""}`}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                >
                    <FunnelIcon />
                    <span>{active ? t("lootcouncil.filter.buttonActive", { count: active }) : t("lootcouncil.filter.button")}</span>
                    <ChevronDownIcon />
                </button>
                {open ? (
                    <div className="lc-fpopmenu" role="dialog" aria-label={t("lootcouncil.filter.button")}>
                        <ContentFilter data={data} view={view} patch={patch} />
                        <div className="lc-field">
                            <label className="kicker" htmlFor="lc-f-category">{t("lootcouncil.filter.category")}</label>
                            <select id="lc-f-category" className="lc-sel" value={view.category} onChange={(e) => patch({ category: e.target.value })}>
                                <option value="">{t("lootcouncil.filter.allCategories")}</option>
                                {o.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div
                            className="lc-field"
                            data-tip={derivedTier ? t("lootcouncil.filter.derivedTip", { tier: derivedTier.label }) : undefined}
                            data-tip-sub={derivedTier ? t("lootcouncil.filter.derivedTipSub") : undefined}
                        >
                            <label className="kicker" htmlFor="lc-f-bis">{t("lootcouncil.filter.bisList")}</label>
                            <select id="lc-f-bis" className="lc-sel" value={view.bisTier} onChange={(e) => patch({ bisTier: e.target.value })}>
                                <option value="">{derivedTier ? t("lootcouncil.filter.bisAuto", { tier: TIER_SHORT[derivedTier.id] || derivedTier.label }) : t("lootcouncil.filter.bisAutomatic")}</option>
                                {o.bisTiers.map((b) => <option key={b.id} value={b.id}>{tParts("lootcouncil.filter.bisTier", { tier: TIER_SHORT[b.id] || b.label })}</option>)}
                            </select>
                        </div>
                        <div
                            className="lc-field"
                            data-tip={t("lootcouncil.filter.gearTip")}
                            data-tip-sub={`${armoryCount
                                ? t("lootcouncil.filter.gearArmory", { armory: armoryCount, count: roster })
                                : t("lootcouncil.filter.gearAllLog")} ${t("lootcouncil.filter.gearEnchants")}`}
                        >
                            <span className="kicker">{t("lootcouncil.filter.gearSource")}</span>
                            <span className={`lc-fval${armoryCount ? " accent" : ""}`}>
                                {armoryCount ? t("lootcouncil.filter.gearValueArmory", { armory: armoryCount, count: roster }) : t("lootcouncil.filter.gearValueLog")}
                            </span>
                        </div>
                        <div
                            className="lc-field"
                            data-tip={data.sim.available ? `WoWSims ${data.sim.version}` : t("lootcouncil.sim.noSim")}
                            data-tip-sub={data.sim.available ? t("lootcouncil.filter.simTipSub", { done: simulated, total: simulatable }) : data.sim.hint}
                        >
                            <span className="kicker">{t("lootcouncil.filter.simulation")}</span>
                            <span className={`lc-fval${!data.sim.available ? " bad" : simulatable && simulated >= simulatable ? " ok" : ""}`}>
                                {data.sim.available ? t("lootcouncil.filter.simValue", { done: simulated, total: simulatable }) : t("lootcouncil.filter.simOffValue")}
                            </span>
                        </div>
                        <div className="lc-fpop-foot">
                            <Button variant="ghost" size="sm" disabled={!active} onClick={() => patch({ tiers: [], contents: [], category: "", bisTier: "" })}>{t("common.reset")}</Button>
                            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t("lootcouncil.filter.done")}</Button>
                        </div>
                    </div>
                ) : null}
            </div>
            <span className="lc-filterbar-badges">
                {reachesGame ? (
                    <Badge
                        tone="accent"
                        icon="inv_misc_gear_01"
                        tip={t("lootcouncil.filter.gameTip", { category: o.categories.find((c) => c.id === view.category)?.name || view.category })}
                        tipSub={canWrite ? t("lootcouncil.filter.gameTipSub") : t("lootcouncil.filter.gameTipReadOnly")}
                    >
                        {t("lootcouncil.filter.game")}
                    </Badge>
                ) : null}
                {note ? (
                    <Badge tone={note.empty ? "bad" : undefined} icon="achievement_guildperk_everybodysfriend" tip={note.head} tipSub={note.sub}>
                        {note.empty ? t("lootcouncil.filter.categoryEmpty") : t("lootcouncil.filter.hidden", { count: data.filter.skipped.category + data.filter.skipped.excluded })}
                    </Badge>
                ) : null}
            </span>
        </div>
    );
}
