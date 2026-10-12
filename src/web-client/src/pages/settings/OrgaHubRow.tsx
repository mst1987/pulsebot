import { useState } from "react";
import { postOrgaHub, removeOrgaHub, type ApiError, type OrgaHub } from "../../api";
import { useToast } from "../../components/shell/Jobs";
import { Button, buttonClass } from "../../components/ui/Button";
import { useConfirm } from "../../components/ui/Modal";
import CategoryField from "./CategoryField";
import { ExternalIcon, SendIcon } from "../../components/ui/icons";
import { formatDate } from "../../lib/format";
import { useT } from "../../i18n";

// "Orga-Zentrale" of one raid category (Einstellungen → Kategorien → Discord-
// Zentralen): the Discord message for the orga — the category's raids of the next
// four weeks, where each one stands, and a "Raid anlegen" button. Posted and
// removed at once through its own API, never through the page's draft and save
// bar; posting again replaces the old message. Who sees the channel is the
// channel's business in Discord.

export type OrgaHubs = {
    hubs: OrgaHub[];
    /** The text channels to post into (Einstellungen' noteChannels list). */
    channels: { id: string; name: string; category?: string }[];
    /** A hub was posted (or moved) or removed (null). */
    onChange: (categoryId: string, hub: OrgaHub | null) => void;
};

export default function OrgaHubRow({ categoryId, categoryName, hubs }: { categoryId: string; categoryName: string; hubs: OrgaHubs }) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const hub = hubs.hubs.find((h) => h.categoryId === categoryId) || null;
    const [channelId, setChannelId] = useState(hub ? hub.channelId : "");
    const [busy, setBusy] = useState(false);

    const post = async () => {
        setBusy(true);
        try {
            const res = await postOrgaHub(categoryId, channelId);
            hubs.onChange(categoryId, res.hub);
            toast(t("settings.categories.orgaHubPosted"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!(await ask({ title: t("settings.categories.orgaHubRemoveTitle"), text: t("settings.categories.orgaHubRemoveText"), action: t("common.remove") }))) return;
        setBusy(true);
        try {
            await removeOrgaHub(categoryId);
            hubs.onChange(categoryId, null);
            toast(t("settings.categories.orgaHubRemoved"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <CategoryField htmlFor={`catorga-${categoryId}`} label={t("settings.categories.orgaHub")}
            sub={t("settings.categories.orgaHubShort")} more={t("settings.categories.orgaHubSub")}>
            {hubs.channels.length ? (
                <div className="cat-panel">
                    <select id={`catorga-${categoryId}`} value={channelId} aria-label={t("settings.categories.orgaHubChannelAria", { name: categoryName })}
                        onChange={(e) => setChannelId(e.target.value)}>
                        <option value="">{t("settings.categories.panelPickChannel")}</option>
                        {hubs.channels.map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                    </select>
                    <Button size="sm" icon={<SendIcon />} disabled={!channelId} running={busy} onClick={post}>
                        {hub ? t("settings.categories.panelRepost") : t("settings.categories.panelPost")}
                    </Button>
                </div>
            ) : <span className="note">{t("settings.categories.panelNoChannels")}</span>}
            {hub && (
                <div className="cat-panel-state">
                    <span className="note">{t("settings.categories.panelSince", { date: formatDate(hub.postedAt) })}</span>
                    {hub.url && (
                        <a className={buttonClass("ghost", "sm", true)} href={hub.url} target="_blank" rel="noreferrer">
                            <ExternalIcon /> {t("settings.categories.panelView")}
                        </a>
                    )}
                    <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>{t("common.remove")}</Button>
                </div>
            )}
        </CategoryField>
    );
}
