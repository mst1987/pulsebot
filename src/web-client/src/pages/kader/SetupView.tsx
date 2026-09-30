// The group setup of one roster (/kader/setup/:rosterId): the roster split into
// groups of five, in variants (A, B, …). Drag a player onto a slot, or click
// a player and then a slot; whoever sits there swaps places. Each group names
// the party buffs it has and the important ones it misses. "Automatisch
// verteilen" gives a start, "Als Text kopieren" the groups for Discord.
import { useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import {
    addKaderVariant, autoKaderVariant, deleteKaderVariant, saveKaderVariant,
    type KaderPlayer, type KaderRole, type KaderRoster, type KaderVariant,
} from "../../api";
import { Button, IconButton, Modal } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { CopyIcon, EditIcon, PlusIcon, TrashIcon, XIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { useT } from "../../i18n";
import { usePersistedState } from "../../lib/persistedState";
import { rolePluralLabel } from "../../lib/wowNames";
import { activeOf, className, colorOf, focusOf, groupHints, moveToSlot, removeFromGroups, specName, unassigned, type Groups } from "../../lib/kader/model";
import { setupText } from "../../lib/kader/setupText";
import { useKader } from "./kaderContext";
import { dragProps, useDropZone } from "./dnd";
import { CharName, ClassBar, PlayerIcon, SubHead } from "./parts";

function GroupSlot({ player, index, picked, onPick, onDropUser }: {
    player: KaderPlayer | null;
    index: number;
    picked: boolean;
    onPick: () => void;
    onDropUser: (userId: string) => void;
}) {
    const t = useT();
    const { view, canWrite } = useKader();
    const drop = useDropZone(onDropUser, canWrite);
    if (!player) {
        return (
            <button type="button" className={`kp-slot kp-free kp-thin${drop.over ? " kp-over" : ""}`} disabled={!canWrite} onClick={onPick} aria-label={t("kader.setup.freeSlot", { n: index + 1 })} {...drop.props}>
                {t("kader.setup.free")}
            </button>
        );
    }
    return (
        <button
            type="button"
            className={`kp-slot kp-thin${picked ? " kp-picked" : ""}${drop.over ? " kp-over" : ""}`}
            aria-pressed={picked}
            disabled={!canWrite}
            onClick={onPick}
            {...dragProps(player.userId, canWrite)}
            {...drop.props}
        >
            <ClassBar color={colorOf(view.classes, player)} small />
            <PlayerIcon player={player} size={18} />
            <CharName player={player} className="kp-slot-name kp-grow" />
        </button>
    );
}

function GroupCard({ index, ids, picked, onPick, onDropAt, roles }: {
    index: number;
    ids: (string | null)[];
    picked: string | null;
    onPick: (userId: string | null, gi: number, si: number) => void;
    onDropAt: (userId: string, gi: number, si: number) => void;
    roles: Map<string, KaderRole>;
}) {
    const t = useT();
    const { view, players } = useKader();
    // the important party buffs by name; the rest a group brings as one "+n" with the names in its tooltip
    const hints = groupHints(ids, players, view.buffs.party);
    const shown = hints.filter((h) => h.important);
    const more = hints.filter((h) => !h.important);
    const focus = focusOf(ids, roles);
    return (
        <div className="kp-panel kp-group">
            <div className="kp-panel-head">
                <h3>{t("kader.setup.group", { n: index + 1 })}</h3>
                <span className="kp-mono kp-muted">{focus === "empty" || focus === "mixed" ? t(`kader.setup.focus.${focus}`) : rolePluralLabel(focus)}</span>
            </div>
            {ids.map((id, si) => (
                <GroupSlot
                    key={si}
                    index={si}
                    player={id ? players.get(id) || null : null}
                    picked={!!id && id === picked}
                    onPick={() => onPick(id, index, si)}
                    onDropUser={(userId) => onDropAt(userId, index, si)}
                />
            ))}
            {hints.length > 0 && (
                <div className="kp-hints">
                    {shown.map((h) => <span key={h.key} className={`kp-hintchip${h.ok ? " kp-ok" : " kp-miss"}`}>{h.ok ? h.label : t("kader.setup.missing", { buff: h.label })}</span>)}
                    {more.length > 0 && <span className="kp-hintchip" data-tip={more.map((h) => h.label).join(", ")}>{t("kader.setup.moreBuffs", { n: more.length })}</span>}
                </div>
            )}
        </div>
    );
}

function VariantBody({ roster, variants, variant, setVariantId }: {
    roster: KaderRoster;
    variants: KaderVariant[];
    variant: KaderVariant;
    setVariantId: (id: string) => void;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { view, players, run, open, canWrite } = useKader();
    const [picked, setPicked] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [text, setText] = useState<string | null>(null);
    const roles = useMemo(() => new Map(roster.members.map((m) => [m.userId, m.role])), [roster]);

    const save = (groups: Groups) => run(saveKaderVariant(roster.id, variant.id, { groups }));
    const rest = unassigned(roster, variant);
    const pickedInGroup = picked ? variant.groups.some((g) => g.includes(picked)) : false;

    const onPickSlot = (id: string | null, gi: number, si: number) => {
        if (picked && picked !== id) {
            void save(moveToSlot(variant.groups, picked, gi, si));
            setPicked(null);
        } else {
            setPicked(id && id !== picked ? id : null);
        }
    };
    const onDropAt = (userId: string, gi: number, si: number) => {
        void save(moveToSlot(variant.groups, userId, gi, si));
        setPicked(null);
    };
    const restDrop = useDropZone((userId) => void save(removeFromGroups(variant.groups, userId)), canWrite);

    const copy = async () => {
        const out = setupText({ variant, roster, players, classes: view.classes });
        try {
            await navigator.clipboard.writeText(out);
            toast(t("kader.setup.copied"));
        } catch {
            setText(out);
        }
    };

    const addVariant = async (copyFrom?: string) => {
        const next = await run(addKaderVariant(roster.id, copyFrom ? { copyFrom, name: t("kader.setup.copyName", { name: variant.name }) } : {}));
        if (next && next.variantId) setVariantId(next.variantId);
    };
    const removeVariant = async () => {
        if (!(await ask({ title: t("kader.setup.deleteTitle", { name: variant.name }), action: t("common.delete"), tone: "danger" }))) return;
        await run(deleteKaderVariant(roster.id, variant.id));
    };

    return (
        <>
            <SubHead kicker={t("kader.setup.kicker", { size: roster.size })} title={roster.name}>
                <Button variant="ghost" disabled={!canWrite || !roster.members.length} onClick={() => { setPicked(null); void run(autoKaderVariant(roster.id, variant.id)); }}>{t("kader.setup.auto")}</Button>
                <Button icon={<CopyIcon />} onClick={() => void copy()}>{t("kader.setup.copy")}</Button>
            </SubHead>
            <div className="kp-variants" role="tablist" aria-label={t("kader.setup.variants")}>
                {variants.map((v) => (
                    <button key={v.id} type="button" role="tab" aria-selected={v.id === variant.id} className={`kp-vtab${v.id === variant.id ? " kp-active" : ""}`} onClick={() => { setVariantId(v.id); setPicked(null); }}>{v.name}</button>
                ))}
                {canWrite && (
                    <>
                        <IconButton icon={<PlusIcon />} size="sm" tip={t("kader.setup.addVariant")} disabled={variants.length >= 6} onClick={() => void addVariant()} />
                        <IconButton icon={<CopyIcon />} size="sm" tip={t("kader.setup.copyVariant")} disabled={variants.length >= 6} onClick={() => void addVariant(variant.id)} />
                        <IconButton icon={<EditIcon />} size="sm" tip={t("kader.setup.rename")} onClick={() => setRenaming(variant.name)} />
                        <IconButton icon={<TrashIcon />} size="sm" tone="danger" tip={t("kader.setup.deleteVariant")} disabled={variants.length <= 1} onClick={() => void removeVariant()} />
                    </>
                )}
            </div>
            <div className="kp-setup">
                <section className={`kp-panel kp-rest${restDrop.over ? " kp-over" : ""}`} {...restDrop.props}>
                    <div className="kp-panel-head">
                        <h2>{t("kader.setup.withoutGroup")}</h2>
                        <span className="kp-mono kp-muted">{rest.length}</span>
                    </div>
                    {rest.length === 0 && <span className="kp-hint">{roster.members.length ? t("kader.setup.allPlaced") : t("kader.setup.emptyRoster")}</span>}
                    {rest.map((id) => {
                        const p = players.get(id);
                        if (!p) return null;
                        const a = activeOf(p);
                        return (
                            <button key={id} type="button" className={`kp-slot${picked === id ? " kp-picked" : ""}`} aria-pressed={picked === id} disabled={!canWrite}
                                {...dragProps(id, canWrite)} onClick={() => setPicked(picked === id ? null : id)} onDoubleClick={() => open({ type: "account", userId: id })}>
                                <ClassBar color={colorOf(view.classes, p)} small />
                                <PlayerIcon player={p} size={18} />
                                <span className="kp-slot-text">
                                    <CharName player={p} className="kp-slot-name" />
                                    <span className="kp-sub">{a ? specName(view.classes, a.mainSpec) || className(view.classes, a.className) : t("kader.player.noChar")}</span>
                                </span>
                            </button>
                        );
                    })}
                    {pickedInGroup && picked && (
                        <Button variant="ghost" size="sm" icon={<XIcon />} onClick={() => { void save(removeFromGroups(variant.groups, picked)); setPicked(null); }}>{t("kader.setup.takeOut")}</Button>
                    )}
                    <div className="kicker kp-gap">{t("kader.bench.title")}</div>
                    <div className="kp-benchlist">
                        {roster.bench.length === 0 && <span className="kp-hint">{t("kader.setup.benchEmpty")}</span>}
                        {roster.bench.map((id) => {
                            const p = players.get(id);
                            return p ? <CharName key={id} player={p} /> : null;
                        })}
                    </div>
                    <p className="kp-hint kp-gap">{picked ? t("kader.setup.pickHint") : t("kader.setup.hint")}</p>
                </section>
                <section className="kp-groups">
                    {variant.groups.map((ids, gi) => <GroupCard key={gi} index={gi} ids={ids} picked={picked} onPick={onPickSlot} onDropAt={onDropAt} roles={roles} />)}
                </section>
            </div>
            <NameModal
                open={renaming !== null}
                initial={renaming || ""}
                onClose={() => setRenaming(null)}
                onSave={(name) => { setRenaming(null); void run(saveKaderVariant(roster.id, variant.id, { name })); }}
            />
            <Modal
                open={text !== null}
                onClose={() => setText(null)}
                title={t("kader.setup.textTitle")}
                width={560}
                hint={t("kader.setup.textHint")}
                footer={<Button onClick={() => setText(null)}>{t("common.close")}</Button>}
            >
                <textarea className="kp-textarea" readOnly rows={14} value={text || ""} onFocus={(e) => e.currentTarget.select()} />
            </Modal>
        </>
    );
}

function NameModal({ open, initial, onSave, onClose }: { open: boolean; initial: string; onSave: (name: string) => void; onClose: () => void }) {
    const t = useT();
    const [name, setName] = useState(initial);
    const [seen, setSeen] = useState(initial);
    if (initial !== seen) {
        setSeen(initial);
        setName(initial);
    }
    const ok = name.trim().length > 0;
    return (
        <Modal
            open={open}
            onClose={onClose}
            title={t("kader.setup.rename")}
            width={420}
            initialFocus="input"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button disabled={!ok} onClick={() => onSave(name.trim())}>{t("common.save")}</Button>
                </>
            )}
        >
            <label className="field">
                <span className="field-label">{t("kader.field.name")}</span>
                <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && ok) onSave(name.trim()); }} />
            </label>
        </Modal>
    );
}

export default function SetupView() {
    const t = useT();
    const { rosterId = "" } = useParams();
    const { view } = useKader();
    const roster = view.rosters.find((r) => r.id === rosterId) || null;
    const variants = roster ? view.setups[roster.id]?.variants || [] : [];
    const [variantId, setVariantId] = usePersistedState<string>(`kader-variant-${rosterId}`, "");
    const variant = variants.find((v) => v.id === variantId) || variants[0];

    if (!roster) return view.rosters.length ? <Navigate to="/kader" replace /> : <div className="kp-empty">{t("kader.setup.noRoster")}</div>;
    if (!variant) return <div className="kp-empty">{t("kader.setup.noRoster")}</div>;
    return <VariantBody roster={roster} variants={variants} variant={variant} setVariantId={setVariantId} />;
}
