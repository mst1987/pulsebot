import { Link, useLocation, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getRaids, getPastRaids, canAccess,
    type PastRaidsData, type RaidsData, type PastRaid, type UpcomingRaid } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePersistedSearchParam, usePersistedState } from "../../lib/ui/persistedState";
import { knownContents, raidIconName } from "../../lib/wow/raidIcons";
import type { ShellContext } from "../../components/shell/Shell";
import { UpcomingRaidList, PastRaidList } from "./RaidList";
import { MenuRailPage } from "../../components/ui/SectionRail";
import RaidCreateDialog from "../../components/raid-create/RaidCreateDialog";
import IconTile from "../../components/ui/IconTile";
import Badge from "../../components/ui/Badge";
import WowIcon from "../../components/ui/WowIcon";
import { useContentVersion } from "../../hooks/useContentVersion";
import { buttonClass } from "../../components/ui/Button";
import "../../styles/raid-events.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { isOrga } from "../../lib/app/orgaArea";
import { useT } from "../../i18n";

// Raid-Events: one page, two views of the same list — what is coming and what
// took place — filtered by Discord category. "Neues Event" (/raids/new) is a
// dialog over this page, not a page of its own.

const VIEWS = ["upcoming", "past"] as const;
type View = typeof VIEWS[number];

// /raids and /raids/new are two routes, so opening the dialog remounts the page.
// The last answer is kept here and shown at once while the fresh one loads,
// instead of blanking the list behind the dialog. Keyed by the version filter
// (#545): switching versions must not flash the other version's cached rows.
const lastLoaded: { upcoming: Record<string, RaidsData>; past: Record<string, PastRaidsData> } = { upcoming: {}, past: {} };

/** The pill id of events outside any category — "" is taken by "Alle". */
const NO_CATEGORY = "__none__";

type Pill = { id: string; name: string; count: number; icon: string };

/** One filter pill per category of the open view, with the raid icon its events show most. */
function categoryPills(events: (UpcomingRaid | PastRaid)[], noCategory: string): Pill[] {
    const byId = new Map<string, { name: string; count: number; contents: Map<string, number> }>();
    for (const ev of events) {
        const key = ev.categoryId || NO_CATEGORY;
        const entry = byId.get(key) || { name: ev.categoryName || noCategory, count: 0, contents: new Map() };
        entry.count += 1;
        const first = knownContents(ev.contentIds)[0];
        if (first) entry.contents.set(first, (entry.contents.get(first) || 0) + 1);
        byId.set(key, entry);
    }
    return [...byId].map(([id, e]) => {
        const top = [...e.contents].sort((a, b) => b[1] - a[1])[0];
        return { id, name: e.name, count: e.count, icon: top ? raidIconName(top[0]) : "" };
    }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The Kommend/Vergangen switch — the Segment look with a count badge per option. */
function ViewSwitch({ value, onChange, counts }: { value: View; onChange: (v: View) => void; counts: Record<View, number | null> }) {
    const t = useT();
    const opts: { v: View; label: string }[] = [{ v: "upcoming", label: t("raids.page.upcoming") }, { v: "past", label: t("raids.page.past") }];
    return (
        <div className="seg re-seg" role="radiogroup" aria-label={t("raids.page.viewAria")}>
            {opts.map((o) => (
                <button key={o.v} type="button" role="radio" aria-checked={value === o.v} className={`seg-opt${value === o.v ? " active" : ""}`} onClick={() => onChange(o.v)}>
                    {o.label}
                    <Badge count tone={value === o.v ? "accent" : undefined}>{counts[o.v] ?? "…"}</Badge>
                </button>
            ))}
        </div>
    );
}

/** The raid list beside the rail of Raid-Events' pages (Raidplan-Vorlagen, -Katalog; components/ui/SectionRail.tsx). */
export default function RaidsPage() {
    const { user } = useOutletContext<ShellContext>();
    return <MenuRailPage user={user} parent="raids"><RaidsList user={user} /></MenuRailPage>;
}

function RaidsList({ user }: ShellContext) {
    const t = useT();
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    // The orga (lib/app/orgaArea.ts): series, templates, notifications, logs, "Kanal fehlt" and creating raids.
    // A raider sees the raids of their categories (the server filters) with what interests them.
    const orga = isOrga(user);
    const canWrite = orga && canAccess(user, "raids", "write");

    const [view, setView] = usePersistedSearchParam<View>("raids-view", "view", "upcoming", VIEWS);
    // Remembered by category id, not by position: categories come and go with
    // the scheduled events, so a position would point at another raid next week.
    const [categoryId, setCategoryId] = usePersistedState("raids-category", "");
    // The game version (#563): the menu's content switch; "" = the server's main version.
    const { version } = useContentVersion();

    const upcomingData = useApi(
        () => getRaids(version).then((d) => { lastLoaded.upcoming[version] = d; return d; }),
        [version],
        { initial: lastLoaded.upcoming[version] || null },
    );
    const pastData = useApi(
        () => getPastRaids(version).then((d) => { lastLoaded.past[version] = d; return d; }),
        [version],
        { initial: lastLoaded.past[version] || null },
    );
    const { data: upcoming, error } = upcomingData;
    const { data: past, error: pastError } = pastData;
    const load = () => { upcomingData.reload(); pastData.reload(); };

    const creating = location.pathname.replace(/\/+$/, "") === "/raids/new";
    const closeCreate = () => navigate(view === "past" ? "/raids?view=past" : "/raids");
    const repeat = (id: string) => navigate(`/raids/new?source=${encodeURIComponent(id)}`);

    if (error) return <div className="empty">{t("raids.page.loadError", { message: error.message })}</div>;
    if (!upcoming) return <RaidLoader text={t("raids.page.loading")} />;

    const events: (UpcomingRaid | PastRaid)[] = view === "past" ? (past?.events || []) : upcoming.events;
    const pills = categoryPills(events, t("raids.page.noCategory"));
    // A remembered category with nothing in this view shows everything instead of an empty list.
    const activeCategory = categoryId && pills.some((p) => p.id === categoryId) ? categoryId : null;
    const filtered = activeCategory === null ? events : events.filter((ev) => (ev.categoryId || NO_CATEGORY) === activeCategory);

    let listing: React.ReactNode;
    if (!upcoming.activeGuildId) {
        listing = <div className="glist re-glist"><div className="re-empty">{t("raids.page.pickServer")}</div></div>;
    } else if (view === "upcoming") {
        listing = (
            <>
                {upcoming.error && <div className="re-warn">{upcoming.error}</div>}
                <UpcomingRaidList
                    events={filtered as UpcomingRaid[]}
                    guildId={upcoming.activeGuildId}
                    canWrite={canWrite}
                    orga={orga}
                    onRepeat={repeat}
                    emptyMessage={upcoming.error ? t("raids.page.noneLoaded") : t("raids.page.noneUpcoming")}
                />
            </>
        );
    } else if (pastError) {
        listing = <div className="glist re-glist"><div className="re-empty">{t("raids.page.pastError", { message: pastError.message })}</div></div>;
    } else if (!past) {
        listing = <div className="glist re-glist"><div className="re-empty">{t("raids.page.pastLoading")}</div></div>;
    } else {
        listing = (
            <>
                {past.error && <div className="re-warn">{past.error}</div>}
                <PastRaidList events={filtered as PastRaid[]} emptyMessage={t("raids.page.nonePast")} orga={orga} canLoot={canAccess(user, "history") || canAccess(user, "loot")} />
            </>
        );
    }

    return (
        <div className="re-page">
            <div className="page-head">
                <IconTile icon="inv_misc_note_02" size="lg" />
                <div className="ph-text">
                    <div className="kicker">Raid-Helper{upcoming.guildName ? ` · ${upcoming.guildName}` : ""}</div>
                    <h1 className="re-h1">
                        {t("raids.page.title")}
                        <span
                            className="re-info" tabIndex={0}
                            data-tip={t("raids.page.title")}
                            data-tip-sub={t("raids.page.info")}
                        >i</span>
                    </h1>
                </div>
                {orga && (
                    <div className="ph-act">
                        <Link className={buttonClass("ghost", "md", true)} to="/raids/series"><WowIcon name="spell_holy_borrowedtime" size={22} />{t("raids.page.series")}</Link>
                        <Link className={buttonClass("ghost", "md", true)} to="/raids/raid-templates"><WowIcon name="inv_misc_note_01" size={22} />{t("raids.page.raidTemplates")}</Link>
                        <Link className={buttonClass("ghost", "md", true)} to="/raids/templates"><WowIcon name="inv_misc_horn_01" size={22} />{t("raids.page.notifyTemplates")}</Link>
                        {canWrite && <Link className={buttonClass("primary", "md", true)} to="/raids/new"><WowIcon name="inv_misc_note_05" size={22} />{t("raids.page.newEvent")}</Link>}
                    </div>
                )}
            </div>

            <div className="re-toolbar">
                <ViewSwitch
                    value={view}
                    onChange={(v) => setView(v)}
                    counts={{ upcoming: upcoming.events.length, past: past ? past.events.length : null }}
                />
                {pills.length > 0 && (
                    <div className="re-pills" role="radiogroup" aria-label={t("raids.page.categoryAria")}>
                        <button type="button" role="radio" aria-checked={activeCategory === null} className={`re-pill noimg${activeCategory === null ? " on" : ""}`} onClick={() => setCategoryId("")}>
                            {t("raids.page.all")} <Badge count>{events.length}</Badge>
                        </button>
                        {pills.map((p) => (
                            <button
                                key={p.id} type="button" role="radio" aria-checked={activeCategory === p.id}
                                className={`re-pill${p.icon ? "" : " noimg"}${activeCategory === p.id ? " on" : ""}`}
                                onClick={() => setCategoryId(p.id)}
                            >
                                {p.icon && <WowIcon name={p.icon} size={20} />}
                                {p.name} <Badge count>{p.count}</Badge>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {listing}

            {canWrite && (
                <RaidCreateDialog
                    open={creating}
                    sourceId={creating ? searchParams.get("source") || "" : ""}
                    userId={user?.id || ""}
                    onClose={closeCreate}
                    onCreated={() => { closeCreate(); load(); }}
                />
            )}
        </div>
    );
}
