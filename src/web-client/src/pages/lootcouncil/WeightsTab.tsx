// "Gewichtung" (#668): how the council weighs. Four sections, one question each:
//   Item-Gewichte  — what one item counts as, per class (Trinket 2,0 …)
//   Ausnahmen      — single items with their own weight (the item search adds one)
//   Bedarf         — how the four parts of the need score weigh against each other
//   Zugehörigkeit  — after how many days belonging counts in full
// Everything is −/+ steppers, nothing is typed. One primary action (Speichern);
// "Auf Vorgaben zurücksetzen" only fills the form with the defaults, so nothing
// changes before it is saved. A reader sees the same page without the controls.
//
// With a raid category picked, a switch says whether that category weighs on
// its own or follows the server's weighting (stores/councilWeightsStore.js).
import { useMemo, useState, type ReactNode } from "react";
import {
    getCouncilWeights, resetCouncilWeights, saveCouncilWeights, searchCouncilItems,
    type CouncilWeightSettings, type CouncilWeightsData, type ItemSearchResult, type NeedShares,
} from "../../api";
import { AsyncView, Badge, Button, Switch, WowIcon, useConfirm } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { MinusIcon, PlusIcon, XIcon } from "../../components/ui/icons";
import ItemSearchPicker from "../../components/loot/ItemSearchPicker";
import RaidLoader from "../../components/ui/RaidLoader";
import { useJobs, useToast } from "../../components/shell/Jobs";
import { useT } from "../../i18n";
import { ItemLink } from "./ItemBits";
import { Part } from "./Part";
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

/** A copy to edit, so the stored answer stays untouched until it is saved. */
const clone = (s: CouncilWeightSettings): CouncilWeightSettings => ({
    classes: { ...s.classes },
    items: Object.fromEntries(Object.entries(s.items || {}).map(([id, e]) => [id, { ...e }])),
    need: { ...s.need },
    tenureDays: s.tenureDays,
});
const same = (a: CouncilWeightSettings, b: CouncilWeightSettings) => JSON.stringify(clone(a)) === JSON.stringify(clone(b));
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
function Section({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
    return (
        <section className="lc-wsec">
            <h3>{title}</h3>
            <p className="lc-muted">{sub}</p>
            {children}
        </section>
    );
}

type TabProps = {
    /** The picked raid category ("" = all). */
    category: string;
    categoryName: string;
    canWrite: boolean;
    /** After a save the council's numbers change — the page reloads them. */
    onSaved: () => void;
};

/** Loads the weighting for the picked scope; the form starts over with every fresh answer. */
export function WeightsTab(props: TabProps) {
    const t = useT();
    const weights = useApi(() => getCouncilWeights(props.category), [props.category]);
    return (
        <AsyncView state={weights} loading={<RaidLoader text={t("lootcouncil.weights.loading")} />}>
            {(data) => (
                <WeightsForm
                    key={`${props.category}:${data.global.at || 0}:${data.own ? data.own.at || 0 : "-"}`}
                    {...props}
                    data={data}
                    onStored={(fresh) => weights.setData(fresh)}
                />
            )}
        </AsyncView>
    );
}

function WeightsForm({ category, categoryName, canWrite, onSaved, data, onStored }: TabProps & {
    data: CouncilWeightsData;
    /** The stored answer after a save — replaces the loaded one (and so restarts this form). */
    onStored: (fresh: CouncilWeightsData) => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const jobs = useJobs();
    const toast = useToast();
    const [draft, setDraft] = useState<CouncilWeightSettings>(() => clone(data.own || data.global));
    // With a category: does it weigh on its own (true) or follow the server's?
    const [own, setOwn] = useState(!!data.own);
    const [saving, setSaving] = useState(false);
    // Icons and names of items added in this session (the server knows the stored ones).
    const [picked, setPicked] = useState<Record<string, { name: string; iconUrl: string; quality: number | null }>>({});

    const stored = own && data.own ? data.own : !own ? data.global : null;
    const dirty = useMemo(() => {
        if (category && own !== !!data.own) return true;
        return !stored || !same(draft, stored);
    }, [data, draft, own, stored, category]);

    const ro = !canWrite;
    const limits = data.limits;
    const needSum = data.needIds.reduce((n, id) => n + (draft.need[id] || 0), 0) || 1;
    const patch = (next: Partial<CouncilWeightSettings>) => setDraft((d) => (d ? { ...d, ...next } : d));
    const setClass = (id: ClassId, v: number) => patch({ classes: { ...draft.classes, [id]: v } });
    const setNeed = (id: NeedId, v: number) => patch({ need: { ...draft.need, [id]: v } });
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

    const onOwn = (next: boolean) => {
        setOwn(next);
        // Switching a category to its own weighting starts from what it follows now.
        setDraft(clone(next ? (data.own || data.global) : data.global));
    };

    const save = async () => {
        setSaving(true);
        try {
            const result = await jobs.run({ label: t("lootcouncil.weights.saving"), quiet: true }, async () => {
                if (category && !own) {
                    // back to the server's weighting: drop the category's own, and
                    // store the server's only when it was changed here
                    if (data.own) await resetCouncilWeights(category);
                    return same(draft, data.global) ? getCouncilWeights(category) : saveCouncilWeights("", draft);
                }
                return saveCouncilWeights(category && own ? category : "", draft);
            });
            if (!result) return;
            toast(t("lootcouncil.weights.saved"));
            onSaved();
            onStored(category ? await getCouncilWeights(category) : result);
        } finally {
            setSaving(false);
        }
    };

    const toDefaults = async () => {
        const ok = await ask({
            title: t("lootcouncil.weights.resetTitle"),
            text: t("lootcouncil.weights.resetText"),
            action: t("lootcouncil.weights.reset"),
            icon: "spell_holy_borrowedtime",
        });
        if (ok) setDraft(clone(data.defaults));
    };

    const scopeLabel = category && own
        ? t("lootcouncil.weights.scopeOwn", { name: categoryName })
        : t("lootcouncil.weights.scopeGlobal");
    const items = Object.entries(draft.items);
    const info = (id: string) => data.itemInfo[id] || picked[id] || { name: draft.items[id]?.name || "", iconUrl: "", quality: null };

    return (
        <Part
            icon="inv_misc_coin_17"
            title={t("lootcouncil.weights.title")}
            hint={t("lootcouncil.weights.hint")}
            actions={<Badge tone={category && own ? "accent" : undefined}>{scopeLabel}</Badge>}
        >
            <div className="lc-weights">
                {category ? (
                    <Switch
                        checked={own}
                        disabled={ro}
                        onChange={onOwn}
                        label={t("lootcouncil.weights.ownSwitch", { name: categoryName })}
                        tip={t("lootcouncil.weights.ownSwitchTip")}
                    />
                ) : null}
                {ro ? <Badge tone="mid">{t("lootcouncil.weights.readOnly")}</Badge> : null}

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
                                onChange={(v) => setClass(id, v)}
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
                                onChange={(v) => setNeed(id, v)}
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

                {!ro ? (
                    <div className="lc-wfoot">
                        <Button variant="ghost" onClick={toDefaults}>{t("lootcouncil.weights.reset")}</Button>
                        <span className="lc-grow" />
                        {dirty ? <span className="lc-muted">{t("lootcouncil.weights.unsaved")}</span> : null}
                        <Button icon="inv_misc_note_01" running={saving} disabled={!dirty} onClick={save}>{t("lootcouncil.weights.save")}</Button>
                    </div>
                ) : null}
            </div>
        </Part>
    );
}
