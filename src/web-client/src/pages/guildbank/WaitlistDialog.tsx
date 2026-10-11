// "Warteliste" (#775): every offered item has one per bank — whoever asked
// first is served first, and when stock comes free the first move up on their
// own as open requests (card in the orga channel, DM). A dialog of its own
// next to "Anfragen" (which stays read-only): three views behind a switch so
// each shows little at once —
//
//   Liste            per item: place, raider or character, amount, since when;
//                    forward / back / remove for the orga
//   Eintrag anlegen  a name (a raider's character, else the character alone),
//                    an offered item, the amount with − / +
//   Import           lines pasted from a sheet ("Name⇥Item⇥Anzahl", also ; or ,),
//                    a preview first (item found, raider matched), then import
//
// Reading takes "raids", every change "raids" write — without it only the list.
import { useState } from "react";
import {
    addGuildBankWaiting, getGuildBankWaitlist, importGuildBankWaitlist, moveGuildBankWaiting, previewGuildBankWaitlist, removeGuildBankWaiting,
    type ApiError, type GuildBankImportRow, type GuildBankItem, type GuildBankWaitingEntry, type GuildBankWaitlist,
} from "../../api";
import { Badge, Button, Field, IconButton, Modal, Segment, WowIcon, useConfirm } from "../../components/ui";
import { ChevronDownIcon, ChevronUpIcon, MinusIcon, PlusIcon, TrashIcon } from "../../components/ui/icons";
import { ItemIcon } from "../../components/loot/LootBadges";
import { useToast } from "../../components/shell/Jobs";
import { useApi } from "../../hooks/useApi";
import { formatDateTime } from "../../lib/format";
import { usePersistedState, useDraftState } from "../../lib/ui/persistedState";
import { useT } from "../../i18n";
import { WAITLIST_ICON, availableTone, groupWaitlist, itemName, waitingName, waitlistItems, type WaitlistGroup } from "./bankView";

type View = "list" | "add" | "import";
const VIEWS: View[] = ["list", "add", "import"];
const AMOUNT_MAX = 9999;

function EntryRow({ entry, first, last, canWrite, busy, onMove, onRemove }: {
    entry: GuildBankWaitingEntry;
    first: boolean;
    last: boolean;
    canWrite: boolean;
    busy: boolean;
    onMove: (entry: GuildBankWaitingEntry, direction: "up" | "down") => void;
    onRemove: (entry: GuildBankWaitingEntry) => void;
}) {
    const t = useT();
    const name = waitingName(entry);
    const sub = [
        // a raider's recipient character, when it is not the name shown already
        entry.characterName && entry.characterName !== name ? t("guildbank.requests.to", { name: entry.characterName }) : "",
        t("guildbank.waitlist.since", { date: formatDateTime(entry.createdAt) }),
        entry.addedByName ? t("guildbank.waitlist.addedBy", { name: entry.addedByName }) : "",
    ];
    return (
        <li className="gb-wl-row">
            <span className="gb-wl-place" aria-label={`#${entry.position}`}>{entry.position}</span>
            <div className="gb-req-text">
                <span className="gb-req-title">
                    {name}
                    {!entry.userId && <Badge size="sm" tip={t("guildbank.waitlist.noDiscord")} tipSub={t("guildbank.waitlist.noDiscordTip")}>{t("guildbank.waitlist.noDiscord")}</Badge>}
                </span>
                <span className="gb-req-sub">{sub.filter(Boolean).join(" · ")}</span>
            </div>
            <span className="gb-wl-amount">{t("guildbank.waitlist.amount", { amount: entry.amount })}</span>
            {canWrite && (
                <span className="gb-wl-actions">
                    <IconButton icon={<ChevronUpIcon />} size="sm" tip={t("guildbank.waitlist.up")} aria-label={`${t("guildbank.waitlist.up")}: ${name}`}
                        disabled={busy || first} onClick={() => onMove(entry, "up")} />
                    <IconButton icon={<ChevronDownIcon />} size="sm" tip={t("guildbank.waitlist.down")} aria-label={`${t("guildbank.waitlist.down")}: ${name}`}
                        disabled={busy || last} onClick={() => onMove(entry, "down")} />
                    <IconButton icon={<TrashIcon />} size="sm" tone="danger" tip={t("guildbank.waitlist.remove")} aria-label={`${t("guildbank.waitlist.remove")}: ${name}`}
                        disabled={busy} onClick={() => onRemove(entry)} />
                </span>
            )}
        </li>
    );
}

function ItemQueue({ group, item, canWrite, busyId, onMove, onRemove }: {
    group: WaitlistGroup;
    item: GuildBankItem | undefined;
    canWrite: boolean;
    busyId: string;
    onMove: (entry: GuildBankWaitingEntry, direction: "up" | "down") => void;
    onRemove: (entry: GuildBankWaitingEntry) => void;
}) {
    const t = useT();
    const free = item ? item.free : 0;
    return (
        <section className="gb-wl-group" aria-label={group.item}>
            <header className="gb-wl-head">
                <ItemIcon url={group.iconUrl} quality={item ? item.quality : null} />
                <span className="gb-wl-item">{group.item}</span>
                <Badge size="sm">{t("guildbank.waitlist.entries", { count: group.entries.length })}</Badge>
                <Badge size="sm" tone={availableTone(free)}>{t("guildbank.waitlist.free", { count: free })}</Badge>
            </header>
            <ol className="gb-wl-list">
                {group.entries.map((e, i) => (
                    <EntryRow key={e.id} entry={e} first={i === 0} last={i === group.entries.length - 1}
                        canWrite={canWrite} busy={busyId === e.id} onMove={onMove} onRemove={onRemove} />
                ))}
            </ol>
        </section>
    );
}

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

function AddEntry({ bankKey, items, onDone }: { bankKey: string; items: GuildBankItem[]; onDone: (r: GuildBankWaitlist) => void }) {
    const t = useT();
    const toast = useToast();
    const offered = waitlistItems(items);
    const [name, setName] = useState("");
    const [itemId, setItemId] = useState(0);
    const [amount, setAmount] = useState(1);
    const [saving, setSaving] = useState(false);
    if (!offered.length) return <div className="empty">{t("guildbank.waitlist.noItems")}</div>;
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
                <Button type="submit" disabled={saving || !name.trim() || !itemId}>{t("guildbank.waitlist.add")}</Button>
            </div>
        </form>
    );
}

/** One pasted line in the preview: line, name (raider found or the character alone), item (red when unknown), amount. */
function PreviewRow({ row }: { row: GuildBankImportRow }) {
    const t = useT();
    const who = row.match
        ? t("guildbank.waitlist.matched", { name: row.match.userName })
        : t(row.ambiguous ? "guildbank.waitlist.ambiguous" : "guildbank.waitlist.unmatched");
    return (
        <li className={`gb-wl-prow${row.ok ? "" : " gb-wl-bad"}`}>
            <span className="gb-wl-line" aria-label={`${t("guildbank.waitlist.colLine")} ${row.line}`}>{row.line}</span>
            <span className="gb-req-text">
                <span className="gb-req-title">{row.name || "–"}</span>
                {!row.error && <span className="gb-req-sub">{who}</span>}
            </span>
            <span className="gb-req-text">
                <span>{row.item ? row.item.name : row.itemText || "–"}</span>
                {(row.error || row.itemError) && <span className="gb-req-sub gb-wl-err">{row.error || row.itemError}</span>}
            </span>
            <span className="gb-wl-amount">{row.amount ? t("guildbank.waitlist.amount", { amount: row.amount }) : "–"}</span>
        </li>
    );
}

function ImportLines({ bankKey, onDone }: { bankKey: string; onDone: (r: GuildBankWaitlist) => void }) {
    const t = useT();
    const toast = useToast();
    // the pasted lines are a draft: copying them out of the sheet again is the one step nobody redoes from memory
    const [draft, setDraft, clearDraft] = useDraftState(`guildbank-waitlist-import:${bankKey}`, { text: "" });
    const text = draft.text;
    const setText = (next: string) => setDraft({ text: next });
    const [rows, setRows] = useState<GuildBankImportRow[] | null>(null);
    const [busy, setBusy] = useState(false);
    const ok = rows ? rows.filter((r) => r.ok).length : 0;
    const preview = async () => {
        setBusy(true);
        try {
            setRows((await previewGuildBankWaitlist(bankKey, text)).rows);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };
    const run = async () => {
        setBusy(true);
        try {
            const r = await importGuildBankWaitlist(bankKey, text);
            toast(t("guildbank.waitlist.imported", { added: r.added, skipped: r.skipped }), "ok");
            clearDraft();
            onDone(r);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };
    if (rows) {
        return (
            <>
                {!rows.length && <div className="empty">{t("guildbank.waitlist.noRows")}</div>}
                {rows.length > 0 && (
                    <ol className="gb-wl-preview" aria-label={t("guildbank.waitlist.preview")}>
                        {rows.map((r) => <PreviewRow key={r.line} row={r} />)}
                    </ol>
                )}
                <div className="gb-wl-submit">
                    <Button variant="ghost" onClick={() => setRows(null)} disabled={busy}>{t("guildbank.waitlist.back")}</Button>
                    <Button onClick={() => { void run(); }} disabled={busy || !ok}>{t("guildbank.waitlist.run", { count: ok })}</Button>
                </div>
            </>
        );
    }
    return (
        <>
            <Field className="field" label={t("guildbank.waitlist.importLabel")} htmlFor="gb-wl-text" hint={t("guildbank.waitlist.importHint")}>
                <textarea id="gb-wl-text" rows={8} value={text} placeholder={t("guildbank.waitlist.importPlaceholder")} onChange={(e) => setText(e.target.value)} />
            </Field>
            <div className="gb-wl-submit">
                <Button onClick={() => { void preview(); }} disabled={busy || !text.trim()}>{t("guildbank.waitlist.preview")}</Button>
            </div>
        </>
    );
}

export default function WaitlistDialog({ bankKey, items, canWrite, onClose }: {
    bankKey: string;
    /** The bank's items: "Verfügbar" per queue and the offered ones to add. */
    items: GuildBankItem[];
    canWrite: boolean;
    onClose: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const list = useApi(() => getGuildBankWaitlist(bankKey), [bankKey]);
    const [picked, setView] = usePersistedState<View>("guildbank-waitlist-view", "list");
    // a reader only ever sees the list (and a stored view of another kind falls back to it)
    const view: View = canWrite && VIEWS.includes(picked) ? picked : "list";
    const [busyId, setBusyId] = useState("");
    const entries = list.data?.entries || [];
    const groups = groupWaitlist(entries);
    const byId = new Map(items.map((it) => [it.itemId, it]));

    const step = async (entry: GuildBankWaitingEntry, fn: () => Promise<GuildBankWaitlist>) => {
        setBusyId(entry.id);
        try {
            const r = await fn();
            list.setData({ entries: r.entries });
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusyId("");
        }
    };
    const move = (entry: GuildBankWaitingEntry, direction: "up" | "down") => { void step(entry, () => moveGuildBankWaiting(bankKey, entry.id, direction)); };
    const remove = async (entry: GuildBankWaitingEntry) => {
        const ok = await ask({
            title: t("guildbank.waitlist.removeTitle"),
            text: t("guildbank.waitlist.removeText", { amount: entry.amount, item: entry.item, name: waitingName(entry) }),
            action: t("guildbank.waitlist.remove"),
            tone: "danger",
        });
        if (ok) await step(entry, () => removeGuildBankWaiting(bankKey, entry.id));
    };
    const done = (r: GuildBankWaitlist) => {
        list.setData({ entries: r.entries });
        setView("list");
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon={<WowIcon name={WAITLIST_ICON} size={22} />}
            tone="bank"
            kicker={t("guildbank.tabsDialog.kicker")}
            title={t("guildbank.waitlist.title")}
            width={640}
            footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            <p className="gb-hint">{t("guildbank.waitlist.hint")}</p>
            {canWrite && (
                <div className="gb-wl-views">
                    <Segment<View>
                        size="sm"
                        ariaLabel={t("guildbank.waitlist.views")}
                        value={view}
                        onChange={setView}
                        options={[
                            { value: "list", label: t("guildbank.waitlist.viewList") },
                            { value: "add", label: t("guildbank.waitlist.viewAdd") },
                            { value: "import", label: t("guildbank.waitlist.viewImport") },
                        ]}
                    />
                </div>
            )}
            {view === "list" && (
                <>
                    {list.error && !list.data && <div className="empty">{list.error.message}</div>}
                    {!list.data && !list.error && <div className="empty">{t("guildbank.waitlist.loading")}</div>}
                    {list.data && !entries.length && <div className="empty">{t("guildbank.waitlist.empty")}</div>}
                    {groups.map((g) => (
                        <ItemQueue key={g.itemId} group={g} item={byId.get(g.itemId)} canWrite={canWrite} busyId={busyId} onMove={move} onRemove={(e) => { void remove(e); }} />
                    ))}
                </>
            )}
            {view === "add" && canWrite && <AddEntry bankKey={bankKey} items={items} onDone={done} />}
            {view === "import" && canWrite && <ImportLines bankKey={bankKey} onDone={done} />}
        </Modal>
    );
}
