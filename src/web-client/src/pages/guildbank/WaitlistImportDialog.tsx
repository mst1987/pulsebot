// "Import" (#775): lines pasted from a sheet ("Name⇥Item⇥Anzahl", also ; or ,),
// a preview first (item found, raider matched), then import. Opened from the
// Warteliste tab; answers the new list.
//
// A name that matches no profile character, or several raiders' characters,
// would land "nicht verknüpft" — the orga could not confirm it later. So would
// a name that is only a profile character nobody has confirmed ("Gentle",
// typed at a signup): it is never linked on its own. In the preview such a
// row gets its own pick: the candidates as toggle chips — the raiders'
// characters of an ambiguous name, else the confirmed characters the name may
// mean ("Gentleowl", "Gentletwowl") — and "Verknüpfen" opens the character search
// (CharacterPicker.tsx, inside this dialog). The picks travel with the import
// (`links`, line → character); a row without one is imported as the character
// alone and stays marked "nicht verknüpft".
import { useState } from "react";
import {
    importGuildBankWaitlist, previewGuildBankWaitlist,
    type ApiError, type GuildBankCharacterChoice, type GuildBankImportLinks, type GuildBankImportRow, type GuildBankWaitlist,
} from "../../api";
import { Button, Chip, Field, Modal, WowIcon } from "../../components/ui";
import { LinkIcon } from "../../components/ui/icons";
import { useToast } from "../../components/shell/Jobs";
import { useDraftState } from "../../lib/ui/persistedState";
import { classLabel } from "../../lib/wow/wowNames";
import { useT } from "../../i18n";
import { WAITLIST_ICON } from "./bankView";
import { CharacterPicker, LinkIntro, NotLinkedBadge } from "./CharacterPicker";

/** The orga's pick for one line, with what it shows. */
type Pick = { userId: string; characterKey: string; label: string };

/** Who a row goes to: the pick, the matched raider, or the choice to link one. */
function Who({ row, pick, onPick, onSearch, onClear }: {
    row: GuildBankImportRow;
    pick: Pick | undefined;
    onPick: (pick: Pick) => void;
    onSearch: () => void;
    onClear: () => void;
}) {
    const t = useT();
    // a line that is not imported (unreadable, unknown item) needs nobody
    if (row.error || !row.ok) return null;
    if (pick) {
        return (
            <span className="gb-req-sub gb-wl-who">
                <Chip tone="ok" icon={<LinkIcon />} onRemove={onClear} removeLabel={t("guildbank.link.unpick")}>{pick.label}</Chip>
            </span>
        );
    }
    if (row.match) return <span className="gb-req-sub">{t("guildbank.waitlist.matched", { name: row.match.userName })}</span>;
    const candidates = row.candidates || [];
    return (
        <span className="gb-req-sub gb-wl-who">
            <NotLinkedBadge noRaider />
            {row.ambiguous && <span>{t("guildbank.waitlist.ambiguousPick")}</span>}
            {!row.ambiguous && row.unverified && <span>{t("guildbank.waitlist.unverifiedPick", { name: row.name })}</span>}
            {!row.ambiguous && !row.unverified && candidates.length > 0 && <span>{t("guildbank.waitlist.suggestedPick")}</span>}
            {candidates.map((c) => (
                <Chip key={`${c.userId}:${c.characterKey}`} pressed={false}
                    onClick={() => onPick({ userId: c.userId, characterKey: c.characterKey, label: t("guildbank.link.pickLabel", { name: c.characterName, raider: c.userName }) })}>
                    {row.ambiguous ? c.userName : c.characterName} · {classLabel(c.className, c.className)}
                </Chip>
            ))}
            <Button size="sm" variant="ghost" icon={<LinkIcon />} onClick={onSearch} aria-label={`${t("guildbank.link.button")}: ${row.name}`}>
                {t(candidates.length ? "guildbank.link.searchOther" : "guildbank.link.button")}
            </Button>
        </span>
    );
}

/** One pasted line in the preview: line, name (raider found, picked or not linked), item (red when unknown), amount. */
function PreviewRow({ row, pick, onPick, onSearch, onClear }: {
    row: GuildBankImportRow;
    pick: Pick | undefined;
    onPick: (pick: Pick) => void;
    onSearch: () => void;
    onClear: () => void;
}) {
    const t = useT();
    return (
        <li className={`gb-wl-prow${row.ok ? "" : " gb-wl-bad"}`}>
            <span className="gb-wl-line" aria-label={`${t("guildbank.waitlist.colLine")} ${row.line}`}>{row.line}</span>
            <span className="gb-req-text">
                <span className="gb-req-title">{row.name || "–"}</span>
                <Who row={row} pick={pick} onPick={onPick} onSearch={onSearch} onClear={onClear} />
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
    const [picks, setPicks] = useState<Record<number, Pick>>({});
    const [searching, setSearching] = useState<GuildBankImportRow | null>(null);
    const [busy, setBusy] = useState(false);
    const ok = rows ? rows.filter((r) => r.ok).length : 0;
    const unlinked = rows ? rows.filter((r) => r.ok && !r.match && !picks[r.line]).length : 0;
    const setPick = (line: number, pick: Pick | null) => setPicks((all) => {
        const next = { ...all };
        if (pick) next[line] = pick;
        else delete next[line];
        return next;
    });
    const links = (): GuildBankImportLinks => Object.fromEntries(Object.entries(picks).map(([line, p]) => [line, { userId: p.userId, characterKey: p.characterKey }]));

    const preview = async () => {
        setBusy(true);
        try {
            setRows((await previewGuildBankWaitlist(bankKey, text)).rows);
            setPicks({});
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };
    const run = async () => {
        setBusy(true);
        try {
            const r = await importGuildBankWaitlist(bankKey, text, links());
            toast(t(r.unlinked ? "guildbank.waitlist.importedUnlinked" : "guildbank.waitlist.imported", { added: r.added, skipped: r.skipped, unlinked: r.unlinked || 0 }), "ok");
            clearDraft();
            onDone(r);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };
    const picked = (row: GuildBankImportRow, choice: GuildBankCharacterChoice) => {
        setPick(row.line, { userId: choice.userId, characterKey: choice.characterKey, label: t("guildbank.link.pickLabel", { name: choice.characterName, raider: choice.userName }) });
        setSearching(null);
    };

    let body;
    if (searching) {
        body = (
            <>
                <CharacterPicker bankKey={bankKey} initialQuery={searching.name} onPick={(c) => picked(searching, c)}
                    intro={<LinkIntro what={t("guildbank.waitlist.lineOf", { line: searching.line, name: searching.name })} current="" />} />
                <div className="gb-wl-submit">
                    <Button variant="ghost" onClick={() => setSearching(null)}>{t("guildbank.waitlist.back")}</Button>
                </div>
            </>
        );
    } else if (rows) {
        body = (
            <>
                {!rows.length && <div className="empty">{t("guildbank.waitlist.noRows")}</div>}
                {rows.length > 0 && (
                    <ol className="gb-wl-preview" aria-label={t("guildbank.waitlist.preview")}>
                        {rows.map((r) => (
                            <PreviewRow key={r.line} row={r} pick={picks[r.line]} onPick={(p) => setPick(r.line, p)}
                                onSearch={() => setSearching(r)} onClear={() => setPick(r.line, null)} />
                        ))}
                    </ol>
                )}
                {unlinked > 0 && <p className="gb-hint gb-wl-unlinked">{t("guildbank.waitlist.unlinkedHint", { count: unlinked })}</p>}
                <div className="gb-wl-submit">
                    <Button variant="ghost" onClick={() => setRows(null)} disabled={busy}>{t("guildbank.waitlist.back")}</Button>
                    <Button onClick={() => { void run(); }} disabled={busy || !ok}>{t("guildbank.waitlist.run", { count: ok })}</Button>
                </div>
            </>
        );
    } else {
        body = (
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

    return (
        <Modal
            open
            onClose={onClose}
            icon={<WowIcon name={WAITLIST_ICON} size={22} />}
            tone="bank"
            kicker={t("guildbank.waitlist.title")}
            title={searching ? t("guildbank.link.title") : t("guildbank.waitlist.viewImport")}
            width={760}
            footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            {body}
        </Modal>
    );
}
