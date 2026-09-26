// "Raider eintragen" (#288): the orga signs somebody up — or off. Three steps
// on one page, top to bottom: who (search), with which character and spec
// (their profile's, or a new one), and the status. Somebody already signed up
// shows how, with "Austragen" beside it. The deadline and a closed signup do not
// apply to the orga; a character that is new is added to the raider's profile.
import { useEffect, useMemo, useState } from "react";
import {
    addRaiderToRaid, getRaiderCandidates, removeRaiderFromRaid,
    type ApiError, type ManageRaider, type SignupStatus } from "../../../api";
import { useApi } from "../../../hooks/useApi";
import { Modal, useConfirm } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Segment from "../../../components/ui/Segment";
import WowIcon from "../../../components/ui/WowIcon";
import { useToast } from "../../../components/Jobs";
import { SIGNUP_STATUS, statusBadgeLabel } from "../../../lib/signups";
import { filterRaiders, orgaStatuses, raiderInputOk, specsOfClass } from "../../../lib/eventManage";
import { classLabel, specLabel } from "../../../lib/wowNames";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

const NEW = "__new";

export default function RaiderModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId, onChanged } = ctx;
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

    // Asked each time the dialog opens (nothing to pick from while it loads); a failed load is a toast, the dialog stays.
    const candidatesData = useApi(() => getRaiderCandidates(eventId), [eventId], { enabled: open });
    const candidates = candidatesData.loading ? null : candidatesData.data;
    useEffect(() => { if (candidatesData.error) toast(candidatesData.error.message, "err"); }, [candidatesData.error, toast]);
    useEffect(() => {
        if (!open) return;
        setQuery("");
        setUserId("");
        setStatus("signed");
    }, [open]);

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
            const r = await addRaiderToRaid({ event: eventId, userId, character: characterName.trim(), spec, status });
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
        if (!(await ask({ title: t("raidManage.raider.removeTitle", { who }), text: t("raidManage.raider.removeText"), action: t("raidManage.raider.remove") }))) return;
        try {
            const r = await removeRaiderFromRaid({ event: eventId, userId: raider.userId });
            onClose();
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_groupneedmore" tone="raids"
            kicker={data.event.title} title={t("raidManage.raider.title")} width={600}
            hint={raider && charKey === NEW ? t("raidManage.raider.hintNewChar") : t("raidManage.raider.hintDefault")}
            footer={(
                <>
                    {raider?.signup && <Button variant="ghost" onClick={remove} className="em-remove">{t("raidManage.raider.remove")}</Button>}
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="em-raider-form" icon="inv_misc_groupneedmore" running={busy} disabled={!raiderInputOk(userId, characterName, spec)}>
                        {raider?.signup ? t("raidManage.raider.change") : t("raidManage.raider.add")}
                    </Button>
                </>
            )}
        >
            <form id="em-raider-form" className="rd-form" onSubmit={submit}>
                {!candidates ? <p className="rd-empty">{t("raidManage.raider.loading")}</p> : !raider ? (
                    <>
                        <div className="field">
                            <label htmlFor="em-raider-q">{t("raidManage.raider.raider")} <span className="rd-muted">{t("raidManage.raider.raiderSub")}</span></label>
                            <input id="em-raider-q" type="search" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} placeholder={t("raidManage.raider.search")} />
                        </div>
                        <div className="em-pick" role="listbox" aria-label={t("raidManage.raider.listAria")}>
                            {shown.map((r) => (
                                <button key={r.userId} type="button" role="option" aria-selected={false} className="em-pick-row" onClick={() => pick(r)}>
                                    <span className="em-pick-name">{r.characters.find((c) => c.main)?.name || r.name || r.userId}</span>
                                    <span className="em-sub">{r.name ? `@${r.name}` : ""}{r.characters.length > 1 ? ` · ${t("raidManage.raider.characters", { count: r.characters.length })}` : ""}</span>
                                    {r.signup && <Badge tone={SIGNUP_STATUS[r.signup.status].tone}>{statusBadgeLabel(r.signup.status)}</Badge>}
                                </button>
                            ))}
                            {!shown.length && <p className="rd-empty">{t("raidManage.raider.notFound")}</p>}
                        </div>
                    </>
                ) : (
                    <>
                        <div className="em-who">
                            <div className="em-cell">
                                <span className="kicker">{t("raidManage.raider.raider")}</span>
                                <span className="em-val">{raider.name ? `@${raider.name}` : raider.userId}</span>
                                <span className="em-sub">
                                    {raider.signup ? `${t("raidManage.raider.signedAs", { status: statusBadgeLabel(raider.signup.status) })}${raider.signup.character ? ` · ${raider.signup.character}` : ""}` : t("raidManage.raider.notSigned")}
                                </span>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setUserId("")}>{t("raidManage.raider.otherRaider")}</Button>
                        </div>

                        <div className="field">
                            <label>{t("raidManage.raider.character")}</label>
                            <div className="em-chips">
                                {raider.characters.map((c) => (
                                    <button key={c.key} type="button" className={`em-chip${charKey === c.key ? " on" : ""}`} onClick={() => { setCharKey(c.key); setSpec(c.specs[0]?.key || ""); }}>
                                        {c.name}{c.main && <span className="em-sub">{t("raidManage.raider.main")}</span>}
                                    </button>
                                ))}
                                <button type="button" className={`em-chip${charKey === NEW ? " on" : ""}`} onClick={() => { setCharKey(NEW); setSpec(""); }}>
                                    {t("raidManage.raider.newChar")}
                                </button>
                            </div>
                        </div>

                        {charKey === NEW && (
                            <div className="em-fields">
                                <div className="field">
                                    <label htmlFor="em-raider-name">{t("raidManage.raider.name")}</label>
                                    <input id="em-raider-name" type="text" maxLength={24} value={newName} onChange={(e) => setNewName(e.target.value)} />
                                </div>
                                <div className="field">
                                    <label htmlFor="em-raider-class">{t("raidManage.raider.class")}</label>
                                    <select id="em-raider-class" value={classId} onChange={(e) => { setClassId(e.target.value); setSpec(""); }}>
                                        <option value="">{t("raidManage.raider.choose")}</option>
                                        {(candidates.classes || []).map((c) => <option key={c.id} value={c.id}>{classLabel(c.id, c.label)}</option>)}
                                    </select>
                                </div>
                            </div>
                        )}

                        {specs.length > 0 && (
                            <div className="field">
                                <label>{t("raidManage.raider.spec")}</label>
                                <div className="em-chips">
                                    {specs.map((s) => (
                                        <button key={s.key} type="button" className={`em-chip${spec === s.key ? " on" : ""}`} onClick={() => setSpec(s.key)}>
                                            {s.icon && <WowIcon name={s.icon} size={18} />}{specLabel(s.key, s.label)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="field">
                            <label>{t("raidManage.raider.status")}</label>
                            <Segment<SignupStatus>
                                size="sm" ariaLabel={t("raidManage.raider.status")} value={status} onChange={(s) => setStatus(s)}
                                options={orgaStatuses().map((s) => ({ value: s, label: SIGNUP_STATUS[s].label }))}
                            />
                        </div>
                    </>
                )}
            </form>
        </Modal>
    );
}
