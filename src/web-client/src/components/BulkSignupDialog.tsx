import { useEffect, useState } from "react";
import {
    saveSignupsBulk,
    type ApiError, type BulkSignupResult, type OwnSignupRow, type SignupClass, type SignupProfile, type SignupStatus,
} from "../api";
import { Badge, Button, Modal } from "./ui";
import { CheckIcon } from "./icons";
import { useToast } from "./Jobs";
import SignupCharacterPicks from "./SignupCharacterPicks";
import { formatEventTime } from "../lib/format";
import { SIGNUP_STATUS, SIGNUP_STATUS_ORDER } from "../lib/signups";
import { initialPicks, picksToInput, type CharacterPick } from "../lib/signupPicks";

// "Für alle gewählten anmelden" (#293): one choice of characters and status for
// every raid picked on the page. Each raid is checked on its own by the server
// (deadline, raider role, class) — the answer lists what was saved and, for
// the rest, why not, so nothing is silently left out.

export default function BulkSignupDialog({ rows, profile, classes, csrfToken, onClose, onDone }: {
    rows: OwnSignupRow[];
    profile: SignupProfile;
    classes: SignupClass[];
    csrfToken: string | null;
    onClose: () => void;
    onDone: (results: BulkSignupResult[]) => void;
}) {
    const toast = useToast();
    const open = rows.length > 0;
    const [picks, setPicks] = useState<CharacterPick[]>([]);
    const [status, setStatus] = useState<SignupStatus>("signed");
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<BulkSignupResult[] | null>(null);

    useEffect(() => {
        if (!open) return;
        setPicks(initialPicks(profile, null));
        setStatus("signed");
        setResults(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!open) return null;

    const absent = status === "absence";
    const characters = picksToInput(profile, picks);
    const canSubmit = !busy && !results && (absent || characters.length > 0);

    const submit = async () => {
        setBusy(true);
        try {
            const res = await saveSignupsBulk(csrfToken, { eventIds: rows.map((r) => r.id), characters, status });
            setResults(res.results);
            onDone(res.results);
            const saved = res.results.filter((r) => r.ok).length;
            toast(`${saved} von ${res.results.length} Raids gespeichert.`, saved === res.results.length ? undefined : "err");
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            icon="inv_misc_book_09"
            tone="signups"
            kicker={rows.length === 1 ? "1 Raid gewählt" : `${rows.length} Raids gewählt`}
            title="Für alle gewählten anmelden"
            width={720}
            hint={results ? undefined : "Was in einem Raid nicht passt (Anmeldeschluss, Klasse, Raider-Rolle), wird dort mit Grund übersprungen."}
            footer={results ? (
                <Button onClick={onClose}>Schließen</Button>
            ) : (
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button icon={<CheckIcon />} disabled={!canSubmit} running={busy} onClick={submit} variant={absent ? "danger" : "primary"}>
                        {absent ? `Von ${rows.length} Raids abmelden` : `Für ${rows.length} Raids anmelden`}
                    </Button>
                </>
            )}
        >
            <div className="an-dlg">
                {results ? (
                    <ul className="an-results">
                        {results.map((r) => <ResultRow key={r.eventId} result={r} />)}
                    </ul>
                ) : (
                    <>
                        <div className="an-sel">
                            {rows.map((r) => <Badge key={r.id} tip={r.title} tipSub={formatEventTime(r.startTime)}>{r.title}</Badge>)}
                        </div>
                        <SignupCharacterPicks profile={profile} classes={classes} picks={picks} onChange={setPicks} disabled={absent} />
                        <div className="field">
                            <label>Status für alle</label>
                            <div className="seg an-status" role="radiogroup" aria-label="Status für alle">
                                {SIGNUP_STATUS_ORDER.map((s) => (
                                    <button
                                        key={s} type="button" role="radio" aria-checked={status === s}
                                        className={`seg-opt${status === s ? " active" : ""}`}
                                        data-tip={SIGNUP_STATUS[s].label} data-tip-sub={SIGNUP_STATUS[s].tip}
                                        onClick={() => setStatus(s)}
                                    >
                                        <i className="an-dot" style={{ background: SIGNUP_STATUS[s].color }} />
                                        {SIGNUP_STATUS[s].label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}

/** One raid of the answer: saved with its characters, or the reason it was not. */
function ResultRow({ result }: { result: BulkSignupResult }) {
    const s = result.signup;
    const chars = s ? s.characters.map((c, i) => `${i ? "+" : ""}${c.character} · ${c.specLabel}`).join(", ") : "";
    const skipped = result.skipped.map((x) => `${x.character} übersprungen: ${x.reason}`).join(" · ");
    return (
        <li className="an-result">
            <Badge tone={result.ok ? "ok" : "bad"}>{result.ok ? "gespeichert" : "nicht gespeichert"}</Badge>
            <span className="an-result-title">{result.title}</span>
            <span className="an-result-text">
                {result.ok ? (s && s.status === "absence" ? "abgemeldet" : `${chars}${s && s.status !== "signed" ? ` – ${SIGNUP_STATUS[s.status].label}` : ""}`) : result.error}
                {skipped && <span className="an-result-skip">{skipped}</span>}
            </span>
        </li>
    );
}
