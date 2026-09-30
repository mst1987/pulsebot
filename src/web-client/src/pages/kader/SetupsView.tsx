// Beispiel-Setups (/kader/<id>/setups): try out groups of five in the meeting,
// in variants (A, B, …), as a 10er (two groups) or a 20er (four) — switching the
// size keeps groups 3 and 4 as they are. The players come from the roster and
// the provisional roster, bench and tentative can be added. Drag a player onto a
// slot, or click the player and then the slot; whoever sits there swaps places.
// The spec of a slot is one of the player's wishes, picked from its spec icons
// (WishPicker); the class colour, role counts and buff hints follow it. Each
// group names the party buffs it has and the important ones it misses. A setup
// never changes a state.
import { useState } from "react";
import {
    addKaderVariant, autoKaderVariant, deleteKaderVariant, saveKaderVariant,
    type KaderSlot, type KaderState, type KaderVariant,
} from "../../api";
import { Button, Field, IconButton, Modal } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { BoltIcon, CheckIcon, CopyIcon, EditIcon, PlusIcon, RosterIcon, SaveIcon, TrashIcon, XIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { useT } from "../../i18n";
import { usePersistedState } from "../../lib/persistedState";
import { rolePluralLabel } from "../../lib/wowNames";
import { classColor, classOfSpec, playerName, ROLES, SETUP_STATES } from "../../lib/kader/model";
import {
    GROUP_SIZE, defaultSpec, groupHints, moveToSlot, placedIds, removeFromGroups, setSlotSpec, setupText, slotRoles, unplaced, visibleGroups, type Groups,
} from "../../lib/kader/setup";
import { classColorProps } from "../../components/ClassSpec";
import { dragProps, useDropZone } from "./dnd";
import { Count, EmptyState, PickIcon, RoleIcon, StateIcon, SubHead, WishIcons } from "./parts";
import WishPicker from "./WishPicker";
import { useKader } from "./kaderContext";

const DEFAULT_SOURCES: KaderState[] = ["roster", "provisional"];
const MAX_VARIANTS = 6;

/** The small dot of a player's state (Roster, Vorläufig, Bench, Tentative). */
function StateDot({ state }: { state: KaderState }) {
    const t = useT();
    const label = t(`kader.state.${state}`);
    return <span className={`kp-sdot kp-sdot-${state}`} role="img" aria-label={label} data-tip={label} />;
}

function Slot({ slot, gi, si, picked, onPick, onDropUser, onSpec }: {
    slot: KaderSlot;
    gi: number;
    si: number;
    picked: boolean;
    onPick: () => void;
    onDropUser: (userId: string) => void;
    onSpec: (spec: string) => void;
}) {
    const t = useT();
    const { view, kader, canWrite } = useKader();
    const drop = useDropZone(onDropUser, canWrite);
    if (!slot) {
        return (
            <button type="button" className={`kp-slot kp-free${drop.over ? " kp-over" : ""}`} disabled={!canWrite} onClick={onPick}
                aria-label={t("kader.setups.freeSlot", { group: gi + 1, n: si + 1 })} {...drop.props}>
                {t("kader.setups.free")}
            </button>
        );
    }
    const entry = kader.players[slot.userId];
    const name = playerName(view, slot.userId, entry);
    const color = classColorProps(classColor(view.classes, classOfSpec(slot.spec)));
    return (
        <div className={`kp-slot${picked ? " kp-picked" : ""}${drop.over ? " kp-over" : ""}`} {...drop.props}>
            {entry ? (
                <WishPicker entry={entry} value={slot.spec} compact disabled={!canWrite} label={t("kader.setups.specOf", { name })} onChange={(pick) => onSpec(pick.spec)} />
            ) : <PickIcon pick={slot.spec ? { className: classOfSpec(slot.spec), spec: slot.spec } : null} size={20} />}
            <button type="button" className="kp-slot-main" aria-pressed={picked} disabled={!canWrite} onClick={onPick} {...dragProps(slot.userId, canWrite)}>
                <span className={`kp-slot-name kp-grow${color.className ? ` ${color.className}` : ""}`} style={color.style}>{name}</span>
            </button>
            {entry && <StateDot state={entry.state} />}
        </div>
    );
}

function GroupCard({ variant, gi, picked, onPickSlot, onDropAt, onSpec }: {
    variant: KaderVariant;
    gi: number;
    picked: string | null;
    onPickSlot: (gi: number, si: number) => void;
    onDropAt: (userId: string, gi: number, si: number) => void;
    onSpec: (gi: number, si: number, spec: string) => void;
}) {
    const t = useT();
    const { view } = useKader();
    const slots = variant.groups[gi];
    const filled = slots.filter(Boolean).length;
    const hints = groupHints(slots, view.buffs.party);
    const shown = hints.filter((h) => h.important);
    const more = hints.filter((h) => !h.important);
    return (
        <div className="kp-panel kp-group">
            <div className="kp-between">
                <h3>{t("kader.setups.group", { n: gi + 1 })}</h3>
                <span className="kp-sub">{t("kader.setups.groupFill", { n: filled, max: GROUP_SIZE })}</span>
            </div>
            {slots.map((slot, si) => (
                <Slot key={si} slot={slot} gi={gi} si={si} picked={!!slot && slot.userId === picked}
                    onPick={() => onPickSlot(gi, si)} onDropUser={(userId) => onDropAt(userId, gi, si)} onSpec={(spec) => onSpec(gi, si, spec)} />
            ))}
            {(hints.length > 0 || filled === 0) && (
                <div className="kp-hints">
                    {filled === 0 && <span className="kp-hintchip">{t("kader.setups.emptyGroup")}</span>}
                    {shown.map((h) => <span key={h.key} className={`kp-hintchip${h.ok ? " kp-ok" : " kp-miss"}`}>{h.ok ? h.label : t("kader.setups.missing", { buff: h.label })}</span>)}
                    {more.length > 0 && <span className="kp-hintchip" data-tip={more.map((h) => h.label).join(", ")}>{t("kader.setups.moreBuffs", { n: more.length })}</span>}
                </div>
            )}
        </div>
    );
}

function NameModal({ initial, onSave, onClose }: { initial: string; onSave: (name: string) => void; onClose: () => void }) {
    const t = useT();
    const [name, setName] = useState(initial);
    const ok = name.trim().length > 0;
    return (
        <Modal
            open
            onClose={onClose}
            title={t("kader.setups.rename")}
            width={440}
            className="kp-dialog"
            initialFocus="input"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button icon={<SaveIcon />} disabled={!ok} onClick={() => onSave(name.trim())}>{t("common.save")}</Button>
                </>
            )}
        >
            <div className="kp-stack">
                <Field label={t("kader.field.name")} htmlFor="kp-variant-name">
                    <input id="kp-variant-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && ok) onSave(name.trim()); }} />
                </Field>
            </div>
        </Modal>
    );
}

export default function SetupsView() {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { view, kader, canWrite, run } = useKader();
    const [variantId, setVariantId] = usePersistedState<string>(`kader-variant-${kader.id}`, "");
    const [rawSources, setSources] = usePersistedState<KaderState[]>("kader-setup-sources", DEFAULT_SOURCES);
    const [picked, setPicked] = useState<string | null>(null);
    const [renaming, setRenaming] = useState(false);
    const [text, setText] = useState<string | null>(null);
    const variant = kader.setups.find((v) => v.id === variantId) || kader.setups[0];
    const sources = SETUP_STATES.filter((s) => Array.isArray(rawSources) && rawSources.includes(s));
    const counts = Object.fromEntries(SETUP_STATES.map((s) => [s, Object.values(kader.players).filter((e) => e.state === s).length])) as Record<KaderState, number>;
    // dropping a player on the list takes them out of the groups
    const restDrop = useDropZone((userId) => {
        if (variant) void run(saveKaderVariant(kader.id, variant.id, { groups: removeFromGroups(variant.groups, userId) }));
    }, canWrite);

    if (!variant) return <div className="kp-empty">{t("kader.setups.none")}</div>;
    const shownGroups = visibleGroups(variant);
    const rest = unplaced(view, kader, variant, sources);
    const placed = placedIds(variant).size;
    const roles = slotRoles(view.classes, variant);
    const pickedInGroup = !!picked && variant.groups.slice(0, shownGroups).some((g) => g.some((s) => s && s.userId === picked));

    const save = (groups: Groups) => run(saveKaderVariant(kader.id, variant.id, { groups }));
    const specFor = (userId: string) => {
        const e = kader.players[userId];
        return e ? defaultSpec(e) : "";
    };
    const onPickSlot = (gi: number, si: number) => {
        const slot = variant.groups[gi][si];
        if (picked && (!slot || slot.userId !== picked)) {
            void save(moveToSlot(variant.groups, picked, specFor(picked), gi, si));
            setPicked(null);
            return;
        }
        setPicked(slot && slot.userId !== picked ? slot.userId : null);
    };
    const onDropAt = (userId: string, gi: number, si: number) => {
        void save(moveToSlot(variant.groups, userId, specFor(userId), gi, si));
        setPicked(null);
    };

    const toggleSource = (s: KaderState) => setSources(sources.includes(s) ? sources.filter((x) => x !== s) : [...sources, s]);
    const setSize = (size: 10 | 20) => { if (size !== variant.size) void run(saveKaderVariant(kader.id, variant.id, { size })); };
    const auto = async () => {
        if (placed && !(await ask({ title: t("kader.setups.autoTitle"), text: t("kader.setups.autoText"), action: t("kader.setups.auto") }))) return;
        setPicked(null);
        await run(autoKaderVariant(kader.id, variant.id, sources));
    };
    const copy = async () => {
        const out = setupText({ view, kader, variant, sources });
        try {
            await navigator.clipboard.writeText(out);
            toast(t("kader.setups.copied"));
        } catch {
            setText(out);
        }
    };
    const addVariant = async (copyFrom?: string) => {
        const next = await run(addKaderVariant(kader.id, copyFrom ? { copyFrom, name: t("kader.setups.copyName", { name: variant.name }) } : {}));
        if (next && next.variantId) setVariantId(next.variantId);
    };
    const removeVariant = async () => {
        if (!(await ask({ title: t("kader.setups.deleteTitle", { name: variant.name }), action: t("common.delete"), tone: "danger" }))) return;
        await run(deleteKaderVariant(kader.id, variant.id));
    };

    return (
        <div className="kp-view">
            <SubHead back="roster" backLabel={t("kader.setups.back")} kicker={t("kader.setups.kicker")} title={t("kader.setups.title")}>
                <div className="kp-variants" role="tablist" aria-label={t("kader.setups.variants")}>
                    {kader.setups.map((v) => (
                        <button key={v.id} type="button" role="tab" aria-selected={v.id === variant.id} className={`kp-vtab${v.id === variant.id ? " kp-active" : ""}`}
                            onClick={() => { setVariantId(v.id); setPicked(null); }}>{v.name}</button>
                    ))}
                    {canWrite && <IconButton icon={<PlusIcon />} size="sm" tip={t("kader.setups.addVariant")} disabled={kader.setups.length >= MAX_VARIANTS} onClick={() => void addVariant()} />}
                </div>
                {canWrite && (
                    <span className="kp-inline">
                        <IconButton icon={<CopyIcon />} size="sm" tip={t("kader.setups.copyVariant")} disabled={kader.setups.length >= MAX_VARIANTS} onClick={() => void addVariant(variant.id)} />
                        <IconButton icon={<EditIcon />} size="sm" tip={t("kader.setups.rename")} onClick={() => setRenaming(true)} />
                        <IconButton icon={<TrashIcon />} size="sm" tone="danger" tip={t("kader.setups.deleteVariant")} disabled={kader.setups.length <= 1} onClick={() => void removeVariant()} />
                    </span>
                )}
                <span className="kp-grow" />
                <span className="kicker">{t("kader.setups.size")}</span>
                <div className="kp-sizes" role="group" aria-label={t("kader.setups.size")}>
                    {([10, 20] as const).map((size) => (
                        <button key={size} type="button" aria-pressed={variant.size === size} className={`kp-size${variant.size === size ? " kp-on" : ""}`} disabled={!canWrite} onClick={() => setSize(size)}>
                            {t("kader.setups.sizeN", { n: size })}
                        </button>
                    ))}
                </div>
                <Button variant="ghost" icon={<CopyIcon />} onClick={() => void copy()}>{t("kader.setups.copy")}</Button>
            </SubHead>
            <div className="kp-setup">
                <aside className={`kp-panel kp-rest${restDrop.over ? " kp-over" : ""}`} {...restDrop.props}>
                    <span className="kicker">{t("kader.setups.sources")}</span>
                    <div className="kp-sources">
                        {SETUP_STATES.map((s) => (
                            <button key={s} type="button" aria-pressed={sources.includes(s)} className={`kp-source-chip${sources.includes(s) ? " kp-on" : ""}`}
                                data-tip={t(`kader.nav.count.${s}`, { count: counts[s] })} onClick={() => toggleSource(s)}>
                                <StateIcon state={s} />{t(`kader.state.${s}`)}<span className="kp-mono">{counts[s]}</span>
                            </button>
                        ))}
                    </div>
                    <div className="kp-listhead kp-gap">
                        <h2>{t("kader.setups.withoutGroup")}</h2>
                        <Count n={rest.length} tip={t("kader.playersN", { count: rest.length })} />
                    </div>
                    {rest.length === 0 && (sources.some((s) => counts[s] > 0)
                        ? <EmptyState icon={<CheckIcon />} text={t("kader.setups.allPlaced")} />
                        : <EmptyState icon={<RosterIcon />} text={t("kader.setups.nobody")} />)}
                    {rest.map((id) => {
                        const entry = kader.players[id];
                        const spec = defaultSpec(entry);
                        const color = classColorProps(classColor(view.classes, classOfSpec(spec)));
                        return (
                            <button key={id} type="button" className={`kp-slot kp-restrow${picked === id ? " kp-picked" : ""}`} aria-pressed={picked === id} disabled={!canWrite}
                                {...dragProps(id, canWrite)} onClick={() => setPicked(picked === id ? null : id)}>
                                <PickIcon pick={spec ? { className: classOfSpec(spec), spec } : null} size={24} />
                                <span className="kp-col kp-grow">
                                    <span className={`kp-slot-name${color.className ? ` ${color.className}` : ""}`} style={color.style}>{playerName(view, id, entry)}</span>
                                    <WishIcons wishes={entry.wishes} size={16} />
                                </span>
                                <StateDot state={entry.state} />
                            </button>
                        );
                    })}
                    {pickedInGroup && picked && (
                        <Button variant="ghost" size="sm" icon={<XIcon />} onClick={() => { void save(removeFromGroups(variant.groups, picked)); setPicked(null); }}>{t("kader.setups.takeOut")}</Button>
                    )}
                    <span className="kp-grow" />
                    <p className="kp-note">{picked ? t("kader.setups.pickHint") : t("kader.setups.hint")}</p>
                </aside>
                <section className="kp-setup-main">
                    <div className="kp-setup-sum">
                        <span><b className="kp-mono kp-big-n">{placed}</b> {t("kader.setups.placedOf", { count: variant.size })}</span>
                        {ROLES.map((r) => (
                            <span key={r} className="kp-rolecount" data-tip={t("kader.roleCount", { role: rolePluralLabel(r), n: roles[r] })}>
                                <RoleIcon role={r} size={18} /><b className="kp-mono">{roles[r]}</b>
                            </span>
                        ))}
                        <span className="kp-grow" />
                        {canWrite && <Button variant="ghost" icon={<BoltIcon />} onClick={() => void auto()}>{t("kader.setups.auto")}</Button>}
                    </div>
                    <div className="kp-groups">
                        {variant.groups.slice(0, shownGroups).map((_, gi) => (
                            <GroupCard key={gi} variant={variant} gi={gi} picked={picked} onPickSlot={onPickSlot} onDropAt={onDropAt}
                                onSpec={(g, s, spec) => void save(setSlotSpec(variant.groups, g, s, spec))} />
                        ))}
                    </div>
                    {variant.size === 10 && variant.groups.slice(2).some((g) => g.some(Boolean)) && <p className="kp-hint">{t("kader.setups.hiddenGroups")}</p>}
                </section>
            </div>
            {renaming && <NameModal initial={variant.name} onClose={() => setRenaming(false)} onSave={(name) => { setRenaming(false); void run(saveKaderVariant(kader.id, variant.id, { name })); }} />}
            <Modal
                open={text !== null}
                onClose={() => setText(null)}
                title={t("kader.setups.textTitle")}
                width={560}
                className="kp-dialog"
                hint={t("kader.setups.textHint")}
                footer={<Button onClick={() => setText(null)}>{t("common.close")}</Button>}
            >
                <textarea className="kp-textarea" readOnly rows={14} aria-label={t("kader.setups.textTitle")} value={text || ""} onFocus={(e) => e.currentTarget.select()} />
            </Modal>
        </div>
    );
}
