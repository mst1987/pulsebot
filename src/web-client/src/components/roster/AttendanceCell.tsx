// One raid night of one raider as a status field (#677) — the roster's attendance grid,
// the member drawer and "Meine Anwesenheit" share it. The field shows the status in its
// colour (--att-<status>) with its letter, a corner dot when the orga set it by hand, and
// the night, the verdict and the override in its tooltip. Whoever may correct attendance
// (`canEdit`) clicks it and gets a small menu: the statuses of EDIT_ORDER, "Automatisch" and an
// optional reason; saving goes through POST /api/attendance/override.
// The log's "left early" suggestion (#990, orga answers only) rides on the field as a dashed
// ring and a tooltip line; the menu opens with it on top: confirming sets "leftEarly",
// dismissing keeps the night present and ends the suggestion.
import { useRef, useState, type RefObject } from "react";
import { setAttendanceOverride, type ApiError, type AttendanceOverride, type AttendanceStatus, type AttendanceSuggestion } from "../../api";
import { useT } from "../../i18n";
import { formatDayDate } from "../../lib/format";
import { EDIT_ORDER, countsAsPresent, statusHint, statusLabel, statusLetter, statusOf, verdictText } from "../../lib/roster/attendanceStatus";
import { VIEWPORT_MARGIN, belowStartPosition, type Placement } from "../../lib/ui/popoverPosition";
import { useToast } from "../shell/Jobs";
import { Button } from "../ui/Button";
import Popover from "../ui/overlay/Popover";
import { SaveIcon } from "../ui/icons/icons";

/** A night as the field reads it: the server's night of any attendance answer. */
export type AttendanceNight = {
    eventId: string;
    title?: string;
    startTime: number;
    attended?: boolean;
    status?: AttendanceStatus | string;
    detail?: string;
    reason?: string | null;
    override?: AttendanceOverride;
    suggestion?: AttendanceSuggestion;
};

/** The log's suggestion of a night, when there is one the field understands. */
function suggestionOf(night: AttendanceNight): AttendanceSuggestion | undefined {
    return night.suggestion?.kind === "leftEarly" ? night.suggestion : undefined;
}

/** The suggestion's line: "Fehlt bei den letzten 2 Kills: Vashj, Kael'thas". */
function suggestionText(s: AttendanceSuggestion, t: ReturnType<typeof useT>): string {
    return t("attendance.suggest.missed", { count: s.missedKills, bosses: s.bosses.join(", ") });
}

const REASON_MAX = 200;

/**
 * Under the field, flipped above when it must — and in any case kept inside the viewport: a cell in the last
 * rows of a long grid has room neither below nor above for the whole menu, then it covers the field instead.
 */
const MENU_PLACEMENT: Placement = (anchor, box, viewport) => {
    if (!anchor) return {};
    const p = belowStartPosition(anchor, box, viewport);
    return { left: p.left, top: Math.max(VIEWPORT_MARGIN, Math.min(p.top, viewport.height - box.height - VIEWPORT_MARGIN)) };
};
const ERROR_CODES = new Set(["not_manager", "invalid_status", "reason_too_long", "not_found", "bad_request"]);

export default function AttendanceCell({ night, userId, name, canEdit = false, size = "md", onSaved }: {
    night: AttendanceNight;
    /** The Discord account the night belongs to. */
    userId: string;
    /** The raider's name (toast, aria). */
    name: string;
    canEdit?: boolean;
    size?: "md" | "sm";
    onSaved?: () => void;
}) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLButtonElement>(null);
    const status = statusOf(night);
    const date = formatDayDate(night.startTime * 1000);
    const head = night.title ? t("attendance.grid.nightTip", { date, title: night.title }) : date;
    const suggestion = suggestionOf(night);
    const verdict = suggestion ? `${verdictText(night)}\n${t("attendance.suggest.cellTip")} · ${suggestionText(suggestion, t)}` : verdictText(night);
    const cls = `att-sq${countsAsPresent(status) ? " is-in" : ""}${night.override ? " is-manual" : ""}${suggestion ? " has-suggest" : ""}${size === "sm" ? " is-sm" : ""}`;
    const letter = size === "sm" ? "" : statusLetter(status);
    if (!canEdit) {
        return (
            <span className={cls} data-att={status} role="img" aria-label={`${head} · ${verdict}`} data-tip={head} data-tip-sub={verdict}>
                {letter}
            </span>
        );
    }
    return (
        <>
            <button
                ref={anchor} type="button" className={cls} data-att={status}
                aria-label={`${t("attendance.edit.aria", { date })} · ${verdict}`} aria-haspopup="dialog" aria-expanded={open}
                data-tip={open ? undefined : head} data-tip-sub={open ? undefined : `${verdict}\n${t("attendance.grid.editHint")}`}
                onClick={() => setOpen((o) => !o)}
            >
                {letter}
            </button>
            {open && (
                <AttendanceEditMenu
                    anchor={anchor} night={night} status={status} userId={userId} name={name} date={date}
                    onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved?.(); }}
                />
            )}
        </>
    );
}

/** The small menu of one night: pick a status, give a reason, save — or back to automatic. */
export function AttendanceEditMenu({ anchor, night, status, userId, name, date, onClose, onSaved }: {
    anchor: RefObject<HTMLElement>;
    night: AttendanceNight;
    status: AttendanceStatus;
    userId: string;
    name: string;
    date: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const [pick, setPick] = useState<AttendanceStatus>(night.override ? night.override.status : status);
    const [reason, setReason] = useState(night.override?.reason || "");
    const [busy, setBusy] = useState(false);

    const errorText = (e: ApiError) => (ERROR_CODES.has(e.code) ? t(`attendance.edit.err.${e.code}`) : t("attendance.edit.err.other", { message: e.message }));
    const suggestion = suggestionOf(night);
    /** `via`: the suggestion's buttons - confirm sets "leftEarly", dismiss keeps the night present with the server's fixed reason. */
    const save = async (next: AttendanceStatus | null, via?: "confirm" | "dismiss") => {
        setBusy(true);
        try {
            if (via === "dismiss") await setAttendanceOverride({ eventId: night.eventId, userId, status: "present", dismiss: "leftEarly" });
            else await setAttendanceOverride({ eventId: night.eventId, userId, status: next, ...(next && reason.trim() ? { reason: reason.trim() } : {}) });
            if (via) toast(t(via === "confirm" ? "attendance.suggest.confirmed" : "attendance.suggest.dismissed", { name, date }));
            else toast(next ? t("attendance.edit.saved", { name, status: statusLabel(next), date }) : t("attendance.edit.reset", { name, date }));
            onSaved();
        } catch (e) {
            toast(errorText(e as ApiError), "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Popover anchor={anchor} place={MENU_PLACEMENT} follow="reposition" onClose={onClose} className="att-menu" role="dialog" aria-label={t("attendance.edit.title")}>
            <div className="att-menu-head">
                <b>{t("attendance.edit.title")}</b>
                <span>{[name, night.title ? `${date} · ${night.title}` : date].filter(Boolean).join(" · ")}</span>
                <span className="att-menu-now">{t("attendance.edit.now", { status: verdictText(night) })}</span>
            </div>
            {suggestion && (
                <div className="att-suggest" data-att="leftEarly">
                    <b>{t("attendance.suggest.title")}</b>
                    <span>{suggestionText(suggestion, t)}</span>
                    <div className="att-suggest-acts">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save("present", "dismiss")} data-tip={t("attendance.suggest.dismissHint")}>
                            {t("attendance.suggest.dismiss")}
                        </Button>
                        <Button size="sm" variant="yes" disabled={busy} onClick={() => void save("leftEarly", "confirm")} data-tip={t("attendance.suggest.confirmHint")}>
                            {t("attendance.suggest.confirm")}
                        </Button>
                    </div>
                </div>
            )}
            <div className="att-menu-opts" role="radiogroup" aria-label={t("attendance.edit.title")}>
                {EDIT_ORDER.map((s) => (
                    <button
                        key={s} type="button" role="radio" aria-checked={pick === s} data-att={s}
                        className={`att-menu-opt${pick === s ? " is-on" : ""}`} onClick={() => setPick(s)}
                    >
                        <span className={`att-sq is-sm${countsAsPresent(s) ? " is-in" : ""}`} aria-hidden="true" />
                        <span className="att-menu-lbl">{statusLabel(s)}</span>
                    </button>
                ))}
            </div>
            {/* what the picked status means, one line - the six would make the menu too tall */}
            <p className="att-menu-hint" data-att={pick}>{statusHint(pick)}</p>
            <label className="att-menu-reason">
                <span>{t("attendance.edit.reason")}</span>
                <input
                    type="text" value={reason} maxLength={REASON_MAX} placeholder={t("attendance.edit.reasonPlaceholder")}
                    onChange={(e) => setReason(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void save(pick); }}
                />
            </label>
            <div className="att-menu-foot">
                <Button size="sm" variant="ghost" disabled={busy || !night.override} onClick={() => void save(null)} data-tip={t("attendance.edit.autoHint")}>
                    {t("attendance.edit.auto")}
                </Button>
                <Button size="sm" variant="go" icon={<SaveIcon />} running={busy} onClick={() => void save(pick)}>{t("attendance.edit.save")}</Button>
            </div>
        </Popover>
    );
}
