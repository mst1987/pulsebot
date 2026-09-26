import { useState } from "react";
import { saveRaidsheet, deleteRaidsheet, type ApiError, type Raidsheet } from "../../api";
import { useTableSort, type Dir } from "../../lib/tableSort";
import { SortTh } from "../../components/SortTh";
import { ExternalIcon, TrashIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { ListSection } from "../../components/ListSection";
import { useCollectionEditor } from "../../lib/collectionEditor";
import { PenIcon } from "../../components/settingsUi";
import Field from "../../components/ui/Field";
import { useConfirm } from "../../components/ui/Modal";
import { Button, IconButton } from "../../components/ui/Button";
import { splitList } from "./settingsDraft";

type SheetSortKey = "name" | "sheetName" | "keywords";

const SHEET_SORT_DEFAULTS: Record<SheetSortKey, Dir> = { name: "asc", sheetName: "asc", keywords: "asc" };

function RaidsheetForm({ sheet, onSaved, onCancel }: {
    sheet: Raidsheet | null;
    onSaved: (msg: string) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState(sheet?.name ?? "");
    const [spreadsheetId, setSpreadsheetId] = useState(sheet?.spreadsheetId ?? "");
    const [sheetName, setSheetName] = useState(sheet?.sheetName ?? "Setup");
    const [gid, setGid] = useState(sheet?.gid === undefined || sheet?.gid === null ? "" : String(sheet.gid));
    const [keywords, setKeywords] = useState((sheet?.keywords ?? []).join(", "));
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await saveRaidsheet({ id: sheet?.id, name, spreadsheetId, sheetName, gid, keywords: splitList(keywords) });
            onSaved(sheet ? `Raidsheet „${name}“ gespeichert.` : `Raidsheet „${name}“ angelegt.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="sheetcard set-form" onSubmit={submit}>
            <Field className="set-field" htmlFor="rs-name" label="Name (Content)"><input id="rs-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Tier 6 / SWP" required /></Field>
            <Field className="set-field" htmlFor="rs-id" label="Spreadsheet-ID" tip="Spreadsheet-ID" tipSub="Der lange Teil der Sheet-URL zwischen /d/ und /edit."><input id="rs-id" type="text" className="mono" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} placeholder="Google-Sheet-ID" /></Field>
            <div className="set-grid">
                <Field className="set-field" htmlFor="rs-tab" label="Tab-Name"><input id="rs-tab" type="text" value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="Setup" /></Field>
                <Field className="set-field" htmlFor="rs-gid" label="Tab-GID" tip="Tab-GID" tipSub="Die Zahl hinter #gid= in der URL des Tabs."><input id="rs-gid" type="text" className="mono" value={gid} onChange={(e) => setGid(e.target.value)} placeholder="0" /></Field>
            </div>
            <Field className="set-field" htmlFor="rs-kw" label="Keywords" tip="Keywords" tipSub="Kommagetrennt. Passt ein Keyword auf den Event-Titel, wird dieses Sheet automatisch vorgeschlagen.">
                <input id="rs-kw" type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="kara, gruul, maggi" />
            </Field>
            <div className="row-actions">
                <Button type="submit" disabled={busy}>{sheet ? "Speichern" : "Raidsheet anlegen"}</Button>
                <Button variant="ghost" disabled={busy} onClick={onCancel}>Abbrechen</Button>
            </div>
        </form>
    );
}

// The guild's raidsheet templates: the list first, one editor at a time.
export function RaidsheetsSection({ sheets, onChanged }: {
    sheets: Raidsheet[];
    onChanged: (msg: string) => void;
}) {
    const ask = useConfirm();
    const editor = useCollectionEditor("sheet");
    const toast = useToast();
    const { sort, dir, onSort, apply } = useTableSort<SheetSortKey>("raidsheets-sort", SHEET_SORT_DEFAULTS, "name");

    const remove = async (sheet: Raidsheet) => {
        if (!(await ask({ title: `Raidsheet „${sheet.name}“ löschen?`, action: "Löschen" }))) return;
        try {
            await deleteRaidsheet(sheet.id);
            onChanged(`Raidsheet „${sheet.name}“ gelöscht.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const saved = (msg: string) => { editor.close(); onChanged(msg); };
    const sorted = apply(sheets, (s, key) => {
        switch (key) {
            case "sheetName": return (s.sheetName || "").toLowerCase();
            case "keywords": return s.keywords.join(", ").toLowerCase();
            default: return (s.name || "").toLowerCase();
        }
    });

    return (
        <ListSection
            editor={editor}
            entries={sheets}
            idOf={(s) => s.id}
            newLabel="Neues Raidsheet"
            editorTitle={(s) => (s ? `Raidsheet „${s.name || ""}“ bearbeiten` : "Neues Raidsheet")}
            editorFor={(s) => <RaidsheetForm sheet={s} onSaved={saved} onCancel={editor.close} />}
        >
            {sheets.length ? (
                <div className="set-card table-scroll">
                    <table className="idx">
                        <thead>
                            <tr>
                                <SortTh sortKey="name" label="Name" sort={sort} dir={dir} onSort={onSort} />
                                <SortTh sortKey="sheetName" label="Tab" sort={sort} dir={dir} onSort={onSort} />
                                <SortTh sortKey="keywords" label="Keywords" sort={sort} dir={dir} onSort={onSort} />
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((s) => (
                                <tr key={s.id}>
                                    <td><strong>{s.name || "(ohne Name)"}</strong></td>
                                    <td className="small">{s.sheetName || "—"}</td>
                                    <td className="small">{s.keywords.length ? s.keywords.join(", ") : "—"}</td>
                                    <td className="cell-act">
                                        {s.spreadsheetId && (
                                            <a className="ibtn sm" target="_blank" rel="noopener noreferrer" aria-label="Sheet öffnen" data-tip="Sheet öffnen"
                                                href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/edit${s.gid ? `#gid=${s.gid}` : ""}`}>
                                                <ExternalIcon />
                                            </a>
                                        )}
                                        <IconButton icon={<PenIcon />} tip="Bearbeiten" size="sm" onClick={() => editor.startEdit(s.id)} />
                                        <IconButton icon={<TrashIcon />} tip="Löschen" size="sm" tone="danger" onClick={() => remove(s)} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : <div className="empty">Noch keine Raidsheets angelegt.</div>}
        </ListSection>
    );
}
