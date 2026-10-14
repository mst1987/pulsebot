import { useState } from "react";
import {
    getAddonCenter, postAddonCenter, removeAddonCenter, saveAddonCenter, type AddonCenterSettings, type AddonCenterView, type ApiError,
} from "../../api";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../components/shell/Jobs";
import { useConfirm } from "../../components/ui/Modal";
import { Button, buttonClass } from "../../components/ui/Button";
import { FieldLabel } from "../../components/ui/Field";
import { ChannelPicker } from "../../components/settings/settingsUi";
import { ExternalIcon, SendIcon } from "../../components/ui/icons";
import { formatDate, formatTime } from "../../lib/format";
import { useT } from "../../i18n";

// Einstellungen → Module → Addons, under the list: "Downloadzentrale im Discord"
// (design board 4). One bot message in a channel with every addon of the channel's
// game version, a download button and a patch notes link each (nothing is
// announced; services/addons/addonCenter.js). Like the rest of the section it saves itself —
// every pick at once through its own route (/api/addon-center), never the page's
// draft or PATCH /api/settings, so the addon list's guards stay untouched. Posting,
// "Neu posten" and "Entfernen" follow the Orga-Zentrale's row (OrgaHubRow).

type Busy = "" | "save" | "post" | "remove";

export default function AddonCenterCard() {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const view = useApi(getAddonCenter, []);
    const [busy, setBusy] = useState<Busy>("");

    if (!view.data) {
        return view.error ? <p className="note dlp-center">{t("addon.center.loadError")}</p> : null;
    }
    const data: AddonCenterView = view.data;
    const { settings, center } = data;

    const run = async (kind: Busy, call: () => Promise<AddonCenterView>, done: string) => {
        setBusy(kind);
        try {
            const next = await call();
            view.setData(next);
            if (next.warning) toast(next.warning, "err");
            else toast(done);
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy("");
        }
    };

    const save = (patch: Partial<AddonCenterSettings>) => run("save", () => saveAddonCenter(patch), t("addon.center.saved"));

    const remove = async () => {
        if (!(await ask({ title: t("addon.center.removeAsk"), text: t("addon.center.removeText"), action: t("common.remove") }))) return;
        await run("remove", removeAddonCenter, t("addon.center.removed"));
    };

    const state = center
        ? (data.checkedAt
            ? t("addon.center.postedState", { date: formatDate(center.postedAt), time: formatTime(data.checkedAt) })
            : t("addon.center.postedNever", { date: formatDate(center.postedAt) }))
        : (!settings.channelId ? t("addon.center.pickChannel") : "");

    return (
        <section className="dlp-center" aria-labelledby="dlp-center-title">
            <div className="list-head-text">
                <h2 id="dlp-center-title">{t("addon.center.title")}</h2>
                <p className="note">{t("addon.center.note")}</p>
            </div>
            <div className="set-card set-form">
                <div className="set-grid">
                    <div className="set-field">
                        <FieldLabel htmlFor="dlp-center-channel" tip={t("addon.center.channel")} tipSub={t("addon.center.channelSub")}>{t("addon.center.channel")}</FieldLabel>
                        <ChannelPicker id="dlp-center-channel" value={settings.channelId} channels={data.channels} onChange={(channelId) => { void save({ channelId }); }} />
                    </div>
                    <div className="set-field">
                        <FieldLabel htmlFor="dlp-center-version" tip={t("addon.center.version")} tipSub={t("addon.center.versionSub")}>{t("addon.center.version")}</FieldLabel>
                        <select id="dlp-center-version" value={settings.versionId} disabled={busy === "save"} onChange={(e) => { void save({ versionId: e.target.value }); }}>
                            <option value="">
                                {data.autoVersion ? t("addon.center.versionAuto", { version: data.autoVersion.label }) : t("addon.center.versionAutoNoChannel")}
                            </option>
                            {data.versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="cat-panel-state dlp-center-actions">
                    <Button size="sm" icon={<SendIcon />} disabled={!settings.channelId || !data.online || busy !== ""} running={busy === "post"}
                        onClick={() => { void run("post", postAddonCenter, t("addon.center.posted")); }}>
                        {center ? t("addon.center.repost") : t("addon.center.post")}
                    </Button>
                    {state && <span className="note">{state}</span>}
                    {!data.online && <span className="note">{t("addon.center.offline")}</span>}
                    {center && center.url && (
                        <a className={buttonClass("ghost", "sm", true)} href={center.url} target="_blank" rel="noreferrer">
                            <ExternalIcon /> {t("addon.center.view")}
                        </a>
                    )}
                    {center && (
                        <Button variant="ghost" size="sm" disabled={busy !== ""} running={busy === "remove"} onClick={() => { void remove(); }}>
                            {t("common.remove")}
                        </Button>
                    )}
                </div>
            </div>
        </section>
    );
}
