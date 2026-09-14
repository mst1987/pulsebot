import { useState } from "react";
import {
    getRaidTemplates, createRaidTemplate, deleteRaidTemplate, importRaidTemplates,
    type ApiError, type RaidTemplate,
} from "../api";
import { useTableSort, type Dir } from "../lib/tableSort";
import { useToast } from "./Jobs";
import { Modal, useConfirm } from "./ui/Modal";
import { Button, IconButton } from "./ui/Button";
import Badge from "./ui/Badge";
import WowIcon from "./ui/WowIcon";
import { TrashIcon } from "./icons";

// Raid-Helper's templates, managed from where they are picked: the create
// dialog's "Verwalten" opens this on top of it. Raid-Helper has no endpoint that
// lists templates, so the bot keeps its own list — loaded from the guild's
// existing events or added by hand.

type SortKey = "name" | "id";
const SORT_DEFAULTS: Record<SortKey, Dir> = { name: "asc", id: "asc" };

export default function RaidTemplatesDialog({ open, onClose, templates, csrfToken, onChanged }: {
    open: boolean;
    onClose: () => void;
    templates: RaidTemplate[];
    csrfToken: string | null;
    onChanged: (templates: RaidTemplate[]) => void;
}) {
    const ask = useConfirm();
    const toast = useToast();
    const [id, setId] = useState("");
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(false);
    const { apply } = useTableSort<SortKey>("raid-templates-sort", SORT_DEFAULTS, "name");
    // Raid-Helper's own numbering compares as a number where it is one.
    const sorted = apply(templates, (t, key) => (key === "name" ? (t.name || "").toLowerCase() : (Number(t.id) || t.id.toLowerCase())));

    const refresh = () => getRaidTemplates().then((r) => onChanged(r.templates));

    const add = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await createRaidTemplate(csrfToken, { id, name });
            setId("");
            setName("");
            toast("Template gespeichert.");
            await refresh();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const remove = async (t: RaidTemplate) => {
        if (!(await ask({ title: "Template entfernen?", text: `„${t.name || t.id}“ wird aus der Liste entfernt. In Raid-Helper bleibt es bestehen.`, action: "Entfernen" }))) return;
        setBusy(true);
        try {
            await deleteRaidTemplate(csrfToken, t.id);
            await refresh();
            toast("Template entfernt.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const importFromRaidHelper = async () => {
        setLoading(true);
        try {
            const r = await importRaidTemplates(csrfToken);
            onChanged(r.templates);
            toast(`${r.added} neu, ${r.updated} aktualisiert.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            icon="inv_misc_note_01"
            kicker="Raid-Helper"
            title="Templates verwalten"
            width={560}
            hint={`${templates.length} Template${templates.length === 1 ? "" : "s"}`}
            footer={<Button variant="ghost" onClick={onClose}>Fertig</Button>}
        >
            <div className="re-tpl-head">
                <span className="tipped" data-tip="Warum eine eigene Liste?" data-tip-sub="Raid-Helper bietet keinen Endpunkt zum Auflisten von Templates. Der Bot liest sie aus den bestehenden Events des Servers oder du trägst sie von Hand ein.">Gespeicherte Templates</span>
                <Button variant="run" size="sm" icon="spell_holy_borrowedtime" running={loading} onClick={importFromRaidHelper}>Aus Raid-Helper laden</Button>
            </div>
            {sorted.length
                ? (
                    <div className="glist re-glist re-tpl-list">
                        {sorted.map((t) => (
                            <div key={t.id} className="re-tpl-row">
                                <WowIcon name="inv_misc_note_01" size={20} />
                                <strong>{t.name || "(ohne Name)"}</strong>
                                <Badge>ID {t.id}</Badge>
                                <IconButton icon={<TrashIcon />} size="sm" tone="danger" tip="Entfernen" tipSub="Nur aus dieser Liste, nicht aus Raid-Helper." disabled={busy} onClick={() => remove(t)} />
                            </div>
                        ))}
                    </div>
                )
                : <div className="re-empty">Noch keine Templates gespeichert.</div>}
            <form className="re-tpl-form" onSubmit={add}>
                <div className="field">
                    <label>Template-ID</label>
                    <input type="text" value={id} onChange={(e) => setId(e.target.value)} placeholder="z.B. 3" required />
                </div>
                <div className="field">
                    <label>Name</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. GDKP Karazhan" />
                </div>
                <Button type="submit" variant="ghost" disabled={busy}>Hinzufügen</Button>
            </form>
        </Modal>
    );
}
