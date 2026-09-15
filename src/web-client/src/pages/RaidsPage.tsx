import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getRaids, getPastRaids, canAccess,
    type ApiError, type PastRaidsData, type RaidsData, type PastRaid, type UpcomingRaid,
} from "../api";
import { usePersistedSearchParam, usePersistedState } from "../lib/persistedState";
import { knownContents, raidIconName } from "../lib/raidIcons";
import type { ShellContext } from "../components/Shell";
import { UpcomingRaidList, PastRaidList } from "../components/RaidList";
import RaidCreateDialog from "../components/RaidCreateDialog";
import IconTile from "../components/ui/IconTile";
import Badge from "../components/ui/Badge";
import WowIcon from "../components/ui/WowIcon";
import { buttonClass } from "../components/ui/Button";
import "../styles/raid-events.css";
import RaidLoader from "../components/ui/RaidLoader";

// Raid-Events: one page, two views of the same list — what is coming and what
// took place — filtered by Discord category. "Neues Event" (/raids/new) is a
// dialog over this page, not a page of its own.

const VIEWS = ["upcoming", "past"] as const;
type View = typeof VIEWS[number];

// /raids and /raids/new are two routes, so opening the dialog remounts the page.
// The last answer is kept here and shown at once while the fresh one loads,
// instead of blanking the list behind the dialog.
const lastLoaded: { upcoming: RaidsData | null; past: PastRaidsData | null } = { upcoming: null, past: null };

/** The pill id of events outside any category — "" is taken by "Alle". */
const NO_CATEGORY = "__none__";

type Pill = { id: string; name: string; count: number; icon: string };

/** One filter pill per category of the open view, with the raid icon its events show most. */
function categoryPills(events: (UpcomingRaid | PastRaid)[]): Pill[] {
    const byId = new Map<string, { name: string; count: number; contents: Map<string, number> }>();
    for (const ev of events) {
        const key = ev.categoryId || NO_CATEGORY;
        const entry = byId.get(key) || { name: ev.categoryName || "Ohne Kategorie", count: 0, contents: new Map() };
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
    const opts: { v: View; label: string }[] = [{ v: "upcoming", label: "Kommend" }, { v: "past", label: "Vergangen" }];
    return (
        <div className="seg re-seg" role="radiogroup" aria-label="Ansicht">
            {opts.map((o) => (
                <button key={o.v} type="button" role="radio" aria-checked={value === o.v} className={`seg-opt${value === o.v ? " active" : ""}`} onClick={() => onChange(o.v)}>
                    {o.label}
                    <Badge count tone={value === o.v ? "accent" : undefined}>{counts[o.v] ?? "…"}</Badge>
                </button>
            ))}
        </div>
    );
}

export default function RaidsPage() {
    const { user, csrfToken } = useOutletContext<ShellContext>();
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const canWrite = canAccess(user, "raids", "write");

    const [view, setView] = usePersistedSearchParam<View>("raids-view", "view", "upcoming", VIEWS);
    // Remembered by category id, not by position: categories come and go with
    // the scheduled events, so a position would point at another raid next week.
    const [categoryId, setCategoryId] = usePersistedState("raids-category", "");

    const [upcoming, setUpcoming] = useState<RaidsData | null>(lastLoaded.upcoming);
    const [past, setPast] = useState<PastRaidsData | null>(lastLoaded.past);
    const [error, setError] = useState<ApiError | null>(null);
    const [pastError, setPastError] = useState<ApiError | null>(null);

    const load = useCallback(() => {
        getRaids().then((d) => { lastLoaded.upcoming = d; setUpcoming(d); }).catch((err: ApiError) => setError(err));
        getPastRaids().then((d) => { lastLoaded.past = d; setPast(d); }).catch((err: ApiError) => setPastError(err));
    }, []);
    useEffect(load, [load]);

    const creating = location.pathname.replace(/\/+$/, "") === "/raids/new";
    const closeCreate = () => navigate(view === "past" ? "/raids?view=past" : "/raids");
    const repeat = (id: string) => navigate(`/raids/new?source=${encodeURIComponent(id)}`);

    if (error) return <div className="empty">Fehler beim Laden der Raid-Events: {error.message}</div>;
    if (!upcoming) return <RaidLoader text="Raids werden geladen" />;

    const events: (UpcomingRaid | PastRaid)[] = view === "past" ? (past?.events || []) : upcoming.events;
    const pills = categoryPills(events);
    // A remembered category with nothing in this view shows everything instead of an empty list.
    const activeCategory = categoryId && pills.some((p) => p.id === categoryId) ? categoryId : null;
    const filtered = activeCategory === null ? events : events.filter((ev) => (ev.categoryId || NO_CATEGORY) === activeCategory);

    let listing: React.ReactNode;
    if (!upcoming.activeGuildId) {
        listing = <div className="glist re-glist"><div className="re-empty">Wähle oben einen Server, um die Events zu sehen.</div></div>;
    } else if (view === "upcoming") {
        listing = (
            <>
                {upcoming.error && <div className="re-warn">{upcoming.error}</div>}
                <UpcomingRaidList
                    events={filtered as UpcomingRaid[]}
                    guildId={upcoming.activeGuildId}
                    canWrite={canWrite}
                    onRepeat={repeat}
                    emptyMessage={upcoming.error ? "Keine Events geladen." : "Keine anstehenden Events gefunden."}
                />
            </>
        );
    } else if (pastError) {
        listing = <div className="glist re-glist"><div className="re-empty">Fehler beim Laden der vergangenen Raids: {pastError.message}</div></div>;
    } else if (!past) {
        listing = <div className="glist re-glist"><div className="re-empty">Lade vergangene Raids…</div></div>;
    } else {
        listing = (
            <>
                {past.error && <div className="re-warn">{past.error}</div>}
                <PastRaidList events={filtered as PastRaid[]} emptyMessage="Keine vergangenen Raids gefunden." />
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
                        Raid-Events
                        <span
                            className="re-info" tabIndex={0}
                            data-tip="Raid-Events"
                            data-tip-sub="Alle Events des gewählten Servers aus Raid-Helper, kommende und vergangene. Anmelde-Aufruf, Raidsheet, Logs und Loot findest du im Event selbst."
                        >i</span>
                    </h1>
                </div>
                <div className="ph-act">
                    <Link className={buttonClass("ghost", "md", true)} to="/raids/templates"><WowIcon name="inv_misc_horn_01" size={22} />Aufruf-Vorlagen</Link>
                    {canWrite && <Link className={buttonClass("primary", "md", true)} to="/raids/new"><WowIcon name="inv_misc_note_05" size={22} />Neues Event</Link>}
                </div>
            </div>

            <div className="re-toolbar">
                <ViewSwitch
                    value={view}
                    onChange={(v) => setView(v)}
                    counts={{ upcoming: upcoming.events.length, past: past ? past.events.length : null }}
                />
                {pills.length > 0 && (
                    <div className="re-pills" role="radiogroup" aria-label="Kategorie">
                        <button type="button" role="radio" aria-checked={activeCategory === null} className={`re-pill noimg${activeCategory === null ? " on" : ""}`} onClick={() => setCategoryId("")}>
                            Alle <Badge count>{events.length}</Badge>
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
                    csrfToken={csrfToken}
                    userId={user?.id || ""}
                    onClose={closeCreate}
                    onCreated={() => { closeCreate(); load(); }}
                />
            )}
        </div>
    );
}
