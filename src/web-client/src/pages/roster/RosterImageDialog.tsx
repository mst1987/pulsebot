// "Roster als Bild" (docs/roster-profile.md): the roster as the server draws it (Raid-Helper's
// composition: four role panels, one row per person), a fixed snapshot of the moment. Left
// the PNG as preview, right the two switches (bench and pause, the further characters - both
// off), then the channel to post into, prefilled with the roster's last one. Everybody who
// may read the roster may look at it and download it; posting needs the right to manage this
// roster (GET /api/rosters/image/info says canPost) - without it the channel and the post
// button stay hidden. A refused post goes to the shared toast and also stays in the dialog as a
// sentence next to the button: the toast sits under the modal's backdrop.
import { useState } from "react";
import { getRosterImageInfo, postRosterImage, rosterImageUrl, type ApiError, type RosterDetail, type RosterImagePosted } from "../../api";
import { useApi } from "../../hooks/useApi";
import { hasKey, useT, type TFunction } from "../../i18n";
import { Button, Modal, Switch, buttonClass } from "../../components/ui";
import { DownloadIcon, SendIcon } from "../../components/ui/icons/icons";
import { ChannelPicker } from "../../components/settings/settingsUi";
import { useToast } from "../../components/shell/Jobs";
import { imageFileName } from "../../lib/roster/rosterImage";

/** A refused post in words: the dialog's own sentences, the code when there is none. */
function postErrorText(t: TFunction, err: Partial<ApiError> | null): string {
    const code = String((err && err.code) || "");
    return code && hasKey(`roster.image.err.${code}`) ? t(`roster.image.err.${code}`) : t("roster.image.err.unknown", { code: code || "?" });
}

export default function RosterImageDialog({ data, onClose }: { data: RosterDetail; onClose: () => void }) {
    const t = useT();
    const notify = useToast();
    const rosterId = data.roster.id;
    const [reserve, setReserve] = useState(false);
    const [chars, setChars] = useState(false);
    // null = untouched: the roster's last channel is the suggestion
    const [picked, setPicked] = useState<string | null>(null);
    const [preview, setPreview] = useState<"loading" | "ready" | "failed">("loading");
    const [posting, setPosting] = useState(false);
    // the refusal as a sentence, shown next to the post button
    const [refusal, setRefusal] = useState("");
    const [posted, setPosted] = useState<RosterImagePosted | null>(null);
    const info = useApi(() => getRosterImageInfo(rosterId), [rosterId]);

    const url = rosterImageUrl(rosterId, { reserve, chars });
    const canPost = !!info.data?.canPost;
    const channels = info.data?.channels || [];
    const channel = picked ?? info.data?.channelId ?? "";
    const channelName = (id: string) => channels.find((c) => c.id === id)?.name || id;

    const toggle = (set: (v: boolean) => void) => (on: boolean) => {
        set(on);
        setPreview("loading");
        setPosted(null);
    };

    const post = async () => {
        if (!channel) {
            setRefusal(postErrorText(t, { code: "no_channel" }));
            return;
        }
        setPosting(true);
        setRefusal("");
        setPosted(null);
        try {
            setPosted(await postRosterImage(rosterId, channel, { reserve, chars }));
        } catch (err) {
            const text = postErrorText(t, err as ApiError);
            setRefusal(text);
            notify(text, "err");
        } finally {
            setPosting(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="roster"
            tone="roster"
            kicker={data.roster.name}
            title={t("roster.image.title")}
            width={1080}
            className="rn-dlg rn-img-dlg"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
                    <a className={buttonClass("ghost", "md", true)} href={url} download={imageFileName(data.roster.name)}>
                        <DownloadIcon />{t("roster.image.download")}
                    </a>
                    {canPost && <Button variant="go" icon={<SendIcon />} running={posting} onClick={post}>{t("roster.image.post")}</Button>}
                </>
            )}
        >
            <div className="rn-img-body">
                <figure className={`rn-img-preview rn-img-${preview}`}>
                    <img
                        key={url}
                        src={url}
                        alt={t("roster.image.alt", { name: data.roster.name })}
                        onLoad={() => setPreview("ready")}
                        onError={() => setPreview("failed")}
                    />
                    {preview === "loading" && <figcaption className="rn-sub">{t("roster.image.loading")}</figcaption>}
                    {preview === "failed" && <figcaption className="rn-img-err" role="alert">{t("roster.image.previewFailed")}</figcaption>}
                </figure>
                <div className="rn-img-side">
                    <section className="rn-dlg-sec">
                        <div className="rn-lbl">{t("roster.image.show")}</div>
                        <Switch checked={reserve} onChange={toggle(setReserve)} label={t("roster.image.showReserve")} />
                        <Switch checked={chars} onChange={toggle(setChars)} label={t("roster.image.showChars")} tip={t("roster.image.showCharsTip")} />
                    </section>
                    {canPost && (
                        <section className="rn-dlg-sec">
                            <label className="rn-lbl" htmlFor="rn-img-channel">{t("roster.image.channel")}</label>
                            <ChannelPicker
                                id="rn-img-channel"
                                value={channel}
                                channels={channels}
                                onChange={(next) => { setPicked(next); setRefusal(""); setPosted(null); }}
                                placeholder={t("roster.image.pickChannel")}
                            />
                            <p className="rn-sub">{t("roster.image.channelHint")}</p>
                            {refusal && <p className="rn-img-err" role="alert">{refusal}</p>}
                            {posted && (
                                <p className="rn-img-ok" role="status">
                                    {t("roster.image.posted", { channel: channelName(posted.channelId) })}{" "}
                                    <a href={posted.url} target="_blank" rel="noreferrer">{t("roster.image.openMessage")}</a>
                                </p>
                            )}
                        </section>
                    )}
                </div>
            </div>
        </Modal>
    );
}
