// "Loot hinzufügen": import an addon export (Gargul/RCLootcouncil) or enter one
// award by hand. The hand entry picks the item from the raid's own drop table
// (never a free search) and the raider from the characters the app knows, the
// same rules as ManualLootForm on the history page — laid out as a dialog body.
import { useEffect, useMemo, useRef, useState } from "react";
import {
    addLootItem, getLootPicker, importLoot,
    type ApiError, type LootPickerData, type RaidDropItem,
} from "../../../api";
import { fmtMs } from "../../../lib/format";
import { itemQualityProps } from "../../../lib/itemQuality";
import { useDraftState } from "../../../lib/persistedState";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Segment from "../../../components/ui/Segment";
import { SearchIcon } from "../../../components/icons";
import { useToast } from "../../../components/Jobs";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

type Mode = "import" | "manual";
type Tool = "auto" | "gargul" | "rclc";

const norm = (s: string) => s.trim().toLowerCase();

// `datetime-local` wants local "YYYY-MM-DDTHH:mm", which toISOString() is not.
function toLocalInput(ms: number): string {
    const d = new Date(ms || Date.now());
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ImportForm({ ctx, onDone, setBusy }: { ctx: RaidCtx; onDone: () => void; setBusy: (b: boolean) => void }) {
    const t = useT();
    const { data, eventId, csrfToken, onChanged } = ctx;
    const toast = useToast();
    // Draft per event: a pasted export belongs to exactly this raid.
    const [draft, patch] = useDraftState(`raid-loot-import:${eventId}`, { tool: (data.lootTool || "auto") as string, text: "" });
    const fileRef = useRef<HTMLInputElement>(null);

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => patch({ text: String(reader.result || "") });
        reader.readAsText(file);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await importLoot(csrfToken, { data: draft.text, tool: draft.tool, event: eventId, manualLabel: "" });
            patch({ text: "" });
            if (fileRef.current) fileRef.current.value = "";
            onDone();
            onChanged(r.skipped ? t("raidModals.lootAdd.importedSkipped", { added: r.added, skipped: r.skipped }) : t("raidModals.lootAdd.imported", { added: r.added }));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form id="rd-loot-form" className="rd-form" onSubmit={submit}>
            <div className="field">
                <label className="tipped" data-tip={t("raidModals.lootAdd.toolTip")} data-tip-sub={t("raidModals.lootAdd.toolTipSub")}>{t("raidModals.lootAdd.toolLabel")}</label>
                <Segment<Tool>
                    ariaLabel={t("raidModals.lootAdd.toolLabel")} value={(["auto", "gargul", "rclc"].includes(draft.tool) ? draft.tool : "auto") as Tool} onChange={(v) => patch({ tool: v })}
                    options={[{ value: "auto", label: "Auto" }, { value: "gargul", label: "Gargul" }, { value: "rclc", label: "RCLootcouncil" }]}
                />
            </div>
            <div className="field">
                <label htmlFor="rd-loot-text">{t("raidModals.lootAdd.exportLabel")}</label>
                <textarea id="rd-loot-text" value={draft.text} onChange={(e) => patch({ text: e.target.value })} rows={7} placeholder={t("raidModals.lootAdd.exportPlaceholder")} required />
            </div>
            <div className="field">
                <label htmlFor="rd-loot-file" className="tipped" data-tip={t("raidModals.lootAdd.fileTip")} data-tip-sub={t("raidModals.lootAdd.fileTipSub")}>{t("raidModals.lootAdd.fileLabel")}</label>
                <input id="rd-loot-file" ref={fileRef} type="file" accept=".json,.csv,.txt,.tsv" onChange={onFile} />
            </div>
        </form>
    );
}

function ManualForm({ ctx, setBusy, setHint }: { ctx: RaidCtx; setBusy: (b: boolean) => void; setHint: (h: string) => void }) {
    const t = useT();
    const { data, eventId, csrfToken, onChanged } = ctx;
    const toast = useToast();
    const [picker, setPicker] = useState<LootPickerData | null>(null);
    const [loadError, setLoadError] = useState("");
    const [contentId, setContentId] = useState("");
    const [boss, setBoss] = useState("");
    const [query, setQuery] = useState("");
    const [item, setItem] = useState<RaidDropItem | null>(null);
    const [character, setCharacter] = useState("");
    const [response, setResponse] = useState("");
    const [awardedAt, setAwardedAt] = useState(() => toLocalInput((data.event.startTime || 0) * 1000 || Date.now()));

    // Loaded when this half of the dialog is first shown, not with the page.
    useEffect(() => {
        if (picker) return;
        getLootPicker(eventId, data.event.title)
            .then((p) => {
                setPicker(p);
                setContentId(p.suggested[0] || p.contents[0]?.id || "");
                setResponse((p.reasons.find((r) => r.id === "mainspec") || p.reasons[0])?.label || "");
            })
            .catch((err: ApiError) => setLoadError(err.message));
    }, [picker, eventId, data.event.title]);

    useEffect(() => { setHint(awardedAt ? t("raidModals.lootAdd.timeHint", { time: fmtMs(new Date(awardedAt).getTime()) }) : ""); }, [awardedAt, setHint, t]);

    const roster = useMemo(() => [
        ...(data.setup?.groups || []).flatMap((g) => g.players.map((p) => p.name)),
        ...data.attendance.responded.map((p) => p.character || "").filter(Boolean),
    ], [data]);
    const inRaid = useMemo(() => new Set(roster.map(norm)), [roster]);
    const names = useMemo(() => {
        const known = picker?.characters.map((c) => c.character) || [];
        const all = [...new Set([...roster, ...known])];
        return all.sort((a, b) => Number(!inRaid.has(norm(a))) - Number(!inRaid.has(norm(b))) || a.localeCompare(b, "de"));
    }, [picker, roster, inRaid]);

    const content = picker?.contents.find((c) => c.id === contentId) || null;
    const bosses = useMemo(() => [...new Set((content?.items || []).map((it) => it.boss))], [content]);
    const items = useMemo(() => {
        const q = norm(query);
        return (content?.items || []).filter((it) => (!boss || it.boss === boss) && (!q || norm(it.name).includes(q) || String(it.id) === q));
    }, [content, boss, query]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!item || !character.trim()) return;
        setBusy(true);
        try {
            const reason = picker?.reasons.find((r) => r.label === response) || null;
            const r = await addLootItem(csrfToken, {
                event: eventId, itemId: item.id, character: character.trim(), boss: item.boss, instance: content?.label || "",
                response, offspec: reason?.id === "offspec", awardedAt: awardedAt ? new Date(awardedAt).getTime() : 0,
            });
            onChanged(t("raidModals.lootAdd.added", { item: r.item.itemName || item.name, character: character.trim() }));
            // Raid, boss and time stay: nachtragen comes in batches.
            setItem(null);
            setCharacter("");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    if (loadError) return <p className="rd-empty">{t("raidModals.lootAdd.loadError", { error: loadError })}</p>;
    if (!picker) return <p className="rd-empty">{t("raidModals.lootAdd.loading")}</p>;

    return (
        <form id="rd-loot-form" className="rd-form" onSubmit={submit}>
            <div className="rd-grid2">
                <div className="field">
                    <label htmlFor="rd-add-raid" className="tipped" data-tip={t("raidModals.lootAdd.raid")} data-tip-sub={t("raidModals.lootAdd.raidTipSub")}>{t("raidModals.lootAdd.raid")}</label>
                    <select id="rd-add-raid" value={contentId} onChange={(e) => { setContentId(e.target.value); setBoss(""); setItem(null); }}>
                        {picker.contents.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="rd-add-boss">{t("raidModals.lootAdd.boss")}</label>
                    <select id="rd-add-boss" value={boss} onChange={(e) => { setBoss(e.target.value); setItem(null); }}>
                        <option value="">{t("raidModals.lootAdd.allBosses")}</option>
                        {bosses.map((b) => <option key={b || "none"} value={b}>{b || t("raidModals.lootAdd.noBoss")}</option>)}
                    </select>
                </div>
            </div>
            <div className="field">
                <label>{t("raidModals.lootAdd.item")} <span className="rd-muted">{t("raidModals.lootAdd.itemCount", { count: items.length })}</span></label>
                <label className="rd-search rd-search-full">
                    <SearchIcon />
                    <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("raidModals.lootAdd.searchPlaceholder")} aria-label={t("raidModals.lootAdd.searchAria")} />
                </label>
                <div className="rd-glist rd-itemlist" role="listbox" aria-label={t("raidModals.lootAdd.itemsAria")}>
                    {/* The whole drop table, never cut short: scrolling it is how
                        somebody who forgot an item's exact name finds it. */}
                    {items.map((it) => (
                        <button
                            type="button" key={it.id} role="option" aria-selected={item?.id === it.id}
                            className={`rd-itemopt${item?.id === it.id ? " on" : ""}`} onClick={() => setItem(it)}
                        >
                            <span className="rd-item">
                                {it.iconUrl ? <img src={it.iconUrl} alt="" loading="lazy" /> : <span className="rd-item-ph" />}
                                <span {...itemQualityProps(it.quality, "rd-item-name")}>{it.name}</span>
                            </span>
                            {item?.id === it.id ? <Badge tone="accent">{t("raidModals.lootAdd.picked")}</Badge> : <span className="rd-muted">{it.boss || "—"}</span>}
                        </button>
                    ))}
                </div>
            </div>
            <div className="rd-grid3">
                <div className="field">
                    <label htmlFor="rd-add-raider">{t("raidModals.lootAdd.raider")}</label>
                    <input id="rd-add-raider" type="text" list="rd-add-raiders" value={character} onChange={(e) => setCharacter(e.target.value)} placeholder={t("raidModals.lootAdd.characterPlaceholder")} autoComplete="off" required />
                    <datalist id="rd-add-raiders">
                        {names.map((n) => <option key={n} value={n}>{inRaid.has(norm(n)) ? t("raidModals.lootAdd.inRaid") : ""}</option>)}
                    </datalist>
                </div>
                <div className="field">
                    <label htmlFor="rd-add-reason">{t("raidModals.lootAdd.reason")}</label>
                    <select id="rd-add-reason" value={response} onChange={(e) => setResponse(e.target.value)}>
                        {picker.reasons.map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="rd-add-time" className="tipped" data-tip={t("raidModals.lootAdd.time")} data-tip-sub={t("raidModals.lootAdd.timeTipSub")}>{t("raidModals.lootAdd.time")}</label>
                    <input id="rd-add-time" type="datetime-local" value={awardedAt} onChange={(e) => setAwardedAt(e.target.value)} />
                </div>
            </div>
        </form>
    );
}

export default function LootAddModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const [mode, setMode] = useState<Mode>("import");
    const [busy, setBusy] = useState(false);
    const [hint, setHint] = useState("");

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_bag_10" tone="history"
            kicker={ctx.data.event.title} title={t("raidModals.lootAdd.title")} width={660}
            hint={mode === "manual" ? hint : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{mode === "manual" ? t("common.close") : t("common.cancel")}</Button>
                    <Button type="submit" form="rd-loot-form" icon="inv_misc_bag_10" running={busy}>{mode === "import" ? t("raidModals.lootAdd.import") : t("raidModals.lootAdd.addItem")}</Button>
                </>
            )}
        >
            <div className="rd-dlg-stack">
                <Segment<Mode>
                    ariaLabel={t("raidModals.lootAdd.modeAria")} size="sm" value={mode} onChange={setMode}
                    options={[{ value: "import", label: t("raidModals.lootAdd.modeImport") }, { value: "manual", label: t("raidModals.lootAdd.modeManual") }]}
                />
                {mode === "import"
                    ? <ImportForm ctx={ctx} onDone={onClose} setBusy={setBusy} />
                    : <ManualForm ctx={ctx} setBusy={setBusy} setHint={setHint} />}
            </div>
        </Modal>
    );
}
