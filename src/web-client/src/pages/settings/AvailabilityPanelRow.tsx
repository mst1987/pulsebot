import { useState } from "react";
import { postAvailabilityPanel, removeAvailabilityPanel, type ApiError, type AvailabilityPanel } from "../../api";
import { useToast } from "../../components/Jobs";
import { Button, buttonClass } from "../../components/ui/Button";
import { useConfirm } from "../../components/ui/Modal";
import CategoryField from "./CategoryField";
import { ExternalIcon, SendIcon } from "../../components/icons";
import { formatDate } from "../../lib/format";
import { useT } from "../../i18n";

// "Ab-/Anwesenheits-Panel" of one raid category (Einstellungen → Kategorien):
// the Discord message whose buttons let raiders enter absences and attendances
// for this category's raids. It acts at once through the panel API — it is not
// part of the page's draft and save bar. Posting again replaces the old panel.

export type AvailabilityPanels = {
    panels: AvailabilityPanel[];
    /** The text channels to post into (Einstellungen' noteChannels list). */
    channels: { id: string; name: string; category?: string }[];
    /** A panel was posted (or moved) or removed (null). */
    onChange: (categoryId: string, panel: AvailabilityPanel | null) => void;
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
        <CategoryField htmlFor={`catpanel-${categoryId}`} label={t("settings.categories.panel")} sub={t("settings.categories.panelSub")}>
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
                    <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>{t("common.remove")}</Button>
                </div>
            )}
        </CategoryField>
    );
}
