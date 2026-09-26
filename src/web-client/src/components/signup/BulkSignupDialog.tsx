import { useEffect, useState } from "react";
import {
    saveSignupsBulk,
    type ApiError, type BulkSignupResult, type OwnSignupRow, type SignupClass, type SignupProfile, type SignupStatus,
} from "../../api";
import { Badge, Button, Modal } from "../ui";
import { CheckIcon } from "../icons";
import { useToast } from "../Jobs";
import SignupCharacterPicks from "./SignupCharacterPicks";
import { formatEventTime } from "../../lib/format";
import { SIGNUP_STATUS, SIGNUP_STATUS_ORDER } from "../../lib/signups";
import { initialPicks, picksToInput, type CharacterPick } from "../../lib/signupPicks";
import { specLabel } from "../../lib/wowNames";
import { useT } from "../../i18n";

// "Für alle gewählten anmelden" (#293): one choice of characters and status for
// every raid picked on the page. Each raid is checked on its own by the server
// (deadline, raider role, class) — the answer lists what was saved and, for
// the rest, why not, so nothing is silently left out.

export default function BulkSignupDialog({ rows, profile, classes, onClose, onDone }: {
    rows: OwnSignupRow[];
    profile: SignupProfile;
    classes: SignupClass[];
    onClose: () => void;
    onDone: (results: BulkSignupResult[]) => void;
}) {
    const t = useT();
    const toast = useToast();
    const open = rows.length > 0;
    const [picks, setPicks] = useState<CharacterPick[]>([]);
    const [status, setStatus] = useState<SignupStatus>("signed");
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<BulkSignupResult[] | null>(null);

    useEffect(() => {
        if (!open) return;
        // Several raids at once carry ONE status for all of them, so the picks
        // deliberately get none of their own (#320) — the status select below
        // is the only one, and picksToInput() then sends no per-character status.
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
            const res = await saveSignupsBulk({ eventIds: rows.map((r) => r.id), characters, status });
            setResults(res.results);
            onDone(res.results);
            const saved = res.results.filter((r) => r.ok).length;
            toast(t("signups.bulk.toast", { saved, total: res.results.length }), saved === res.results.length ? undefined : "err");
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
            kicker={t("signups.selectedCount", { count: rows.length })}
            title={t("signups.bulkTitle")}
            width={720}
            hint={results ? undefined : t("signups.bulk.hint")}
            footer={results ? (
                <Button onClick={onClose}>{t("common.close")}</Button>
            ) : (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon={<CheckIcon />} disabled={!canSubmit} running={busy} onClick={submit} variant={absent ? "danger" : "primary"}>
                        {absent ? t("signups.bulk.signOffAll", { count: rows.length }) : t("signups.bulk.signUpAll", { count: rows.length })}
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
                            <label>{t("signups.statusForAll")}</label>
                            <div className="seg an-status" role="radiogroup" aria-label={t("signups.statusForAll")}>
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
    const t = useT();
    const s = result.signup;
    const chars = s ? s.characters.map((c, i) => `${i ? "+" : ""}${c.character} · ${specLabel(c.spec, c.specLabel)}`).join(", ") : "";
    const skipped = result.skipped.map((x) => t("signups.bulk.skipped", { character: x.character, reason: x.reason })).join(" · ");
    return (
        <li className="an-result">
            <Badge tone={result.ok ? (result.waitlisted ? "mid" : "ok") : "bad"}>
                {result.ok ? (result.waitlisted ? t("signups.bulk.waitlisted") : t("signups.bulk.saved")) : t("signups.bulk.notSaved")}
            </Badge>
            <span className="an-result-title">{result.title}</span>
            <span className="an-result-text">
                {result.ok ? (s && s.status === "absence" ? t("signups.bulk.absent") : `${chars}${s && s.status !== "signed" ? ` – ${SIGNUP_STATUS[s.status].label}` : ""}`) : result.error}
                {result.notice && <span className="an-result-skip">{result.notice}</span>}
                {skipped && <span className="an-result-skip">{skipped}</span>}
            </span>
        </li>
    );
}
