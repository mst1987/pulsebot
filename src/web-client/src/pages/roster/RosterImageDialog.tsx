// "Roster als Bild" (docs/roster-profile.md): the roster as the server draws it (Raid-Helper's
// composition: four role panels, one row per person). Left the PNG as preview, right the two
// switches (bench and pause, the further characters - off, or as the running post has them), then
// the channel to post into, prefilled with the running post's or the roster's last one. Everybody
// who may read the roster may look at it and download it (a snapshot); posting needs the right to
// manage this roster (GET /api/rosters/image/info says canPost) - without it the channel and the
// post button stay hidden. A posted picture keeps itself current until it is deleted in Discord; a
// roster has one, so posting again replaces it. A closed roster's post stays a snapshot. A picture
// from before the bot remembered its posts can be attached instead; its field opens on request, as
// few will need it, and a closed roster has none (nothing would keep the picture current). The own
// text replaces the short line and goes along with a post or an attachment. A refused post goes to
// the shared toast and also stays in the dialog as a sentence next to the button: the toast sits
// under the modal's backdrop.
import { useState } from "react";
import { attachRosterImage, getRosterImageInfo, postRosterImage, rosterImageUrl, type ApiError, type RosterDetail, type RosterImagePosted } from "../../api";
import { useApi } from "../../hooks/useApi";
import { hasKey, useT, type TFunction } from "../../i18n";
import { Button, Field, Modal, Switch, buttonClass } from "../../components/ui";
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
    // null = untouched: the running post's text is the suggestion
    const [pickedText, setPickedText] = useState<string | null>(null);
    // the attach form opens on request; what was pasted stays while the server refuses it
    const [attaching, setAttaching] = useState(false);
    const [messageRef, setMessageRef] = useState("");
    const [attachBusy, setAttachBusy] = useState(false);
    // which address the preview has answered for: another address is loading again
    const [drawn, setDrawn] = useState<{ url: string; ok: boolean } | null>(null);
    const [posting, setPosting] = useState(false);
    // the refusal as a sentence, shown next to the post button
    const [refusal, setRefusal] = useState("");
    const [posted, setPosted] = useState<(RosterImagePosted & { attached: boolean }) | null>(null);
    const info = useApi(() => getRosterImageInfo(rosterId), [rosterId]);

    // Until the answer the switches cannot know the running post's values: they wait, and no
    // picture is drawn that the answer would replace at once (the server has one core).
    const answered = !!info.data || !!info.error;
    const live = info.data?.live ?? null;
    const reserve = pickedReserve ?? live?.reserve ?? false;
    const chars = pickedChars ?? live?.chars ?? false;
    const text = pickedText ?? live?.text ?? "";
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

    const refuse = (err: unknown): string => {
        const sentence = postErrorText(t, err as ApiError);
        setRefusal(sentence);
        return sentence;
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
            const result = await postRosterImage(rosterId, channel, { reserve, chars, text });
            // the new post is the running one now; the old one's link is dead
            await info.reload();
            setPosted({ ...result, attached: false });
        } catch (err) {
            notify(refuse(err), "err");
        } finally {
            setPosting(false);
        }
    };

    const attach = async () => {
        setAttachBusy(true);
        setRefusal("");
        setPosted(null);
        try {
            const result = await attachRosterImage(rosterId, channel, messageRef, { reserve, chars, text });
            // the link may name another channel than the picker: the running post's is the suggestion now
            setPicked(null);
            await info.reload();
            setPosted({ ...result, attached: true });
            setAttaching(false);
            setMessageRef("");
        } catch (err) {
            notify(refuse(err), "err");
        } finally {
            setAttachBusy(false);
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
                            <Field label={t("roster.image.text")} htmlFor="rn-img-text" hint={t("roster.image.textHint")}>
                                <textarea
                                    id="rn-img-text"
                                    value={text}
                                    maxLength={500}
                                    rows={2}
                                    onChange={(e) => { setPickedText(e.target.value); setPosted(null); }}
                                />
                            </Field>
                        </section>
                    )}
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
                            {!data.roster.closed && !attaching && (
                                <div className="rn-img-attach-row">
                                    <Button variant="ghost" size="sm" onClick={() => setAttaching(true)}>{t("roster.image.attachOpen")}</Button>
                                </div>
                            )}
                            {!data.roster.closed && attaching && (
                                <>
                                    <label className="rn-lbl" htmlFor="rn-img-message">{t("roster.image.attachLabel")}</label>
                                    <input
                                        id="rn-img-message"
                                        className="inp-sm"
                                        autoComplete="off"
                                        value={messageRef}
                                        maxLength={200}
                                        onChange={(e) => { setMessageRef(e.target.value); setRefusal(""); }}
                                    />
                                    <p className="rn-sub">{t("roster.image.attachHint")}</p>
                                    <div className="rn-img-attach-row">
                                        <Button variant="go" size="sm" running={attachBusy} onClick={attach}>{t("roster.image.attachButton")}</Button>
                                        <Button variant="ghost" size="sm" onClick={() => { setAttaching(false); setRefusal(""); }}>{t("common.cancel")}</Button>
                                    </div>
                                </>
                            )}
                            {refusal && <p className="rn-img-err" role="alert">{refusal}</p>}
                            {posted && (
                                <p className="rn-img-ok" role="status">
                                    {t(posted.attached ? "roster.image.attached" : "roster.image.posted", { channel: channelName(posted.channelId) })}
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
