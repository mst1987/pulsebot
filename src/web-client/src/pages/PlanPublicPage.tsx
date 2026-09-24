import { useEffect, useMemo, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { getRaidplanPublic, type ApiError, type RaidplanPublic, type RaidplanPublicBoss } from "../api";
import PlanBoard from "../components/raidplan/PlanBoard";
import ReadTables, { ByPlayerLog } from "./raid-detail/raidplan/ReadTables";
import { assignmentLinks, isMine } from "../lib/assign";
import RaidLoader from "../components/ui/RaidLoader";
import LangToggle from "../components/LangToggle";
import ThemeToggle from "../components/ThemeToggle";
import { formatEventTime } from "../lib/format";
import { rosterMap } from "../lib/raidplan";
import { cleanNames } from "../lib/mention";
import Mentions from "../components/raidplan/Mentions";
import { useT } from "../i18n";
import "../styles/raidplan.css";

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
    const [data, setData] = useState<RaidplanPublic | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [selected, setSelected] = useState("");
    const [mapOnly, setMapOnly] = useState(false);
    const [win, setWin] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

    useEffect(() => {
        getRaidplanPublic(token)
            .then((d) => { setData(d); setSelected(d.bosses[0] ? d.bosses[0].key : ""); })
            .catch((err: ApiError) => setError(err));
    }, [token]);
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
    const mineHere = !!boss && !!data.me && (boss.tokens.some((k) => k.userId === data.me) || boss.slots.some((sl) => sl.userId === data.me) || boss.assignments.some((a) => isMine(a, { slots: boss.slots, players }, data.meIds)));
    const wide = win.w >= 1100;
    const names = cleanNames(data.meIds.map((id) => (players.get(id) || { character: "" }).character));
    // the map's height: the window minus the head, the chips and some air (wide); a small part of the window when it is on top (narrow)
    const mapHeight = mapOnly ? Math.max(300, win.h - 96) : wide ? Math.max(320, win.h - 108) : Math.round(win.h * 0.45);
    const ctx = boss ? { slots: boss.slots, players, catalog: data.catalog } : null;
    const label = (b: RaidplanPublicBoss) => (b.general ? t("raidBoard.assign.general") : b.trash ? t("raidBoard.assign.trash") : b.name);

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

            {data.bosses.length === 0 && <div className="rp-empty"><p className="rp-muted">{t("raidBoard.public.empty")}</p></div>}

            {data.bosses.length > 0 && (
                <>
                    <nav className="rp-bossnav rp-public-nav" aria-label={t("raidBoard.bosses.title")}>
                        {data.bosses.map((b, idx) => {
                            const on = boss !== null && b.key === boss.key;
                            const special = b.trash || b.general;
                            const i = data.bosses.slice(0, idx).filter((x) => !x.trash && !x.general).length;
                            return (
                                <button key={b.key} type="button" className={`rp-bosschip${on ? " is-on" : ""}`} aria-current={on ? "true" : undefined} aria-label={label(b)} data-tip={label(b)} onClick={() => setSelected(b.key)}>
                                    <img src={b.iconUrl} alt="" width={24} height={24} />
                                    {!special && <span className="rp-bosschip-no">{i + 1}</span>}
                                    {on && <span className="rp-bosschip-name">{label(b)}</span>}
                                </button>
                            );
                        })}
                    </nav>

                    {boss && ctx && (
                        <div className={`rp-read-2col${boss.general ? " no-board" : ""}${mapOnly ? " is-map-only" : ""}`}>
                            {!mapOnly && (
                                <div className="rp-read-left">
                                    {boss.notes.trim() && <p className="rp-notes-text"><Mentions text={boss.notes} names={names} /></p>}
                                    <ReadTables assignments={boss.assignments} ctx={ctx} me={data.meIds} loggedIn={!!data.me} loginHref={`/auth/login?next=/p/${token}`} />
                                </div>
                            )}
                            {!boss.general && (
                                <div className="rp-read-right">
                                    <PlanBoard
                                        bossName={boss.name} bossIcon={boss.iconUrl} mapUrl={boss.mapUrl} maxHeight={mapHeight}
                                        tokens={boss.tokens} slots={boss.slots} marks={boss.marks} zones={boss.zones} icons={boss.icons} objectScale={boss.objectScale} lines={boss.lines} texts={boss.texts} mapOpacity={boss.mapOpacity}
                                        players={players} roster={data.roster} me={data.meIds} links={assignmentLinks(boss as never, data.meIds)}
                                    />
                                    {wide && (
                                        <button type="button" className="rp-maponly" aria-pressed={mapOnly} data-tip={t(mapOnly ? "raidBoard.public.mapBack" : "raidBoard.public.mapOnly")} aria-label={t(mapOnly ? "raidBoard.public.mapBack" : "raidBoard.public.mapOnly")} onClick={() => setMapOnly((v) => !v)}>
                                            {mapOnly ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {boss && ctx && !mapOnly && <ByPlayerLog assignments={boss.assignments} ctx={ctx} me={data.meIds} />}
                </>
            )}
        </div>
    );
}
