import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { MarkIcon } from "../components/raidplan/MarkIcon";
import { groupColor, groupMark, inkOn } from "../lib/raidplan/groupStyle";
import { Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { useBoardView } from "../hooks/useBoardView";
import { viewFromSaved } from "../lib/raidplan/boardView";
import MiniMap from "../components/raidplan/MiniMap";
import { useViewPrefs } from "../hooks/useViewPrefs";
import { shownFor } from "../lib/raidplan/viewRules";
import { SheetViewMenu } from "./raid-detail/raidplan/ViewControls";
import { getRaidplanPublic, type RaidplanBoard, type RaidplanPublicBoss } from "../api";
import { useApi } from "../hooks/useApi";
import { autoPlaces, deriveAuto } from "../lib/raidplan/autoPlace";
import PlanBoard from "../components/raidplan/PlanBoard";
import ReadTables from "./raid-detail/raidplan/ReadTables";
import ReadSteps from "./raid-detail/raidplan/ReadSteps";
import { assignmentLinks, isMine } from "../lib/raidplan/assign";
import { splitMine } from "../lib/raidplan/mineView";
import RaidLoader from "../components/ui/RaidLoader";
import LangToggle from "../components/LangToggle";
import ThemeToggle from "../components/ThemeToggle";
import { formatEventTime } from "../lib/format";
import { rosterMap, sectionLabel, severalInstances, startSection } from "../lib/raidplan";
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
 */
export default function PlanPublicPage({ token }: { token: string }) {
    const t = useT();
    const [selected, setSelected] = useState("");
    const plan = useApi(() => getRaidplanPublic(token).then((d) => {
        // a deep link (?section=<key>) first, else "Allgemein", else the first section (left-out ones are not sent at all)
        setSelected(startSection(d.bosses, new URLSearchParams(window.location.search).get("section") || "", "", []));
        return d;
    }), [token]);
    const { data, error } = plan;
    const [mapOnly, setMapOnly] = useState(false);
    const [focusGroup, setFocusGroup] = useState(0);
    const [onlyMine, setOnlyMine] = useState(false);
    const bv = useBoardView({ touchPan: true });
    const [prefs, setPref] = useViewPrefs("eh.raidplan.sheetPrefs");
    // another section starts fitted again
    // a section opens with the view the organiser saved for it (the whole picture when there is none)
    useEffect(() => { const b = data ? data.bosses.find((x) => x.key === selected) || data.bosses[0] : null; bv.set(viewFromSaved(b ? b.view : null)); }, [selected, data]); // eslint-disable-line react-hooks/exhaustive-deps
    const [win, setWin] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

    useEffect(() => {
        const size = () => setWin({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener("resize", size);
        return () => window.removeEventListener("resize", size);
    }, []);

    const players = useMemo(() => rosterMap(data ? data.roster : []), [data]);

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
    const auto = boss && !boss.general && boss.showMap !== false ? deriveAuto(boss.assignments, boss as unknown as RaidplanBoard, { template: false, roster: data.roster }) : undefined;
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
            <header className="rp-public-head">
                <div className="rp-public-titles">
                    <span className="rp-kicker">{t("raidBoard.public.kicker")}</span>
                    <h1 className="rp-public-title">{data.event.title}</h1>
                    <span className="rp-muted">{formatEventTime(data.event.startTime)}</span>
                    {boss && boss.profileName && <span className="rp-muted">· {t("raidBoard.public.tactic", { name: boss.profileName })}</span>}
                    {data.me && boss && <span className={mineHere ? "rp-me-note" : "rp-muted"}>· {mineHere ? t("raidBoard.public.you") : t("raidBoard.public.youNot")}</span>}
                </div>
                <div className="rp-public-tools">
                    <LangToggle />
                    <ThemeToggle />
                </div>
            </header>

            {data.bosses.length === 0 && <div className="rp-empty"><p className="rp-muted">{(data.hiddenCount || 0) > 0 ? t("raidBoard.public.nothingShared") : t("raidBoard.public.empty")}</p></div>}

            {data.bosses.length > 0 && (
                <>
                    <nav className="rp-bossnav rp-public-nav" aria-label={t("raidBoard.bosses.title")}>
                        {data.me && data.meIds.length > 0 && (
                            <button type="button" className={`rp-bosschip rp-onlymine${onlyMine ? " is-on" : ""}`} aria-pressed={onlyMine} data-tip={t("raidBoard.read.onlyMineTip")} onClick={() => setOnlyMine((v) => !v)}>{t("raidBoard.read.onlyMine")}</button>
                        )}
                        {shownBosses.map((b) => {
                            const on = boss !== null && b.key === boss.key;
                            // icon and name on every chip (the same bar as the editor's BossNav)
                            return (
                                <button key={b.key} type="button" className={`rp-bosschip${on ? " is-on" : ""}`} aria-current={on ? "true" : undefined} aria-label={label(b)} onClick={() => setSelected(b.key)}>
                                    <img src={b.iconUrl} alt="" width={24} height={24} />
                                    <span className="rp-bosschip-name">{label(b)}</span>
                                </button>
                            );
                        })}
                    </nav>

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
                                        players={players} roster={data.roster} me={data.meIds} links={prefs.links ? assignmentLinks({ ...boss, places: auto ? autoPlaces(auto) : {} } as never, data.meIds) : []} auto={auto} assignments={boss.assignments} showRings={shownFor(boss.showRings, prefs.groupRings)} groupColors={boss.groupColors} groupMarks={boss.groupMarks} focusGroup={focusGroup}
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
