// One item's settings (the row's slider button): the reserve that always stays
// in the bank, the most one request may ask for, the waiting list's portion
// per turn (− / +, 1–99: whoever is on gets at most that many, the rest
// queues again at the end) and the orga's own category.
// Saved together; the server checks the numbers again.
import { useState } from "react";
import type { GuildBankItem, GuildBankItemPatch } from "../../api";
import { Button, Field, Modal } from "../../components/ui";
import { MinusIcon, PlusIcon } from "../../components/ui/icons";
import { useT } from "../../i18n";
import { itemName, PORTION_MAX, PORTION_MIN, validPortion, wholeNumber } from "./bankView";

/**
 * The portion as a number with − / + beside it. A half-typed number ("" on the
 * way to "12") stays in the field and is only handed over once it is valid;
 * leaving the field shows the value that counts again.
 */
function PortionStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
    const t = useT();
    const [typing, setTyping] = useState<string | null>(null);
    const step = (by: number) => {
        setTyping(null);
        onChange(Math.min(PORTION_MAX, Math.max(PORTION_MIN, value + by)));
    };
    return (
        <div className="gb-stepper" role="group" aria-label={t("guildbank.dialog.portion")}>
            <button type="button" aria-label={t("guildbank.dialog.portionLess")} disabled={value <= PORTION_MIN} onClick={() => step(-1)}><MinusIcon /></button>
            <input id="gb-portion" type="number" inputMode="numeric" min={PORTION_MIN} max={PORTION_MAX} step={1}
                value={typing ?? String(value)}
                onChange={(e) => {
                    const text = e.target.value;
                    setTyping(text);
                    if (text !== "" && validPortion(Number(text))) onChange(Number(text));
                }}
                onBlur={() => setTyping(null)} />
            <button type="button" aria-label={t("guildbank.dialog.portionMore")} disabled={value >= PORTION_MAX} onClick={() => step(1)}><PlusIcon /></button>
        </div>
    );
}

export default function ItemSettingsDialog({ item, saving, onClose, onSave }: {
    item: GuildBankItem;
    saving: boolean;
    onClose: () => void;
    onSave: (patch: GuildBankItemPatch) => void;
}) {
    const t = useT();
    const [reserve, setReserve] = useState(String(item.reserve));
    const [max, setMax] = useState(String(item.maxPerRequest));
    const [portion, setPortion] = useState(item.portion);
    const [category, setCategory] = useState(item.category);
    const reserveN = wholeNumber(reserve);
    const maxN = wholeNumber(max);
    const invalid = reserveN === null || maxN === null;
    const wowheadGroup = item.autoGroup;

    const save = () => {
        if (reserveN === null || maxN === null) return;
        onSave({ reserve: reserveN, maxPerRequest: maxN, portion, category: category.trim() });
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon={item.icon || "inv_misc_questionmark"}
            tone="bank"
            kicker={t("guildbank.dialog.kicker")}
            title={itemName(item)}
            width={520}
            initialFocus="#gb-reserve"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button onClick={save} disabled={invalid || saving}>{saving ? t("common.saving") : t("common.save")}</Button>
                </>
            )}
        >
            <form className="gb-fields" onSubmit={(e) => { e.preventDefault(); save(); }}>
                <Field label={t("guildbank.dialog.reserve")} htmlFor="gb-reserve" tip={t("guildbank.dialog.reserve")} tipSub={t("guildbank.dialog.reserveTip")}
                    error={reserveN === null ? t("guildbank.dialog.wholeNumber") : undefined}>
                    <input id="gb-reserve" inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value)} />
                </Field>
                <Field label={t("guildbank.dialog.max")} htmlFor="gb-max" tip={t("guildbank.dialog.max")} tipSub={t("guildbank.dialog.maxTip")}
                    error={maxN === null ? t("guildbank.dialog.wholeNumber") : undefined}>
                    <input id="gb-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
                </Field>
                <Field className="field gb-wide" label={t("guildbank.dialog.portion")} htmlFor="gb-portion" tip={t("guildbank.dialog.portion")} tipSub={t("guildbank.dialog.portionTip")}
                    hint={t("guildbank.dialog.portionHint")}>
                    <PortionStepper value={portion} onChange={setPortion} />
                </Field>
                <Field className="field gb-wide" label={t("guildbank.dialog.category")} htmlFor="gb-category" tip={t("guildbank.dialog.category")} tipSub={t("guildbank.dialog.categoryTip")}>
                    <input
                        id="gb-category"
                        maxLength={40}
                        value={category}
                        placeholder={wowheadGroup ? t("guildbank.dialog.categoryPlaceholder", { group: wowheadGroup }) : t("guildbank.dialog.categoryPlaceholderNone")}
                        onChange={(e) => setCategory(e.target.value)}
                    />
                </Field>
                {/* Enter in a field saves */}
                <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </form>
        </Modal>
    );
}
