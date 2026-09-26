// "Softres": create a list on softres.it (instances as tiles, amount, faction,
// login switch, hard reserves), enter a link to an existing one, or post the
// list into the event channel once there is one.
import { useCallback, useMemo, useState } from "react";
import {
    createSoftres, linkSoftres, postRaidSoftres, searchSoftresItems,
    type ApiError, type ItemSearchResult, type SoftresCatalogueGroup,
} from "../../../api";
import { useDraftState } from "../../../lib/persistedState";
import { itemQualityProps } from "../../../lib/itemQuality";
import { messageLink } from "../../../lib/discordLinks";
import { Modal } from "../../../components/ui/Modal";
import { Button, IconButton } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Segment from "../../../components/ui/Segment";
import WowIcon from "../../../components/ui/WowIcon";
import ItemSearchPicker from "../../../components/ItemSearchPicker";
import { ExternalIcon, XIcon } from "../../../components/icons";
import { useToast } from "../../../components/Jobs";
import { useT } from "../../../i18n";
import { INSTANCE_ICONS, type RaidCtx } from "../meta";

type Mode = "create" | "link" | "post";

// What the create form holds. Codes are an array, not a Set: the draft
// round-trips through JSON.
type HardReserve = { id: number; name: string; iconUrl?: string; quality?: number | null };
type SoftresDraft = {
    codes: string[];
    amount: number;
    faction: "Horde" | "Alliance";
    hardReserves: HardReserve[];
    protection: boolean;
};

// A softres list is single-edition: checking an instance of another edition
// drops the others.
function editionMap(catalogue: SoftresCatalogueGroup[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const g of catalogue) for (const i of g.instances) m.set(i.code, g.edition);
    return m;
}

export default function SoftresModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId, onChanged } = ctx;
    const { softresCatalogue, softresSuggested, softresEdition, eventSoftres: so, event: ev } = data;
    const toast = useToast();
    const [mode, setMode] = useState<Mode>(so?.url ? "post" : "create");
    const [busy, setBusy] = useState(false);

    // Draft per event: picking instances and searching hard reserves is real work.
    // User Protection (login to reserve) is the default for a new list.
    const [draft, patch, clearDraft] = useDraftState<SoftresDraft>(`raid-softres:${eventId}`, {
        codes: softresSuggested || [], amount: 1, faction: "Horde", hardReserves: [], protection: true,
    });
    const selected = useMemo(() => new Set(draft.codes), [draft.codes]);
    const codeEdition = useMemo(() => editionMap(softresCatalogue), [softresCatalogue]);
    const currentEdition = useMemo(() => {
        for (const code of selected) {
            const ed = codeEdition.get(code);
            if (ed) return ed;
        }
        return softresEdition || softresCatalogue[0]?.edition || "tbc";
    }, [selected, codeEdition, softresEdition, softresCatalogue]);

    const [softresUrl, setSoftresUrl] = useState(so?.url || "");
    const [softresEditUrl, setSoftresEditUrl] = useState(so?.editUrl || "");
    const [message, setMessage] = useState(so?.postedMessage || "");

    const search = useCallback((q: string) => searchSoftresItems(currentEdition, q), [currentEdition]);

    const toggle = (code: string, edition: string) => {
        const next = new Set(selected);
        if (next.has(code)) next.delete(code);
        else {
            for (const c of next) if (codeEdition.get(c) !== edition) next.delete(c);
            next.add(code);
        }
        patch({ codes: [...next] });
    };
    const addHardReserve = (it: ItemSearchResult) => {
        if (draft.hardReserves.some((x) => x.id === it.id)) return;
        patch({ hardReserves: [...draft.hardReserves, { id: it.id, name: it.name, iconUrl: it.iconUrl, quality: it.quality }] });
    };

    const run = async (fn: () => Promise<{ message: string }>, after?: () => void) => {
        setBusy(true);
        try {
            const r = await fn();
            after?.();
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const create = (e: React.FormEvent) => {
        e.preventDefault();
        run(() => createSoftres({
            event: eventId, instanceCodes: [...selected], amount: draft.amount, faction: draft.faction,
            hardReserves: draft.hardReserves.map(({ id, name }) => ({ id, name })), hideReserves: false, protection: draft.protection,
        }), () => { clearDraft(); setMode("post"); });
    };
    const saveLink = (e: React.FormEvent) => {
        e.preventDefault();
        run(() => linkSoftres({ event: eventId, softresUrl, softresEditUrl }), () => setMode("post"));
    };
    const post = (e: React.FormEvent) => {
        e.preventDefault();
        run(() => postRaidSoftres({ event: eventId, message }));
    };

    const posted = !!(so?.postedChannelId && so?.postedMessageId);
    const channel = ev.channelName || ev.channelId;
    const modes = [
        ...(so?.url ? [{ value: "post" as Mode, label: t("raidModals.softres.modePost") }] : []),
        { value: "create" as Mode, label: so?.url ? t("raidModals.softres.modeRecreate") : t("raidModals.softres.modeCreate") },
        { value: "link" as Mode, label: t("raidModals.softres.modeLink") },
    ];

    const footer = (
        <>
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            {mode === "create" && <Button type="submit" form="rd-softres-form" icon="inv_misc_ticket_tarot_madness" running={busy} disabled={!selected.size}>{t("raidModals.softres.create")}</Button>}
            {mode === "link" && <Button type="submit" form="rd-softres-form" running={busy}>{t("raidModals.softres.saveLink")}</Button>}
            {mode === "post" && <Button type="submit" form="rd-softres-form" icon="inv_letter_15" running={busy}>{posted ? t("raidModals.shared.updateMessage") : t("raidModals.softres.postChannel")}</Button>}
        </>
    );

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_ticket_tarot_madness" tone={so?.url ? "ok" : "mid"}
            kicker={ev.title} title={mode === "create" ? t("raidModals.softres.titleCreate") : mode === "link" ? t("raidModals.softres.titleLink") : t("raidModals.softres.titlePost")}
            width={640} footer={footer}
            hint={mode === "post" && channel ? t("raidModals.shared.inChannel", { channel }) : undefined}
        >
            <div className="rd-dlg-stack">
                <Segment<Mode> ariaLabel="Softres" size="sm" value={mode} onChange={setMode} options={modes} />

                {mode === "create" && (
                    <form id="rd-softres-form" className="rd-form" onSubmit={create}>
                        <div className="field">
                            <label className="tipped" data-tip={t("raidModals.softres.instancesTip")} data-tip-sub={t("raidModals.softres.instancesTipSub")}>
                                {t("raidModals.softres.instancesLabel")}{!!softresSuggested.length && <Badge tone="accent">{t("raidModals.softres.fromTitle")}</Badge>}
                            </label>
                            {softresCatalogue.map((g) => (
                                <div key={g.edition} className="rd-checks rd-checks-2">
                                    {g.instances.map((i) => (
                                        <label key={i.code} className={`rd-check${selected.has(i.code) ? " on" : ""}`}>
                                            <input type="checkbox" checked={selected.has(i.code)} onChange={() => toggle(i.code, g.edition)} />
                                            <WowIcon name={INSTANCE_ICONS[i.code] || "inv_misc_questionmark"} size={20} />
                                            {i.name}
                                        </label>
                                    ))}
                                </div>
                            ))}
                        </div>
                        <div className="rd-grid3">
                            <div className="field">
                                <label htmlFor="rd-softres-amount">{t("raidModals.softres.amount")}</label>
                                <input
                                    id="rd-softres-amount" type="number" min={1} max={6} value={draft.amount}
                                    onChange={(e) => patch({ amount: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })}
                                />
                            </div>
                            <div className="field">
                                <label>{t("raidModals.softres.faction")}</label>
                                <Segment<"Horde" | "Alliance">
                                    ariaLabel={t("raidModals.softres.faction")} value={draft.faction} onChange={(v) => patch({ faction: v })}
                                    options={[{ value: "Horde", label: "Horde" }, { value: "Alliance", label: "Alliance" }]}
                                />
                            </div>
                            <div className="field">
                                <label className="tipped" data-tip="User Protection" data-tip-sub={t("raidModals.softres.protectionTipSub")}>
                                    {t("raidModals.softres.protectionLabel")}
                                </label>
                                <label className="rd-switch">
                                    <input type="checkbox" checked={draft.protection} onChange={(e) => patch({ protection: e.target.checked })} />
                                    <span className="rd-switch-track" aria-hidden="true" />
                                    {draft.protection ? t("raidModals.softres.on") : t("raidModals.softres.off")}
                                </label>
                            </div>
                        </div>
                        <div className="field">
                            <label className="tipped" data-tip={t("raidModals.softres.hardTip")} data-tip-sub={t("raidModals.softres.hardTipSub")}>
                                {t("raidModals.softres.hardLabel")} <span className="rd-muted">{t("raidModals.shared.optional")}</span>
                            </label>
                            <ItemSearchPicker search={search} onPick={addHardReserve} placeholder={t("raidModals.softres.itemSearch")} />
                            {draft.hardReserves.length > 0 && (
                                <div className="rd-chips rd-chips-flat">
                                    {draft.hardReserves.map((hr) => (
                                        <span key={hr.id} className="rd-chip">
                                            {hr.iconUrl ? <img src={hr.iconUrl} alt="" loading="lazy" /> : null}
                                            <span {...itemQualityProps(hr.quality)}>{hr.name}</span>
                                            <IconButton
                                                size="sm" icon={<XIcon />} tip={t("raidModals.softres.remove")} className="rd-chip-x"
                                                onClick={() => patch({ hardReserves: draft.hardReserves.filter((x) => x.id !== hr.id) })}
                                            />
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </form>
                )}

                {mode === "link" && (
                    <form id="rd-softres-form" className="rd-form" onSubmit={saveLink}>
                        <div className="field">
                            <label htmlFor="rd-softres-url">{t("raidModals.softres.viewUrl")}</label>
                            <input id="rd-softres-url" type="url" value={softresUrl} onChange={(e) => setSoftresUrl(e.target.value)} placeholder="https://softres.it/raid/..." required />
                        </div>
                        <div className="field">
                            <label htmlFor="rd-softres-edit">{t("raidModals.softres.editUrl")} <span className="rd-muted">{t("raidModals.shared.optional")}</span></label>
                            <input id="rd-softres-edit" type="url" value={softresEditUrl} onChange={(e) => setSoftresEditUrl(e.target.value)} placeholder="https://softres.it/raid/...?adminToken=..." />
                        </div>
                    </form>
                )}

                {mode === "post" && so?.url && (
                    <form id="rd-softres-form" className="rd-form" onSubmit={post}>
                        <div className="rd-sheetrow">
                            <WowIcon name="inv_misc_ticket_tarot_madness" size={24} />
                            <span className="rd-sheetrow-text">
                                <b>{t("raidModals.softres.instances", { count: (so.instances || []).length })} · {t("raidModals.softres.perPlayer", { count: so.amount || 1 })}</b>
                                <span className="rd-muted">{so.hardReserveCount ? t("raidModals.softres.hardCount", { count: so.hardReserveCount }) : t("raidModals.softres.noHard")}</span>
                            </span>
                            {posted ? <Badge tone="ok">{t("raidModals.shared.posted")}</Badge> : <Badge tone="mid">{t("raidModals.shared.notPosted")}</Badge>}
                            <a className="ibtn sm" href={so.url} target="_blank" rel="noopener noreferrer" data-tip={t("raidModals.softres.viewList")} aria-label={t("raidModals.softres.viewList")}><ExternalIcon /></a>
                            {so.editUrl && <a className="ibtn sm" href={so.editUrl} target="_blank" rel="noopener noreferrer" data-tip={t("raidModals.softres.editList")} data-tip-sub={t("raidModals.softres.editListSub")} aria-label={t("raidModals.softres.editList")}><WowIcon name="inv_misc_note_01" size={20} /></a>}
                        </div>
                        <div className="field">
                            <label htmlFor="rd-softres-msg">{t("raidModals.shared.message")} <span className="rd-muted">{t("raidModals.shared.optional")}</span></label>
                            <input id="rd-softres-msg" type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("raidModals.softres.messagePlaceholder")} />
                        </div>
                        {posted && so.postedChannelId && so.postedMessageId && (
                            <a className="mlink rd-small" href={messageLink(data.guildId, so.postedChannelId, so.postedMessageId)} target="_blank" rel="noopener noreferrer">{t("raidModals.shared.openPosted")}</a>
                        )}
                    </form>
                )}
            </div>
        </Modal>
    );
}
