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
import { Link, useOutletContext } from "react-router-dom";
import {
    canAccess, getRoster, setRosterHidden,
    type ApiError, type RosterChar, type RosterData, type RosterHiddenNote, type RosterRole,
} from "../api";
import { usePersistedState } from "../lib/persistedState";
import { sortRows, useTableSort, type Dir } from "../lib/tableSort";
import { ClassSpecIdentity } from "../components/ClassSpec";
import { RosterKpis } from "../components/RosterHero";
import { AttendanceBar, GearStateBadge, IconLink, LootBadge, RoleBadge } from "../components/RosterCommon";
import { SortLabel } from "../components/SortTh";
import { CLASS_LABELS, ROLE_ORDER, classIconName } from "../lib/rosterView";
import { Badge, Expand, IconButton, IconTile, Segment, WowIcon } from "../components/ui";
import { ChevronDownIcon, EyeIcon, EyeOffIcon, SearchIcon } from "../components/icons";
import type { ShellContext } from "../components/Shell";
import { useToast } from "../components/Jobs";
import { useConfirm } from "../components/ui/Modal";
import { formatDate } from "../lib/format";
import "../styles/roster-charakter.css";

/** Rows a long group shows before "n weitere zeigen". */
const GROUP_PREVIEW = 11;

type RoleFilter = "all" | "tank" | "healer" | "dps";

/** Which list the panel shows: the roster, or who was taken off it. */
type Tab = "active" | "hidden";

// What the columns sort by. The attendance is the one that depends on where the
// row stands — it is measured per raid category, so a group sorts by its own.
type SortKey = "name" | "role" | "attendance" | "gear" | "loot";
const SORT_DEFAULTS: Record<SortKey, Dir> = { name: "asc", role: "asc", attendance: "desc", gear: "desc", loot: "desc" };

// Search/filter/open groups survive a reload and a visit to another page.
// Stored values are untrusted: an unknown role falls back to "all". `open` is
// null until the visitor folds a group — then the first group is open.
type View = { search: string; role: RoleFilter; className: string; spec: string; onlyIssues: boolean; tab: Tab; open: string[] | null };
const VIEW_DEFAULT: View = { search: "", role: "all", className: "", spec: "", onlyIssues: false, tab: "active", open: null };
const ROLE_FILTERS: RoleFilter[] = ["all", "tank", "healer", "dps"];

const UNGROUPED = "__none";

function byRoleThenName(a: RosterChar, b: RosterChar): number {
    const r = (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3);
    return r || a.character.localeCompare(b.character);
}

function charHref(c: RosterChar, tab = ""): string {
    return `/roster/char?name=${encodeURIComponent(c.character)}${tab ? `&tab=${tab}` : ""}`;
}

function RosterRow({ c, categoryId, categoryName, hidden, onHide }: {
    c: RosterChar;
    categoryId: string;
    categoryName: string;
    /** Set on a row of the "Ausgeblendet" list: when and by whom. */
    hidden?: RosterHiddenNote;
    /** Missing when the visitor may only read the roster. */
    onHide?: (c: RosterChar, hide: boolean) => void;
}) {
    return (
        <div className="rc-row">
            <ClassSpecIdentity
                character={c.character}
                className={c.className}
                spec={c.spec}
                classColor={c.classColor}
                iconUrl={c.iconUrl}
                to={charHref(c)}
                extra={hidden
                    ? (
                        <Badge
                            className="rc-mini" tip="Ausgeblendet"
                            tipSub={`${hidden.by ? `Von ${hidden.by}, ` : ""}seit ${formatDate(hidden.at)}${hidden.reason ? ` · ${hidden.reason}` : ""}`}
                        >
                            ausgeblendet
                        </Badge>
                    )
                    : !c.assigned && !!c.lootCount && (
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
                {onHide && (hidden
                    ? (
                        <IconButton
                            size="sm" icon={<EyeIcon />} tip="Wieder ins Roster"
                            tipSub="Der Charakter taucht wieder in den Listen und in den Zahlen oben auf."
                            onClick={() => onHide(c, false)}
                        />
                    )
                    : (
                        <IconButton
                            size="sm" icon={<EyeOffIcon />} tip="Ausblenden"
                            tipSub="Nimmt den Charakter aus den Listen und den Zahlen oben — Loot, Auswertungen und die Charakter-Seite bleiben unverändert."
                            onClick={() => onHide(c, true)}
                        />
                    ))}
            </span>
            <Link className="exp-lbl rc-open" to={charHref(c)}>
                <span>Öffnen</span>
                <span className="exp go" aria-hidden="true"><ChevronDownIcon /></span>
            </Link>
        </div>
    );
}

// The column head is the sort control (SortLabel, the same one the loot council
// uses over its grid): a roster is read down a column — who was there least,
// who has the most open gear findings — and clicking the head is where everyone
// tries that first. The explanation stays in the head's tooltip.
function GroupColumns({ sort, dir, onSort }: { sort: SortKey; dir: Dir; onSort: (key: SortKey) => void }) {
    const head = (sortKey: SortKey, label: string, tip: string, tipSub: string) => (
        <SortLabel<SortKey> sortKey={sortKey} label={label} sort={sort} dir={dir} onSort={onSort} tip={tip} tipSub={tipSub} />
    );
    return (
        <div className="rc-cols">
            <span />
            {head("name", "Charakter", "Charakter", "Name in Klassenfarbe, darunter die Spec. Klick öffnet die Charakter-Seite.")}
            {head("role", "Rolle", "Rolle", "Die Rolle aus dem neuesten Log, in dem der Charakter vorkommt; ohne Log aus der Spec.")}
            {head("attendance", "Anwesenheit", "Anwesenheit", "Die letzten 11 Raids dieser Kategorie: im Log = da; ohne Log zählt die Raid-Helper-Anmeldung des zugeordneten Raiders.\nGrün ab 80 %, gelb ab 60 %.")}
            {head("gear", "Gear-Stand", "Gear-Stand", "Befunde aus der neuesten Log-Auswertung, in der der Charakter vorkommt: fehlende Verzauberung, leere Sockel, inaktiver Meta-Gem.\n„nicht ausgewertet“ = in keiner gespeicherten Auswertung.")}
            {head("loot", "Loot", "Loot", "Importierte Items dieses Charakters; die neuesten im Tooltip.")}
            <span className="rc-cols-links">Links</span>
            <span />
        </div>
    );
}

function RosterGroup({ id, title, crumb, icon, chars, open, onToggle, sort, dir, onSort, hiddenNotes, onHide }: {
    id: string;
    title: string;
    crumb: string;
    icon: string;
    chars: RosterChar[];
    open: boolean;
    onToggle: () => void;
    sort: SortKey;
    dir: Dir;
    onSort: (key: SortKey) => void;
    /** Only the hidden list passes these — per character key, since when. */
    hiddenNotes?: Record<string, RosterHiddenNote>;
    onHide?: (c: RosterChar, hide: boolean) => void;
}) {
    const [showAll, setShowAll] = useState(false);
    const withIssues = chars.filter((c) => c.gear && c.gear.issueCount).length;
    const high = chars.some((c) => c.gear && c.gear.issues.some((i) => i.severity === "high"));
    // Sorted per group: the attendance column measures against *this* category.
    const sorted = sortRows(chars, (c) => {
        switch (sort) {
            case "role": return ROLE_ORDER[c.role] ?? 3;
            // no nights counted sorts below 0 %, never above it
            case "attendance": return c.attendance?.[id]?.pct ?? -1;
            case "gear": return c.gear ? c.gear.issueCount : -1;
            case "loot": return c.lootCount || 0;
            default: return c.character.toLowerCase();
        }
    }, dir);
    const shown = showAll ? sorted : sorted.slice(0, GROUP_PREVIEW);
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
                    <GroupColumns sort={sort} dir={dir} onSort={onSort} />
                    {shown.map((c) => (
                        <RosterRow
                            key={c.key} c={c} categoryId={id} categoryName={title}
                            hidden={hiddenNotes?.[c.key]} onHide={onHide}
                        />
                    ))}
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
    const { user, csrfToken } = useOutletContext<ShellContext>();
    const [data, setData] = useState<RosterData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [stored, setView] = usePersistedState<View>("roster-view", VIEW_DEFAULT);
    const { sort, dir, onSort } = useTableSort<SortKey>("roster-sort", SORT_DEFAULTS, "name");
    const toast = useToast();
    const ask = useConfirm();
    const canWrite = canAccess(user, "roster", "write");

    useEffect(() => {
        getRoster().then(setData).catch((err: ApiError) => setError(err));
    }, []);

    const showHidden = stored.tab === "hidden";
    const chars = useMemo(() => (showHidden ? data?.hiddenChars : data?.chars) || [], [data, showHidden]);
    const categories = useMemo(() => data?.categories || [], [data]);
    // Which of the hidden rows carries which note, for the badge in its row.
    const hiddenNotes = useMemo(() => {
        const m: Record<string, RosterHiddenNote> = {};
        for (const c of data?.hiddenChars || []) m[c.key] = c.hidden;
        return m;
    }, [data]);

    /**
     * Take a character off the roster or put it back. The answer is applied to
     * the loaded roster instead of re-fetching it: the endpoint rebuilds every
     * character's gear and attendance, which is seconds of work for a decision
     * whose outcome we already know.
     */
    const toggleHidden = async (c: RosterChar, hide: boolean) => {
        if (hide && !(await ask({
            title: "Charakter ausblenden?",
            text: `„${c.character}" verschwindet aus den Listen und aus den Zahlen oben. Loot, Auswertungen und die Charakter-Seite bleiben unverändert — über den Tab „Ausgeblendet" kommt er jederzeit zurück.`,
            action: "Ausblenden",
        }))) return;
        try {
            await setRosterHidden(csrfToken, c.character, hide);
            setData((prev) => {
                if (!prev) return prev;
                if (hide) {
                    const note: RosterHiddenNote = { character: c.character, reason: "", at: Date.now(), by: user.name || "" };
                    return {
                        ...prev,
                        chars: prev.chars.filter((x) => x.key !== c.key),
                        hiddenChars: [...prev.hiddenChars, { ...c, hidden: note }],
                    };
                }
                return {
                    ...prev,
                    chars: [...prev.chars, c],
                    hiddenChars: prev.hiddenChars.filter((x) => x.key !== c.key),
                };
            });
            toast(hide ? `${c.character} ausgeblendet.` : `${c.character} ist wieder im Roster.`, "ok");
            // The KPI band is aggregated server-side, so it only agrees with the
            // lists again once the roster comes back — quietly, in the background.
            getRoster().then(setData).catch(() => undefined);
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

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
    if (!data) return <div className="empty">Lade…</div>;

    // A stored view from an older build lacks fields or carries old ones
    // (category, classSpec, sort) — only the known fields are read.
    const view: View = {
        search: typeof stored.search === "string" ? stored.search : "",
        role: ROLE_FILTERS.includes(stored.role) ? stored.role : "all",
        className: typeof stored.className === "string" ? stored.className : "",
        spec: typeof stored.spec === "string" ? stored.spec : "",
        onlyIssues: stored.onlyIssues === true,
        tab: stored.tab === "hidden" ? "hidden" : "active",
        open: Array.isArray(stored.open) ? stored.open : null,
    };
    const patch = (p: Partial<View>) => setView(() => ({ ...view, ...p }));

    // The specs to pick from follow the class filter — 30 specs in one list is
    // not a filter, and the roster rarely carries more than a handful per class.
    const specCounts = (() => {
        const m = new Map<string, number>();
        for (const c of chars) {
            if (view.className && c.className !== view.className) continue;
            if (c.spec) m.set(c.spec, (m.get(c.spec) || 0) + 1);
        }
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    })();
    // A spec that the current class filter does not have is no filter at all.
    const activeSpec = specCounts.some(([spec]) => spec === view.spec) ? view.spec : "";

    const searchLower = view.search.trim().toLowerCase();
    const filtered = chars.filter((c) => {
        if (searchLower && !c.character.toLowerCase().includes(searchLower)) return false;
        if (view.role !== "all" && c.role !== (view.role as RosterRole)) return false;
        if (view.className && c.className !== view.className) return false;
        if (activeSpec && c.spec !== activeSpec) return false;
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
                {(!!data.hiddenChars.length || canWrite) && (
                    <div className="rc-tabs">
                        <Segment<Tab>
                            ariaLabel="Liste"
                            value={view.tab}
                            onChange={(tab) => patch({ tab })}
                            options={[
                                {
                                    value: "active", label: `Roster (${data.chars.length})`, icon: "achievement_guildperk_everybodysfriend",
                                    tip: "Wer aktuell zählt",
                                },
                                {
                                    value: "hidden", label: `Ausgeblendet (${data.hiddenChars.length})`, icon: "inv_misc_book_09",
                                    tip: "Nicht mehr dabei",
                                },
                            ]}
                        />
                    </div>
                )}
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
                {/* Specs as their own row of pills, and only once a class is
                    picked: 30 specs at once is not a filter, the four a class
                    actually plays is. Same gesture as the class chips — a second
                    click takes the filter back. */}
                {!!view.className && specCounts.length > 1 && (
                    <div className="rc-specs-row" role="group" aria-label="Spec">
                        {specCounts.map(([spec, count]) => {
                            const on = activeSpec === spec;
                            return (
                                <button
                                    key={spec}
                                    type="button"
                                    className={`rc-spec${on ? " is-on" : ""}`}
                                    aria-pressed={on}
                                    data-tip={spec}
                                    data-tip-sub={on ? "Klick hebt den Spec-Filter auf." : `Nur ${spec} zeigen.`}
                                    onClick={() => patch({ spec: on ? "" : spec })}
                                >
                                    {spec}
                                    <b>{count}</b>
                                </button>
                            );
                        })}
                    </div>
                )}
                {!chars.length && (
                    <p className="sub rc-empty">
                        {showHidden
                            ? "Niemand ausgeblendet. Über das Augen-Symbol in einer Zeile kommt jemand hierher, der nicht mehr mitraidet."
                            : "Noch keine Charaktere bekannt — Loot importieren oder unter Einstellungen → Kategorien Raider ihren Chars zuordnen."}
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
                        sort={sort}
                        dir={dir}
                        onSort={onSort}
                        hiddenNotes={showHidden ? hiddenNotes : undefined}
                        onHide={canWrite ? toggleHidden : undefined}
                    />
                ))}
            </div>
        </>
    );
}
