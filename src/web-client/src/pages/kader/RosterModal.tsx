// Create or edit a roster: name, Forever instance, size, and (when editing)
// the target number per role. Deleting a roster is behind a confirmation.
import { useState } from "react";
import { createKaderRoster, deleteKaderRoster, updateKaderRoster, type KaderRole } from "../../api";
import { Button, Modal } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { useT } from "../../i18n";
import { rolePluralLabel } from "../../lib/wowNames";
import { ROLES } from "../../lib/kader/model";
import { useKader } from "./kaderContext";

export default function RosterModal({ mode, onClose }: { mode: "new" | "edit"; onClose: () => void }) {
    const t = useT();
    const ask = useConfirm();
    const { view, roster, run, selectRoster } = useKader();
    const editing = mode === "edit" && roster ? roster : null;
    const [name, setName] = useState(editing ? editing.name : "");
    const [instanceId, setInstanceId] = useState(editing ? editing.instanceId : (view.instances[0] ? view.instances[0].id : ""));
    const instance = view.instances.find((i) => i.id === instanceId);
    const [size, setSize] = useState(editing ? editing.size : (instance ? instance.defaultSize : 20));
    const [targets, setTargets] = useState<Record<KaderRole, number>>(editing ? editing.targets : { tank: 0, healer: 0, melee: 0, ranged: 0 });
    const sum = ROLES.reduce((s, r) => s + (Number(targets[r]) || 0), 0);

    const pickInstance = (id: string) => {
        setInstanceId(id);
        const inst = view.instances.find((i) => i.id === id);
        if (inst && inst.sizes.length && !inst.sizes.includes(size)) setSize(inst.defaultSize);
    };

    const submit = async () => {
        const changedTargets = editing ? ROLES.some((r) => targets[r] !== editing.targets[r]) : false;
        const next = await run(editing
            ? updateKaderRoster(editing.id, { name, instanceId, size, ...(changedTargets ? { targets } : {}) })
            : createKaderRoster({ name: name.trim() || undefined, instanceId, size }));
        if (!next) return;
        if (next.rosterId) selectRoster(next.rosterId);
        onClose();
    };

    const remove = async () => {
        if (!editing) return;
        if (!(await ask({ title: t("kader.roster.deleteTitle", { name: editing.name }), text: t("kader.roster.deleteText"), action: t("common.delete"), tone: "danger" }))) return;
        if (await run(deleteKaderRoster(editing.id))) onClose();
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_groupneedmore"
            tone="kader"
            title={editing ? t("kader.roster.edit") : t("kader.roster.new")}
            width={560}
            footer={(
                <>
                    {editing && <button type="button" className="kp-link kp-danger kp-footleft" onClick={() => void remove()}>{t("kader.roster.delete")}</button>}
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!instanceId || (!!editing && !name.trim())} onClick={() => void submit()}>{editing ? t("common.save") : t("kader.roster.create")}</Button>
                </>
            )}
        >
            <label className="field">
                <span className="field-label">{t("kader.field.name")}</span>
                <input value={name} maxLength={40} placeholder={editing ? "" : t("kader.roster.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="kp-two">
                <label className="field">
                    <span className="field-label">{t("kader.roster.instance")}</span>
                    <select value={instanceId} onChange={(e) => pickInstance(e.target.value)}>
                        {view.instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                </label>
                <label className="field">
                    <span className="field-label">{t("kader.roster.size")}</span>
                    <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
                        {(instance && instance.sizes.length ? instance.sizes : [size]).map((s) => <option key={s} value={s}>{t("kader.roster.sizeN", { n: s })}</option>)}
                    </select>
                </label>
            </div>
            {editing && (
                <>
                    <div className="kicker">{t("kader.roster.targets", { sum, size })}</div>
                    <div className="kp-four">
                        {ROLES.map((r) => (
                            <label key={r} className="field">
                                <span className="field-label">{rolePluralLabel(r)}</span>
                                <input type="number" min={0} max={40} value={targets[r]} onChange={(e) => setTargets({ ...targets, [r]: Number(e.target.value) })} />
                            </label>
                        ))}
                    </div>
                </>
            )}
        </Modal>
    );
}
