import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
    getAvailability, previewAvailability, saveAvailability, updateAvailability,
    type ApiError, type AvailabilityData, type AvailabilityEntry, type AvailabilityInput, type AvailabilityKind,
    type AvailabilityRaid, type AvailabilityResult, type RaiderRef,
} from "../../api";
import { useApi } from "../../hooks/useApi";
import { useContentVersion } from "../../hooks/useContentVersion";
import { Button, Modal, Segment } from "../ui";
import { AbsenceIcon, CheckIcon, SignedIcon, XIcon } from "../ui/icons/icons";
import { useToast } from "../shell/Jobs";
import type { ShellContext } from "../shell/Shell";
import { CharacterRows, RaidChecklist, RaiderPick, ResultList, ScopePicker } from "./AvailabilityParts";
import {
    characterGroups, charactersInput, charsFromEntry, countResults, effectiveChars, initialScope, nextTo, pickedVersions,
    raidFixed, resultSummary, scopeFromEntry, scopeParts, setCharSpec, toggleCategory, toggleChar, toggleServer,
    type CharPick, type ScopePick,
} from "../../lib/signups/availability";
import { versionLabel } from "../../lib/raidplan/versions";
import { useT } from "../../i18n";
// rendered on more than one page (Anmeldungen, Roster › Abwesenheiten): it brings its stylesheet along
import "../../styles/signups.css";

// "Abwesenheit / Anwesenheit eintragen" and "… bearbeiten": a period, where it
// holds (servers and their categories), a reason (absence) or the characters
// with their spec (attendance), and the raids the period covers right now — all
// picked, a click leaves one out. The server signs off / up at once and
// remembers the period for raids created later (src/services/signups/availability.js).
// The orga may enter for another raider: their characters and servers are
// loaded, and `userId` goes along with preview and save.
// Editing (`entryId`) opens the same form filled in; the kind stays, the raids the
// entry already changed stay as they are (`applied`), PUT saves.

/** How long the inputs must rest before the raids of the period are looked up. */
const PREVIEW_DELAY = 300;
/** How many characters one attendance takes (the server's limit). */
const MAX_CHARS = 12;

type Preview = { key: string; raids: AvailabilityRaid[] | null; problem: string };

export default function AvailabilityDialog({ kind, own, target = null, categoryId = "", entryId = "", activeGuildId, onClose, onSaved }: {
    /** The kind to start with (editing: the entry's); null = closed. */
    kind: AvailabilityKind | null;
    /** The caller's own GET /api/availability. */
    own: AvailabilityData;
    /** The orga enters for this raider from the start (Roster › Abwesenheiten); they can still pick another. */
    target?: RaiderRef | null;
    /** The raid category picked at the start (the open tab of the page); "" = the server the web shows, all of it. */
    categoryId?: string;
    /** Edit this entry (of `target`, else the caller's own) instead of entering a new one. */
    entryId?: string;
    /** The server the web shows; missing = the shell's. */
    activeGuildId?: string;
    onClose: () => void;
    /** After a save: the section and the raid list reload. */
    onSaved: () => void;
}) {
    const shell = useOutletContext<ShellContext | undefined>();
    const guildId = activeGuildId ?? shell?.activeGuildId ?? "";
    // a fresh form per opening: every field starts from scratch
    if (!kind) return null;
    const forOther = own.orga ? target : null;
    if (entryId) return <EditGate entryId={entryId} kind={kind} own={own} target={forOther} activeGuildId={guildId} onClose={onClose} onSaved={onSaved} />;
    return <AvailabilityForm initialKind={kind} own={own} initialTarget={forOther} initialCategory={categoryId} activeGuildId={guildId} onClose={onClose} onSaved={onSaved} />;
}

/** Editing: the raider's data with the entry first (the orga's raider is loaded), then the form filled in. */
function EditGate({ entryId, kind, own, target, activeGuildId, onClose, onSaved }: {
    entryId: string;
    kind: AvailabilityKind;
    own: AvailabilityData;
    target: RaiderRef | null;
    activeGuildId: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const t = useT();
    const other = useApi(() => getAvailability(target ? target.userId : ""), [target ? target.userId : ""], { enabled: !!target });
    const data = target ? other.data : own;
    const entry = data ? data.entries.find((e) => e.id === entryId) : undefined;
    if (data && entry) {
        return <AvailabilityForm initialKind={entry.kind} own={own} initialTarget={target} initialCategory="" activeGuildId={activeGuildId}
            edit={{ entry, data }} onClose={onClose} onSaved={onSaved} />;
    }
    const presence = kind === "presence";
    return (
        <Modal open onClose={onClose} icon={presence ? <SignedIcon /> : <AbsenceIcon />} tone={presence ? "ok" : "bad"}
            kicker={t("signups.availability.dialog.kickerEdit")}
            title={presence ? t("signups.availability.dialog.titleEditPresence") : t("signups.availability.dialog.titleEditAbsence")}
            width={640} footer={<Button variant="ghost" icon={<XIcon />} onClick={onClose}>{t("common.close")}</Button>}>
            {target && other.error ? <p className="an-av-problem" role="alert">{other.error.message}</p>
                : !data ? <p className="an-note">{t("signups.availability.dialog.loadingRaider")}</p>
                    : <p className="an-av-problem" role="alert">{t("signups.availability.dialog.entryGone")}</p>}
        </Modal>
    );
}

function AvailabilityForm({ initialKind, own, initialTarget, initialCategory, activeGuildId, edit = null, onClose, onSaved }: {
    initialKind: AvailabilityKind;
    own: AvailabilityData;
    initialTarget: RaiderRef | null;
    initialCategory: string;
    activeGuildId: string;
    /** Editing: the entry and the data it came with (the raider's). */
    edit?: { entry: AvailabilityEntry; data: AvailabilityData } | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const { versions } = useContentVersion();
    const entry = edit ? edit.entry : null;
    const [kind, setKind] = useState<AvailabilityKind>(initialKind);
    const [target, setTarget] = useState<RaiderRef | null>(initialTarget);
    const [from, setFrom] = useState(entry ? entry.from : own.today);
    const [to, setTo] = useState(entry ? entry.to : own.today);
    const [comment, setComment] = useState(entry ? entry.comment : "");
    // null = not touched yet: the start pick follows the raider's data (it changes with the orga's raider)
    const [scopePick, setScopePick] = useState<ScopePick | null>(() => (edit ? scopeFromEntry(edit.entry, edit.data.servers || []) : null));
    const [chosen, setChosen] = useState<CharPick>(() => (edit ? charsFromEntry(edit.entry, edit.data.characters) : {}));
    const [off, setOff] = useState<Set<string>>(() => new Set());
    const [preview, setPreview] = useState<Preview>({ key: "", raids: null, problem: "" });
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<AvailabilityResult[] | null>(null);

    // The other raider's characters and servers (orga only; editing brings them along).
    const other = useApi(() => getAvailability(target ? target.userId : ""), [target ? target.userId : ""], { enabled: !!target && !edit });
    const data = edit ? edit.data : target ? other.data : own;
    const servers = data ? data.servers || [] : [];
    const scope = scopePick || initialScope(servers, { categoryId: initialCategory, activeGuildId });
    const parts = scopeParts(scope, servers);
    // an attendance offers only characters of the versions the picked categories play
    const groups = characterGroups(data ? data.characters : [], pickedVersions(scope, servers));
    const offered = groups.flatMap((g) => g.characters);
    const picks = effectiveChars(chosen, groups);
    const chars = charactersInput(picks, offered);
    const presence = kind === "presence";
    const forName = target ? target.name || target.character : "";

    const input: AvailabilityInput = {
        kind, from, to, scope: parts,
        ...(presence ? { characters: chars } : {}),
        ...(target ? { userId: target.userId } : {}),
        ...(entry ? { id: entry.id } : {}),
    };
    const inputKey = JSON.stringify(input);
    const complete = !!from && !!to && !!data && parts.length > 0 && (!presence || (chars.length > 0 && chars.length <= MAX_CHARS));

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
    const picked = raids.filter((r) => !off.has(r.id) && !raidFixed(kind, r));
    const problem = current?.problem || (target && !edit && other.error ? other.error.message : "");
    const canSave = !!current && !!current.raids && !busy && !results;

    const toggle = (id: string) => setOff((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const pickTarget = (raider: RaiderRef | null) => {
        setTarget(raider);
        setScopePick(null);
        setChosen({});
        setOff(new Set());
    };

    const submit = async () => {
        setBusy(true);
        try {
            const body = { ...input, comment: presence ? "" : comment.trim(), eventIds: picked.map((r) => r.id) };
            const res = entry ? await updateAvailability({ ...body, id: entry.id }) : await saveAvailability(body);
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

    const hint = entry
        ? (target ? t("signups.availability.dialog.hintEditFor", { name: forName }) : t("signups.availability.dialog.hintEdit"))
        : presence
            ? (target ? t("signups.availability.dialog.hintPresenceFor", { name: forName }) : t("signups.availability.dialog.hintPresence"))
            : (target ? t("signups.availability.dialog.hintAbsenceFor", { name: forName }) : t("signups.availability.dialog.hintAbsence"));
    const title = entry
        ? (presence ? t("signups.availability.dialog.titleEditPresence") : t("signups.availability.dialog.titleEditAbsence"))
        : (presence ? t("signups.availability.dialog.titlePresence") : t("signups.availability.dialog.titleAbsence"));
    const saveLabel = entry ? t("signups.availability.dialog.saveEdit")
        : presence ? t("signups.availability.dialog.savePresence") : t("signups.availability.dialog.saveAbsence");
    // an entry may still be changed while it runs: its start may lie before today
    const minFrom = entry && entry.from < own.today ? entry.from : own.today;
    const loading = !!target && !data;

    return (
        <Modal
            open
            onClose={onClose}
            icon={presence ? <SignedIcon /> : <AbsenceIcon />}
            tone={presence ? "ok" : "bad"}
            kicker={results ? t("signups.availability.dialog.resultsKicker") : entry ? t("signups.availability.dialog.kickerEdit") : t("signups.availability.dialog.kicker")}
            title={title}
            width={640}
            hint={results ? undefined : hint}
            footer={results ? (
                <Button variant="ghost" icon={<XIcon />} onClick={onClose}>{t("common.close")}</Button>
            ) : (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon={<CheckIcon />} disabled={!canSave} running={busy} onClick={submit} variant="go">{saveLabel}</Button>
                </>
            )}
        >
            {results ? <ResultList results={results} /> : (
                <div className="an-dlg an-av-form">
                    {own.orga && !entry && <RaiderPick target={target} onPick={pickTarget} />}
                    {!entry && (
                        <Segment
                            ariaLabel={t("signups.availability.dialog.kindAria")}
                            value={kind}
                            onChange={setKind}
                            options={[
                                { value: "absence", label: t("signups.availability.dialog.absence"), icon: <AbsenceIcon /> },
                                { value: "presence", label: t("signups.availability.dialog.presence"), icon: <SignedIcon /> },
                            ]}
                        />
                    )}
                    <div className="field">
                        <span className="an-label">{t("signups.availability.dialog.category")}</span>
                        {loading ? <p className="an-note">{t("signups.availability.dialog.loadingRaider")}</p>
                            : !servers.length ? (
                                <p className="an-note">{target ? t("signups.availability.dialog.noServerFor", { name: forName }) : t("signups.availability.dialog.noServer")}</p>
                            ) : (
                                <>
                                    <ScopePicker servers={servers} pick={scope}
                                        onAll={(g) => setScopePick(toggleServer(scope, g))}
                                        onCategory={(g, c) => setScopePick(toggleCategory(scope, g, c))} />
                                    {!parts.length && <p className="an-av-problem" role="alert">{t("signups.availability.dialog.noScope")}</p>}
                                </>
                            )}
                    </div>
                    <div className="an-grid">
                        <div className="field">
                            <label htmlFor="an-av-from">{t("signups.availability.dialog.from")}</label>
                            <input id="an-av-from" type="date" value={from} min={minFrom}
                                onChange={(e) => { setFrom(e.target.value); setTo(nextTo(e.target.value, to)); }} />
                        </div>
                        <div className="field">
                            <label htmlFor="an-av-to">{t("signups.availability.dialog.to")}</label>
                            <input id="an-av-to" type="date" value={to} min={from || own.today} onChange={(e) => setTo(e.target.value)} />
                        </div>
                    </div>
                    {presence ? (
                        loading || !servers.length || !parts.length ? null
                            : !offered.length ? (
                                <p className="an-note">{target ? t("signups.availability.dialog.noCharacterFor", { name: forName }) : t("signups.availability.dialog.noCharacter")}</p>
                            ) : (
                                <div className="field">
                                    <span className="an-label">
                                        {t("signups.availability.dialog.characters")}
                                        {offered.length > 1 && <span className="an-opt"> · {t("signups.availability.dialog.picked", { picked: chars.length, total: offered.length })}</span>}
                                    </span>
                                    <CharacterRows groups={groups} picked={picks} versionName={(id) => versionLabel(versions, id)}
                                        onToggle={(c) => setChosen(toggleChar(chosen, groups, c))}
                                        onSpec={(key, spec) => setChosen(setCharSpec(chosen, groups, key, spec))} />
                                    {!chars.length && <p className="an-av-problem" role="alert">{t("signups.availability.dialog.noCharPicked")}</p>}
                                    {chars.length > MAX_CHARS && <p className="an-av-problem" role="alert">{t("signups.availability.dialog.maxChars", { count: MAX_CHARS })}</p>}
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
                        <span className="an-label">
                            {t("signups.availability.dialog.raids")}
                            {raids.length > 0 && <span className="an-opt"> · {t("signups.availability.dialog.picked", { picked: picked.length, total: raids.length })}</span>}
                        </span>
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
