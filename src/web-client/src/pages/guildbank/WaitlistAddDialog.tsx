// "Eintrag anlegen" (#775): one entry onto an item's waiting list — a name
// (a raider's character, else the character alone), an offered item, the
// amount with − / +. Opened from the Warteliste tab; answers the new list.
import { useState } from "react";
import { addGuildBankWaiting, type ApiError, type GuildBankItem, type GuildBankWaitlist } from "../../api";
import { Button, Field, Modal, WowIcon } from "../../components/ui";
import { MinusIcon, PlusIcon } from "../../components/ui/icons/icons";
import { useToast } from "../../components/shell/Jobs";
import { useT } from "../../i18n";
import { WAITLIST_ICON, itemName, waitlistItems } from "./bankView";

const AMOUNT_MAX = 9999;

/** − / + around a whole number (no free typing needed). */
function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
    const t = useT();
    return (
        <div className="gb-stepper" role="group" aria-label={label}>
            <button type="button" aria-label={t("guildbank.waitlist.less")} disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}><MinusIcon /></button>
            <b aria-live="polite">{value}</b>
            <button type="button" aria-label={t("guildbank.waitlist.more")} disabled={value >= AMOUNT_MAX} onClick={() => onChange(Math.min(AMOUNT_MAX, value + 1))}><PlusIcon /></button>
        </div>
    );
}

export default function WaitlistAddDialog({ bankKey, items, onClose, onDone }: {
    bankKey: string;
    items: GuildBankItem[];
    onClose: () => void;
    onDone: (r: GuildBankWaitlist) => void;
}) {
    const t = useT();
    const toast = useToast();
    const offered = waitlistItems(items);
    const [name, setName] = useState("");
    const [itemId, setItemId] = useState(0);
    const [amount, setAmount] = useState(1);
    const [saving, setSaving] = useState(false);
    const save = async () => {
        if (!name.trim() || !itemId) return;
        setSaving(true);
        try {
            const r = await addGuildBankWaiting(bankKey, { name: name.trim(), itemId, amount });
            toast(t("guildbank.waitlist.added", { name: name.trim() }), "ok");
            onDone(r);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };
    return (
        <Modal
            open
            onClose={onClose}
            icon={<WowIcon name={WAITLIST_ICON} size={22} />}
            tone="bank"
            kicker={t("guildbank.waitlist.title")}
            title={t("guildbank.waitlist.viewAdd")}
            width={560}
            footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            {!offered.length
                ? <div className="empty">{t("guildbank.waitlist.noItems")}</div>
                : (
                    <form className="gb-fields" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                        <Field className="field gb-wide" label={t("guildbank.waitlist.name")} htmlFor="gb-wl-name" tip={t("guildbank.waitlist.name")} tipSub={t("guildbank.waitlist.nameHint")}>
                            <input id="gb-wl-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
                        </Field>
                        <Field label={t("guildbank.waitlist.item")} htmlFor="gb-wl-item">
                            <select id="gb-wl-item" value={itemId || ""} onChange={(e) => setItemId(Number(e.target.value) || 0)}>
                                <option value="">{t("guildbank.waitlist.pickItem")}</option>
                                {offered.map((it) => <option key={it.itemId} value={it.itemId}>{itemName(it)}</option>)}
                            </select>
                        </Field>
                        <Field label={t("guildbank.waitlist.count")}>
                            <Stepper value={amount} onChange={setAmount} label={t("guildbank.waitlist.count")} />
                        </Field>
                        <div className="gb-wide gb-wl-submit">
                            <Button type="submit" icon={<PlusIcon />} disabled={saving || !name.trim() || !itemId}>{t("guildbank.waitlist.add")}</Button>
                        </div>
                    </form>
                )}
        </Modal>
    );
}
