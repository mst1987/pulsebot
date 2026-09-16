// "Raider eintragen" (#288): the orga signs somebody up — or off. Three steps
// on one page, top to bottom: who (search), with which character and spec
// (their profile's, or a new one), and the status. Somebody already signed up
// shows how, with "Austragen" beside it. The deadline and a closed signup do not
// apply to the orga; a character that is new is added to the raider's profile.
import { useEffect, useMemo, useState } from "react";
import {
    addRaiderToRaid, getRaiderCandidates, removeRaiderFromRaid,
    type ApiError, type ManageCandidates, type ManageRaider, type SignupStatus,
} from "../../../api";
import { Modal, useConfirm } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Segment from "../../../components/ui/Segment";
import WowIcon from "../../../components/ui/WowIcon";
import { useToast } from "../../../components/Jobs";
import { SIGNUP_STATUS, statusBadgeLabel } from "../../../lib/signups";
import { filterRaiders, orgaStatuses, raiderInputOk, specsOfClass } from "../../../lib/eventManage";
import type { RaidCtx } from "../meta";

const NEW = "__new";

export default function RaiderModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const { data, eventId, csrfToken, onChanged } = ctx;
    const [candidates, setCandidates] = useState<ManageCandidates | null>(null);
    const [query, setQuery] = useState("");
    const [userId, setUserId] = useState("");
    const [charKey, setCharKey] = useState("");
    const [newName, setNewName] = useState("");
    const [classId, setClassId] = useState("");
    const [spec, setSpec] = useState("");
    const [status, setStatus] = useState<SignupStatus>("signed");
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const ask = useConfirm();

    useEffect(() => {
        if (!open) return;
        setQuery("");
        setUserId("");
        setStatus("signed");
        setCandidates(null);
        getRaiderCandidates(eventId).then(setCandidates).catch((err: ApiError) => toast(err.message, "err"));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, eventId]);

    const raider: ManageRaider | undefined = candidates?.raiders.find((r) => r.userId === userId);
    const shown = useMemo(() => filterRaiders(candidates?.raiders || [], query).slice(0, 40), [candidates, query]);

    // A picked raider starts from their current signup, else their main character.
    const pick = (r: ManageRaider) => {
        setUserId(r.userId);
        const current = r.signup ? r.characters.find((c) => c.name === r.signup!.character) : undefined;
        const first = current || r.characters.find((c) => c.main) || r.characters[0];
        setCharKey(first ? first.key : NEW);
        setNewName("");
        setClassId("");
        setSpec(r.signup?.spec || (first && first.specs[0] ? first.specs[0].key : ""));
        if (r.signup && r.signup.status !== "absence") setStatus(r.signup.status);
    };

    const character = raider?.characters.find((c) => c.key === charKey);
    const specs = charKey === NEW ? specsOfClass(candidates, classId) : (character?.specs || []);
    const characterName = charKey === NEW ? newName : (character?.name || "");

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!raiderInputOk(userId, characterName, spec)) return;
        setBusy(true);
        try {
            const r = await addRaiderToRaid(csrfToken, { event: eventId, userId, character: characterName.trim(), spec, status });
            onClose();
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!raider) return;
        const who = raider.signup?.character || raider.name;
        if (!(await ask({ title: `${who} austragen?`, text: "Die Anmeldung wird entfernt. Der Raider bekommt keine Nachricht.", action: "Austragen" }))) return;
        try {
            const r = await removeRaiderFromRaid(csrfToken, { event: eventId, userId: raider.userId });
            onClose();
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_groupneedmore" tone="raids"
            kicker={data.event.title} title="Raider eintragen" width={600}
            hint={raider && charKey === NEW ? "Der neue Charakter wird auch ins Profil des Raiders übernommen." : "Anmeldeschluss und geschlossene Anmeldung gelten für die Orga nicht."}
            footer={(
                <>
                    {raider?.signup && <Button variant="ghost" onClick={remove} className="em-remove">Austragen</Button>}
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button type="submit" form="em-raider-form" icon="inv_misc_groupneedmore" running={busy} disabled={!raiderInputOk(userId, characterName, spec)}>
                        {raider?.signup ? "Ändern" : "Eintragen"}
                    </Button>
                </>
            )}
        >
            <form id="em-raider-form" className="rd-form" onSubmit={submit}>
                {!candidates ? <p className="rd-empty">Raider werden geladen …</p> : !raider ? (
                    <>
                        <div className="field">
                            <label htmlFor="em-raider-q">Raider <span className="rd-muted">Discord-Name oder Charakter</span></label>
                            <input id="em-raider-q" type="search" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} placeholder="Suchen …" />
                        </div>
                        <div className="em-pick" role="listbox" aria-label="Raider">
                            {shown.map((r) => (
                                <button key={r.userId} type="button" role="option" aria-selected={false} className="em-pick-row" onClick={() => pick(r)}>
                                    <span className="em-pick-name">{r.characters.find((c) => c.main)?.name || r.name || r.userId}</span>
                                    <span className="em-sub">{r.name ? `@${r.name}` : ""}{r.characters.length > 1 ? ` · ${r.characters.length} Charaktere` : ""}</span>
                                    {r.signup && <Badge tone={SIGNUP_STATUS[r.signup.status].tone}>{statusBadgeLabel(r.signup.status)}</Badge>}
                                </button>
                            ))}
                            {!shown.length && <p className="rd-empty">Niemand gefunden.</p>}
                        </div>
                    </>
                ) : (
                    <>
                        <div className="em-who">
                            <div className="em-cell">
                                <span className="kicker">Raider</span>
                                <span className="em-val">{raider.name ? `@${raider.name}` : raider.userId}</span>
                                <span className="em-sub">
                                    {raider.signup ? `angemeldet als ${statusBadgeLabel(raider.signup.status)}${raider.signup.character ? ` · ${raider.signup.character}` : ""}` : "noch nicht angemeldet"}
                                </span>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setUserId("")}>Anderer Raider</Button>
                        </div>

                        <div className="field">
                            <label>Charakter</label>
                            <div className="em-chips">
                                {raider.characters.map((c) => (
                                    <button key={c.key} type="button" className={`em-chip${charKey === c.key ? " on" : ""}`} onClick={() => { setCharKey(c.key); setSpec(c.specs[0]?.key || ""); }}>
                                        {c.name}{c.main && <span className="em-sub">Main</span>}
                                    </button>
                                ))}
                                <button type="button" className={`em-chip${charKey === NEW ? " on" : ""}`} onClick={() => { setCharKey(NEW); setSpec(""); }}>
                                    Neuer Charakter
                                </button>
                            </div>
                        </div>

                        {charKey === NEW && (
                            <div className="em-fields">
                                <div className="field">
                                    <label htmlFor="em-raider-name">Name</label>
                                    <input id="em-raider-name" type="text" maxLength={24} value={newName} onChange={(e) => setNewName(e.target.value)} />
                                </div>
                                <div className="field">
                                    <label htmlFor="em-raider-class">Klasse</label>
                                    <select id="em-raider-class" value={classId} onChange={(e) => { setClassId(e.target.value); setSpec(""); }}>
                                        <option value="">wählen …</option>
                                        {(candidates.classes || []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                                    </select>
                                </div>
                            </div>
                        )}

                        {specs.length > 0 && (
                            <div className="field">
                                <label>Spezialisierung</label>
                                <div className="em-chips">
                                    {specs.map((s) => (
                                        <button key={s.key} type="button" className={`em-chip${spec === s.key ? " on" : ""}`} onClick={() => setSpec(s.key)}>
                                            {s.icon && <WowIcon name={s.icon} size={18} />}{s.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="field">
                            <label>Status</label>
                            <Segment<SignupStatus>
                                size="sm" ariaLabel="Status" value={status} onChange={(s) => setStatus(s)}
                                options={orgaStatuses().map((s) => ({ value: s, label: SIGNUP_STATUS[s].label }))}
                            />
                        </div>
                    </>
                )}
            </form>
        </Modal>
    );
}
