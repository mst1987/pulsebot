import { useState } from "react";
import { saveOrgaLinks, type ApiError, type OrgaLink } from "../../api";
import { useToast } from "../../components/shell/Jobs";
import { Button } from "../../components/ui/Button";
import { PlusIcon } from "../../components/ui/icons";
import { useT } from "../../i18n";
import LinkRow from "./LinkRow";
import { cleanLinks } from "../../lib/discord/buttonEmoji";

// The links of one category's Orga-Zentrale (the buttons below "Raid anlegen"),
// edited like the raider organizer's links in AvailabilityPanelRow: a row per
// link, saved with its own button. The orga can change the same list in
// Discord ("Links …" on the hub); a save here redraws a posted hub at once.

export default function OrgaLinksEditor({ categoryId, links, maxLinks, onSaved }: {
    categoryId: string;
    links: OrgaLink[];
    maxLinks: number;
    /** The links as the server kept them. */
    onSaved: (categoryId: string, links: OrgaLink[]) => void;
}) {
    const t = useT();
    const toast = useToast();
    const [rows, setRows] = useState<OrgaLink[]>(() => links.map((l) => ({ ...l })));
    const [saving, setSaving] = useState(false);
    const setRow = (i: number, patch: Partial<OrgaLink>) => setRows(rows.map((r, at) => (at === i ? { ...r, ...patch } : r)));

    const save = async () => {
        setSaving(true);
        try {
            const res = await saveOrgaLinks(categoryId, cleanLinks(rows));
            setRows(res.links.map((l) => ({ ...l })));
            onSaved(categoryId, res.links);
            toast(t("settings.categories.linksSaved"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="cat-links">
            <strong id={`catorgalinks-${categoryId}`}>{t("settings.categories.orgaLinks")}</strong>
            <span className="note">{t("settings.categories.orgaLinksSub")}</span>
            {rows.map((row, i) => (
                <LinkRow key={i} row={row} n={i + 1} groupId={`catorgalinks-${categoryId}`}
                    onChange={(patch) => setRow(i, patch)} onRemove={() => setRows(rows.filter((_, at) => at !== i))} />
            ))}
            <div className="cat-links-actions">
                <Button variant="ghost" size="sm" icon={<PlusIcon />} disabled={rows.length >= maxLinks}
                    onClick={() => setRows([...rows, { label: "", url: "" }])}>{t("settings.categories.linkAdd")}</Button>
                <Button size="sm" running={saving} onClick={save}>{t("settings.categories.linksSave")}</Button>
            </div>
        </div>
    );
}
