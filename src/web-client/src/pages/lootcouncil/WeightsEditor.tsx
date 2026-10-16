// The weighting of a Loot-Council profile (#668, since #676 part of the
// "Profile" tab). Four sections, one question each:
//   Item-Gewichte  — what one item counts as, per class (Trinket 2,0 …)
//   Ausnahmen      — single items with their own weight (the item search adds one)
//   Bedarf         — how the four parts of the need score weigh against each other
//   Zugehörigkeit  — after how many days belonging counts in full
// Everything is −/+ steppers, nothing is typed. The editor only changes the
// draft it is handed; saving is the profile tab's one primary button. A reader
// sees the same sections without the controls.
import { useState, type ReactNode } from "react";
import { searchCouncilItems, type CouncilProfileData, type CouncilWeightSettings, type ItemSearchResult, type NeedShares } from "../../api";
import { Button, WowIcon } from "../../components/ui";
import { MinusIcon, PlusIcon, XIcon } from "../../components/ui/icons";
import ItemSearchPicker from "../../components/loot/ItemSearchPicker";
import { useT } from "../../i18n";
import { ItemLink } from "./ItemBits";
import { fmtPoints } from "./needWeights";

type ClassId = keyof CouncilWeightSettings["classes"];
type NeedId = keyof NeedShares;

const CLASS_ICONS: Record<ClassId, string> = {
    trinket: "inv_trinket_naxxramas04",
    bisWeapon: "inv_staff_53",
    weapon: "inv_sword_04",
    set: "inv_helmet_96",
    normal: "inv_chest_cloth_49",
    frequent: "inv_misc_bag_10",
};
const NEED_ICONS: Record<NeedId, string> = {
    drought: "inv_misc_pocketwatch_02",
    share: "inv_misc_bag_10",
    need: "inv_misc_gem_variety_02",
    tenure: "achievement_reputation_01",
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A number with − and +, spoken with its word ("2,0 Punkte"). */
export function WeightStepper({ label, icon, tip, value, text, step, min, max, disabled, onChange }: {
    label: string;
    icon?: string;
    tip?: string;
    value: number;
    /** The value with its word, as shown between the buttons. */
    text: ReactNode;
    step: number;
    min: number;
    max: number;
    disabled?: boolean;
    onChange: (next: number) => void;
}) {
    const t = useT();
    return (
        <div className="lc-wstep">
            <span className="lc-wstep-lbl" data-tip={tip ? label : undefined} data-tip-sub={tip}>
                {icon ? <WowIcon name={icon} size={22} /> : null}
                <span>{label}</span>
            </span>
            <div className="lc-wstep-ctl" role="group" aria-label={label}>
                <button type="button" aria-label={t("lootcouncil.weights.less", { label })} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, round1(value - step)))}><MinusIcon /></button>
                <b aria-live="polite">{text}</b>
                <button type="button" aria-label={t("lootcouncil.weights.more", { label })} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, round1(value + step)))}><PlusIcon /></button>
            </div>
        </div>
    );
}

/** One section of the form: a heading, a short line under it, the controls. */
export function Section({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
    return (
        <section className="lc-wsec">
            <h3>{title}</h3>
            <p className="lc-muted">{sub}</p>
            {children}
        </section>
    );
}

/** The four weighting sections over a draft; `onChange` gets the whole next draft. */
export function WeightsEditor({ draft, onChange, data, readOnly }: {
    draft: CouncilWeightSettings;
    onChange: (next: CouncilWeightSettings) => void;
    /** The profile answer: item info of the stored exceptions, ids and limits. */
    data: Pick<CouncilProfileData, "itemInfo" | "classIds" | "needIds" | "limits">;
    readOnly: boolean;
}) {
    const t = useT();
    // Icons and names of items added in this session (the server knows the stored ones).
    const [picked, setPicked] = useState<Record<string, { name: string; iconUrl: string; quality: number | null }>>({});
    const ro = readOnly;
    const limits = data.limits;
    const needSum = data.needIds.reduce((n, id) => n + (draft.need[id] || 0), 0) || 1;
    const patch = (next: Partial<CouncilWeightSettings>) => onChange({ ...draft, ...next });
    const setItem = (id: string, v: number) => patch({ items: { ...draft.items, [id]: { ...draft.items[id], weight: v } } });
    const removeItem = (id: string) => {
        const items = { ...draft.items };
        delete items[id];
        patch({ items });
    };
    const addItem = (item: ItemSearchResult) => {
        const id = String(item.id);
        if (draft.items[id]) return;
        setPicked((p) => ({ ...p, [id]: { name: item.name, iconUrl: item.iconUrl || "", quality: item.quality ?? null } }));
        patch({ items: { ...draft.items, [id]: { weight: 1, name: item.name } } });
    };
    const items = Object.entries(draft.items);
    const info = (id: string) => data.itemInfo[id] || picked[id] || { name: draft.items[id]?.name || "", iconUrl: "", quality: null };

    return (
        <>
            <Section title={t("lootcouncil.weights.classesTitle")} sub={t("lootcouncil.weights.classesSub")}>
                <div className="lc-wgrid">
                    {data.classIds.map((id) => (
                        <WeightStepper
                            key={id}
                            label={t(`lootcouncil.weights.class.${id}`)}
                            tip={t(`lootcouncil.weights.classTip.${id}`)}
                            icon={CLASS_ICONS[id]}
                            value={draft.classes[id]}
                            text={t("lootcouncil.weights.points", { count: draft.classes[id], points: fmtPoints(draft.classes[id]) })}
                            step={0.1}
                            min={0}
                            max={limits.weightMax}
                            disabled={ro}
                            onChange={(v) => patch({ classes: { ...draft.classes, [id]: v } })}
                        />
                    ))}
                </div>
            </Section>

            <Section title={t("lootcouncil.weights.itemsTitle")} sub={t("lootcouncil.weights.itemsSub")}>
                {items.length ? (
                    <div className="lc-wlist">
                        {items.map(([id, entry]) => {
                            const meta = info(id);
                            const auto = data.itemInfo[id]?.autoClass;
                            return (
                                <div key={id} className="lc-witem">
                                    <ItemLink id={Number(id)} name={meta.name || entry.name} iconUrl={meta.iconUrl} quality={meta.quality} />
                                    {auto && auto !== "override"
                                        ? <span className="lc-muted">{t("lootcouncil.weights.insteadOf", { cls: t(`lootcouncil.weights.class.${auto}`), points: fmtPoints(draft.classes[auto as ClassId]) })}</span>
                                        : <span />}
                                    <WeightStepper
                                        label={meta.name || entry.name || `Item ${id}`}
                                        value={entry.weight}
                                        text={t("lootcouncil.weights.points", { count: entry.weight, points: fmtPoints(entry.weight) })}
                                        step={0.1}
                                        min={0}
                                        max={limits.weightMax}
                                        disabled={ro}
                                        onChange={(v) => setItem(id, v)}
                                    />
                                    {!ro ? (
                                        <Button variant="ghost" size="sm" icon={<XIcon />} onClick={() => removeItem(id)} aria-label={t("lootcouncil.weights.removeItem", { name: meta.name || entry.name })}>
                                            {t("lootcouncil.weights.remove")}
                                        </Button>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="lc-muted lc-wempty">{t("lootcouncil.weights.noItems")}</div>
                )}
                {!ro && items.length < limits.items ? (
                    <div className="lc-wpicker">
                        <ItemSearchPicker search={searchCouncilItems} onPick={addItem} placeholder={t("lootcouncil.weights.searchItem")} />
                    </div>
                ) : null}
            </Section>

            <Section title={t("lootcouncil.weights.needTitle")} sub={t("lootcouncil.weights.needSub")}>
                <div className="lc-wgrid">
                    {data.needIds.map((id) => (
                        <WeightStepper
                            key={id}
                            label={t(`lootcouncil.weights.need.${id}`)}
                            tip={t(`lootcouncil.weights.needTip.${id}`)}
                            icon={NEED_ICONS[id]}
                            value={draft.need[id]}
                            text={t("lootcouncil.weights.share", { value: draft.need[id], pct: Math.round(((draft.need[id] || 0) / needSum) * 100) })}
                            step={5}
                            min={0}
                            max={limits.needMax}
                            disabled={ro}
                            onChange={(v) => patch({ need: { ...draft.need, [id]: v } })}
                        />
                    ))}
                </div>
            </Section>

            <Section title={t("lootcouncil.weights.tenureTitle")} sub={t("lootcouncil.weights.tenureSub")}>
                <div className="lc-wgrid">
                    <WeightStepper
                        label={t("lootcouncil.weights.tenureDays")}
                        tip={t("lootcouncil.weights.tenureDaysTip")}
                        icon={NEED_ICONS.tenure}
                        value={draft.tenureDays}
                        text={t("lootcouncil.word.daysCount", { count: draft.tenureDays })}
                        step={5}
                        min={limits.tenureMin}
                        max={limits.tenureMax}
                        disabled={ro}
                        onChange={(v) => patch({ tenureDays: v })}
                    />
                </div>
            </Section>
        </>
    );
}
