import { useState } from "react";
import type { SetupPerson } from "../../../api";
import { useT } from "../../../i18n";
import { ChevronDownIcon, SearchIcon } from "../../../components/icons";
import { Slot, type Interaction } from "./Board";
import { useZone } from "./useZone";
import { matchesQuery } from "./setupText";

// "Angemeldet" (#517): everybody signed up who is neither in a group nor on the
// bench — where the setup starts from, since the editor no longer needs a
// proposal first. A panel of its own beside the groups, by role (tank, healer,
// melee, ranged) with a search and role filters, so dragging is a short way.
// Where the editor is too narrow for a side column it docks at the bottom of the
// window instead (setup-editor.css, container query): one row to scroll sideways,
// folded away by its arrow — and folded by itself while a raider of it is picked,
// so the free places to tap stay in view. The whole panel is a drop zone: a raider
// dropped here leaves the setup again. Never posted.

const SECTIONS = ["tank", "healer", "melee", "ranged"] as const;
type Filter = "all" | "tank" | "healer" | "dps";

const inFilter = (p: SetupPerson, filter: Filter) => filter === "all"
    || (filter === "dps" ? p.role === "melee" || p.role === "ranged" : p.role === filter);

export function PoolPanel({ pool, ui, absent = 0 }: { pool: SetupPerson[]; ui: Interaction; absent?: number }) {
    const t = useT();
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("all");
    const [collapsed, setCollapsed] = useState(false);
    const zone = useZone({ pool: true }, ui);
    const canTake = ui.editable && !!ui.selected && !pool.some((p) => p.userId === ui.selected);
    const picking = !!ui.selected && pool.some((p) => p.userId === ui.selected);
    const count = (f: Filter) => pool.filter((p) => inFilter(p, f)).length;
    const shown = pool.filter((p) => inFilter(p, filter) && matchesQuery(p, query));
    // a role nobody signed up for in the group is no section; anything unknown goes with the ranged
    const sections = SECTIONS.map((role) => ({
        role,
        people: shown.filter((p) => (role === "ranged" ? !["tank", "healer", "melee"].includes(p.role) : p.role === role)),
    })).filter((s) => s.people.length);
    const filters: Filter[] = ["all", "tank", "healer", "dps"];
    return (
        <section
            className={`se-poolpanel${zone.over ? " se-over" : ""}${canTake ? " se-target" : ""}${collapsed ? " se-pp-collapsed" : ""}${picking ? " se-pp-picking" : ""}${pool.length ? "" : " se-pp-none"}`}
            {...zone.props}
            aria-label={t("setup.pool.aria")}
        >
            <header className="se-pp-head">
                <span className="se-pp-title" data-tip={t("setup.pool.title")} data-tip-sub={t("setup.pool.tip")}>
                    {t("setup.pool.title")} <b className="se-pp-count">{pool.length}</b>
                </span>
                <span className="se-pp-sub">{t("setup.poolPanel.notPlaced")}</span>
                {canTake && (
                    <button type="button" className="se-ph se-ph-take se-pp-take" onClick={() => ui.onDrop({ pool: true })}>{t("setup.poolPanel.back")}</button>
                )}
                <button
                    type="button" className="se-pp-toggle" aria-expanded={!collapsed}
                    aria-label={collapsed ? t("setup.poolPanel.expand") : t("setup.poolPanel.collapse")}
                    data-tip={collapsed ? t("setup.poolPanel.expand") : t("setup.poolPanel.collapse")}
                    onClick={() => setCollapsed((c) => !c)}
                >
                    <ChevronDownIcon />
                </button>
            </header>
            <div className="se-pp-body">
                {pool.length > 0 && (
                    <div className="se-pp-tools">
                        <label className="se-pp-search">
                            <SearchIcon />
                            <input type="search" value={query} placeholder={t("setup.poolPanel.search")} aria-label={t("setup.poolPanel.search")} onChange={(e) => setQuery(e.target.value)} />
                        </label>
                        <div className="se-pp-filters" role="group" aria-label={t("setup.poolPanel.filter")}>
                            {filters.map((f) => (
                                <button key={f} type="button" className={`se-pp-chip${filter === f ? " is-on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                                    {t(`setup.poolPanel.filters.${f}`)} <small>{count(f)}</small>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                <div className="se-pp-sections">
                    {sections.map((s) => (
                        <div key={s.role} className="se-pp-sec">
                            <div className="se-pp-sec-head">{t(`setup.poolPanel.sections.${s.role}`)} <small>{s.people.length}</small></div>
                            <div className="se-pp-grid">
                                {s.people.map((p) => <Slot key={p.userId} p={p} ui={ui} inPool />)}
                            </div>
                        </div>
                    ))}
                    {!pool.length && <p className="se-pp-empty">{t("setup.pool.empty")}</p>}
                    {pool.length > 0 && !shown.length && <p className="se-pp-empty">{t("setup.poolPanel.noMatch")}</p>}
                </div>
                {absent > 0 && <p className="se-pp-absent">{t("setup.poolPanel.absent", { count: absent })}</p>}
            </div>
        </section>
    );
}
