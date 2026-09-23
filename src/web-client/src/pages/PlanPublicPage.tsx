import { useEffect, useMemo, useState } from "react";
import { getRaidplanPublic, type ApiError, type RaidplanPublic, type RaidplanPublicBoss } from "../api";
import PlanBoard, { PlayerName, TokenIcon } from "../components/raidplan/PlanBoard";
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
    const mineHere = !!boss && !!data.me && (boss.tokens.some((k) => k.userId === data.me) || boss.targets.some((r) => r.userIds.includes(data.me)));

    return (
        <div className="rp-public">
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
                                {b.name}
                            </button>
                        ))}
                    </div>

                    {boss && (
                        <div className="rp-public-body">
                            <PlanBoard
                                bossName={boss.name} bossIcon={boss.iconUrl} mapUrl={boss.mapUrl}
                                tokens={boss.tokens} players={players} me={data.me}
                            />
                            <div className="rp-public-side">
                                {boss.profileName && <p className="rp-muted">{t("raidBoard.public.tactic", { name: boss.profileName })}</p>}
                                {data.me
                                    ? <p className={mineHere ? "rp-me-note" : "rp-muted"}>{mineHere ? t("raidBoard.public.you") : t("raidBoard.public.youNot")}</p>
                                    : <p className="rp-muted">{t("raidBoard.public.loginHint")} <a className="mlink" href="/auth/login">{t("raidBoard.public.login")}</a></p>}
                                <h2 className="rp-kicker rp-h2">{t("raidBoard.public.targets")}</h2>
                                {boss.targets.length === 0 && <p className="rp-muted">{t("raidBoard.public.rowsEmpty")}</p>}
                                {boss.targets.length > 0 && (
                                    <table className="rp-table">
                                        <tbody>
                                            {boss.targets.map((r) => (
                                                <tr key={r.id} className={data.me && r.userIds.includes(data.me) ? "is-me" : ""}>
                                                    <th scope="row">{r.title}</th>
                                                    <td>
                                                        {r.userIds.map((id) => {
                                                            const p = players.get(id);
                                                            if (!p) return null;
                                                            return (
                                                                <span key={id} className={`rp-chip rp-static${id === data.me ? " is-me" : ""}`}>
                                                                    <TokenIcon player={p} size="sm" />
                                                                    <PlayerName player={p} />
                                                                </span>
                                                            );
                                                        })}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
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
