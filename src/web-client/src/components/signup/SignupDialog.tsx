import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
    saveSignup,
    type ApiError, type GameRole, type OwnSignup, type OwnSignupRow, type SignupClass, type SignupCounts, type SignupProfile, type SignupStatus,
} from "../../api";
import { Badge, Button, Modal, WowIcon } from "../ui";
import { CheckIcon } from "../icons";
import { useToast } from "../Jobs";
import SignupCharacterPicks from "./SignupCharacterPicks";
import { formatEventTime } from "../../lib/format";
import {
    CAN_ALSO, ROLE_ORDER, SIGNUP_STATUS, SIGNUP_STATUS_ORDER, defaultCanAlso, roleCountText,
} from "../../lib/signups";
import {
    commonStatus, initialPicks, picksToInput, setAllStatuses, signupStatusOf, type CharacterPick,
} from "../../lib/signupPicks";
import { useT } from "../../i18n";

// The signup dialog (#256): characters and specs from the profile (several since
// #293: the first is the choice, the others "kann auch mit"), the status,
// "Ich kann auch", a comment — and nothing else. The role counts sit in the
// head's kicker line, the wish partner as one badge, every explanation in a
// tooltip. The server checks it all again (src/web/signupService.js); the
// dialog only keeps a member from picking what cannot work.
//
// The status belongs to the character since #320 — the same thing Discord has
// done since #302, where "Spät" moves only the first one. The segment below the
// characters therefore sets them **all** ("alle auf …"); a single line is
// changed by its own dot in SignupCharacterPicks. Where the lines differ, no
// segment option is marked and one small line says so, instead of pretending
// one status held for everybody.

export default function SignupDialog({ row, profile, classes, onClose, onSaved }: {
    row: OwnSignupRow | null;
    profile: SignupProfile;
    classes: SignupClass[];
    onClose: () => void;
    onSaved: (eventId: string, signup: OwnSignup, counts: SignupCounts) => void;
}) {
    const t = useT();
    const toast = useToast();
    const mine = row?.mine || null;

    // Several own characters (#293): the first is the choice, the rest "kann auch mit".
    const [picks, setPicks] = useState<CharacterPick[]>([]);
    const [status, setStatus] = useState<SignupStatus>("signed");
    const [canAlso, setCanAlso] = useState<GameRole[]>([]);
    const [comment, setComment] = useState("");
    const [busy, setBusy] = useState(false);

    // Start from the stored signup, else from the main character and its first spec.
    useEffect(() => {
        if (!row) return;
        const allowed = row.allowedStatuses;
        const wanted = mine?.status || "signed";
        const open = allowed.includes(wanted) || !allowed.length ? wanted : allowed[0];
        const start = initialPicks(profile, mine, open);
        const first = profile.characters.find((c) => c.key === start[0]?.characterKey);
        const role = first?.specs.find((s) => s.key === start[0]?.spec)?.role || "";
        setPicks(start);
        setStatus(open);
        setCanAlso(mine ? mine.canAlso : (first ? defaultCanAlso(profile, first.key, role) : []));
        setComment(mine?.comment || "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row?.id]);

    const character = profile.characters.find((c) => c.key === picks[0]?.characterKey) || null;
    const spec = picks[0]?.spec || "";
    const ownRole = character?.specs.find((s) => s.key === spec)?.role || "";
    const alsoOptions = useMemo(() => ROLE_ORDER.filter((r) => r !== ownRole), [ownRole]);

    if (!row) return null;

    const absent = status === "absence";
    const noCharacter = !profile.characters.length;
    const closed = !row.allowedStatuses.length;
    // "Vielleicht" / "Absagen" turn the comment into a message to the raid lead,
    // which the bot posts in the orga's channel — required, optional or not asked
    // per category (src/web/signupNotes.js; the server checks "required" again).
    const noteStatus = absent || signupStatusOf(picks, status) === "tentative";
    const noteMode = noteStatus ? row.noteMode || "optional" : "none";
    const noteMissing = noteMode === "required" && comment.trim().length < 2;
    const canSubmit = !busy && !closed && !noteMissing && (absent || (!!character && !!spec));
    // What the segment shows as chosen: the status every character shares, "" when they differ (#320).
    const shared = absent ? "absence" : commonStatus(picks, status);
    const pickStatus = (s: SignupStatus) => {
        setStatus(s);
        if (s !== "absence") setPicks((list) => setAllStatuses(list, s));
    };

    const changePicks = (next: CharacterPick[]) => {
        const firstChanged = next[0]?.characterKey !== picks[0]?.characterKey;
        setPicks(next);
        const head = profile.characters.find((c) => c.key === next[0]?.characterKey);
        const role = head?.specs.find((s) => s.key === next[0]?.spec)?.role || "";
        if (!mine && head && firstChanged) setCanAlso(defaultCanAlso(profile, head.key, role));
        else setCanAlso((list) => list.filter((r) => r !== role));
    };

    const submit = async () => {
        setBusy(true);
        try {
            const res = await saveSignup({
                eventId: row.id,
                characters: picksToInput(profile, picks),
                // the signup's own status mirrors the first character's (#320)
                status: signupStatusOf(picks, status),
                canAlso: absent ? [] : canAlso.filter((r) => r !== ownRole),
                comment,
            });
            onSaved(row.id, res.signup, res.counts);
            // A full raid turned the "Dabei" into the waiting list (#306) — the
            // raider hears it here, not from the roster.
            if (res.notice) toast(res.notice, res.waitlisted ? "err" : undefined);
            else toast(absent ? t("signups.dialog.toastAbsent", { title: row.title }) : t("signups.dialog.toastSaved", { title: row.title, status: SIGNUP_STATUS[signupStatusOf(picks, status)].label }));
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const kicker = [
        formatEventTime(row.startTime),
        row.size ? t("signups.dialog.size", { size: row.size }) : "",
        t("signups.attending", { count: row.attending }),
        roleCountText(row.counts),
    ].filter(Boolean).join(" · ");

    return (
        <Modal
            open={!!row}
            onClose={onClose}
            icon={row.instanceIcon || "inv_misc_book_09"}
            tone="signups"
            kicker={kicker}
            title={`${row.title} · ${mine ? t("signups.dialog.change") : t("signups.signUp")}`}
            width={720}
            hint={closed
                ? t("signups.dialog.started")
                : row.deadlinePassed ? t("signups.dialog.deadlineHint") : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon={<CheckIcon />} disabled={!canSubmit} running={busy} onClick={submit} variant={absent ? "danger" : "primary"}>
                        {absent ? t("signups.dialog.signOff") : mine ? t("common.save") : t("signups.signUp")}
                    </Button>
                </>
            )}
        >
            <div className="an-dlg">
                {noCharacter ? (
                    <p className="an-note">
                        {t("signups.dialog.noCharBefore")} <Link to="/profile">{t("signups.dialog.noCharLink")}</Link> {t("signups.dialog.noCharAfter")}
                    </p>
                ) : (
                    <SignupCharacterPicks
                        profile={profile} classes={classes} picks={picks} onChange={changePicks} disabled={absent}
                        statuses allowedStatuses={row.allowedStatuses}
                    />
                )}

                <div className="field">
                    <label>{picks.length > 1 ? t("signups.statusForAll") : t("signups.dialog.status")}</label>
                    <div className="seg an-status" role="radiogroup" aria-label={t("signups.dialog.status")}>
                        {SIGNUP_STATUS_ORDER.map((s) => {
                            const allowed = row.allowedStatuses.includes(s);
                            return (
                                <button
                                    key={s} type="button" role="radio" aria-checked={shared === s}
                                    className={`seg-opt${shared === s ? " active" : ""}`}
                                    disabled={!allowed || (noCharacter && s !== "absence")}
                                    data-tip={SIGNUP_STATUS[s].label}
                                    data-tip-sub={allowed ? SIGNUP_STATUS[s].tip : t("signups.dialog.notAfterDeadline")}
                                    onClick={() => pickStatus(s)}
                                >
                                    <i className="an-dot" style={{ "--an-c": SIGNUP_STATUS[s].color } as CSSProperties} />
                                    {SIGNUP_STATUS[s].label}
                                </button>
                            );
                        })}
                    </div>
                    {!shared && <div className="hint">{t("signups.dialog.mixedStatus")}</div>}
                </div>

                {!absent && !noCharacter && (
                    <div className="field">
                        <label>{t("signups.dialog.canAlso")}</label>
                        <div className="an-also">
                            {alsoOptions.map((r) => {
                                const on = canAlso.includes(r);
                                return (
                                    <button
                                        key={r} type="button" aria-pressed={on} className={`an-chip${on ? " is-on" : ""}`}
                                        onClick={() => setCanAlso((list) => (on ? list.filter((x) => x !== r) : [...list, r]))}
                                    >
                                        <WowIcon name={CAN_ALSO[r].icon} size={20} />
                                        {CAN_ALSO[r].label}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="hint">{t("signups.dialog.canAlsoHint")}</div>
                    </div>
                )}

                <div className="field">
                    {noteMode === "none" ? (
                        <label htmlFor="an-comment">{t("signups.dialog.comment")} <span className="an-opt">{t("signups.dialog.optional")}</span></label>
                    ) : (
                        <label htmlFor="an-comment" data-tip={t("signups.dialog.note")} data-tip-sub={t("signups.dialog.noteTip")}>
                            {t("signups.dialog.note")} {noteMode === "required" ? <span className="an-opt">{t("signups.dialog.required")}</span> : <span className="an-opt">{t("signups.dialog.optional")}</span>}
                        </label>
                    )}
                    <input id="an-comment" type="text" maxLength={noteMode === "none" ? 300 : 100} value={comment}
                        placeholder={noteMode === "none" ? t("signups.dialog.commentPlaceholder") : absent ? t("signups.dialog.notePlaceholderAbsent") : t("signups.dialog.notePlaceholderTentative")}
                        aria-required={noteMode === "required"} onChange={(e) => setComment(e.target.value)} />
                </div>

                {row.wishPartners.length > 0 && !absent && (
                    <div className="an-wish">
                        <Badge
                            tone="ok"
                            icon="achievement_guildperk_everybodysfriend"
                            tip={t("signups.dialog.wishTip")}
                            tipSub={row.wishes ? t("signups.dialog.wishOn") : t("signups.dialog.wishOff")}
                        >
                            {t("signups.dialog.wishSignedUp", { count: row.wishPartners.length, names: row.wishPartners.map((p) => p.name).join(", ") })}
                        </Badge>
                    </div>
                )}

                {/* #308: the raid in one's own calendar, and the page everyone can open. Both
                    are server-rendered and public — see src/web/icsFeed.js / eventPublicPage.js. */}
                <div className="an-links">
                    <a href={`/r/cal/${encodeURIComponent(row.id)}.ics`}>{t("signups.dialog.calendar")}</a>
                    <a href={`/e/${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer">{t("signups.dialog.publicPage")}</a>
                </div>
            </div>
        </Modal>
    );
}
