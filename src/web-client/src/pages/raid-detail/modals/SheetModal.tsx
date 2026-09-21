// "Raidsheet": which sheet the raid links (its own filled copy or the
// category's fixed one), filling a fresh copy from the raidplan, and posting
// the link into the event channel — the three things that used to be three
// forms with a paragraph each.
import { useState } from "react";
import { Link } from "react-router-dom";
import { fillRaidsheet, postRaidSheet, type ApiError } from "../../../api";
import { fmtMs } from "../../../lib/format";
import { messageLink } from "../../../lib/discordLinks";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import IconTile from "../../../components/ui/IconTile";
import { ExternalIcon } from "../../../components/icons";
import { useJobs, useToast } from "../../../components/Jobs";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

export default function SheetModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId, csrfToken, onChanged } = ctx;
    const { raidsheets, matchedSheetId, tankCandidates, eventSheet, sheetLink, event: ev } = data;
    const jobs = useJobs();
    const toast = useToast();
    const [sheetId, setSheetId] = useState(matchedSheetId || raidsheets[0]?.id || "");
    const [tank3, setTank3] = useState("");
    const [message, setMessage] = useState(eventSheet?.postedMessage || "");
    const [filling, setFilling] = useState(false);
    const [posting, setPosting] = useState(false);

    const channel = ev.channelName || ev.channelId;
    const posted = !!(eventSheet?.postedChannelId && eventSheet?.postedMessageId);

    // Copying the template in Drive and writing the setup takes a while; it runs
    // as a background job so the page stays usable meanwhile.
    const fill = (e: React.FormEvent) => {
        e.preventDefault();
        setFilling(true);
        jobs.run({
            label: t("raidModals.sheet.fillJob"),
            detail: ev.title,
            icon: "inv_scroll_03",
            expectedSeconds: 20,
            describe: (r) => ({ message: r.message }),
        }, () => fillRaidsheet(csrfToken, { event: eventId, sheetId: sheetId || raidsheets[0]?.id || "", tank3, eventTitle: ev.title, eventStartTime: ev.startTime })).then(() => {
            setFilling(false);
            onChanged("");
        });
    };

    const post = async () => {
        setPosting(true);
        try {
            const r = await postRaidSheet(csrfToken, { event: eventId, message });
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setPosting(false);
        }
    };

    const own = sheetLink?.source === "event";
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_scroll_03" tone="raids"
            kicker={ev.title} title={t("raidModals.sheet.title")} width={620}
            hint={channel ? t("raidModals.shared.inChannel", { channel }) : undefined}
            footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            <div className="rd-dlg-stack">
                <div className="rd-sheetrow">
                    <IconTile icon="inv_scroll_03" tone={sheetLink ? "ok" : "none"} />
                    <span className="rd-sheetrow-text">
                        <b>{sheetLink ? (own ? (eventSheet?.eventTitle || t("raidModals.sheet.filled")) : (sheetLink.name || t("raidModals.sheet.categorySheet"))) : t("raidModals.sheet.none")}</b>
                        <span className="rd-muted">
                            {sheetLink
                                ? own
                                    ? eventSheet?.deleteAfter ? t("raidModals.sheet.copyDeleted", { date: fmtMs(eventSheet.deleteAfter, false) }) : t("raidModals.sheet.copyForRaid")
                                    : t("raidModals.sheet.categorySheet")
                                : t("raidModals.sheet.noneHint")}
                        </span>
                    </span>
                    {sheetLink && (posted ? <Badge tone="ok">{t("raidModals.shared.posted")}</Badge> : <Badge tone="mid">{t("raidModals.shared.notPosted")}</Badge>)}
                    {sheetLink && (
                        <a className="ibtn sm" href={sheetLink.url} target="_blank" rel="noopener noreferrer" data-tip={t("raidModals.sheet.open")} aria-label={t("raidModals.sheet.open")}><ExternalIcon /></a>
                    )}
                </div>

                <div className="rd-dlg-sec">
                    <div className="kicker">{t("raidModals.sheet.fillKicker")}</div>
                    {!raidsheets.length ? (
                        <p className="rd-empty">{t("raidModals.sheet.noTemplatesBefore")} <Link className="mlink" to="/settings">{t("raidModals.sheet.noTemplatesLink")}</Link>{t("raidModals.sheet.noTemplatesAfter")}</p>
                    ) : (
                        <form className="rd-form rd-grid2" onSubmit={fill}>
                            <div className="field">
                                <label
                                    htmlFor="rd-sheet-template" className="tipped" data-tip={t("raidModals.sheet.template")}
                                    data-tip-sub={matchedSheetId ? t("raidModals.sheet.templateMatched") : t("raidModals.sheet.templateUnmatched")}
                                >
                                    {t("raidModals.sheet.template")}
                                </label>
                                <select id="rd-sheet-template" value={sheetId} onChange={(e) => setSheetId(e.target.value)} required>
                                    {raidsheets.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="rd-sheet-tank3" className="tipped" data-tip={t("raidModals.sheet.tank3")} data-tip-sub={t("raidModals.sheet.tank3TipSub")}>{t("raidModals.sheet.tank3")} <span className="rd-muted">{t("raidModals.shared.optional")}</span></label>
                                {tankCandidates.length
                                    ? (
                                        <select id="rd-sheet-tank3" value={tank3} onChange={(e) => setTank3(e.target.value)}>
                                            <option value="">{t("raidModals.sheet.noTank")}</option>
                                            {tankCandidates.map((c) => <option key={c.name} value={c.name}>{c.name}{c.specName ? ` — ${c.specName}` : ""}</option>)}
                                        </select>
                                    )
                                    : <input id="rd-sheet-tank3" type="text" value={tank3} onChange={(e) => setTank3(e.target.value)} placeholder={t("raidModals.sheet.tank3Placeholder")} />}
                            </div>
                            <div className="rd-form-actions">
                                <Button
                                    type="submit" variant="run" icon="inv_scroll_03" running={filling}
                                    data-tip={own ? t("raidModals.sheet.refill") : t("raidModals.sheet.fillSheet")} data-tip-sub={t("raidModals.sheet.fillTipSub")}
                                >
                                    {own ? t("raidModals.sheet.refill") : t("raidModals.sheet.fillCopy")}
                                </Button>
                            </div>
                        </form>
                    )}
                </div>

                {sheetLink && (
                    <div className="rd-dlg-sec">
                        <div className="kicker">{t("raidModals.sheet.postKicker")}</div>
                        <div className="rd-form rd-inline">
                            <div className="field">
                                <label htmlFor="rd-sheet-msg">{t("raidModals.shared.message")} <span className="rd-muted">{t("raidModals.shared.optional")}</span></label>
                                <input id="rd-sheet-msg" type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("raidModals.sheet.messagePlaceholder")} />
                            </div>
                            <Button icon="inv_letter_15" running={posting} onClick={post}>{posted ? t("raidModals.shared.updateMessage") : t("raidModals.sheet.post")}</Button>
                        </div>
                        {posted && eventSheet?.postedChannelId && eventSheet.postedMessageId && (
                            <a className="mlink rd-small" href={messageLink(data.guildId, eventSheet.postedChannelId, eventSheet.postedMessageId)} target="_blank" rel="noopener noreferrer">
                                {t("raidModals.shared.openPosted")}
                            </a>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}
