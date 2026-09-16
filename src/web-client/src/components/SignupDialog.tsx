import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
    saveSignup,
    type ApiError, type GameRole, type OwnSignup, type OwnSignupRow, type SignupClass, type SignupCounts, type SignupProfile, type SignupStatus,
} from "../api";
import { Badge, Button, Modal, WowIcon } from "./ui";
import { classColorProps } from "./ClassSpec";
import { CheckIcon } from "./icons";
import { useToast } from "./Jobs";
import { formatEventTime } from "../lib/format";
import {
    CAN_ALSO, GEAR_LABEL, ROLE_ORDER, SIGNUP_STATUS, SIGNUP_STATUS_ORDER, defaultCanAlso, roleCountText,
} from "../lib/signups";

// The signup dialog (#256): character and spec from the profile, the status,
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
    const firstChar = profile.characters.find((c) => c.main) || profile.characters[0];

    const [characterKey, setCharacterKey] = useState("");
    const [spec, setSpec] = useState("");
    const [status, setStatus] = useState<SignupStatus>("signed");
    const [canAlso, setCanAlso] = useState<GameRole[]>([]);
    const [comment, setComment] = useState("");
    const [busy, setBusy] = useState(false);

    // Start from the stored signup, else from the main character and its first spec.
    useEffect(() => {
        if (!row) return;
        const allowed = row.allowedStatuses;
        const char = profile.characters.find((c) => c.name.toLowerCase() === (mine?.character || "").toLowerCase()) || firstChar;
        const specKey = mine?.spec && char?.specs.some((s) => s.key === mine.spec) ? mine.spec : (char?.specs[0]?.key || "");
        const role = char?.specs.find((s) => s.key === specKey)?.role || "";
        const wanted = mine?.status || "signed";
        setCharacterKey(char?.key || "");
        setSpec(specKey);
        setStatus(allowed.includes(wanted) || !allowed.length ? wanted : allowed[0]);
        setCanAlso(mine ? mine.canAlso : (char ? defaultCanAlso(profile, char.key, role) : []));
        setComment(mine?.comment || "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row?.id]);

    const character = profile.characters.find((c) => c.key === characterKey) || null;
    const cls = classes.find((c) => c.id === character?.className);
    const ownRole = character?.specs.find((s) => s.key === spec)?.role || "";
    const alsoOptions = useMemo(() => ROLE_ORDER.filter((r) => r !== ownRole), [ownRole]);

    if (!row) return null;

    const absent = status === "absence";
    const noCharacter = !profile.characters.length;
    const closed = !row.allowedStatuses.length;
    const canSubmit = !busy && !closed && (absent || (!!character && !!spec));
    const color = classColorProps(cls?.color);

    const pickCharacter = (key: string) => {
        const next = profile.characters.find((c) => c.key === key);
        const nextSpec = next?.specs[0]?.key || "";
        setCharacterKey(key);
        setSpec(nextSpec);
        if (!mine && next) setCanAlso(defaultCanAlso(profile, next.key, next.specs[0]?.role || ""));
    };

    const pickSpec = (key: string) => {
        setSpec(key);
        const role = character?.specs.find((s) => s.key === key)?.role || "";
        setCanAlso((list) => list.filter((r) => r !== role));
    };

    const submit = async () => {
        setBusy(true);
        try {
            const res = await saveSignup(csrfToken, {
                eventId: row.id,
                character: absent && !character ? "" : character?.name || "",
                spec: absent ? "" : spec,
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
                    <div className="an-grid">
                        <div className="field">
                            <label htmlFor="an-char">Charakter</label>
                            <div className="an-pick">
                                {cls && <WowIcon name={cls.icon} size={22} />}
                                <select id="an-char" value={characterKey} disabled={absent} onChange={(e) => pickCharacter(e.target.value)} {...color}>
                                    {profile.characters.map((c) => <option key={c.key} value={c.key}>{c.name}{c.main ? " (Main)" : ""}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="field">
                            <label htmlFor="an-spec">Spec</label>
                            <div className="an-pick">
                                {character?.specs.find((s) => s.key === spec) && <WowIcon name={character.specs.find((s) => s.key === spec)!.icon} size={22} />}
                                <select id="an-spec" value={spec} disabled={absent || !character?.specs.length} onChange={(e) => pickSpec(e.target.value)}>
                                    {!character?.specs.length && <option value="">kein Spec im Profil</option>}
                                    {character?.specs.map((s) => <option key={s.key} value={s.key}>{s.label} · {GEAR_LABEL[s.gear] || s.gear}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>
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
