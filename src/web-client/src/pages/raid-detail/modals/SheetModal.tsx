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
import type { RaidCtx } from "../meta";

export default function SheetModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
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
            label: "Raidsheet füllen",
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
            kicker={ev.title} title="Raidsheet" width={620}
            hint={channel ? `in #${channel}` : undefined}
            footer={<Button variant="ghost" onClick={onClose}>Schließen</Button>}
        >
            <div className="rd-dlg-stack">
                <div className="rd-sheetrow">
                    <IconTile icon="inv_scroll_03" tone={sheetLink ? "ok" : "none"} />
                    <span className="rd-sheetrow-text">
                        <b>{sheetLink ? (own ? (eventSheet?.eventTitle || "Gefülltes Sheet") : (sheetLink.name || "Festes Sheet der Kategorie")) : "Noch kein Sheet"}</b>
                        <span className="rd-muted">
                            {sheetLink
                                ? own
                                    ? eventSheet?.deleteAfter ? `Kopie · wird am ${fmtMs(eventSheet.deleteAfter, false)} gelöscht` : "Kopie für diesen Raid"
                                    : "Festes Sheet der Kategorie"
                                : "Eine Kopie der Vorlage füllen oder der Kategorie ein festes Sheet zuweisen"}
                        </span>
                    </span>
                    {sheetLink && (posted ? <Badge tone="ok">gepostet</Badge> : <Badge tone="mid">nicht gepostet</Badge>)}
                    {sheetLink && (
                        <a className="ibtn sm" href={sheetLink.url} target="_blank" rel="noopener noreferrer" data-tip="Sheet öffnen" aria-label="Sheet öffnen"><ExternalIcon /></a>
                    )}
                </div>

                <div className="rd-dlg-sec">
                    <div className="kicker">Füllen</div>
                    {!raidsheets.length ? (
                        <p className="rd-empty">Keine Raidsheet-Vorlagen. Lege sie in den <Link className="mlink" to="/settings">Einstellungen</Link> an.</p>
                    ) : (
                        <form className="rd-form rd-grid2" onSubmit={fill}>
                            <div className="field">
                                <label
                                    htmlFor="rd-sheet-template" className="tipped" data-tip="Vorlage"
                                    data-tip-sub={matchedSheetId ? "Anhand des Event-Titels vorausgewählt." : "Keine Vorlage passte zum Titel – bitte wählen."}
                                >
                                    Vorlage
                                </label>
                                <select id="rd-sheet-template" value={sheetId} onChange={(e) => setSheetId(e.target.value)} required>
                                    {raidsheets.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="rd-sheet-tank3" className="tipped" data-tip="Tank 3" data-tip-sub="Wird in die dritte Tank-Zeile eingetragen. Zur Wahl stehen die tank-fähigen Raider im Setup.">Tank 3 <span className="rd-muted">optional</span></label>
                                {tankCandidates.length
                                    ? (
                                        <select id="rd-sheet-tank3" value={tank3} onChange={(e) => setTank3(e.target.value)}>
                                            <option value="">— keiner —</option>
                                            {tankCandidates.map((c) => <option key={c.name} value={c.name}>{c.name}{c.specName ? ` — ${c.specName}` : ""}</option>)}
                                        </select>
                                    )
                                    : <input id="rd-sheet-tank3" type="text" value={tank3} onChange={(e) => setTank3(e.target.value)} placeholder="Name des 3. Tanks" />}
                            </div>
                            <div className="rd-form-actions">
                                <Button
                                    type="submit" variant="run" icon="inv_scroll_03" running={filling}
                                    data-tip={own ? "Neu füllen" : "Sheet füllen"} data-tip-sub="Legt eine eigene Kopie der Vorlage an und überträgt das Raid-Helper-Setup. Die Kopie wird 3 Tage nach dem Raid gelöscht."
                                >
                                    {own ? "Neu füllen" : "Kopie füllen"}
                                </Button>
                            </div>
                        </form>
                    )}
                </div>

                {sheetLink && (
                    <div className="rd-dlg-sec">
                        <div className="kicker">In den Channel posten</div>
                        <div className="rd-form rd-inline">
                            <div className="field">
                                <label htmlFor="rd-sheet-msg">Nachricht <span className="rd-muted">optional</span></label>
                                <input id="rd-sheet-msg" type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="z. B. Das Raidsheet für heute Abend – bitte eintragen!" />
                            </div>
                            <Button icon="inv_letter_15" running={posting} onClick={post}>{posted ? "Nachricht aktualisieren" : "Sheet posten"}</Button>
                        </div>
                        {posted && eventSheet?.postedChannelId && eventSheet.postedMessageId && (
                            <a className="mlink rd-small" href={messageLink(data.guildId, eventSheet.postedChannelId, eventSheet.postedMessageId)} target="_blank" rel="noopener noreferrer">
                                Gepostete Nachricht öffnen
                            </a>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}
