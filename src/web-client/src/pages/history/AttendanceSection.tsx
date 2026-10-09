import type { RosterCharData } from "../../api";
import { AttendanceBar } from "../../components/roster/RosterCommon";
import { nightLabel } from "../../lib/roster/rosterView";
import { detailText, statusLabel, statusOf, verdictText } from "../../lib/roster/attendanceStatus";
import { Badge, PartHead } from "../../components/ui";
import { useT } from "../../i18n";

export function AttendanceSection({ roster }: { roster: RosterCharData | null }) {
    const t = useT();
    if (!roster) return <p className="sub">{t("history.attendance.loadFailed")}</p>;
    if (!roster.categories.length) return <p className="sub">{t("history.attendance.noCategory")}</p>;
    return (
        <>
            {roster.categories.map((c) => {
                const a = roster.attendance[c.id];
                const raids = a?.raids || [];
                return (
                    <div key={c.id} className="dash-card ros-part">
                        <PartHead
                            icon={c.icon || "ability_warrior_rallyingcry"}
                            tone="roster"
                            title={c.name}
                            crumb={[...c.contents, raids.length ? t("history.attendance.lastRaids", { count: raids.length }) : t("history.attendance.noneCounted")].join(" · ")}
                            action={<AttendanceBar attendance={a} categoryName={c.name} />}
                        />
                        {raids.length
                            ? (
                                <div className="ros-nights">
                                    {raids.map((r) => (
                                        <div key={r.eventId} className="ros-night">
                                            <span className="ros-night-date">{nightLabel(r.startTime * 1000)}</span>
                                            <span className="ros-night-title">{r.title || t("history.attendance.raidFallback")}</span>
                                            <Badge tone={r.attended ? "ok" : "bad"} icon={r.attended ? "ability_warrior_rallyingcry" : undefined}>
                                                {statusLabel(statusOf(r))}
                                            </Badge>
                                            <span className="sub">{r.override ? verdictText(r) : detailText(r.detail)}</span>
                                        </div>
                                    ))}
                                </div>
                            )
                            : <p className="sub ros-empty">{t("history.attendance.empty")}</p>}
                    </div>
                );
            })}
        </>
    );
}
