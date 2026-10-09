import type { CSSProperties } from "react";
import type { AbsenceOverview, AbsencePeriod, AbsenceRaider } from "../../api";
import { barLabel, barPlace, categoryTone, dayIndex, dayWidth, displayName, LONG_DAYS, MANY_AWAY, playsLine, raidDays, timelineWeeks } from "../../lib/roster/absences";
import { dayMs, periodLabel } from "../../lib/signups/availability";
import { formatDayDate, formatDayMonth, formatWeekday } from "../../lib/format";
import { useT } from "../../i18n";
import { AbSpec, ClassName } from "./parts";

// The timeline of Roster › Abwesenheiten: one row per raider, the weeks across.
// The head carries the weeks (KW + dates), a day row whose raid days are tinted
// with a dot per category, and how many are missing on each raid day. A row
// draws the periods as bars (long ones filled), single raids signed off from
// as rings, and today as a line. The box scrolls sideways, the names stay.

const vars = (v: Record<string, string | number>) => v as CSSProperties;

export default function AbsenceTimeline({ data, rows, onOpen }: {
    data: AbsenceOverview;
    rows: AbsenceRaider[];
    onOpen: (userId: string) => void;
}) {
    const t = useT();
    const weeks = timelineWeeks(data.from, data.weeks);
    const total = weeks.length * 7;
    const byDay = raidDays(data.raids);
    const today = dayIndex(data.from, data.today);
    const style = vars({ "--ab-days": total, "--ab-dw": `${dayWidth(data.weeks)}px` });
    const gaps = [...byDay].filter(([day]) => dayIndex(data.from, day) >= 0 && dayIndex(data.from, day) < total);

    return (
        <div className="ab-tl-box" role="region" aria-label={t("absences.timeline.aria")} tabIndex={0}>
            <div className="ab-tl" style={style}>
                {today >= 0 && today < total && <span className="ab-today" style={vars({ "--ab-at": today })} aria-hidden="true" />}
                <div className="ab-tl-row ab-tl-weeks">
                    <div className="ab-tl-who ab-tl-corner">{t("absences.timeline.raider", { count: rows.length })}</div>
                    <div className="ab-tl-lane">
                        {weeks.map((w) => (
                            <div key={w.start} className="ab-week">
                                <b>{t("absences.timeline.week", { kw: w.kw })}</b>
                                <span>{`${formatDayMonth(dayMs(w.start))} – ${formatDayMonth(dayMs(w.end))}`}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="ab-tl-row ab-tl-days">
                    <div className="ab-tl-who ab-tl-corner" />
                    <div className="ab-tl-lane">
                        {weeks.flatMap((w) => w.days).map((day) => {
                            const raid = byDay.get(day);
                            const names = raid ? data.raids.filter((r) => r.day === day).map((r) => r.title).join(" · ") : "";
                            return (
                                <div
                                    key={day}
                                    className={`ab-day${raid ? " is-raid" : ""}${day === data.today ? " is-today" : ""}`}
                                    data-day={day}
                                    data-tip={raid ? formatDayDate(dayMs(day)) : undefined}
                                    data-tip-sub={raid ? names : undefined}
                                >
                                    <span className="ab-day-ini">{formatWeekday(dayMs(day)).slice(0, 2)}</span>
                                    {raid && (
                                        <span className="ab-day-dots">
                                            {raid.categories.map((c) => <i key={c} className={`ab-cat-${categoryTone(c, data.categories)}`} />)}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div className="ab-tl-row ab-tl-gap">
                    <div className="ab-tl-who ab-tl-corner">{t("absences.timeline.missing")}</div>
                    <div className="ab-tl-lane">
                        {gaps.map(([day, raid]) => (
                            <span
                                key={day}
                                className={`ab-gap${raid.away >= MANY_AWAY ? " is-many" : ""}${raid.away ? "" : " ab-gap-none"}`}
                                style={vars({ "--ab-at": dayIndex(data.from, day) })}
                                data-day={day}
                                data-tip={t("absences.timeline.missingTip", { count: raid.away })}
                                data-tip-sub={formatDayDate(dayMs(day))}
                            >
                                {raid.away}
                            </span>
                        ))}
                    </div>
                </div>
                {rows.map((r) => <RaiderRow key={r.userId} raider={r} data={data} total={total} onOpen={onOpen} />)}
                {!rows.length && <p className="ab-tl-empty">{t("absences.timeline.empty")}</p>}
            </div>
        </div>
    );
}

function RaiderRow({ raider, data, total, onOpen }: { raider: AbsenceRaider; data: AbsenceOverview; total: number; onOpen: (userId: string) => void }) {
    const t = useT();
    const name = displayName(raider);
    const sub = [raider.character && raider.name !== raider.character ? raider.name : "", playsLine(raider)].filter(Boolean).join(" · ");
    return (
        <button type="button" className="ab-tl-row ab-tl-raider" onClick={() => onOpen(raider.userId)} aria-label={t("absences.timeline.open", { name })} data-user={raider.userId}>
            <span className="ab-tl-who">
                <AbSpec who={raider} />
                <span className="ab-who-text">
                    <ClassName who={raider} className="ab-who-name" />
                    <span className="ab-who-sub">{sub}</span>
                </span>
                {raider.hint && (
                    <span className="ab-pill" data-tip={t("absences.hint.title")} data-tip-sub={raider.hint.categoryName}>
                        {t("absences.timeline.hintPill", { count: raider.hint.count, of: raider.hint.of })}
                    </span>
                )}
            </span>
            <span className="ab-tl-lane">
                {raider.periods.map((p) => <PeriodBar key={p.id} period={p} from={data.from} total={total} dw={dayWidth(data.weeks)} />)}
                {raider.singles.map((s) => {
                    const at = dayIndex(data.from, s.day);
                    if (at < 0 || at >= total) return null;
                    return (
                        <span
                            key={s.eventId}
                            className="ab-single"
                            style={vars({ "--ab-at": at })}
                            data-day={s.day}
                            data-tip={t("absences.timeline.single")}
                            data-tip-sub={[formatDayDate(dayMs(s.day)), s.title].filter(Boolean).join(" · ")}
                        />
                    );
                })}
            </span>
        </button>
    );
}

/** Below this width a bar keeps its words for the tooltip: one letter of a reason says nothing. */
const MIN_LABEL_PX = 44;

function PeriodBar({ period, from, total, dw }: { period: AbsencePeriod; from: string; total: number; dw: number }) {
    const t = useT();
    const place = barPlace(period, from, total);
    if (!place) return null;
    const presence = period.kind === "presence";
    const cls = [
        "ab-bar",
        presence ? "is-presence" : period.days >= LONG_DAYS ? "is-long" : "",
        place.cutStart ? "is-cut-start" : "",
        place.cutEnd ? "is-cut-end" : "",
    ].filter(Boolean).join(" ");
    const sub = [
        presence ? t("absences.kind.presence") : t("absences.kind.absence"),
        period.comment,
        period.categoryName ? t("absences.onlyCategory", { name: period.categoryName }) : "",
        period.byOrga ? t("absences.byOrga") : "",
    ].filter(Boolean).join(" · ");
    return (
        <span
            className={cls}
            style={vars({ "--ab-at": place.start, "--ab-span": place.span })}
            data-from={period.from}
            data-to={period.to}
            data-tip={`${periodLabel(period.from, period.to)} · ${t("absences.days", { count: period.days })}`}
            data-tip-sub={sub}
        >
            {place.span * dw >= MIN_LABEL_PX && <span className="ab-bar-text">{barLabel(period)}</span>}
            {place.cutEnd && <span className="ab-bar-more" aria-hidden="true">→</span>}
        </span>
    );
}
