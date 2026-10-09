// The attendance tab of a roster (#677, /roster/r/<id>/attendance): a grid of the members
// and the category's last counted raids (its attendance window). Each cell is the night's
// status as a coloured field with its letter (components/roster/AttendanceCell.tsx); a
// night set by hand carries a corner dot and says so in its tooltip. Whoever may correct
// attendance (roster managers, admins, raids write — `canEditAttendance`) clicks a cell
// and picks the status. The name column stays put while the raids scroll sideways.
import type { RosterDetail } from "../../api";
import { useT } from "../../i18n";
import AttendanceCell from "../../components/roster/AttendanceCell";
import { formatDayDate, formatDayMonth } from "../../lib/format";
import { attendanceTone } from "../../lib/roster/rosterView";
import { attendanceGrid } from "../../lib/roster/attendanceGrid";
import { EDIT_ORDER, countsAsPresent, statusHint, statusLabel, statusLetter } from "../../lib/roster/attendanceStatus";
import { MemberAvatar } from "./RosterParts";

/** On a narrow screen the newest raids stand right: the box starts scrolled to its end (once). */
function showNewest(el: HTMLDivElement | null) {
    if (!el || el.dataset.scrolled) return;
    el.scrollLeft = el.scrollWidth;
    el.dataset.scrolled = "1";
}

export default function AttendanceTab({ data, onOpen, onChanged }: {
    data: RosterDetail;
    onOpen: (userId: string) => void;
    onChanged: () => void;
}) {
    const t = useT();
    if (!data.roster.categoryId) return <p className="rn-empty">{t("attendance.grid.noCategory")}</p>;
    const { columns, rows } = attendanceGrid(data);
    if (!rows.length) return <p className="rn-empty">{t("attendance.grid.noMembers")}</p>;
    if (!columns.length) return <p className="rn-empty">{t("attendance.grid.noNights")}</p>;
    const canEdit = !!data.canEditAttendance;
    return (
        <section className="rn-att" aria-label={t("roster.detail.tabAttendance")}>
            <div className="rn-att-top">
                <p className="rn-sub">
                    {t("attendance.grid.readHint", { count: columns.length })}
                    {canEdit ? ` ${t("attendance.grid.editHint")}` : ""}
                </p>
                <ul className="rn-att-legend" aria-label={t("attendance.grid.legend")}>
                    {EDIT_ORDER.map((s) => (
                        <li key={s} data-tip={statusLabel(s)} data-tip-sub={statusHint(s)}>
                            <span className={`att-sq${countsAsPresent(s) ? " is-in" : ""}`} data-att={s} aria-hidden="true">{statusLetter(s)}</span>
                            {statusLabel(s)}
                        </li>
                    ))}
                </ul>
            </div>
            {/* the box scrolls sideways on a small screen; focusable so the keyboard can scroll it too */}
            <div className="rn-att-scroll" role="region" aria-label={t("attendance.grid.aria")} tabIndex={0} ref={showNewest}>
                <table className="rn-att-grid">
                    <thead>
                        <tr>
                            <th scope="col" className="rn-att-name">{t("attendance.grid.member")}</th>
                            {columns.map((c) => (
                                <th key={c.eventId} scope="col" className="rn-att-night" data-tip={formatDayDate(c.startTime * 1000)} data-tip-sub={c.title}>
                                    <span>{formatDayMonth(c.startTime * 1000)}</span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(({ member, cells, attendance }) => {
                            const tone = attendance ? attendanceTone(attendance.pct) : undefined;
                            return (
                                <tr key={member.userId} className={member.status === "pause" ? "is-pause" : undefined} data-st={member.status}>
                                    <th scope="row" className="rn-att-name">
                                        <button type="button" className="rn-att-who" onClick={() => onOpen(member.userId)}>
                                            <MemberAvatar member={member} />
                                            <span className="rn-att-who-text">
                                                <b>{member.displayName}</b>
                                                <small className={tone ? `rn-tone-${tone}` : undefined}>
                                                    {attendance && attendance.pct !== null
                                                        ? t("attendance.grid.quotaValue", { pct: attendance.pct, attended: attendance.attended, total: attendance.total })
                                                        : member.chars.length ? t("attendance.grid.noQuota") : t("attendance.grid.noChars")}
                                                </small>
                                            </span>
                                        </button>
                                    </th>
                                    {cells.map((cell, i) => (
                                        <td key={columns[i].eventId}>
                                            {cell
                                                ? <AttendanceCell night={{ ...cell, title: cell.title || columns[i].title }} userId={member.userId} name={member.displayName} canEdit={canEdit} onSaved={onChanged} />
                                                : <span className="att-sq is-none" role="img" aria-label={t("attendance.grid.notCounted")} data-tip={formatDayDate(columns[i].startTime * 1000)} data-tip-sub={t("attendance.grid.notCounted")}>–</span>}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
