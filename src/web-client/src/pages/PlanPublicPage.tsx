import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MarkIcon } from "../components/raidplan/MarkIcon";
import { groupColor, groupMark, inkOn } from "../lib/raidplan/groupStyle";
import { Maximize2, Minimize2, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import { useVisiblePoll } from "../hooks/useVisiblePoll";
import { hasSectionDeepLink, sectionFromUrl, showSectionInUrl } from "../lib/raidplan/sectionUrl";
import { useBoardView } from "../hooks/useBoardView";
import { viewFromSaved } from "../lib/raidplan/boardView";
import MiniMap from "../components/raidplan/MiniMap";
import { useViewPrefs } from "../hooks/useViewPrefs";
import { useRaidProgress } from "../hooks/useRaidProgress";
import { shownFor } from "../lib/raidplan/viewRules";
import { SheetViewMenu } from "./raid-detail/raidplan/ViewControls";
import { getRaidplanPublic, pollRaidplanPublic, type RaidplanBoard, type RaidplanPublicBoss } from "../api";
import { useApi } from "../hooks/useApi";
import { autoPlaces, deriveAuto } from "../lib/raidplan/autoPlace";
import PlanBoard from "../components/raidplan/PlanBoard";
import ReadTables from "./raid-detail/raidplan/ReadTables";
import ReadSteps from "./raid-detail/raidplan/ReadSteps";
import SheetBossNav from "./raid-detail/raidplan/SheetBossNav";
import { bossesWithMine } from "../lib/raidplan/bossMine";
import { assignmentLinks, isMine } from "../lib/raidplan/assign";
import { splitMine } from "../lib/raidplan/mineView";
import RaidLoader from "../components/ui/RaidLoader";
import { TipLayer } from "../components/ui/Tip";
import LangToggle from "../components/LangToggle";
import ThemeToggle from "../components/ThemeToggle";
import { formatEventTime } from "../lib/format";
import { rememberSection, rememberedSection, rosterMap, sectionLabel, severalInstances, startSection } from "../lib/raidplan";
import { cleanNames } from "../lib/raidplan/mention";
import Mentions from "../components/raidplan/Mentions";
import { useT } from "../i18n";
import "../styles/raidplan/index.css";

/**
 * The read view of a published raid plan, /p/<token> — the "Sheet-Ansicht".
 * No login and no menu: the token in the address is the whole authentication
 * (GET /api/raidplan/public). The whole window is used: a slim head, the bosses as
 * one row of icon chips, then the assignments (tables) on the left and the map on
 * the right (the bigger part, sticky, its height limited to the window); the log
 * "tasks by player" runs over the full width at the end. Below 1100 px the map is
 * on top and the assignments follow. When the visitor is logged in and stands in
 * the plan (the server answers with `me`), their own token and rows are highlighted.
 *
 * Live (#555): while the tab is visible the page asks again every LIVE_POLL_MS with the ETag of what it shows; the server
 * answers a bare 304 while nothing changed. A changed plan is drawn in place - the section, the zoom, the scroll position,
 * the highlighted group and "Only for me" stay - and a small "Aktualisiert" shows for a moment. The chosen section stands
 * in the address (`#boss=<key>`, lib/raidplan/sectionUrl.ts) and in this browser, so a reload lands on it again.
 */
const LIVE_POLL_MS = 20_000;
/** How long the "Aktualisiert" note stays after a live update. */
const UPDATED_NOTE_MS = 4_000;

export default function PlanPublicPage({ token }: { token: string }) {
    const t = useT();
    const [selected, setSelected] = useState("");
    const memoryKey = `p:${token}`;
    // the ETag of what is shown: the live poll sends it and gets a bare 304 while nothing changed (#555)
    const etag = useRef("");
    const plan = useApi(() => getRaidplanPublic(token).then((r) => {
        const d = r.data;
        etag.current = r.etag;
        // the address first (#boss= of the last visit, else a deep link ?section=), else the section last open in this browser,
        // else "Allgemein", else the first section (left-out ones are not sent at all)
        setSelected(startSection(d.bosses, sectionFromUrl(), rememberedSection(memoryKey), []));
        return d;
    }), [token]);
    const { data, error, setData } = plan;
    // the chosen section into the address and this browser - by hand, by following the log or on the first load (#555)
    useEffect(() => {
        if (!selected) return;
        showSectionInUrl(selected);
        rememberSection(memoryKey, selected);
    }, [selected, memoryKey]);
    // a section the organiser removed meanwhile: back to where a fresh visit starts
    useEffect(() => {
        if (data && selected && !data.bosses.some((b) => b.key === selected)) setSelected(startSection(data.bosses, "", "", []));
    }, [data, selected]);

    // live (#555): ask again with the ETag of what is shown; a 304 (null) changes nothing
    const [updatedAt, setUpdatedAt] = useState(0);
    useVisiblePoll(() => {
        if (!data) return;
        const shown = data;
        pollRaidplanPublic(token, etag.current).then((r) => {
            if (!r) return;
            etag.current = r.etag;
            // an answer equal to what is shown (a proxy that dropped the ETag) draws nothing and says nothing
            if (JSON.stringify(r.data) === JSON.stringify(shown)) return;
            setData(r.data);
            setUpdatedAt(Date.now());
        }).catch(() => { /* withdrawn or offline: keep what is shown, the next round asks again */ });
    }, LIVE_POLL_MS, !!data);
    useEffect(() => {
        if (!updatedAt) return undefined;
        const timer = window.setTimeout(() => setUpdatedAt(0), UPDATED_NOTE_MS);
        return () => window.clearTimeout(timer);
    }, [updatedAt]);
    const [mapOnly, setMapOnly] = useState(false);
    const [focusGroup, setFocusGroup] = useState(0);
    const [onlyMine, setOnlyMine] = useState(false);
    const bv = useBoardView({ touchPan: true });
    const [prefs, setPref] = useViewPrefs("eh.raidplan.sheetPrefs");
    // another section starts fitted again
    // a section opens with the view the organiser saved for it (the whole picture when there is none); a live update keeps the
    // visitor's zoom unless the organiser changed that section's saved view
    const openBoss = data ? data.bosses.find((x) => x.key === selected) || data.bosses[0] : null;
    const savedView = openBoss ? openBoss.view : null;
    const savedViewKey = JSON.stringify(savedView || null);
    useEffect(() => { bv.set(viewFromSaved(savedView)); }, [selected, savedViewKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const [win, setWin] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

    useEffect(() => {
        const size = () => setWin({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener("resize", size);
        return () => window.removeEventListener("resize", size);
    }, []);

    // "Gruppen im Plan" (#529): a raider outside the plan comes only when a row names him - named there as he is, but never part of a
    // group ring or an auto token (the server resolved everything else without him)
    const players = useMemo(() => rosterMap(data ? data.roster.map((p) => (p.outOfPlan ? { ...p, outOfPlan: false } : p)) : []), [data]);
    const planned = useMemo(() => (data ? data.roster.filter((p) => !p.outOfPlan) : []), [data]);
    // the sections where the visitor is personally assigned: their chips carry a dot (issue #503)
    const mineKeys = useMemo(() => bossesWithMine(data ? data.bosses : [], players, data ? data.meIds : []), [data, players]);
    // the plan follows the raid (#534): during the raid window the linked log turns it to the boss being pulled, else the next one -
    // until the visitor picks a section himself (a deep link ?section= counts as that; the #boss= of a reload does not)
    const sectionKeys = useMemo(() => (data ? data.bosses.map((b) => b.key) : []), [data]);
    const progress = useRaidProgress({
        source: data ? { token } : null, startTime: data ? data.event.startTime : 0, keys: sectionKeys, select: setSelected,
        initialFollow: !hasSectionDeepLink(),
    });

    if (error) {
        return (
            <div className="rp-public">
                <div className="rp-empty">
                    <strong>{error.code === "not_found" ? t("raidBoard.public.notFound") : t("raidBoard.public.error", { message: error.message })}</strong>
                </div>
            </div>
        );
    }
    if (!data) return <RaidLoader text={t("raidBoard.public.loading")} />;

    const boss: RaidplanPublicBoss | null = data.bosses.find((b) => b.key === selected) || data.bosses[0] || null;
    const mineHere = !!boss && !!data.me && (boss.tokens.some((k) => k.userId === data.me) || boss.slots.some((sl) => sl.userId === data.me) || boss.assignments.some((a) => isMine(a, { slots: boss.slots, players, roles: boss.roles || {} }, data.meIds)));
    const wide = win.w >= 1100;
    const names = cleanNames(data.meIds.map((id) => (players.get(id) || { character: "" }).character));
    // the map's height: the window minus the head, the chips and some air (wide); a small part of the window when it is on top (narrow)
    const mapHeight = mapOnly ? Math.max(300, win.h - 96) : wide ? Math.max(320, win.h - 108) : Math.round(win.h * 0.45);
    const ctx = boss ? { slots: boss.slots, players, catalog: data.catalog, groupColors: boss.groupColors, groupMarks: boss.groupMarks, roles: boss.roles || {}, icons: boss.icons } : null;
    // what the tank rows put on the map, exactly as the editor derives it (the rows arrive resolved from the approved setup)
    const auto = boss && !boss.general && boss.showMap !== false ? deriveAuto(boss.assignments, boss as unknown as RaidplanBoard, { template: false, roster: planned }) : undefined;
    /** the groups of this section, for the legend that highlights one (the others dim on the map) */
    const groupNs = boss ? Array.from(new Set(boss.slots.filter((sl) => sl.kind === "group").map((sl) => sl.n))).sort((a, b) => a - b) : [];
    // "Only for me": the sections that concern the visitor (he does something, or something acts on him), and in them only his blocks
    const concerns = (b: RaidplanPublicBoss) => {
        const c = { slots: b.slots, players, catalog: data.catalog, groupColors: b.groupColors, groupMarks: b.groupMarks, roles: b.roles || {}, icons: b.icons };
        const sp = splitMine(b.assignments, c, data.meIds, names);
        return sp.mine.length > 0 || sp.onMe.length > 0;
    };
    const shownBosses = onlyMine && data.meIds.length > 0 ? data.bosses.filter((b) => concerns(b)) : data.bosses;
    const several = severalInstances(data.bosses);
    const label = (b: RaidplanPublicBoss) => sectionLabel(b, several);

    return (
        <div className="rp-public rp-wide">
            {/* the page has no menu shell: its own layer draws the data-tip boxes (the chips, the zoom buttons) */}
            <TipLayer />
            <header className="rp-public-head">
                <div className="rp-public-titles">
                    <span className="rp-kicker">{t("raidBoard.public.kicker")}</span>
                    <h1 className="rp-public-title">{data.event.title}</h1>
                    <span className="rp-muted">{formatEventTime(data.event.startTime)}</span>
                    {boss && boss.profileName && <span className="rp-muted">· {t("raidBoard.public.tactic", { name: boss.profileName })}</span>}
                    {data.me && boss && <span className={mineHere ? "rp-me-note" : "rp-muted"}>· {mineHere ? t("raidBoard.public.you") : t("raidBoard.public.youNot")}</span>}
                </div>
                <div className="rp-public-tools">
                    {/* the live update's note (#555): always in the page so a screen reader hears it, text only for a moment */}
                    <span className="rp-live-note" role="status" aria-live="polite">
                        {updatedAt > 0 && <><RefreshCw size={13} aria-hidden="true" />{t("raidBoard.public.updated")}</>}
                    </span>
                    <LangToggle />
                    <ThemeToggle />
                </div>
            </header>

            {data.bosses.length === 0 && <div className="rp-empty"><p className="rp-muted">{(data.hiddenCount || 0) > 0 ? t("raidBoard.public.nothingShared") : t("raidBoard.public.empty")}</p></div>}

            {data.bosses.length > 0 && (
                <>
                    <SheetBossNav
                        bosses={shownBosses} selectedKey={boss ? boss.key : ""} mineKeys={mineKeys} label={label} onSelect={progress.choose}
                        killedKeys={progress.killed} follow={progress.live ? { on: progress.follow, onToggle: () => progress.setFollow(!progress.follow) } : undefined}
                        showOnlyMine={!!data.me && data.meIds.length > 0} onlyMine={onlyMine} onToggleOnlyMine={() => setOnlyMine((v) => !v)}
                    />

                    {boss && ctx && (
                        <div className={`rp-read-2col${boss.general || boss.showMap === false ? " no-board" : ""}${boss.showMap === false && !boss.general ? " no-map" : ""}${mapOnly ? " is-map-only" : ""}`}>
                            {!mapOnly && (
                                <div className="rp-read-left">
                                    {boss.notes.trim() && <p className="rp-notes-text"><Mentions text={boss.notes} names={names} /></p>}
                                    <ReadTables assignments={boss.assignments} ctx={ctx} me={data.meIds} loggedIn={!!data.me} loginHref={`/auth/login?next=/p/${token}`} focusGroup={focusGroup} onFocusGroup={setFocusGroup} onlyMine={onlyMine} />
                                    <ReadSteps steps={boss.steps || []} ctx={ctx} me={data.meIds} onlyMine={onlyMine} />
                                </div>
                            )}
                            {!boss.general && boss.showMap !== false && (
                                <div className="rp-read-right">
                                    {groupNs.length > 0 && (
                                        <div className="rp-glegend" role="group" aria-label={t("raidBoard.group.legend")}>
                                            <span className="rp-kicker">{t("raidBoard.group.legend")}</span>
                                            {groupNs.map((n) => (
                                                <button key={n} type="button" className={focusGroup === n ? "is-on" : ""} aria-pressed={focusGroup === n} data-tip={t("raidBoard.group.legendFocus")} style={{ "--gc": groupColor(boss.groupColors, n), "--gi": inkOn(groupColor(boss.groupColors, n)) } as CSSProperties} onClick={() => setFocusGroup(focusGroup === n ? 0 : n)}>
                                                    {t("raidBoard.slot.group", { n })}{groupMark(boss.groupMarks, n) && <MarkIcon mark={groupMark(boss.groupMarks, n) as never} size={14} />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <PlanBoard
                                        bossName={boss.name} bossIcon={boss.iconUrl} mapUrl={boss.mapUrl} maxHeight={mapHeight}
                                        tokens={boss.tokens} slots={boss.slots} marks={boss.marks} zones={boss.zones} icons={boss.icons} objectScale={boss.objectScale} lines={boss.lines} texts={boss.texts} mapOpacity={boss.mapOpacity}
                                        players={players} roster={planned} me={data.meIds} links={prefs.links ? assignmentLinks({ ...boss, places: auto ? autoPlaces(auto) : {} } as never, data.meIds, auto || null) : []} auto={auto} assignments={boss.assignments} showRings={shownFor(boss.showRings, prefs.groupRings)} groupColors={boss.groupColors} groupMarks={boss.groupMarks} focusGroup={focusGroup}
                                        view={bv.view} frameRef={bv.frame} showNames={shownFor(boss.showNames, prefs.names)} showBadges={boss.showBadges !== false} showRoleRings={shownFor(boss.showRoleRings, prefs.roleRings)} highlightMe={prefs.highlight}
                                    />
                                    <div className="rp-zoomctl" role="group" aria-label={t("raidBoard.zoom.title")}>
                                        <button type="button" aria-label={t("raidBoard.zoom.out")} data-tip={t("raidBoard.zoom.out")} onClick={bv.zoomOut}><ZoomOut size={16} /></button>
                                        <button type="button" className="rp-zoomctl-pct" aria-label={t("raidBoard.zoom.fit")} data-tip={t("raidBoard.zoom.fitTip")} onClick={bv.fit}>{Math.round(bv.view.z * 100)} %</button>
                                        <button type="button" aria-label={t("raidBoard.zoom.in")} data-tip={t("raidBoard.zoom.in")} onClick={bv.zoomIn}><ZoomIn size={16} /></button>
                                        {boss.view && (bv.view.z > 1
                                            ? <button type="button" className="rp-zoomctl-pct" data-tip={t("raidBoard.zoom.wholeTip")} onClick={bv.fit}>{t("raidBoard.zoom.whole")}</button>
                                            : <button type="button" className="rp-zoomctl-pct" data-tip={t("raidBoard.zoom.cutoutTip")} onClick={() => bv.set(viewFromSaved(boss.view))}>{t("raidBoard.zoom.cutout")}</button>)}
                                        <SheetViewMenu prefs={prefs} setPref={setPref} hasLinks />
                                    </div>
                                    {prefs.minimap && bv.view.z > 1 && <MiniMap mapUrl={boss.mapUrl} view={bv.view} onCenter={bv.centerAt} label={t("raidBoard.zoom.minimap")} />}
                                    {wide && (
                                        <button type="button" className="rp-maponly" aria-pressed={mapOnly} data-tip={t(mapOnly ? "raidBoard.public.mapBack" : "raidBoard.public.mapOnly")} aria-label={t(mapOnly ? "raidBoard.public.mapBack" : "raidBoard.public.mapOnly")} onClick={() => setMapOnly((v) => !v)}>
                                            {mapOnly ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
