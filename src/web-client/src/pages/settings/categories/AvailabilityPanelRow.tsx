import { useState } from "react";
import { postAvailabilityPanel, removeAvailabilityPanel, saveAvailabilityFeatures, saveAvailabilityLinks, type ApiError, type AvailabilityLink, type AvailabilityPanel } from "../../../api";
import { useToast } from "../../../components/shell/Jobs";
import { Button, buttonClass } from "../../../components/ui/Button";
import { useConfirm } from "../../../components/ui/overlay/Modal";
import CategoryField from "./CategoryField";
import LinkRow from "./LinkRow";
import HubFeatureSwitches from "./HubFeatureSwitches";
import { cleanLinks } from "../../../lib/discord/buttonEmoji";
import { ExternalIcon, PlusIcon, SendIcon, TrashIcon, SaveIcon } from "../../../components/ui/icons/icons";
import { formatDate } from "../../../lib/format";
import { useT } from "../../../i18n";

// "Ab-/Anwesenheits-Panel" of one raid category (Einstellungen → Kategorien):
// the Discord message whose buttons let raiders enter absences and attendances
// for this category's raids. It acts at once through the panel API — it is not
// part of the page's draft and save bar. Posting again replaces the old panel.
// Below it the category's links: the link buttons at the bottom of the panel
// (WCL invite, info sheet, tactics …), saved with their own button.

export type AvailabilityPanels = {
    panels: AvailabilityPanel[];
    /** The text channels to post into (Einstellungen' noteChannels list). */
    channels: { id: string; name: string; category?: string }[];
    /** The organizer's link buttons per category id. */
    links: Record<string, AvailabilityLink[]>;
    /** How many links one category may have. */
    maxLinks: number;
    /** A panel was posted (or moved) or removed (null). */
    onChange: (categoryId: string, panel: AvailabilityPanel | null) => void;
    /** The category's links were saved (as the server kept them). */
    onLinks: (categoryId: string, links: AvailabilityLink[]) => void;
    /** Categories with a part of the hub switched off (#969); missing = all on. */
    features?: Record<string, Record<string, boolean>>;
    /** The hub's parts in their order; none = no switches shown. */
    featureKeys?: string[];
    /** A category's switches were saved (as the server kept them). */
    onFeatures?: (categoryId: string, features: Record<string, boolean>) => void;
};

export default function AvailabilityPanelRow({ categoryId, categoryName, panels }: {
    categoryId: string;
    categoryName: string;
    panels: AvailabilityPanels;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const panel = panels.panels.find((p) => p.categoryId === categoryId) || null;
    const [channelId, setChannelId] = useState(panel ? panel.channelId : "");
    const [busy, setBusy] = useState(false);
    const [rows, setRows] = useState<AvailabilityLink[]>(() => (panels.links[categoryId] || []).map((l) => ({ ...l })));
    const [savingLinks, setSavingLinks] = useState(false);
    const setRow = (i: number, patch: Partial<AvailabilityLink>) => setRows(rows.map((r, at) => (at === i ? { ...r, ...patch } : r)));

    const saveLinks = async () => {
        setSavingLinks(true);
        try {
            const res = await saveAvailabilityLinks(categoryId, cleanLinks(rows));
            setRows(res.links.map((l) => ({ ...l })));
            panels.onLinks(categoryId, res.links);
            toast(t("settings.categories.linksSaved"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setSavingLinks(false);
        }
    };

    const post = async () => {
        setBusy(true);
        try {
            const res = await postAvailabilityPanel(categoryId, channelId);
            panels.onChange(categoryId, res.panel);
            toast(t("settings.categories.panelPosted"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!(await ask({ title: t("settings.categories.panelRemoveTitle"), text: t("settings.categories.panelRemoveText"), action: t("common.remove") }))) return;
        setBusy(true);
        try {
            await removeAvailabilityPanel(categoryId);
            panels.onChange(categoryId, null);
            toast(t("settings.categories.panelRemoved"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <CategoryField htmlFor={`catpanel-${categoryId}`} label={t("settings.categories.panel")}
            sub={t("settings.categories.panelShort")} more={t("settings.categories.panelSub")}>
            {panels.channels.length ? (
                <div className="cat-panel">
                    <select id={`catpanel-${categoryId}`} value={channelId} aria-label={t("settings.categories.panelChannelAria", { name: categoryName })}
                        onChange={(e) => setChannelId(e.target.value)}>
                        <option value="">{t("settings.categories.panelPickChannel")}</option>
                        {panels.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                    </select>
                    <Button size="sm" icon={<SendIcon />} disabled={!channelId} running={busy} onClick={post}>
                        {panel ? t("settings.categories.panelRepost") : t("settings.categories.panelPost")}
                    </Button>
                </div>
            ) : <span className="note">{t("settings.categories.panelNoChannels")}</span>}
            {panel && (
                <div className="cat-panel-state">
                    <span className="note">{t("settings.categories.panelSince", { date: formatDate(panel.postedAt) })}</span>
                    {panel.url && (
                        <a className={buttonClass("ghost", "sm", true)} href={panel.url} target="_blank" rel="noreferrer">
                            <ExternalIcon /> {t("settings.categories.panelView")}
                        </a>
                    )}
                    <Button variant="danger" size="sm" icon={<TrashIcon />} disabled={busy} onClick={remove}>{t("common.remove")}</Button>
                </div>
            )}
            <HubFeatureSwitches kind="raid" categoryId={categoryId} keys={panels.featureKeys || []}
                features={(panels.features || {})[categoryId] || {}} save={saveAvailabilityFeatures}
                onSaved={(id, f) => panels.onFeatures && panels.onFeatures(id, f)} />
            <div className="cat-links">
                <strong id={`catlinks-${categoryId}`}>{t("settings.categories.links")}</strong>
                <span className="note">{t("settings.categories.linksSub")}</span>
                {rows.map((row, i) => (
                    <LinkRow key={i} row={row} n={i + 1} groupId={`catlinks-${categoryId}`}
                        onChange={(patch) => setRow(i, patch)} onRemove={() => setRows(rows.filter((_, at) => at !== i))} />
                ))}
                <div className="cat-links-actions">
                    <Button variant="ghost" size="sm" icon={<PlusIcon />} disabled={rows.length >= panels.maxLinks}
                        onClick={() => setRows([...rows, { label: "", url: "" }])}>{t("settings.categories.linkAdd")}</Button>
                    <Button variant="go" size="sm" icon={<SaveIcon />} running={savingLinks} onClick={saveLinks}>{t("settings.categories.linksSave")}</Button>
                </div>
            </div>
        </CategoryField>
    );
}
