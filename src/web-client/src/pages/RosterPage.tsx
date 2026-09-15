// The roster: every known character of the guild, grouped by the raid category
// it belongs to (Discord category = one recurring raid series, e.g.
// "Montagsraid", "Pug"). A character raiding under several categories shows up
// in each group.
//
// The page answers the raid lead's question before an invite (design issue
// #218): what does the character play, was it there lately, is its gear in
// order, what did it already get. Explanations live in tooltips, the full gear
// findings and the loot history one click away on the character page.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getRoster, type ApiError, type RosterChar, type RosterData, type RosterRole } from "../api";
import { usePersistedState } from "../lib/persistedState";
import { ClassSpecIdentity } from "../components/ClassSpec";
import { RosterKpis } from "../components/RosterHero";
import { AttendanceBar, GearStateBadge, IconLink, LootBadge, RoleBadge, TipLabel } from "../components/RosterCommon";
import { CLASS_LABELS, ROLE_ORDER, classIconName } from "../lib/rosterView";
import { Badge, Expand, IconTile, Segment, WowIcon } from "../components/ui";
import { ChevronDownIcon, SearchIcon } from "../components/icons";
import "../styles/roster-charakter.css";
import RaidLoader from "../components/ui/RaidLoader";

/** Rows a long group shows before "n weitere zeigen". */
const GROUP_PREVIEW = 11;

type RoleFilter = "all" | "tank" | "healer" | "dps";

// Search/filter/open groups survive a reload and a visit to another page.
// Stored values are untrusted: an unknown role falls back to "all". `open` is
// null until the visitor folds a group — then the first group is open.
type View = { search: string; role: RoleFilter; className: string; onlyIssues: boolean; open: string[] | null };
const VIEW_DEFAULT: View = { search: "", role: "all", className: "", onlyIssues: false, open: null };
const ROLE_FILTERS: RoleFilter[] = ["all", "tank", "healer", "dps"];

const UNGROUPED = "__none";

function byRoleThenName(a: RosterChar, b: RosterChar): number {
    const r = (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3);
    return r || a.character.localeCompare(b.character);
}

function charHref(c: RosterChar, tab = ""): string {
    return `/roster/char?name=${encodeURIComponent(c.character)}${tab ? `&tab=${tab}` : ""}`;
}

function RosterRow({ c, categoryId, categoryName }: { c: RosterChar; categoryId: string; categoryName: string }) {
    return (
        <div className="rc-row">
            <ClassSpecIdentity
                character={c.character}
                className={c.className}
                spec={c.spec}
                classColor={c.classColor}
                iconUrl={c.iconUrl}
                to={charHref(c)}
                extra={!c.assigned && !!c.lootCount && (
                    <Badge tone="accent" className="rc-mini" tip="nur Loot" tipSub="Nur aus dem Loot bekannt — noch keinem Raider in dieser Kategorie zugeordnet.">
                        nur Loot
                    </Badge>
                )}
            />
            <span className="rc-cell"><RoleBadge role={c.role} /></span>
            <span className="rc-cell">
                {categoryId === UNGROUPED
                    ? <span className="sub">–</span>
                    : <AttendanceBar attendance={c.attendance?.[categoryId]} categoryName={categoryName} />}
            </span>
            <span className="rc-cell"><GearStateBadge gear={c.gear} /></span>
            <span className="rc-cell"><LootBadge count={c.lootCount} items={c.items || []} to={charHref(c, "loot")} /></span>
            <span className="rc-acts">
                <IconLink href={c.wclUrl} icon="inv_misc_pocketwatch_01" tip="Warcraft Logs" />
                <IconLink href={c.armoryUrl} icon="inv_shirt_guildtabard_01" tip="Armory" />
            </span>
            <Link className="exp-lbl rc-open" to={charHref(c)}>
                <span>Öffnen</span>
                <span className="exp go" aria-hidden="true"><ChevronDownIcon /></span>
            </Link>
        </div>
    );
}

function GroupColumns() {
    return (
        <div className="rc-cols" aria-hidden="true">
            <span />
            <TipLabel tip="Charakter" sub="Name in Klassenfarbe, darunter die Spec. Klick öffnet die Charakter-Seite.">Charakter</TipLabel>
            <TipLabel tip="Rolle" sub="Die Rolle aus dem neuesten Log, in dem der Charakter vorkommt; ohne Log aus der Spec.">Rolle</TipLabel>
            <TipLabel tip="Anwesenheit" sub={"Die letzten 11 Raids dieser Kategorie: im Log = da; ohne Log zählt die Raid-Helper-Anmeldung des zugeordneten Raiders.\nGrün ab 80 %, gelb ab 60 %."}>Anwesenheit</TipLabel>
            <TipLabel tip="Gear-Stand" sub={"Befunde aus der neuesten Log-Auswertung, in der der Charakter vorkommt: fehlende Verzauberung, leere Sockel, inaktiver Meta-Gem.\n„nicht ausgewertet“ = in keiner gespeicherten Auswertung."}>Gear-Stand</TipLabel>
            <TipLabel tip="Loot" sub="Importierte Items dieses Charakters; die neuesten im Tooltip.">Loot</TipLabel>
            <span className="rc-cols-links">Links</span>
            <span />
        </div>
    );
}

function RosterGroup({ id, title, crumb, icon, chars, open, onToggle }: {
    id: string;
    title: string;
    crumb: string;
    icon: string;
    chars: RosterChar[];
    open: boolean;
    onToggle: () => void;
}) {
    const [showAll, setShowAll] = useState(false);
    const withIssues = chars.filter((c) => c.gear && c.gear.issueCount).length;
    const high = chars.some((c) => c.gear && c.gear.issues.some((i) => i.severity === "high"));
    const shown = showAll ? chars : chars.slice(0, GROUP_PREVIEW);
    return (
        <section className={`rc-grp${open ? " is-open" : ""}`}>
            <div className="rc-grp-head">
                <IconTile icon={icon} tone={id === UNGROUPED ? "none" : "roster"} />
                <div className="rc-grp-title">
                    <span>{title}</span>
                    <span className="kicker">{crumb}</span>
                </div>
                <Badge count tip={`${chars.length} Charakter${chars.length === 1 ? "" : "e"}`}>{chars.length}</Badge>
                {!!withIssues && (
                    <Badge tone={high ? "bad" : "mid"} icon="inv_misc_gem_variety_02">{withIssues} mit Gear-Problemen</Badge>
                )}
                <Expand open={open} onToggle={onToggle} showLabel={!open} label="Details" />
            </div>
            {open && (
                <div className="rc-list">
                    <GroupColumns />
                    {shown.map((c) => <RosterRow key={c.key} c={c} categoryId={id} categoryName={title} />)}
                    {chars.length > GROUP_PREVIEW && (
                        <div className="rc-more">
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)}>
                                {showAll ? "Weniger zeigen" : `${chars.length - GROUP_PREVIEW} weitere zeigen`}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

export default function RosterPage() {
    const [data, setData] = useState<RosterData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [stored, setView] = usePersistedState<View>("roster-view", VIEW_DEFAULT);

    useEffect(() => {
        getRoster().then(setData).catch((err: ApiError) => setError(err));
    }, []);

    const chars = useMemo(() => data?.chars || [], [data]);
    const categories = useMemo(() => data?.categories || [], [data]);

    const categoryNameById = useMemo(() => {
        const m = new Map<string, string>();
        for (const c of categories) m.set(c.id, c.name);
        return m;
    }, [categories]);

    // Class chips carry the count of the whole roster, like the KPI row.
    const classCounts = useMemo(() => {
        const m = new Map<string, number>();
        for (const c of chars) if (c.className) m.set(c.className, (m.get(c.className) || 0) + 1);
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [chars]);

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <RaidLoader text="Roster wird geladen" />;

    // A stored view from an older build lacks fields or carries old ones
    // (category, classSpec, sort) — only the known fields are read.
    const view: View = {
        search: typeof stored.search === "string" ? stored.search : "",
        role: ROLE_FILTERS.includes(stored.role) ? stored.role : "all",
        className: typeof stored.className === "string" ? stored.className : "",
        onlyIssues: stored.onlyIssues === true,
        open: Array.isArray(stored.open) ? stored.open : null,
    };
    const patch = (p: Partial<View>) => setView(() => ({ ...view, ...p }));

    const searchLower = view.search.trim().toLowerCase();
    const filtered = chars.filter((c) => {
        if (searchLower && !c.character.toLowerCase().includes(searchLower)) return false;
        if (view.role !== "all" && c.role !== (view.role as RosterRole)) return false;
        if (view.className && c.className !== view.className) return false;
        if (view.onlyIssues && !(c.gear && c.gear.issueCount)) return false;
        return true;
    }).sort(byRoleThenName);

    const groups = [...new Set(chars.flatMap((c) => c.categoryIds))]
        .map((id) => {
            const info = data.categoryInfo?.[id];
            const crumbParts = [...(info?.contents || [])];
            crumbParts.push(info?.raids ? `letzte ${info.raids} Raid${info.raids === 1 ? "" : "s"}` : "noch keine Raids gezählt");
            return {
                id,
                title: categoryNameById.get(id) || id,
                crumb: crumbParts.join(" · "),
                icon: info?.icon || "achievement_guildperk_everybodysfriend",
                chars: filtered.filter((c) => c.categoryIds.includes(id)),
            };
        })
        .filter((g) => g.chars.length)
        .sort((a, b) => a.title.localeCompare(b.title));
    const ungrouped = filtered.filter((c) => !c.categoryIds.length);
    if (ungrouped.length) {
        groups.push({ id: UNGROUPED, title: "Ohne Kategorie", crumb: "nur aus Loot-Importen bekannt", icon: "inv_misc_note_02", chars: ungrouped });
    }

    const openIds = view.open ?? (groups[0] ? [groups[0].id] : []);
    const toggleGroup = (id: string) => {
        patch({ open: openIds.includes(id) ? openIds.filter((x) => x !== id) : [...openIds, id] });
    };

    return (
        <>
            <div className="page-head">
                <IconTile icon="achievement_guildperk_everybodysfriend" tone="roster" size="lg" />
                <div className="ph-text">
                    <div className="kicker">{data.stats.categories} Raid-Kategorie{data.stats.categories === 1 ? "" : "n"}</div>
                    <h1 className="rc-title">
                        Roster
                        <span
                            className="rc-info"
                            tabIndex={0}
                            data-tip="Alle Charaktere je Raid-Kategorie"
                            data-tip-sub={"Wer welchen Char in welchem Raid spielt, wird unter Einstellungen → Kategorien zugeordnet; zusätzlich zählt jeder Raid, in dem ein Char Loot bekommen hat.\nAnwesenheit aus Raid-Helper-Anmeldungen und zugeordneten Logs, Gear-Stand aus der letzten Auswertung."}
                        >
                            ?
                        </span>
                    </h1>
                </div>
            </div>

            <RosterKpis stats={data.stats} onlyIssues={view.onlyIssues} onToggleIssues={() => patch({ onlyIssues: !view.onlyIssues })} />

            <div className="dash-card rc-panel">
                <div className="rc-filters">
                    <label className="rc-search">
                        <SearchIcon />
                        <input
                            type="search"
                            placeholder="Charakter suchen …"
                            aria-label="Charakter suchen"
                            value={view.search}
                            onChange={(e) => patch({ search: e.target.value })}
                        />
                    </label>
                    <Segment<RoleFilter>
                        ariaLabel="Rolle"
                        value={view.role}
                        onChange={(role) => patch({ role })}
                        options={[
                            { value: "all", label: "Alle" },
                            { value: "tank", label: "Tank", icon: "inv_shield_06" },
                            { value: "healer", label: "Heiler", icon: "spell_holy_flashheal" },
                            { value: "dps", label: "DPS", icon: "ability_dualwield" },
                        ]}
                    />
                    {!!classCounts.length && (
                        <div className="rc-chips" role="group" aria-label="Klasse">
                            {classCounts.map(([className, count]) => {
                                const on = view.className === className;
                                const label = CLASS_LABELS[className] || className;
                                return (
                                    <button
                                        key={className}
                                        type="button"
                                        className={`rc-chip${on ? " is-on" : ""}${view.className && !on ? " is-dim" : ""}`}
                                        aria-pressed={on}
                                        aria-label={`${label} · ${count}`}
                                        data-tip={`${label} · ${count}`}
                                        data-tip-sub={on ? "Klick hebt den Klassenfilter auf." : `Nur ${label} zeigen.`}
                                        onClick={() => patch({ className: on ? "" : className })}
                                    >
                                        <WowIcon name={classIconName(className)} size={26} />
                                        <b>{count}</b>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                {!chars.length && (
                    <p className="sub rc-empty">
                        Noch keine Charaktere bekannt — Loot importieren oder unter Einstellungen → Kategorien Raider ihren Chars zuordnen.
                    </p>
                )}
                {!!chars.length && !filtered.length && <p className="sub rc-empty">Keine Charaktere zu diesem Filter.</p>}
                {groups.map((g) => (
                    <RosterGroup
                        key={g.id}
                        id={g.id}
                        title={g.title}
                        crumb={g.crumb}
                        icon={g.icon}
                        chars={g.chars}
                        open={openIds.includes(g.id)}
                        onToggle={() => toggleGroup(g.id)}
                    />
                ))}
            </div>
        </>
    );
}
