import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { AbsenceOverview, AbsenceRaid } from "../../api";
import { categoryTone, signedShare, upcomingRaids } from "../../lib/absences";
import { eventTimeParts } from "../../lib/format";
import { ExternalIcon } from "../../components/icons";
import { useT } from "../../i18n";

// "Pro Raid": one calm card per coming raid — when, which, and how full it is.
// Who is away is the timeline's business; the user wanted the cards without it
// (October 2026).

const vars = (v: Record<string, string | number>) => v as CSSProperties;

export default function AbsenceRaids({ data }: { data: AbsenceOverview }) {
    const t = useT();
    const raids = upcomingRaids(data.raids, data.today);
    if (!raids.length) return <p className="ab-empty">{t("absences.raids.empty")}</p>;
    return (
        <div className="ab-raids">
            {raids.map((r) => <RaidCard key={r.id} raid={r} data={data} />)}
        </div>
    );
}

function RaidCard({ raid, data }: { raid: AbsenceRaid; data: AbsenceOverview }) {
    const t = useT();
    const when = eventTimeParts(raid.startTime);
    return (
        <article className="ab-raid" aria-label={raid.title}>
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
            <div className="ab-raid-bar" style={vars({ "--ab-in": `${signedShare(raid)}%` })} aria-hidden="true">
                <i className="ab-raid-in" />
            </div>
            <div className="ab-raid-count">
                <span><b>{raid.signed}</b> {t("absences.raids.in")}{raid.size > 0 ? ` · ${t("absences.raids.size", { count: raid.size })}` : ""}</span>
            </div>
            <Link className="mlink ab-raid-setup" to={`/raids/detail?event=${encodeURIComponent(raid.id)}&tab=setup`}>{t("absences.raids.toSetup")}</Link>
        </article>
    );
}
