// The roster: every known character of the guild, grouped by the raid category
// it belongs to (Discord category = one recurring raid series, e.g.
// "Montagsraid", "Pug"). A character raiding under several categories shows up
// in each group.
//
// The page answers the raid lead's question before an invite (design issue
// #218): what does the character play, was it there lately, is its gear in
// order, what did it already get. Explanations live in tooltips, the full gear
// findings and the loot history one click away on the character page.
import { useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { canAccess, getCharacterClaims, getRoster, setRosterHidden, type ApiError, type RosterChar, type RosterHiddenNote, type RosterRole } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePersistedState } from "../../lib/persistedState";
import { useTableSort, type Dir } from "../../lib/tableSort";
import { RosterKpis } from "./RosterHero";
import { ROLE_ORDER, classIconName } from "../../lib/rosterView";
import { classLabel, roleLabel } from "../../lib/wowNames";
import { useT } from "../../i18n";
import { IconTile, Segment, WowIcon } from "../../components/ui";
import { SearchIcon } from "../../components/icons";
import type { ShellContext } from "../../components/Shell";
import { useToast } from "../../components/Jobs";
import { useConfirm } from "../../components/ui/Modal";
import "../../styles/roster-charakter.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { RosterGroup, UNGROUPED } from "./RosterGroup";
import { ClaimsBadge } from "./ClaimsBadge";

type RoleFilter = "all" | "tank" | "healer" | "dps";

/** Which list the panel shows: the roster, or who was taken off it. */
type Tab = "active" | "hidden";

// What the columns sort by. The attendance is the one that depends on where the
// row stands — it is measured per raid category, so a group sorts by its own.
export type SortKey = "name" | "role" | "attendance" | "gear" | "loot";

const SORT_DEFAULTS: Record<SortKey, Dir> = { name: "asc", role: "asc", attendance: "desc", gear: "desc", loot: "desc" };

// Search/filter/open groups survive a reload and a visit to another page.
// Stored values are untrusted: an unknown role falls back to "all". `open` is
// null until the visitor folds a group — then the first group is open.
type View = { search: string; role: RoleFilter; className: string; spec: string; onlyIssues: boolean; tab: Tab; open: string[] | null };

const VIEW_DEFAULT: View = { search: "", role: "all", className: "", spec: "", onlyIssues: false, tab: "active", open: null };

const ROLE_FILTERS: RoleFilter[] = ["all", "tank", "healer", "dps"];

function byRoleThenName(a: RosterChar, b: RosterChar): number {
    const r = (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3);
    return r || a.character.localeCompare(b.character);
}

export default function RosterPage() {
    const { user } = useOutletContext<ShellContext>();
    const roster = useApi(() => getRoster(), []);
    const { data, setData } = roster;
    // Beside the roster, best-effort: without the claims the "doppelt vergeben" badge simply stays away.
    const claimsData = useApi(() => getCharacterClaims().then((r) => r.claims), []);
    const claims = claimsData.data || [];
    const [stored, setView] = usePersistedState<View>("roster-view", VIEW_DEFAULT);
    const { sort, dir, onSort } = useTableSort<SortKey>("roster-sort", SORT_DEFAULTS, "name");
    const toast = useToast();
    const ask = useConfirm();
    const canWrite = canAccess(user, "roster", "write");
    const t = useT();

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
            title: t("roster.hide.title"),
            text: t("roster.hide.text", { name: c.character }),
            action: t("roster.hide.action"),
        }))) return;
        try {
            await setRosterHidden(c.character, hide);
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
            toast(hide ? t("roster.hide.hidden", { name: c.character }) : t("roster.hide.back", { name: c.character }), "ok");
            // The KPI band is aggregated server-side, so it only agrees with the
            // lists again once the roster comes back — quietly, in the background:
            // the change itself went through, so a failed refresh must not turn
            // the page into an error.
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

    if (roster.error) return <div className="empty">{t("roster.page.loadError", { message: roster.error.message })}</div>;
    if (!data) return <RaidLoader text={t("roster.page.loading")} />;

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
            crumbParts.push(info?.raids ? t("roster.page.lastRaids", { count: info.raids }) : t("roster.page.noRaids"));
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
        groups.push({ id: UNGROUPED, title: t("roster.page.ungrouped"), crumb: t("roster.page.ungroupedCrumb"), icon: "inv_misc_note_02", chars: ungrouped });
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
                    <div className="kicker">{t("roster.page.categories", { count: data.stats.categories })}</div>
                    <h1 className="ros-title">
                        {t("roster.page.title")}
                        <span
                            className="ros-info"
                            tabIndex={0}
                            data-tip={t("roster.page.infoTip")}
                            data-tip-sub={t("roster.page.infoSub")}
                        >
                            ?
                        </span>
                    </h1>
                    {claims.length > 0 && <div className="ph-meta"><ClaimsBadge claims={claims} /></div>}
                </div>
            </div>

            <RosterKpis stats={data.stats} onlyIssues={view.onlyIssues} onToggleIssues={() => patch({ onlyIssues: !view.onlyIssues })} />

            <div className="dash-card ros-panel">
                {(!!data.hiddenChars.length || canWrite) && (
                    <div className="ros-tabs">
                        <Segment<Tab>
                            ariaLabel={t("roster.page.listAria")}
                            value={view.tab}
                            onChange={(tab) => patch({ tab })}
                            options={[
                                {
                                    value: "active", label: t("roster.page.tabActive", { count: data.chars.length }), icon: "achievement_guildperk_everybodysfriend",
                                    tip: t("roster.page.tabActiveTip"),
                                },
                                {
                                    value: "hidden", label: t("roster.page.tabHidden", { count: data.hiddenChars.length }), icon: "inv_misc_book_09",
                                    tip: t("roster.page.tabHiddenTip"),
                                },
                            ]}
                        />
                    </div>
                )}
                <div className="ros-filters">
                    <label className="ros-search">
                        <SearchIcon />
                        <input
                            type="search"
                            placeholder={t("roster.page.searchPlaceholder")}
                            aria-label={t("roster.page.searchAria")}
                            value={view.search}
                            onChange={(e) => patch({ search: e.target.value })}
                        />
                    </label>
                    <Segment<RoleFilter>
                        ariaLabel={t("roster.page.roleAria")}
                        value={view.role}
                        onChange={(role) => patch({ role })}
                        options={[
                            { value: "all", label: t("common.all") },
                            { value: "tank", label: roleLabel("tank"), icon: "inv_shield_06" },
                            { value: "healer", label: roleLabel("healer"), icon: "spell_holy_flashheal" },
                            { value: "dps", label: roleLabel("dps"), icon: "ability_dualwield" },
                        ]}
                    />
                    {!!classCounts.length && (
                        <div className="ros-chips" role="group" aria-label={t("roster.page.classAria")}>
                            {classCounts.map(([className, count]) => {
                                const on = view.className === className;
                                const label = classLabel(className);
                                return (
                                    <button
                                        key={className}
                                        type="button"
                                        className={`ros-chip${on ? " is-on" : ""}${view.className && !on ? " is-dim" : ""}`}
                                        aria-pressed={on}
                                        aria-label={`${label} · ${count}`}
                                        data-tip={`${label} · ${count}`}
                                        data-tip-sub={on ? t("roster.page.classOn") : t("roster.page.showOnly", { label })}
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
                    <div className="ros-specs-row" role="group" aria-label="Spec">
                        {specCounts.map(([spec, count]) => {
                            const on = activeSpec === spec;
                            return (
                                <button
                                    key={spec}
                                    type="button"
                                    className={`ros-spec${on ? " is-on" : ""}`}
                                    aria-pressed={on}
                                    data-tip={spec}
                                    data-tip-sub={on ? t("roster.page.specOn") : t("roster.page.showOnly", { label: spec })}
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
                    <p className="sub ros-empty">
                        {showHidden
                            ? t("roster.page.emptyHidden")
                            : t("roster.page.emptyActive")}
                    </p>
                )}
                {!!chars.length && !filtered.length && <p className="sub ros-empty">{t("roster.page.noMatch")}</p>}
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
