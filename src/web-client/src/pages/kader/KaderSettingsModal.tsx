// A new Kader (just a name — the creator leads it), or the settings of one:
// name, leads (who votes in the Vorläufig step and may conduct interviews) and
// deleting it with everything in it.
import { useState } from "react";
import { createKader, deleteKader, updateKader, type KaderChange, type KaderView } from "../../api";
import { Button, IconButton, Modal } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { XIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { nameOf } from "../../lib/kader/model";

type Props = {
    mode: "create" | "edit";
    view: KaderView;
    onClose: () => void;
    run: <T>(call: Promise<T>) => Promise<T | null>;
    onCreated?: (kaderId: string) => void;
    onDeleted?: () => void;
};

export default function KaderSettingsModal({ mode, view, onClose, run, onCreated, onDeleted }: Props) {
    const t = useT();
    const ask = useConfirm();
    const kader = mode === "edit" ? view.kader : null;
    const [name, setName] = useState(kader ? kader.name : "");
    const [leads, setLeads] = useState<string[]>(kader ? kader.leads : []);
    const [pick, setPick] = useState("");
    const candidates = view.members.filter((m) => !leads.includes(m.userId)).sort((a, b) => a.displayName.localeCompare(b.displayName));
    const ready = !!name.trim() && (mode === "create" || leads.length > 0);

    const submit = async () => {
        if (!ready) return;
        if (mode === "create") {
            const change = await run<KaderChange>(createKader(name.trim()));
            if (change && change.kaderId && onCreated) onCreated(change.kaderId);
            return;
        }
        if (!kader) return;
        const change = await run(updateKader(kader.id, { name: name.trim(), leads }));
        if (change) onClose();
    };

    const remove = async () => {
        if (!kader) return;
        const n = Object.keys(kader.players).length;
        if (!(await ask({ title: t("kader.settings.deleteTitle", { name: kader.name }), text: t("kader.settings.deleteText", { n }), action: t("common.delete"), tone: "danger" }))) return;
        if (await run(deleteKader(kader.id)) && onDeleted) onDeleted();
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="kader"
            title={mode === "create" ? t("kader.settings.createTitle") : t("kader.settings.title")}
            width={520}
            initialFocus="input"
            hint={mode === "create" ? t("kader.settings.createHint") : undefined}
            footer={(
                <>
                    {kader && <button type="button" className="kp-link kp-danger kp-footleft" onClick={() => void remove()}>{t("kader.settings.delete")}</button>}
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!ready} onClick={() => void submit()}>{mode === "create" ? t("kader.settings.create") : t("common.save")}</Button>
                </>
            )}
        >
            <label className="field">
                <span className="field-label">{t("kader.field.name")}</span>
                <input value={name} maxLength={40} placeholder={t("kader.settings.namePlaceholder")} onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
            </label>
            {kader && (
                <div className="field">
                    <span className="field-label">{t("kader.settings.leads")}</span>
                    <ul className="kp-leadlist">
                        {leads.map((id) => (
                            <li key={id}>
                                <span className="kp-grow">{nameOf(view, id)}</span>
                                <IconButton icon={<XIcon />} size="sm" tip={t("kader.settings.removeLead", { name: nameOf(view, id) })} disabled={leads.length <= 1} onClick={() => setLeads(leads.filter((x) => x !== id))} />
                            </li>
                        ))}
                    </ul>
                    <div className="kp-inline">
                        <select aria-label={t("kader.settings.addLead")} value={pick} onChange={(e) => setPick(e.target.value)}>
                            <option value="">{t("kader.settings.pickLead")}</option>
                            {candidates.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
                        </select>
                        <Button variant="ghost" size="sm" disabled={!pick} onClick={() => { setLeads([...leads, pick]); setPick(""); }}>{t("common.add")}</Button>
                    </div>
                    <span className="kp-hint">{t("kader.settings.leadsHint")}</span>
                </div>
            )}
        </Modal>
    );
}
