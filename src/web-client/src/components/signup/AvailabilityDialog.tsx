import { useEffect, useState } from "react";
import {
    getAvailability, previewAvailability, saveAvailability,
    type ApiError, type AvailabilityData, type AvailabilityInput, type AvailabilityKind, type AvailabilityRaid,
    type AvailabilityResult, type RaiderRef,
} from "../../api";
import { useApi } from "../../hooks/useApi";
import { Button, Modal, Segment, WowIcon } from "../ui";
import { AbsenceIcon, CheckIcon, SignedIcon } from "../icons";
import { useToast } from "../Jobs";
import { RaidChecklist, RaiderPick, ResultList } from "./AvailabilityParts";
import { countResults, firstSpec, nextTo, resultSummary, staysAsIs } from "../../lib/availability";
import { classIconName } from "../../lib/rosterView";
import { specLabel } from "../../lib/wowNames";
import { useT } from "../../i18n";

// "Abwesenheit / Anwesenheit eintragen": a period, a reason (absence) or a
// character · spec (attendance), and the raids the period covers right now —
// all picked, a click leaves one out. The server signs off / up at once and
// remembers the period for raids created later (src/services/signups/availability.js).
// The orga may enter for another raider: their characters are loaded, and
// `userId` goes along with preview and save.

/** How long the inputs must rest before the raids of the period are looked up. */
const PREVIEW_DELAY = 300;

type Preview = { key: string; raids: AvailabilityRaid[] | null; problem: string };

export default function AvailabilityDialog({ kind, own, onClose, onSaved }: {
    /** The kind to start with; null = closed. */
    kind: AvailabilityKind | null;
    /** The caller's own GET /api/availability. */
    own: AvailabilityData;
    onClose: () => void;
    /** After a save: the section and the raid list reload. */
    onSaved: () => void;
}) {
    // a fresh form per opening: every field starts from scratch
    if (!kind) return null;
    return <AvailabilityForm initialKind={kind} own={own} onClose={onClose} onSaved={onSaved} />;
}

function AvailabilityForm({ initialKind, own, onClose, onSaved }: {
    initialKind: AvailabilityKind;
    own: AvailabilityData;
    onClose: () => void;
    onSaved: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const [kind, setKind] = useState<AvailabilityKind>(initialKind);
    const [target, setTarget] = useState<RaiderRef | null>(null);
    const [from, setFrom] = useState(own.today);
    const [to, setTo] = useState(own.today);
    const [comment, setComment] = useState("");
    const [charKey, setCharKey] = useState("");
    const [spec, setSpec] = useState("");
    const [off, setOff] = useState<Set<string>>(() => new Set());
    const [preview, setPreview] = useState<Preview>({ key: "", raids: null, problem: "" });
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<AvailabilityResult[] | null>(null);

    // The other raider's characters (orga only).
    const other = useApi(() => getAvailability(target ? target.userId : ""), [target ? target.userId : ""], { enabled: !!target });
    const data = target ? other.data : own;
    const characters = data ? data.characters : [];
    // The picked character, else the raider's first — their own order, there is no main.
    const character = characters.find((c) => c.key === charKey) || characters[0];
    const specKey = character && character.specs.some((s) => s.key === spec) ? spec : firstSpec(character);
    const presence = kind === "presence";
    const forName = target ? target.name || target.character : "";

    const input: AvailabilityInput = {
        kind, from, to,
        ...(presence && character ? { character: character.key, spec: specKey } : {}),
        ...(target ? { userId: target.userId } : {}),
    };
    const inputKey = JSON.stringify(input);
    const complete = !!from && !!to && !!data && (!presence || (!!character && !!specKey));

    useEffect(() => {
        if (!complete) return undefined;
        let live = true;
        const timer = window.setTimeout(() => {
            previewAvailability(JSON.parse(inputKey) as AvailabilityInput).then(
                (r) => { if (live) setPreview({ key: inputKey, raids: r.raids, problem: "" }); },
                (e: ApiError) => { if (live) setPreview({ key: inputKey, raids: null, problem: e.message }); },
            );
        }, PREVIEW_DELAY);
        return () => { live = false; window.clearTimeout(timer); };
    }, [inputKey, complete]);

    // the answer for exactly these inputs, else still looking
    const current = complete && preview.key === inputKey ? preview : null;
    const raids = current?.raids || [];
    const picked = raids.filter((r) => !off.has(r.id) && !staysAsIs(kind, r.status));
    const problem = current?.problem || (target && other.error ? other.error.message : "");
    const canSave = !!current && !!current.raids && !busy && !results;

    const toggle = (id: string) => setOff((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const pickTarget = (raider: RaiderRef | null) => {
        setTarget(raider);
        setCharKey("");
        setSpec("");
    };

    const submit = async () => {
        setBusy(true);
        try {
            const res = await saveAvailability({ ...input, comment: presence ? "" : comment.trim(), eventIds: picked.map((r) => r.id) });
            const { skipped, failed } = countResults(res.results);
            toast(resultSummary(kind, res.results, res.dm), failed ? "err" : undefined);
            onSaved();
            if (skipped || failed) setResults(res.results);
            else onClose();
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const hint = presence
        ? (target ? t("signups.availability.dialog.hintPresenceFor", { name: forName }) : t("signups.availability.dialog.hintPresence"))
        : (target ? t("signups.availability.dialog.hintAbsenceFor", { name: forName }) : t("signups.availability.dialog.hintAbsence"));

    return (
        <Modal
            open
            onClose={onClose}
            icon={presence ? <SignedIcon /> : <AbsenceIcon />}
            tone={presence ? "ok" : "bad"}
            kicker={results ? t("signups.availability.dialog.resultsKicker") : t("signups.availability.dialog.kicker")}
            title={presence ? t("signups.availability.dialog.titlePresence") : t("signups.availability.dialog.titleAbsence")}
            width={640}
            hint={results ? undefined : hint}
            footer={results ? (
                <Button onClick={onClose}>{t("common.close")}</Button>
            ) : (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon={<CheckIcon />} disabled={!canSave} running={busy} onClick={submit} variant={presence ? "primary" : "danger"}>
                        {presence ? t("signups.availability.dialog.savePresence") : t("signups.availability.dialog.saveAbsence")}
                    </Button>
                </>
            )}
        >
            {results ? <ResultList results={results} /> : (
                <div className="an-dlg an-av-form">
                    {own.orga && <RaiderPick target={target} onPick={pickTarget} />}
                    <Segment
                        ariaLabel={t("signups.availability.dialog.kindAria")}
                        value={kind}
                        onChange={setKind}
                        options={[
                            { value: "absence", label: t("signups.availability.dialog.absence"), icon: <AbsenceIcon /> },
                            { value: "presence", label: t("signups.availability.dialog.presence"), icon: <SignedIcon /> },
                        ]}
                    />
                    <div className="an-grid">
                        <div className="field">
                            <label htmlFor="an-av-from">{t("signups.availability.dialog.from")}</label>
                            <input id="an-av-from" type="date" value={from} min={own.today}
                                onChange={(e) => { setFrom(e.target.value); setTo(nextTo(e.target.value, to)); }} />
                        </div>
                        <div className="field">
                            <label htmlFor="an-av-to">{t("signups.availability.dialog.to")}</label>
                            <input id="an-av-to" type="date" value={to} min={from || own.today} onChange={(e) => setTo(e.target.value)} />
                        </div>
                    </div>
                    {presence ? (
                        target && !data ? <p className="an-note">{t("signups.availability.dialog.loadingRaider")}</p>
                            : !character ? (
                                <p className="an-note">{target ? t("signups.availability.dialog.noCharacterFor", { name: forName }) : t("signups.availability.dialog.noCharacter")}</p>
                            ) : (
                                <div className="an-grid">
                                    <div className="field">
                                        <label htmlFor="an-av-char">{t("signups.availability.dialog.character")}</label>
                                        <div className="an-pick">
                                            <WowIcon name={classIconName(character.className)} size={22} />
                                            <select id="an-av-char" value={character.key} onChange={(e) => { setCharKey(e.target.value); setSpec(""); }}>
                                                {characters.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="field">
                                        <label htmlFor="an-av-spec">{t("signups.availability.dialog.spec")}</label>
                                        <select id="an-av-spec" value={specKey} onChange={(e) => setSpec(e.target.value)}>
                                            {character.specs.map((s) => <option key={s.key} value={s.key}>{specLabel(s.key, s.label)}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )
                    ) : (
                        <div className="field">
                            <label htmlFor="an-av-reason">{t("signups.availability.dialog.reason")} <span className="an-opt">{t("signups.availability.dialog.optional")}</span></label>
                            <input id="an-av-reason" type="text" maxLength={100} value={comment}
                                placeholder={t("signups.availability.dialog.reasonPlaceholder")} onChange={(e) => setComment(e.target.value)} />
                        </div>
                    )}
                    <div className="field">
                        <label>
                            {t("signups.availability.dialog.raids")}
                            {raids.length > 0 && <span className="an-opt"> · {t("signups.availability.dialog.picked", { picked: picked.length, total: raids.length })}</span>}
                        </label>
                        {problem ? <p className="an-av-problem" role="alert">{problem}</p>
                            : !complete ? null
                                : !current ? <p className="an-note">{t("signups.availability.dialog.searching")}</p>
                                    : raids.length ? <RaidChecklist kind={kind} raids={raids} off={off} onToggle={toggle} />
                                        : <p className="an-note">{t("signups.availability.dialog.noRaids")}</p>}
                    </div>
                </div>
            )}
        </Modal>
    );
}
