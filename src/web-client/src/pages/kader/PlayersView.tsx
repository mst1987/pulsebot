// "Spieler finden" (/kader/spieler): the whole pool as a list. A filter bar with
// dropdown menus (Status, Rolle, Klasse, Anwesenheit, Tage, Gear — each option
// with the count it would leave), the active filters as chips, a grouping switch
// (Rolle, Klasse, Anwesenheit, Status, Keine) and groups that fold, each head
// with its count, class mix, how many are in the roster and the average
// attendance. Filters, grouping, sort and folded groups are remembered.
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { KaderDay, KaderGear, KaderPlayer, KaderRole } from "../../api";
import { Chip, IconButton, Segment } from "../../components/ui";
import { CheckIcon, ChevronDownIcon, MinusIcon, PlusIcon, SearchIcon } from "../../components/icons";
import { useDismiss } from "../../hooks/useDismiss";
import { usePersistedState } from "../../lib/persistedState";
import { tParts, useT } from "../../i18n";
import { roleLabel } from "../../lib/wowNames";
import { activeOf, className, colorOf, pctOf, statusOf, ROLES, type Status } from "../../lib/kader/model";
import {
    ATT_STEPS, DAYS, EMPTY_FILTERS, GEARS, GROUP_BYS, NO_CLASS, STATUSES,
    cleanFilters, countWith, filterCount, groupPlayers, passes, sortPlayers, tierOf,
    type Filters, type GroupBy, type SortBy,
} from "../../lib/kader/players";
import { useKader } from "./kaderContext";
import { CharName, ClassBar, ClassIcon, Meter, PlayerIcon, RoleIcon, SubHead, WeekDots } from "./parts";
import { attText, specLine } from "../../lib/kader/model";

type MenuKey = "status" | "roles" | "classes" | "minAtt" | "days" | "gear";
type Option = { key: string; label: string; checked: boolean; n: number; pick: () => void; color?: string; icon?: ReactNode; single?: boolean };

function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function PlayerRow({ player }: { player: KaderPlayer }) {
    const t = useT();
    const { view, roster, open, place, canWrite } = useKader();
    const status = statusOf(roster, player.userId);
    const a = activeOf(player);
    const pct = pctOf(player);
    const free = status !== "kader";
    const full = !!roster && roster.members.length >= roster.size;
    const name = a ? a.name : player.displayName;
    return (
        <div className="kp-lrow">
            <button type="button" className="kp-lrow-char" onClick={() => open({ type: "account", userId: player.userId })}>
                <ClassBar color={colorOf(view.classes, player)} />
                <PlayerIcon player={player} />
                <span className="kp-prow-text">
                    <CharName player={player} className="kp-lrow-name" />
                    <span className="kp-sub">@{player.displayName}</span>
                </span>
            </button>
            <span className="kp-lrow-spec">{specLine(player, view.classes)}</span>
            <span className="kp-lrow-att">
                {pct !== null ? <Meter pct={pct} tone={`tier-${tierOf(pct)}`} /> : <span />}
                <span className="kp-mono">{attText(player)}</span>
            </span>
            <WeekDots days={player.availability} />
            <span><span className={`kp-status st-${status}`}>{t(`kader.status.${status}`)}</span></span>
            {canWrite ? (
                <IconButton
                    icon={free ? <PlusIcon /> : <MinusIcon />}
                    size="sm"
                    tip={free ? (full ? t("kader.pool.full") : t("kader.pool.addTo")) : t("kader.pool.removeFrom")}
                    aria-label={free ? t("kader.pool.addToNamed", { name }) : t("kader.pool.removeFromNamed", { name })}
                    disabled={!roster || (free && full)}
                    onClick={() => void place(player.userId, free ? "role" : "free")}
                />
            ) : <span />}
        </div>
    );
}

export default function PlayersView() {
    const t = useT();
    const { view, roster } = useKader();
    const [storedFilters, setFilters] = usePersistedState<Filters>("kader-filters", EMPTY_FILTERS);
    const f = useMemo(() => cleanFilters(storedFilters), [storedFilters]);
    const [groupBy, setGroupBy] = usePersistedState<GroupBy>("kader-group", "role");
    const [sort, setSort] = usePersistedState<SortBy>("kader-sort", "att");
    const [collapsed, setCollapsed] = usePersistedState<string[]>("kader-collapsed", []);
    const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
    const barRef = useRef<HTMLDivElement>(null);
    useDismiss(barRef, openMenu !== null, () => setOpenMenu(null));

    const classes = view.classes;
    const status = (id: string): Status => statusOf(roster, id);
    const by: GroupBy = GROUP_BYS.includes(groupBy) ? groupBy : "role";
    const list = sortPlayers(view.players.filter((p) => passes(p, f, status, classes)), sort === "name" ? "name" : "att");
    const groups = groupPlayers(list, by, classes, status);
    const count = (skip: MenuKey, test: (p: KaderPlayer) => boolean) => countWith(view.players, f, status, classes, skip, test);
    const set = (patch: Partial<Filters>) => setFilters({ ...f, ...patch });

    function multi<T extends string>(key: "status" | "roles" | "classes" | "days" | "gear", values: T[], labelOf: (v: T) => string, test: (p: KaderPlayer, v: T) => boolean, colorOf?: (v: T) => string): Option[] {
        const current = f[key] as T[];
        return values.map((v) => ({
            key: v,
            label: labelOf(v),
            checked: current.includes(v),
            n: count(key, (p) => test(p, v)),
            pick: () => set({ [key]: toggle(current, v) } as Partial<Filters>),
            color: colorOf ? colorOf(v) : undefined,
        }));
    }

    const classLabelOf = (v: string) => (v === NO_CLASS ? t("kader.group.noClass") : className(classes, v));
    const menus: { key: MenuKey; label: string; n: number; badge: string; options: Option[] }[] = [
        { key: "status", label: t("kader.filter.status"), n: f.status.length, badge: String(f.status.length), options: multi<Status>("status", STATUSES, (v) => t(`kader.status.${v}`), (p, v) => status(p.userId) === v) },
        { key: "roles", label: t("kader.filter.role"), n: f.roles.length, badge: String(f.roles.length), options: multi<KaderRole>("roles", ROLES, (v) => roleLabel(v), (p, v) => activeOf(p)?.role === v).map((o) => ({ ...o, icon: <RoleIcon role={o.key as KaderRole} size={18} /> })) },
        {
            key: "classes", label: t("kader.filter.class"), n: f.classes.length, badge: String(f.classes.length),
            options: multi<string>("classes", [...classes.map((c) => c.key), NO_CLASS], classLabelOf, (p, v) => (activeOf(p)?.className || NO_CLASS) === v, (v) => classes.find((c) => c.key === v)?.color || "")
                .map((o) => ({ ...o, icon: o.key === NO_CLASS ? undefined : <ClassIcon classKey={o.key} size={18} /> })),
        },
        {
            key: "minAtt", label: t("kader.filter.attendance"), n: f.minAtt ? 1 : 0, badge: `≥${f.minAtt}`,
            options: ATT_STEPS.map((v) => ({
                key: String(v),
                label: v ? t("kader.filter.attFrom", { pct: v }) : t("kader.filter.attAll"),
                checked: f.minAtt === v,
                single: true,
                n: count("minAtt", (p) => (pctOf(p) ?? 0) >= v),
                pick: () => { set({ minAtt: v }); setOpenMenu(null); },
            })),
        },
        { key: "days", label: t("kader.filter.days"), n: f.days.length, badge: String(f.days.length), options: multi<KaderDay>("days", DAYS, (v) => t("kader.filter.canDay", { day: t(`kader.day.${v}`) }), (p, v) => p.availability.includes(v)) },
        { key: "gear", label: t("kader.filter.gear"), n: f.gear.length, badge: String(f.gear.length), options: multi<KaderGear>("gear", GEARS, (v) => t(`kader.gear.${v}`), (p, v) => (activeOf(p)?.gear || "none") === v) },
    ];

    const chips: { key: string; label: string; remove: () => void }[] = [
        ...f.status.map((s) => ({ key: `s-${s}`, label: t(`kader.status.${s}`), remove: () => set({ status: toggle(f.status, s) }) })),
        ...f.roles.map((r) => ({ key: `r-${r}`, label: roleLabel(r), remove: () => set({ roles: toggle(f.roles, r) }) })),
        ...f.classes.map((c) => ({ key: `c-${c}`, label: classLabelOf(c), remove: () => set({ classes: toggle(f.classes, c) }) })),
        ...(f.minAtt ? [{ key: "a", label: t("kader.filter.attFrom", { pct: f.minAtt }), remove: () => set({ minAtt: 0 }) }] : []),
        ...f.days.map((d) => ({ key: `d-${d}`, label: t("kader.filter.canDay", { day: t(`kader.day.${d}`) }), remove: () => set({ days: toggle(f.days, d) }) })),
        ...f.gear.map((g) => ({ key: `g-${g}`, label: t(`kader.gear.${g}`), remove: () => set({ gear: toggle(f.gear, g) }) })),
    ];

    return (
        <>
            <SubHead kicker={t("kader.players.kicker")} title={t("kader.players.title")} />
            <div className="kp-filterbar" ref={barRef}>
                <div className="kp-filterrow">
                    <label className="kp-search kp-wide">
                        <SearchIcon />
                        <input type="search" aria-label={t("kader.players.search")} placeholder={t("kader.players.search")} value={f.q} onChange={(e) => set({ q: e.target.value })} />
                    </label>
                    {menus.map((m) => (
                        <div key={m.key} className="kp-menuwrap">
                            <button
                                type="button"
                                className={`kp-menubtn${m.n ? " kp-active" : ""}${openMenu === m.key ? " kp-open" : ""}`}
                                aria-expanded={openMenu === m.key}
                                aria-haspopup="true"
                                onClick={() => setOpenMenu(openMenu === m.key ? null : m.key)}
                            >
                                {m.label}
                                {m.n > 0 && <span className="kp-menubadge">{m.badge}</span>}
                                <ChevronDownIcon />
                            </button>
                            {openMenu === m.key && (
                                <div className="kp-menu" role="menu" aria-label={m.label}>
                                    {m.options.map((o) => (
                                        <button key={o.key} type="button" role={o.single ? "menuitemradio" : "menuitemcheckbox"} aria-checked={o.checked} className="kp-menuopt" onClick={o.pick}>
                                            <span className={`kp-check${o.single ? " kp-round" : ""}${o.checked ? " kp-on" : ""}`}>{o.checked && <CheckIcon />}</span>
                                            {o.icon}
                                            <span className={`kp-grow${o.color ? " class-colored" : ""}`} style={o.color ? { "--cc": o.color } as CSSProperties : undefined}>{o.label}</span>
                                            <span className="kp-mono kp-muted">{o.n}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                    <span className="kp-grow" />
                    <div className="kp-groupby">
                    <span className="kicker">{t("kader.players.groupBy")}</span>
                    <Segment<GroupBy>
                        size="sm"
                        ariaLabel={t("kader.players.groupBy")}
                        value={by}
                        onChange={(v) => { setGroupBy(v); setCollapsed([]); }}
                        options={GROUP_BYS.map((g) => ({ value: g, label: t(`kader.groupBy.${g}`) }))}
                    />
                    </div>
                </div>
                <div className="kp-countrow">
                    <span className="kp-muted">{tParts("kader.players.count", { n: list.length, total: view.players.length })}</span>
                    {chips.map((c) => <Chip key={c.key} onRemove={c.remove} removeLabel={t("kader.filter.remove", { label: c.label })}>{c.label}</Chip>)}
                    {filterCount(f) > 0 && <button type="button" className="kp-link" onClick={() => setFilters({ ...EMPTY_FILTERS, q: f.q })}>{t("kader.filter.clear")}</button>}
                    <span className="kp-grow" />
                    <label className="kp-sort kp-muted">{t("kader.players.sort")}
                        <select value={sort} onChange={(e) => setSort(e.target.value === "name" ? "name" : "att")}>
                            <option value="att">{t("kader.players.sortAtt")}</option>
                            <option value="name">{t("kader.players.sortName")}</option>
                        </select>
                    </label>
                </div>
            </div>
            <div className="kp-panel kp-list">
                <div className="kp-lrow kp-headrow" aria-hidden="true">
                    <span className="kicker">{t("kader.players.colChar")}</span>
                    <span className="kicker">{t("kader.players.colSpec")}</span>
                    <span className="kicker">{t("kader.players.colAtt")}</span>
                    <span className="kicker">{t("kader.players.colDays")}</span>
                    <span className="kicker">{t("kader.players.colStatus")}</span>
                    <span />
                </div>
                {groups.length === 0 && <div className="kp-empty">{t("kader.players.none")}</div>}
                {groups.map((g) => {
                    const expanded = !collapsed.includes(g.key);
                    return (
                        <div key={g.key} className="kp-lgroup">
                            <button type="button" className="kp-ghead" aria-expanded={expanded} onClick={() => setCollapsed(expanded ? [...collapsed, g.key] : collapsed.filter((k) => k !== g.key))}>
                                <span className={`kp-chev${expanded ? "" : " kp-closed"}`}><ChevronDownIcon /></span>
                                {by === "role" && (ROLES as string[]).includes(g.key) && <RoleIcon role={g.key as KaderRole} size={18} />}
                                {by === "cls" && g.key !== NO_CLASS && <ClassIcon classKey={g.key} size={18} />}
                                <span className={`kp-gtitle ${g.tone}${g.color ? " class-colored" : ""}`} style={g.color ? { "--cc": g.color } as CSSProperties : undefined}>{g.title}</span>
                                <span className="kp-mono kp-muted">{g.items.length}</span>
                                <span className="kp-mix" aria-hidden="true">
                                    {g.mix.map((m) => <i key={m.key} style={{ "--cc": m.color, "--share": `${m.share}%` } as CSSProperties} />)}
                                </span>
                                <span className="kp-grow" />
                                <span className="kp-sub">{t("kader.players.inKader", { n: g.inKader })}</span>
                                <span className="kp-mono kp-muted kp-avg">{g.avg === null ? "Ø —" : `Ø ${g.avg} %`}</span>
                            </button>
                            {expanded && g.items.map((p) => <PlayerRow key={p.userId} player={p} />)}
                        </div>
                    );
                })}
            </div>
        </>
    );
}
