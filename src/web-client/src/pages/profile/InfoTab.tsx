import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AttendanceCategory, CalendarTokens, ProfileData, ProfilePatch, RaiderAttendanceData, RaiderProfile } from "../../api";
import { Badge, buttonClass, type ConfirmFn } from "../../components/ui";
import AttendanceCell from "../../components/roster/AttendanceCell";
import { EyeOffIcon } from "../../components/ui/icons";
import { nightsInOrder } from "../../lib/roster/absences";
import { tOr, useT } from "../../i18n";
import { AvoidPart, type Fold, FoldPart, NoteField, RaidPicker, WishPicker } from "./ProfileParts";
import { CalendarPart } from "./CalendarPart";

// The tab "Meine Infos": what belongs to the person, not to a character — in
// three calm groups, every part folded to one line until it is opened:
//   Raiden         the attendance of the shown version (GET /api/availability/attendance)
//   Verknüpfungen  the calendar subscription
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

export function InfoTab({ data, profile, fold, onFold, patch, ask, calendar, onCalendar, attendance, attendanceFailed }: {
    data: ProfileData;
    profile: RaiderProfile;
    fold: Fold[];
    onFold: (id: Fold) => void;
    patch: (change: ProfilePatch, optimistic?: Partial<RaiderProfile>) => Promise<void>;
    ask: ConfirmFn;
    calendar: CalendarTokens | null;
    onCalendar: (next: CalendarTokens) => void;
    /** The own attendance of the shown version, null while it loads. */
    attendance: RaiderAttendanceData | null;
    attendanceFailed: boolean;
}) {
    const t = useT();
    const cal = calendar;
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
                </Group>
            </div>

            <div className="pf-col">
                <Group label={t("profile.info.groupPrefs")}>
                    {/* Part 2 adds the hours per weekday inside this fold. */}
                    <FoldPart
                        id="days" open={fold} onToggle={onFold} title={t("profile.fold.days")}
                        summary={profile.availability.length
                            ? (
                                <span className="pf-day-sum">
                                    {data.weekdays.filter((d) => profile.availability.includes(d.id)).map((d) => (
                                        <span key={d.id} className="pf-day-tag" data-day={d.id}>{tOr(`profile.weekday.${d.id}`, d.label)}</span>
                                    ))}
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
