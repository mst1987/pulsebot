import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AttendanceCategory, CalendarTokens, ProfileData, ProfilePatch, RaiderAttendanceData, RaiderProfile, SyncKeys } from "../../api";
import { Badge, buttonClass, IconButton, NumberStepper, type ConfirmFn } from "../../components/ui";
import AttendanceCell from "../../components/roster/AttendanceCell";
import { EyeOffIcon, XIcon } from "../../components/ui/icons";
import { nightsInOrder } from "../../lib/roster/absences";
import { stepTime, withDayTime } from "../../lib/profile/dayTimes";
import { tOr, useT } from "../../i18n";
import { AvoidPart, type Fold, FoldPart, NoteField, RaidPicker, WishPicker } from "./ProfileParts";
import { CalendarPart } from "./CalendarPart";
import { SyncKeysPart } from "./SyncKeysPart";

// The tab "Meine Infos": what belongs to the person, not to a character — in
// three calm groups, every part folded to one line until it is opened:
//   Raiden         the attendance of the shown version (GET /api/availability/attendance)
//   Verknüpfungen  the calendar subscription; the sync app keys (#1000) only for orga of a server
//   Vorlieben      weekdays, preferred raids, with whom (not), a note for the orga
// Saving works as before: every change goes through `patch` (PUT /api/profile).

/** A group of folds with its small heading. */
function Group({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="pf-group">
            <span className="kicker pf-group-label">{label}</span>
            {children}
        </div>
    );
}

/** The folded line of the attendance: the first category with counted raids, how many more there are. */
function attendanceSummary(data: RaiderAttendanceData | null, failed: boolean, t: ReturnType<typeof useT>): string {
    if (failed) return t("profile.fold.loadError");
    if (!data) return t("profile.fold.loading");
    const counted = data.categories.filter((c) => c.pct !== null && c.total > 0);
    if (!counted.length) return t("profile.attendance.none");
    const first = counted[0];
    const line = t("profile.attendance.sum", { pct: first.pct ?? 0, attended: first.attended, count: first.total, name: first.name || first.id });
    return counted.length > 1 ? `${line} ${t("profile.attendance.more", { count: counted.length - 1 })}` : line;
}

/** One category: the quota large, the counted nights as status fields (read only here), how many of how many. */
function AttendanceCategoryRow({ cat, userId, name }: { cat: AttendanceCategory; userId: string; name: string }) {
    const t = useT();
    return (
        <div className="pf-att">
            <span className="kicker">{cat.name || cat.id}</span>
            {cat.pct === null || !cat.total ? (
                <p className="pf-muted">{t("absences.mine.noRaids")}</p>
            ) : (
                <>
                    <div className="pf-att-figure">
                        <b>{t("absences.mine.pct", { pct: cat.pct })}</b>
                        <span>{t("absences.mine.ofRaids", { attended: cat.attended, count: cat.total })}</span>
                    </div>
                    <div className="pf-att-nights" role="list" aria-label={t("absences.mine.nightsAria")}>
                        {nightsInOrder(cat.raids).map((r) => (
                            <span key={r.eventId} role="listitem" className="pf-att-night">
                                <AttendanceCell night={r} userId={userId} name={name} />
                            </span>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

/**
 * "Ab wann" per chosen weekday (part 2): an optional hour in quarter hours, − and +;
 * empty = the whole evening, × takes the hour away again. Only info for the orga.
 */
function DayTimes({ days, times, step, onChange }: {
    days: { id: string; label: string }[];
    times: Record<string, string>;
    step: number;
    onChange: (next: Record<string, string>) => void;
}) {
    const t = useT();
    return (
        <div className="pf-times">
            <span className="kicker">{t("profile.days.timesKicker")}</span>
            {days.map((d) => {
                const day = tOr(`profile.weekday.${d.id}`, d.label);
                const from = times[d.id] || "";
                const less = stepTime(from, -1, step);
                const more = stepTime(from, 1, step);
                return (
                    // one calm row per chosen day: the day in its colour, the hour as one − value + control, × quiet beside it
                    <div key={d.id} className={`pf-time-row${from ? " pf-time-set" : ""}`} data-day={d.id}>
                        <span className="pf-time-day">{day}</span>
                        <NumberStepper
                            value={null} min={0} max={0}
                            ariaLabel={t("profile.days.fromAria", { day })}
                            lessLabel={t("profile.days.earlier")}
                            moreLabel={t("profile.days.later")}
                            display={from ? t("profile.days.from", { time: from }) : t("profile.days.wholeEvening")}
                            onChange={() => undefined}
                            onLess={less ? () => onChange(withDayTime(times, d.id, less)) : null}
                            onMore={more ? () => onChange(withDayTime(times, d.id, more)) : null}
                        />
                        {from
                            ? <IconButton tone="ghost" icon={<XIcon />} tip={t("profile.days.clear")} tipSub={t("profile.days.clearSub", { day })}
                                onClick={() => onChange(withDayTime(times, d.id, ""))} />
                            : <span className="pf-time-gap" aria-hidden="true" />}
                    </div>
                );
            })}
        </div>
    );
}

export function InfoTab({ data, profile, fold, onFold, patch, ask, calendar, onCalendar, syncKeys = null, onSyncKeys, attendance, attendanceFailed }: {
    data: ProfileData;
    profile: RaiderProfile;
    fold: Fold[];
    onFold: (id: Fold) => void;
    patch: (change: ProfilePatch, optimistic?: Partial<RaiderProfile>) => Promise<void>;
    ask: ConfirmFn;
    calendar: CalendarTokens | null;
    onCalendar: (next: CalendarTokens) => void;
    /** The own sync app keys; the part shows only when `allowed` (orga of at least one server). */
    syncKeys?: SyncKeys | null;
    onSyncKeys?: (next: SyncKeys) => void;
    /** The own attendance of the shown version, null while it loads. */
    attendance: RaiderAttendanceData | null;
    attendanceFailed: boolean;
}) {
    const t = useT();
    const cal = calendar;
    const times = profile.availabilityFrom || {};
    return (
        <div className="pf-grid pf-grid-even">
            <div className="pf-col">
                <Group label={t("profile.info.groupRaiding")}>
                    <FoldPart id="attendance" open={fold} onToggle={onFold} title={t("profile.fold.attendance")}
                        summary={attendanceSummary(attendance, attendanceFailed, t)}>
                        {attendance && attendance.categories.length > 0
                            ? attendance.categories.map((c) => <AttendanceCategoryRow key={c.id} cat={c} userId={attendance.userId} name={attendance.name || profile.name} />)
                            : <p className="pf-muted">{attendanceSummary(attendance, attendanceFailed, t)}</p>}
                        <Link className={buttonClass("ghost", "sm", false, "pf-fold-link")} to="/absences">{t("profile.attendance.open")}</Link>
                    </FoldPart>
                </Group>
                <Group label={t("profile.info.groupLinks")}>
                    <FoldPart
                        id="calendar" open={fold} onToggle={onFold} title={t("profile.fold.calendar")}
                        summary={!cal ? t("profile.fold.calendarLoading") : cal.tokens.length === 0 ? t("profile.fold.calendarNone") : t("profile.fold.calendarActive", { count: cal.tokens.length })}
                    >
                        <CalendarPart data={cal} onChange={onCalendar} />
                    </FoldPart>
                    {syncKeys?.allowed && onSyncKeys && (
                        <FoldPart
                            id="syncKeys" open={fold} onToggle={onFold} title={t("profile.fold.syncKeys")}
                            summary={syncKeys.keys.length === 0 ? t("profile.fold.syncKeysNone") : t("profile.fold.syncKeysActive", { count: syncKeys.keys.length })}
                        >
                            <SyncKeysPart data={syncKeys} onChange={onSyncKeys} />
                        </FoldPart>
                    )}
                </Group>
            </div>

            <div className="pf-col">
                <Group label={t("profile.info.groupPrefs")}>
                    <FoldPart
                        id="days" open={fold} onToggle={onFold} title={t("profile.fold.days")}
                        summary={profile.availability.length
                            ? (
                                <span className="pf-day-sum">
                                    {data.weekdays.filter((d) => profile.availability.includes(d.id)).map((d) => {
                                        const day = tOr(`profile.weekday.${d.id}`, d.label);
                                        const from = times[d.id];
                                        return <span key={d.id} className="pf-day-tag" data-day={d.id}>{from ? t("profile.days.tagFrom", { day, time: from }) : day}</span>;
                                    })}
                                </span>
                            )
                            : t("profile.fold.daysNone")}
                    >
                        <div className="pf-days">
                            {data.weekdays.map((d) => {
                                const on = profile.availability.includes(d.id);
                                const next = on ? profile.availability.filter((x) => x !== d.id) : [...profile.availability, d.id];
                                return (
                                    <button key={d.id} type="button" data-day={d.id} className={`pf-day${on ? " is-on" : ""}`} aria-pressed={on}
                                        onClick={() => patch({ availability: next }, { availability: next })}>
                                        {tOr(`profile.weekday.${d.id}`, d.label)}
                                    </button>
                                );
                            })}
                        </div>
                        {profile.availability.length > 0 && (
                            <DayTimes
                                days={data.weekdays.filter((d) => profile.availability.includes(d.id))}
                                times={times}
                                step={data.limits.timeStep || 15}
                                onChange={(next) => patch({ availabilityFrom: next }, { availabilityFrom: next })}
                            />
                        )}
                    </FoldPart>

                    <FoldPart
                        id="raids" open={fold} onToggle={onFold} title={t("profile.fold.raids")}
                        summary={profile.preferredRaids.length ? t("profile.fold.raidsChosen", { count: profile.preferredRaids.length }) : t("profile.fold.raidsNone")}
                    >
                        <RaidPicker data={data} value={profile.preferredRaids} onChange={(next) => patch({ preferredRaids: next }, { preferredRaids: next })} />
                    </FoldPart>

                    <FoldPart
                        id="wishes" open={fold} onToggle={onFold} title={t("profile.fold.wishes")}
                        summary={profile.wishes.length ? profile.wishes.map((w) => w.character || w.name).join(", ") : t("profile.fold.wishesNone")}
                        badge={<Badge icon={<EyeOffIcon />} tip={t("profile.fold.orgaOnlyTip")} tipSub={t("profile.fold.orgaOnlySub")}>{t("profile.fold.orgaOnly")}</Badge>}
                    >
                        <WishPicker
                            wishes={profile.wishes}
                            max={data.limits.wishes}
                            classes={data.classes}
                            exclude={profile.avoid}
                            hint={t("profile.wishes.hint")}
                            onChange={(next) => patch({ wishes: next.map((w) => w.userId) }, { wishes: next })}
                        />
                    </FoldPart>

                    <FoldPart
                        id="avoid" open={fold} onToggle={onFold} title={t("profile.fold.avoid")}
                        summary={!profile.avoidEnabled
                            ? t("profile.fold.avoidOff")
                            : profile.avoid.length ? profile.avoid.map((w) => w.character || w.name).join(", ") : t("profile.fold.avoidNone")}
                        badge={<Badge icon={<EyeOffIcon />} tip={t("profile.fold.orgaOnlyTip")} tipSub={t("profile.avoid.orgaOnlySub")}>{t("profile.fold.orgaOnly")}</Badge>}
                    >
                        <AvoidPart
                            profile={profile}
                            max={data.limits.avoid}
                            classes={data.classes}
                            onEnable={async (on) => {
                                if (on && !(await ask({
                                    title: t("profile.avoid.confirmTitle"),
                                    text: t("profile.avoid.confirmText"),
                                    action: t("profile.avoid.confirmAction"),
                                }))) return;
                                void patch({ avoidEnabled: on }, { avoidEnabled: on, avoid: on ? profile.avoid : [] });
                            }}
                            onChange={(next) => patch({ avoid: next.map((w) => w.userId) }, { avoid: next })}
                        />
                    </FoldPart>

                    <FoldPart
                        id="note" open={fold} onToggle={onFold} title={t("profile.fold.note")}
                        summary={profile.note ? profile.note : t("profile.fold.noteNone")}
                    >
                        <NoteField value={profile.note} max={data.limits.note} onSave={(note) => patch({ note }, { note })} />
                    </FoldPart>
                </Group>
            </div>
        </div>
    );
}
