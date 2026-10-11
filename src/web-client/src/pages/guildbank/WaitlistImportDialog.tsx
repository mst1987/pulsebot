// "Import" (#775): lines pasted from a sheet ("Name⇥Item⇥Anzahl", also ; or ,),
// a preview first (item found, raider matched), then import. Opened from the
// Warteliste tab; answers the new list.
import { useState } from "react";
import {
    importGuildBankWaitlist, previewGuildBankWaitlist,
    type ApiError, type GuildBankImportRow, type GuildBankWaitlist,
} from "../../api";
import { Button, Field, Modal, WowIcon } from "../../components/ui";
import { useToast } from "../../components/shell/Jobs";
import { useDraftState } from "../../lib/ui/persistedState";
import { useT } from "../../i18n";
import { WAITLIST_ICON } from "./bankView";

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
                {row.fuzzy && row.item && <span className="gb-req-sub gb-fuzzy">{t("guildbank.waitlist.fuzzy", { name: row.item.name })}</span>}
                {(row.error || row.itemError) && <span className="gb-req-sub gb-wl-err">{row.error || row.itemError}</span>}
            </span>
            <span className="gb-wl-amount">{row.amount ? t("guildbank.waitlist.amount", { amount: row.amount }) : "–"}</span>
        </li>
    );
}

export default function WaitlistImportDialog({ bankKey, onClose, onDone }: {
    bankKey: string;
    onClose: () => void;
    onDone: (r: GuildBankWaitlist) => void;
}) {
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
    return (
        <Modal
            open
            onClose={onClose}
            icon={<WowIcon name={WAITLIST_ICON} size={22} />}
            tone="bank"
            kicker={t("guildbank.waitlist.title")}
            title={t("guildbank.waitlist.viewImport")}
            width={720}
            footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            {rows ? (
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
            ) : (
                <>
                    <Field className="field" label={t("guildbank.waitlist.importLabel")} htmlFor="gb-wl-text" hint={t("guildbank.waitlist.importHint")}>
                        <textarea id="gb-wl-text" rows={8} value={text} placeholder={t("guildbank.waitlist.importPlaceholder")} onChange={(e) => setText(e.target.value)} />
                    </Field>
                    <div className="gb-wl-submit">
                        <Button onClick={() => { void preview(); }} disabled={busy || !text.trim()}>{t("guildbank.waitlist.preview")}</Button>
                    </div>
                </>
            )}
        </Modal>
    );
}
