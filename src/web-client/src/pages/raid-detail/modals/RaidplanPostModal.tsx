// "Einteilungen posten" (#502): the raid plan's read link (/p/<token>) as one
// message in the event channel — the same row and message field as the sheet's
// "In den Channel posten". A draft plan is published by the post; posting again
// edits the message it wrote before.
import { useEffect, useState } from "react";
import { postRaidplanLink, type ApiError } from "../../../api";
import { fmtMs } from "../../../lib/format";
import { messageLink } from "../../../lib/discordLinks";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import IconTile from "../../../components/ui/IconTile";
import { ExternalIcon } from "../../../components/icons";
import { useToast } from "../../../components/Jobs";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

export default function RaidplanPostModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId, onChanged } = ctx;
    const rp = data.raidplanPost || null;
    const ev = data.event;
    const toast = useToast();
    const [message, setMessage] = useState(rp?.message || "");
    const [posting, setPosting] = useState(false);
    // the text of the last post, once the dialog opens again after a reload
    useEffect(() => { if (open) setMessage(rp?.message || ""); }, [open, rp?.message]);

    const channel = ev.channelName || ev.channelId;
    const posted = !!(rp?.channelId && rp?.messageId);

    const post = async () => {
        setPosting(true);
        try {
            const r = await postRaidplanLink({ event: eventId, message });
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setPosting(false);
        }
    };

    let sub = t("raidModals.raidplan.emptyHint");
    if (rp?.filled) sub = rp.published ? t("raidModals.raidplan.publishedHint") : t("raidModals.raidplan.draftHint");
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_map02" tone="raids"
            kicker={ev.title} title={t("raidModals.raidplan.title")} width={560}
            hint={channel ? t("raidModals.shared.inChannel", { channel }) : undefined}
            footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            <div className="rd-dlg-stack">
                <div className="rd-sheetrow">
                    <IconTile icon="inv_misc_map02" tone={rp?.filled ? "ok" : "none"} />
                    <span className="rd-sheetrow-text">
                        <b>{!rp?.filled ? t("raidModals.raidplan.empty") : rp.published ? t("raidModals.raidplan.published") : t("raidModals.raidplan.draft")}</b>
                        <span className="rd-muted">{sub}</span>
                    </span>
                    {rp?.filled && (posted
                        ? <Badge tone="ok">{t("raidModals.raidplan.postedAt", { date: fmtMs(rp.postedAt, false) })}</Badge>
                        : <Badge tone="mid">{t("raidModals.shared.notPosted")}</Badge>)}
                    {rp?.publicPath && (
                        <a className="ibtn sm" href={rp.publicPath} target="_blank" rel="noopener noreferrer" data-tip={t("raidModals.raidplan.open")} aria-label={t("raidModals.raidplan.open")}><ExternalIcon /></a>
                    )}
                </div>

                {rp?.filled && (
                    <div className="rd-dlg-sec">
                        <div className="kicker">{t("raidModals.raidplan.postKicker")}</div>
                        <div className="rd-form rd-inline">
                            <div className="field">
                                <label htmlFor="rd-plan-msg">{t("raidModals.shared.message")} <span className="rd-muted">{t("raidModals.shared.optional")}</span></label>
                                <input id="rd-plan-msg" type="text" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("raidModals.raidplan.messagePlaceholder")} />
                            </div>
                            <Button icon="inv_letter_15" running={posting} onClick={post}>{posted ? t("raidModals.shared.updateMessage") : t("raidModals.raidplan.post")}</Button>
                        </div>
                        {posted && (
                            <a className="mlink rd-small" href={messageLink(data.guildId, rp.channelId, rp.messageId)} target="_blank" rel="noopener noreferrer">
                                {t("raidModals.shared.openPosted")}
                            </a>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}
