import { useEffect, useMemo, useState } from "react";
import { getRaidplanPublic, type ApiError, type RaidplanPublic, type RaidplanPublicBoss } from "../api";
import PlanBoard from "../components/raidplan/PlanBoard";
import { AssignTable } from "./raid-detail/raidplan/AssignPanel";
import { assignmentLinks, isMine } from "../lib/assign";
import RaidLoader from "../components/ui/RaidLoader";
import LangToggle from "../components/LangToggle";
import ThemeToggle from "../components/ThemeToggle";
import { formatEventTime } from "../lib/format";
import { rosterMap } from "../lib/raidplan";
import { useT } from "../i18n";
import "../styles/raidplan.css";

/**
 * The read view of a published raid plan, /p/<token> — the "Sheet-Ansicht".
 * No login and no menu: the token in the address is the whole authentication
 * (GET /api/raidplan/public). Per boss the board with its map and the table of
 * target rows. When the visitor is logged in and stands in the plan (the server
 * answers with `me`), their own token and rows are highlighted.
 */
export default function PlanPublicPage({ token }: { token: string }) {
    const t = useT();
    const [data, setData] = useState<RaidplanPublic | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [selected, setSelected] = useState("");

    useEffect(() => {
        getRaidplanPublic(token)
            .then((d) => { setData(d); setSelected(d.bosses[0] ? d.bosses[0].key : ""); })
            .catch((err: ApiError) => setError(err));
    }, [token]);

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
    const mineHere = !!boss && !!data.me && (boss.tokens.some((k) => k.userId === data.me) || boss.slots.some((sl) => sl.userId === data.me) || boss.assignments.some((a) => isMine(a, { slots: boss.slots, players }, data.me)));

    return (
        <div className="rp-public rp-wide">
            <header className="rp-public-head">
                <div>
                    <div className="rp-kicker">{t("raidBoard.public.kicker")}</div>
                    <h1 className="rp-public-title">{data.event.title}</h1>
                    <div className="rp-muted">{formatEventTime(data.event.startTime)}</div>
                </div>
                <div className="rp-public-tools">
                    <LangToggle />
                    <ThemeToggle />
                </div>
            </header>

            {data.bosses.length === 0 && <div className="rp-empty"><p className="rp-muted">{t("raidBoard.public.empty")}</p></div>}

            {data.bosses.length > 0 && (
                <>
                    <div className="rp-tabs" role="tablist">
                        {data.bosses.map((b) => (
                            <button key={b.key} type="button" role="tab" aria-selected={boss !== null && b.key === boss.key} className={`rp-tab${boss !== null && b.key === boss.key ? " is-on" : ""}`} onClick={() => setSelected(b.key)}>
                                <img src={b.iconUrl} alt="" width={22} height={22} />
                                {b.general ? t("raidBoard.assign.general") : b.trash ? t("raidBoard.assign.trash") : b.name}
                            </button>
                        ))}
                    </div>

                    {boss && (
                        <div className="rp-public-body">
                            {!boss.general && <PlanBoard
                                bossName={boss.name} bossIcon={boss.iconUrl} mapUrl={boss.mapUrl}
                                tokens={boss.tokens} slots={boss.slots} marks={boss.marks} zones={boss.zones} icons={boss.icons} objectScale={boss.objectScale} lines={boss.lines} texts={boss.texts} mapOpacity={boss.mapOpacity}
                                players={players} roster={data.roster} me={data.me} links={assignmentLinks(boss as never)}
                            />}
                            <div className="rp-public-side">
                                {boss.profileName && <p className="rp-muted">{t("raidBoard.public.tactic", { name: boss.profileName })}</p>}
                                {data.me
                                    ? <p className={mineHere ? "rp-me-note" : "rp-muted"}>{mineHere ? t("raidBoard.public.you") : t("raidBoard.public.youNot")}</p>
                                    : <p className="rp-muted">{t("raidBoard.public.loginHint")} <a className="mlink" href="/auth/login">{t("raidBoard.public.login")}</a></p>}
                                <AssignTable assignments={boss.assignments} ctx={{ slots: boss.slots, players }} me={data.me} />
                                {boss.notes.trim() && (
                                    <>
                                        <h2 className="rp-kicker rp-h2">{t("raidBoard.public.notes")}</h2>
                                        <p className="rp-notes-text">{boss.notes}</p>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
