import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
    saveSignup,
    type ApiError, type GameRole, type OwnSignup, type OwnSignupRow, type SignupClass, type SignupCounts, type SignupProfile, type SignupStatus,
} from "../api";
import { Badge, Button, Modal, WowIcon } from "./ui";
import { CheckIcon } from "./icons";
import { useToast } from "./Jobs";
import SignupCharacterPicks from "./SignupCharacterPicks";
import { formatEventTime } from "../lib/format";
import {
    CAN_ALSO, ROLE_ORDER, SIGNUP_STATUS, SIGNUP_STATUS_ORDER, defaultCanAlso, roleCountText,
} from "../lib/signups";
import { initialPicks, picksToInput, type CharacterPick } from "../lib/signupPicks";

// The signup dialog (#256): characters and specs from the profile (several since
// #293: the first is the choice, the others "kann auch mit"), the status,
// "Ich kann auch", a comment — and nothing else. The role counts sit in the
// head's kicker line, the wish partner as one badge, every explanation in a
// tooltip. The server checks it all again (src/web/signupService.js); the
// dialog only keeps a member from picking what cannot work.

export default function SignupDialog({ row, profile, classes, csrfToken, onClose, onSaved }: {
    row: OwnSignupRow | null;
    profile: SignupProfile;
    classes: SignupClass[];
    csrfToken: string | null;
    onClose: () => void;
    onSaved: (eventId: string, signup: OwnSignup, counts: SignupCounts) => void;
}) {
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
        const start = initialPicks(profile, mine);
        const first = profile.characters.find((c) => c.key === start[0]?.characterKey);
        const role = first?.specs.find((s) => s.key === start[0]?.spec)?.role || "";
        const wanted = mine?.status || "signed";
        setPicks(start);
        setStatus(allowed.includes(wanted) || !allowed.length ? wanted : allowed[0]);
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
    const canSubmit = !busy && !closed && (absent || (!!character && !!spec));

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
            const res = await saveSignup(csrfToken, {
                eventId: row.id,
                characters: picksToInput(profile, picks),
                status,
                canAlso: absent ? [] : canAlso.filter((r) => r !== ownRole),
                comment,
            });
            onSaved(row.id, res.signup, res.counts);
            toast(absent ? `Von ${row.title} abgemeldet.` : `Für ${row.title} gespeichert: ${SIGNUP_STATUS[status].label}.`);
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const kicker = [
        formatEventTime(row.startTime),
        row.size ? `${row.size}er` : "",
        `${row.attending} angemeldet`,
        roleCountText(row.counts),
    ].filter(Boolean).join(" · ");

    return (
        <Modal
            open={!!row}
            onClose={onClose}
            icon={row.instanceIcon || "inv_misc_book_09"}
            tone="signups"
            kicker={kicker}
            title={`${row.title} · ${mine ? "Anmeldung ändern" : "Anmelden"}`}
            width={720}
            hint={closed
                ? "Der Raid hat begonnen."
                : row.deadlinePassed ? "Anmeldeschluss vorbei – nur noch Abmelden oder Spät." : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button icon={<CheckIcon />} disabled={!canSubmit} running={busy} onClick={submit} variant={absent ? "danger" : "primary"}>
                        {absent ? "Abmelden" : mine ? "Speichern" : "Anmelden"}
                    </Button>
                </>
            )}
        >
            <div className="an-dlg">
                {noCharacter ? (
                    <p className="an-note">
                        In deinem Profil steht noch kein Charakter. <Link to="/profile">Charakter anlegen</Link> – abmelden geht auch ohne.
                    </p>
                ) : (
                    <SignupCharacterPicks profile={profile} classes={classes} picks={picks} onChange={changePicks} disabled={absent} />
                )}

                <div className="field">
                    <label>Status</label>
                    <div className="seg an-status" role="radiogroup" aria-label="Status">
                        {SIGNUP_STATUS_ORDER.map((s) => {
                            const allowed = row.allowedStatuses.includes(s);
                            return (
                                <button
                                    key={s} type="button" role="radio" aria-checked={status === s}
                                    className={`seg-opt${status === s ? " active" : ""}`}
                                    disabled={!allowed || (noCharacter && s !== "absence")}
                                    data-tip={SIGNUP_STATUS[s].label}
                                    data-tip-sub={allowed ? SIGNUP_STATUS[s].tip : "Nach dem Anmeldeschluss nicht mehr wählbar."}
                                    onClick={() => setStatus(s)}
                                >
                                    <i className="an-dot" style={{ background: SIGNUP_STATUS[s].color }} />
                                    {SIGNUP_STATUS[s].label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {!absent && !noCharacter && (
                    <div className="field">
                        <label>Ich kann auch</label>
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
                        <div className="hint">Vorbelegt aus deinem Profil. Die Orga sieht das beim Setup.</div>
                    </div>
                )}

                <div className="field">
                    <label htmlFor="an-comment">Kommentar <span className="an-opt">(optional)</span></label>
                    <input id="an-comment" type="text" maxLength={300} value={comment} placeholder="z. B. komme ca. 10 min später" onChange={(e) => setComment(e.target.value)} />
                </div>

                {row.wishPartners.length > 0 && !absent && (
                    <div className="an-wish">
                        <Badge
                            tone="ok"
                            icon="achievement_guildperk_everybodysfriend"
                            tip="Wunschpartner angemeldet"
                            tipSub={row.wishes ? "Dein Wunsch aus dem Profil wird beim Setup berücksichtigt." : "Bei diesem Event werden Wünsche beim Setup nicht berücksichtigt."}
                        >
                            {row.wishPartners.map((p) => p.name).join(", ")} {row.wishPartners.length === 1 ? "ist" : "sind"} auch angemeldet
                        </Badge>
                    </div>
                )}
            </div>
        </Modal>
    );
}
