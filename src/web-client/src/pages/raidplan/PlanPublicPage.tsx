import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, Clapperboard, ZoomIn, ZoomOut } from "lucide-react";
import { useVisiblePoll } from "../../hooks/useVisiblePoll";
import { hasSectionDeepLink, sectionFromUrl, showSectionInUrl } from "../../lib/raidplan/sectionUrl";
import { useBoardView } from "../../hooks/useBoardView";
import { useSheetLayout } from "../../hooks/useSheetLayout";
import type { MinePos, StripMode } from "../../lib/raidplan/sheetLayout";
import { viewFromSaved } from "../../lib/raidplan/boardView";
import MiniMap from "../../components/raidplan/MiniMap";
import { useViewPrefs } from "../../hooks/useViewPrefs";
import { useRaidProgress } from "../../hooks/useRaidProgress";
import { shownFor } from "../../lib/raidplan/viewRules";
import { SheetViewMenu } from "../../components/raidplan/editor/ViewControls";
import { getRaidplanPublic, pollRaidplanPublic, type RaidplanBoard, type RaidplanPublicBoss } from "../../api";
import { useApi } from "../../hooks/useApi";
import { autoPlaces, deriveAuto } from "../../lib/raidplan/autoPlace";
import PlanBoard from "../../components/raidplan/PlanBoard";
import ScenePlayerBar, { SceneCaption } from "../../components/raidplan/ScenePlayerBar";
import { useScenePlayer } from "../../hooks/useScenePlayer";
import { autoAtOf, boardAfter, boardAt, frameAt, playable } from "../../lib/raidplan/scene";
import StageBar from "./stage/StageBar";
import BossStrip from "./stage/BossStrip";
import MineCard from "./stage/MineCard";
import TasksPanel from "./stage/TasksPanel";
import { bossesWithMine } from "../../lib/raidplan/bossMine";
import { assignmentLinks } from "../../lib/raidplan/assign";
import { splitMine } from "../../lib/raidplan/mineView";
import RaidLoader from "../../components/ui/RaidLoader";
import { TipLayer } from "../../components/ui/Tip";
import ArchiveBanner from "../../components/raid/ArchiveBanner";
import LangToggle from "../../components/shell/LangToggle";
import ThemeToggle from "../../components/shell/ThemeToggle";
import { formatEventTime } from "../../lib/format";
import { rememberSection, rememberedSection, rosterMap, sectionLabel, severalInstances, startSection } from "../../lib/raidplan";
import { cleanNames } from "../../lib/raidplan/mention";
import { useT } from "../../i18n";
import "../../styles/raidplan/index.css";

/** the width of "Alle Aufgaben" (stage.css .rp-sheet-panel) */
const PANEL_W = 480;
/** below this stage width the panel always lies over the map: beside it the map would be too narrow */
const PUSH_MIN_W = 900;

/** The stage's own size, read through a ResizeObserver: the map fits it as a whole (0 x 0 until measured). */
function useStageSize(): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    useEffect(() => {
        if (!el) return undefined;
        const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        read();
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, [el]);
    return [setEl, size];
}

/**
 * The read view of a published raid plan, /p/<token> — the "Sheet-Ansicht", laid out as a stage ("Karte als Bühne").
 * No login and no menu: the token in the address is the whole authentication (GET /api/raidplan/public). The page is
 * exactly the window: one bar on top (the section with its arrows, "Alle N Abschnitte", the groups, "Automatisch
 * mitgehen", the live note), and under it the map as big as it fits, on a blurred copy of itself. Over the map float
 * "Deine Aufgaben" (lower left, folds to its head) and the tab "Alle Aufgaben" (right edge), which opens the tables of
 * everyone as a panel. A section without a map (Allgemein, "Karte aus") shows both in the page's flow instead. When
 * the visitor is logged in and stands in the plan (the server answers with `me`), his token and rows are highlighted.
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
    const [focusGroup, setFocusGroup] = useState(0);
    const [onlyMine, setOnlyMine] = useState(false);
    // the boss strip and "Alle Einteilungen" as this visitor left them (this browser, across sections and reloads)
    const [layout, setLayout] = useSheetLayout();
    const panel = layout.allTasks;
    const togglePanel = useCallback(() => setLayout({ allTasks: !panel }), [setLayout, panel]);
    const setStrip = useCallback((strip: StripMode) => setLayout({ strip }), [setLayout]);
    // where "Deine Aufgaben" floats over the map, dragged there by this visitor
    const setMinePos = useCallback((mine: MinePos | null) => setLayout({ mine }), [setLayout]);
    const togglePush = useCallback(() => setLayout({ push: !layout.push }), [setLayout, layout.push]);
    // "Deine Aufgaben" starts folded on a phone, where it would cover half the map
    const [mineFolded, setMineFolded] = useState(() => window.innerWidth < 720);
    const bv = useBoardView({ touchPan: true });
    // the animation that is open ("" = the plan as it is): it closes with its section
    const [animId, setAnimId] = useState("");
    useEffect(() => { setAnimId(""); }, [selected]);
    const animBoss = data ? data.bosses.find((x) => x.key === selected) || null : null;
    const scenes = useMemo(() => (animBoss && animBoss.showMap !== false && !animBoss.general ? playable(animBoss.scenes) : []), [animBoss]);
    const scene = scenes.find((s) => s.id === animId) || null;
    const player = useScenePlayer(scene, { autoplay: true });
    const [prefs, setPref] = useViewPrefs("eh.raidplan.sheetPrefs");
    const [stageRef, stage] = useStageSize();
    // a section opens with the view the organiser saved for it (the whole picture when there is none); a live update keeps the
    // visitor's zoom unless the organiser changed that section's saved view
    const openBoss = data ? data.bosses.find((x) => x.key === selected) || data.bosses[0] : null;
    const savedView = openBoss ? openBoss.view : null;
    const savedViewKey = JSON.stringify(savedView || null);
    useEffect(() => { bv.set(viewFromSaved(savedView)); }, [selected, savedViewKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // "Gruppen im Plan" (#529): a raider outside the plan comes only when a row names him - named there as he is, but never part of a
    // group ring or an auto token (the server resolved everything else without him)
    const players = useMemo(() => rosterMap(data ? data.roster.map((p) => (p.outOfPlan ? { ...p, outOfPlan: false } : p)) : []), [data]);
    const planned = useMemo(() => (data ? data.roster.filter((p) => !p.outOfPlan) : []), [data]);
    // the sections where the visitor is personally assigned: "Aufgabe für dich" in the section menu, quick links in his card (#503)
    const mineKeys = useMemo(() => bossesWithMine(data ? data.bosses : [], players, data ? data.meIds : []), [data, players]);
    // the plan follows the raid (#534): during the raid window the linked log turns it to the boss being pulled, else the next one -
    // until the visitor picks a section himself (a deep link ?section= counts as that; the #boss= of a reload does not)
    const sectionKeys = useMemo(() => (data ? data.bosses.map((b) => b.key) : []), [data]);
    const progress = useRaidProgress({
        source: data ? { token } : null, startTime: data ? data.event.startTime : 0, keys: sectionKeys, select: setSelected,
        initialFollow: !hasSectionDeepLink(),
    });
    // the browser tab names the open section
    useEffect(() => {
        const b = data ? data.bosses.find((x) => x.key === selected) : null;
        if (data && b) document.title = `${sectionLabel(b, severalInstances(data.bosses))} · ${data.event.title}`;
    }, [data, selected]);

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
    const names = cleanNames(data.meIds.map((id) => (players.get(id) || { character: "" }).character));
    const ctx = boss ? { slots: boss.slots, players, catalog: data.catalog, groupColors: boss.groupColors, groupMarks: boss.groupMarks, roles: boss.roles || {}, icons: boss.icons } : null;
    const hasMap = !!boss && !boss.general && boss.showMap !== false;
    // "Karte daneben": the open "Alle Aufgaben" makes the map narrower instead of lying over it - only where the window has room for
    // both (a phone's panel is the whole width). --rp-side is the room the stage keeps free on the right (the tab, or the panel), which
    // the map, "Deine Aufgaben" and its drag (MineCard.tsx) leave alone
    const pushable = stage.w >= PUSH_MIN_W;
    const pushed = panel && layout.push && pushable;
    const side = pushed ? Math.min(PANEL_W, stage.w) + 16 : 64;
    // what the tank rows put on the map, exactly as the editor derives it (the rows arrive resolved from the approved setup)
    const baseAuto = boss && hasMap ? deriveAuto(boss.assignments, boss as unknown as RaidplanBoard, { template: false, roster: planned }) : undefined;
    /** the groups of this section, for the bar's chips that highlight one (the others dim on the map) */
    const groupNs = boss ? Array.from(new Set(boss.slots.filter((sl) => sl.kind === "group").map((sl) => sl.n))).sort((a, b) => a - b) : [];
    // "Only for me": the sections that concern the visitor (he does something, or something acts on him); the open one always stays
    const concerns = (b: RaidplanPublicBoss) => {
        const c = { slots: b.slots, players, catalog: data.catalog, groupColors: b.groupColors, groupMarks: b.groupMarks, roles: b.roles || {}, icons: b.icons };
        const sp = splitMine(b.assignments, c, data.meIds, names);
        return sp.mine.length > 0 || sp.onMe.length > 0;
    };
    const shownBosses = onlyMine && data.meIds.length > 0 ? data.bosses.filter((b) => (boss !== null && b.key === boss.key) || concerns(b)) : data.bosses;
    const several = severalInstances(data.bosses);
    const label = (b: RaidplanPublicBoss) => sectionLabel(b, several);
    const loginHref = `/auth/login?next=/p/${token}`;
    const elsewhere = boss ? data.bosses.filter((b) => b.key !== boss.key && mineKeys.has(b.key)) : [];
    // the map fits the stage as a whole, with some air round it; before the stage is measured, what the window leaves under the bar
    const boardHeight = Math.max(240, (stage.h || window.innerHeight - 140) - 24);

    if (!boss || !ctx) {
        return (
            <div className="rp-public rp-sheet">
                <TipLayer />
                <ArchiveBanner archive={data.archived} publicView />
                <header className="rp-sheet-bar">
                    <div className="rp-sheet-titles"><span className="rp-kicker">{t("raidBoard.public.kicker")}</span><h1 className="rp-sheet-title">{data.event.title}</h1></div>
                    <div className="rp-sheet-tools"><LangToggle /><ThemeToggle /></div>
                </header>
                <div className="rp-sheet-flat"><div className="rp-empty"><p className="rp-muted">{(data.hiddenCount || 0) > 0 ? t("raidBoard.public.nothingShared") : t("raidBoard.public.empty")}</p></div></div>
            </div>
        );
    }

    // an open animation moves the objects (lib/raidplan/scene.ts): the board at the player's time, the tank rows' objects from where they stand;
    // with less motion asked for, frame by frame. `drawn` is what the map shows: the plan as it is, or that moment of the animation
    const anim = scene ? (player.still ? boardAfter(boss, scene, frameAt(scene, player.t), autoAtOf(baseAuto)) : boardAt(boss, scene, player.t, autoAtOf(baseAuto))) : null;
    const drawn = anim ? anim.board : boss;
    const auto = anim ? deriveAuto(drawn.assignments, drawn as unknown as RaidplanBoard, { template: false, roster: planned }) : baseAuto;

    const mine = (
        <MineCard
            boss={boss} ctx={ctx} roster={planned} meIds={data.meIds} names={names} loggedIn={!!data.me} loginHref={loginHref}
            elsewhere={elsewhere} label={label} onPick={progress.choose} collapsed={hasMap && mineFolded} onToggle={() => setMineFolded((v) => !v)} inline={!hasMap}
            pos={layout.mine} onMove={setMinePos}
        />
    );
    const tasks = (
        <TasksPanel
            boss={boss} title={label(boss)} ctx={ctx} meIds={data.meIds} names={names} loggedIn={!!data.me} loginHref={loginHref}
            focusGroup={focusGroup} onFocusGroup={setFocusGroup} onClose={hasMap ? togglePanel : undefined}
            push={hasMap && pushable ? { on: layout.push, toggle: togglePush } : null}
        />
    );

    const strip = (mode: "top" | "left") => (
        <BossStrip sections={shownBosses} selectedKey={boss.key} mineKeys={mineKeys} killedKeys={progress.killed} label={label} mode={mode} onPick={progress.choose} />
    );

    return (
        <div className="rp-public rp-sheet">
            {/* the page has no menu shell: its own layer draws the data-tip boxes (the arrows, the groups, the zoom buttons) */}
            <TipLayer />
            <ArchiveBanner archive={data.archived} publicView />
            <StageBar
                boss={boss} sections={shownBosses} mineKeys={mineKeys} killedKeys={progress.killed} label={label}
                head={`${data.event.title} · ${formatEventTime(data.event.startTime)}`} onPick={progress.choose}
                groups={hasMap ? groupNs : []} focusGroup={focusGroup} onFocusGroup={setFocusGroup} follow={progress.chip}
                onlyMine={data.me && data.meIds.length > 0 ? { on: onlyMine, toggle: () => setOnlyMine((v) => !v) } : null}
                strip={{ mode: layout.strip, set: setStrip }} allTasks={hasMap ? { on: panel, toggle: togglePanel } : null}
                updated={updatedAt > 0}
            />
            {layout.strip === "top" && strip("top")}
            <div className="rp-sheet-main">
            {layout.strip === "left" && strip("left")}
            {hasMap ? (
                <div ref={stageRef} className={`rp-sheet-stage${panel ? " is-panel" : ""}${pushed ? " is-push" : ""}${scene ? " is-anim" : ""}`} style={{ "--rp-side": `${side}px` } as CSSProperties}>
                    {boss.mapUrl && <img className="rp-sheet-backdrop" src={boss.mapUrl} alt="" aria-hidden="true" />}
                    <div className="rp-sheet-board">
                        <PlanBoard
                            bossName={boss.name} bossIcon={boss.iconUrl} mapUrl={boss.mapUrl} maxHeight={boardHeight}
                            tokens={drawn.tokens} slots={drawn.slots} marks={drawn.marks} zones={drawn.zones} icons={drawn.icons} objectScale={boss.objectScale} lines={drawn.lines} texts={drawn.texts} mapOpacity={boss.mapOpacity}
                            fx={anim ? anim.fx : undefined} trails={anim ? anim.trails : undefined}
                            players={players} roster={planned} me={data.meIds} links={prefs.links && !anim ? assignmentLinks({ ...boss, places: auto ? autoPlaces(auto) : {} } as never, data.meIds, auto || null) : []} auto={auto} assignments={boss.assignments} showRings={shownFor(boss.showRings, prefs.groupRings)} groupColors={boss.groupColors} groupMarks={boss.groupMarks} focusGroup={focusGroup}
                            view={bv.view} frameRef={bv.frame} showNames={shownFor(boss.showNames, prefs.names)} showBadges={boss.showBadges !== false} showRoleRings={shownFor(boss.showRoleRings, prefs.roleRings)} highlightMe={prefs.highlight}
                        />
                    </div>
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
                    {scene && <SceneCaption scene={scene} t={player.t} />}
                    {scene ? (
                        <ScenePlayerBar className="rp-anim-stage" scenes={scenes} scene={scene} player={player} onPick={setAnimId} onClose={() => setAnimId("")} />
                    ) : scenes.length > 0 && (
                        <button type="button" className="rp-anim-open" data-tip={t("raidBoard.anim.openTip")} onClick={() => setAnimId(scenes[0].id)}>
                            <Clapperboard size={18} aria-hidden="true" />
                            <span>{scenes.length > 1 ? t("raidBoard.anim.openN", { n: scenes.length }) : t("raidBoard.anim.open")}</span>
                        </button>
                    )}
                    {/* while an animation plays, "Deine Aufgaben" makes room for its bar (it comes back with the plan) */}
                    {!scene && mine}
                    {panel ? tasks : (
                        <button type="button" className="rp-sheet-tab" aria-expanded={false} onClick={togglePanel}>
                            <ChevronLeft size={18} aria-hidden="true" />
                            <span className="rp-sheet-tab-label">{t("raidBoard.stage.allTasks")}</span>
                            <span className="rp-sheet-tab-sub">{t("raidBoard.stage.allTasksCount", { n: boss.assignments.length })}</span>
                        </button>
                    )}
                </div>
            ) : (
                <div className="rp-sheet-flat">
                    {mine}
                    {tasks}
                </div>
            )}
            </div>
        </div>
    );
}
