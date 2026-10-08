import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { AbsenceOverview, AbsenceRaid } from "../../api";
import { categoryTone, raidShares, raidShort, roleLines, upcomingRaids } from "../../lib/absences";
import { dayMs } from "../../lib/availability";
import { eventTimeParts, formatDayMonth } from "../../lib/format";
import { rolePluralLabel } from "../../lib/wowNames";
import { ExternalIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { AbSpec, ClassName } from "./parts";

// "Pro Raid": one card per coming raid — who is in, who is away, and whether
// tanks and healers still reach what the raid needs. Only a role somebody is
// away from gets a line; a card that comes up short has an orange border.

const vars = (v: Record<string, string | number>) => v as CSSProperties;

export default function AbsenceRaids({ data, onOpen }: { data: AbsenceOverview; onOpen: (userId: string) => void }) {
    const t = useT();
    const raids = upcomingRaids(data.raids, data.today);
    if (!raids.length) return <p className="ab-empty">{t("absences.raids.empty")}</p>;
    return (
        <div className="ab-raids">
            {raids.map((r) => <RaidCard key={r.id} raid={r} data={data} onOpen={onOpen} />)}
        </div>
    );
}

function RaidCard({ raid, data, onOpen }: { raid: AbsenceRaid; data: AbsenceOverview; onOpen: (userId: string) => void }) {
    const t = useT();
    const when = eventTimeParts(raid.startTime);
    const lines = roleLines(raid);
    const shares = raidShares(raid);
    const short = raidShort(raid);
    return (
        <article className={`ab-raid${short ? " ab-short" : ""}`} aria-label={raid.title}>
            <div className="ab-raid-head">
                {when && (
                    <span className="ab-date" aria-hidden="true">
                        <span className="ab-date-dow">{when.weekday}</span>
                        <span className="ab-date-day">{when.day}</span>
                        <span className="ab-date-mon">{when.month}</span>
                    </span>
                )}
                <div className="ab-raid-title">
                    {raid.url
                        ? <a className="mlink" href={raid.url} target="_blank" rel="noreferrer">{raid.title}<ExternalIcon /></a>
                        : <b>{raid.title}</b>}
                    <div className="ab-raid-meta">
                        {raid.categoryName && <span className={`ab-catpill ab-cat-${categoryTone(raid.categoryId, data.categories)}`}>{raid.categoryName}</span>}
                        {when && <span>{when.time}</span>}
                    </div>
                </div>
            </div>
            <div className="ab-raid-bar" style={vars({ "--ab-in": `${shares.in}%`, "--ab-out": `${shares.away}%` })} aria-hidden="true">
                <i className="ab-raid-in" />
                <i className="ab-raid-out" />
            </div>
            <div className="ab-raid-count">
                <span><b>{raid.signed}</b> {t("absences.raids.in")}</span>
                <span className="ab-raid-awaycount"><b>{raid.away}</b> {t("absences.raids.away")}</span>
                {raid.size > 0 && <span className="ab-raid-size">{t("absences.raids.size", { count: raid.size })}</span>}
            </div>
            {lines.length ? (
                <ul className="ab-roles">
                    {lines.map((l) => (
                        <li key={l.role} className={l.short ? "ab-short" : ""}>
                            {t("absences.raids.roleLine", { role: rolePluralLabel(l.role), away: l.gap.away, have: l.gap.have, need: l.gap.need })}
                        </li>
                    ))}
                </ul>
            ) : <p className="ab-roles-ok">{t("absences.raids.rolesOk")}</p>}
            {raid.absent.length > 0 && (
                <ul className="ab-chips" aria-label={t("absences.raids.absentAria")}>
                    {raid.absent.map((a) => {
                        const who = data.raiders.find((r) => r.userId === a.userId);
                        const how = a.how === "period" ? t("absences.raids.howPeriod") : t("absences.raids.howSingle");
                        return (
                            <li key={a.userId}>
                                <button type="button" className="ab-chip" onClick={() => onOpen(a.userId)} data-tip={how} data-tip-sub={a.comment || undefined}>
                                    <i className={a.how === "period" ? "ab-mark-bar" : "ab-mark-ring"} aria-hidden="true" />
                                    {who ? <><AbSpec who={who} size="sm" /><ClassName who={who} /></> : <span>{a.userId}</span>}
                                    {a.until && <span className="ab-chip-sub">{t("absences.raids.until", { date: formatDayMonth(dayMs(a.until)) })}</span>}
                                    {a.comment && <span className="ab-chip-sub">{a.comment}</span>}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <Link className="mlink ab-raid-setup" to={`/raids/detail?event=${encodeURIComponent(raid.id)}&tab=setup`}>{t("absences.raids.toSetup")}</Link>
        </article>
    );
}
