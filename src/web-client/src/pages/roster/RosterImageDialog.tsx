// "Roster als Bild" (docs/roster-profile.md): the roster as the server draws it (Raid-Helper's
// composition: four role panels, one row per person). Left the PNG as preview, right the two
// switches (bench and pause, the further characters - off, or as the running post has them), then
// the channel to post into, prefilled with the running post's or the roster's last one. Everybody
// who may read the roster may look at it and download it (a snapshot); posting needs the right to
// manage this roster (GET /api/rosters/image/info says canPost) - without it the channel and the
// post button stay hidden. A posted picture keeps itself current until it is deleted in Discord; a
// roster has one, so posting again replaces it. A closed roster's post stays a snapshot. A refused
// post goes to the shared toast and also stays in the dialog as a sentence next to the button: the
// toast sits under the modal's backdrop.
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
    // null = untouched: the running post's value is the suggestion, else off
    const [pickedReserve, setPickedReserve] = useState<boolean | null>(null);
    const [pickedChars, setPickedChars] = useState<boolean | null>(null);
    // null = untouched: the running post's channel, else the roster's last one, is the suggestion
    const [picked, setPicked] = useState<string | null>(null);
    // which address the preview has answered for: another address is loading again
    const [drawn, setDrawn] = useState<{ url: string; ok: boolean } | null>(null);
    const [posting, setPosting] = useState(false);
    // the refusal as a sentence, shown next to the post button
    const [refusal, setRefusal] = useState("");
    const [posted, setPosted] = useState<RosterImagePosted | null>(null);
    const info = useApi(() => getRosterImageInfo(rosterId), [rosterId]);

    // Until the answer the switches cannot know the running post's values: they wait, and no
    // picture is drawn that the answer would replace at once (the server has one core).
    const answered = !!info.data || !!info.error;
    const live = info.data?.live ?? null;
    const reserve = pickedReserve ?? live?.reserve ?? false;
    const chars = pickedChars ?? live?.chars ?? false;
    const url = rosterImageUrl(rosterId, { reserve, chars });
    const preview = !answered || drawn?.url !== url ? "loading" : drawn.ok ? "ready" : "failed";
    const canPost = !!info.data?.canPost;
    const channels = info.data?.channels || [];
    const channel = picked ?? live?.channelId ?? info.data?.channelId ?? "";
    const channelName = (id: string) => channels.find((c) => c.id === id)?.name || id;

    const toggle = (set: (v: boolean) => void) => (on: boolean) => {
        set(on);
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
            const result = await postRosterImage(rosterId, channel, { reserve, chars });
            // the new post is the running one now; the old one's link is dead
            await info.reload();
            setPosted(result);
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
                    {canPost && <Button variant="go" icon={<SendIcon />} running={posting} onClick={post}>{t(live ? "roster.image.repost" : "roster.image.post")}</Button>}
                </>
            )}
        >
            <div className="rn-img-body">
                <figure className={`rn-img-preview rn-img-${preview}`}>
                    {answered && (
                        <img
                            key={url}
                            src={url}
                            alt={t("roster.image.alt", { name: data.roster.name })}
                            onLoad={() => setDrawn({ url, ok: true })}
                            onError={() => setDrawn({ url, ok: false })}
                        />
                    )}
                    {preview === "loading" && <figcaption className="rn-sub">{t("roster.image.loading")}</figcaption>}
                    {preview === "failed" && <figcaption className="rn-img-err" role="alert">{t("roster.image.previewFailed")}</figcaption>}
                </figure>
                <div className="rn-img-side">
                    <section className="rn-dlg-sec">
                        <div className="rn-lbl">{t("roster.image.show")}</div>
                        <Switch checked={reserve} disabled={!answered} onChange={toggle(setPickedReserve)} label={t("roster.image.showReserve")} />
                        <Switch checked={chars} disabled={!answered} onChange={toggle(setPickedChars)} label={t("roster.image.showChars")} tip={t("roster.image.showCharsTip")} />
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
                            {live ? (
                                <>
                                    <p className="rn-sub">
                                        {t("roster.image.live", { channel: channelName(live.channelId) })}
                                        {live.url && <>{" "}<a href={live.url} target="_blank" rel="noreferrer">{t("roster.image.openMessage")}</a></>}
                                    </p>
                                    <p className="rn-sub">{t("roster.image.repostHint")}</p>
                                </>
                            ) : (
                                <p className="rn-sub">{t(data.roster.closed ? "roster.image.closedHint" : "roster.image.channelHint")}</p>
                            )}
                            {refusal && <p className="rn-img-err" role="alert">{refusal}</p>}
                            {posted && (
                                <p className="rn-img-ok" role="status">
                                    {t("roster.image.posted", { channel: channelName(posted.channelId) })}
                                    {!live?.url && <>{" "}<a href={posted.url} target="_blank" rel="noreferrer">{t("roster.image.openMessage")}</a></>}
                                </p>
                            )}
                        </section>
                    )}
                </div>
            </div>
        </Modal>
    );
}
