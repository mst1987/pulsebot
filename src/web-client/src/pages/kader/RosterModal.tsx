// Create or edit a roster: a name and a size (quick picks 10/20/25/40 or any
// number from 5 to 40), and when editing the target number per role (the
// server fills them from the size). Deleting a roster is behind a confirmation.
import { useState } from "react";
import { createKaderRoster, deleteKaderRoster, updateKaderRoster, type KaderRole } from "../../api";
import { Button, Chip, Modal } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { useT } from "../../i18n";
import { rolePluralLabel } from "../../lib/wowNames";
import { ROLES } from "../../lib/kader/model";
import { useKader } from "./kaderContext";
import { RoleIcon } from "./parts";

const QUICK_SIZES = [10, 20, 25, 40];
const SIZE_MIN = 5;
const SIZE_MAX = 40;

export default function RosterModal({ mode, onClose }: { mode: "new" | "edit"; onClose: () => void }) {
    const t = useT();
    const ask = useConfirm();
    const { roster, run, selectRoster } = useKader();
    const editing = mode === "edit" && roster ? roster : null;
    const [name, setName] = useState(editing ? editing.name : "");
    const [sizeText, setSizeText] = useState(String(editing ? editing.size : 20));
    const [targets, setTargets] = useState<Record<KaderRole, number>>(editing ? editing.targets : { tank: 0, healer: 0, melee: 0, ranged: 0 });
    const size = Number(sizeText);
    const sizeOk = Number.isInteger(size) && size >= SIZE_MIN && size <= SIZE_MAX;
    const sum = ROLES.reduce((s, r) => s + (Number(targets[r]) || 0), 0);
    const ready = !!name.trim() && sizeOk;

    const submit = async () => {
        if (!ready) return;
        const changedTargets = editing ? ROLES.some((r) => targets[r] !== editing.targets[r]) : false;
        const next = await run(editing
            ? updateKaderRoster(editing.id, { name: name.trim(), size, ...(changedTargets ? { targets } : {}) })
            : createKaderRoster({ name: name.trim(), size }));
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
            width={520}
            initialFocus="input"
            footer={(
                <>
                    {editing && <button type="button" className="kp-link kp-danger kp-footleft" onClick={() => void remove()}>{t("kader.roster.delete")}</button>}
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!ready} onClick={() => void submit()}>{editing ? t("common.save") : t("kader.roster.create")}</Button>
                </>
            )}
        >
            <label className="field">
                <span className="field-label">{t("kader.field.name")}</span>
                <input value={name} maxLength={40} placeholder={t("kader.roster.namePlaceholder")} onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
            </label>
            <div className="field">
                <span className="field-label" id="kp-size-label">{t("kader.roster.size")}</span>
                <div className="kp-sizerow">
                    <div className="chip-row" role="group" aria-labelledby="kp-size-label">
                        {QUICK_SIZES.map((s) => <Chip key={s} pressed={size === s} onClick={() => setSizeText(String(s))}>{t("kader.roster.sizeN", { n: s })}</Chip>)}
                    </div>
                    <input className="kp-sizeinput" type="number" min={SIZE_MIN} max={SIZE_MAX} aria-labelledby="kp-size-label" value={sizeText} onChange={(e) => setSizeText(e.target.value)} />
                </div>
                {!sizeOk && <span className="field-error">{t("kader.roster.sizeRule", { min: SIZE_MIN, max: SIZE_MAX })}</span>}
                {sizeOk && <span className="kp-hint">{t("kader.roster.sizeHint", { groups: Math.ceil(size / 5) })}</span>}
            </div>
            {editing && (
                <>
                    <div className="kicker">{t("kader.roster.targets", { sum, size: sizeOk ? size : editing.size })}</div>
                    <div className="kp-four">
                        {ROLES.map((r) => (
                            <label key={r} className="field">
                                <span className="field-label kp-iconlabel"><RoleIcon role={r} size={16} />{rolePluralLabel(r)}</span>
                                <input type="number" min={0} max={40} value={targets[r]} onChange={(e) => setTargets({ ...targets, [r]: Number(e.target.value) })} />
                            </label>
                        ))}
                    </div>
                </>
            )}
        </Modal>
    );
}
