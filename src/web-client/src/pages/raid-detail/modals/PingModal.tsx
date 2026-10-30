// "Fehlende pingen": pings exactly the raiders holding a raider role who have
// not reacted yet — in the event channel of the raid's server; whoever is not
// on that server gets a DM (#894).
import { useState } from "react";
import { pingMissingRaiders, type ApiError } from "../../../api";
import { Modal } from "../../../components/ui/overlay/Modal";
import { Button } from "../../../components/ui/Button";
import { useToast } from "../../../components/shell/Jobs";
import { channelHint } from "../../../lib/settings/settingsLogic";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

export default function PingModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId, onChanged } = ctx;
    const missing = data.attendance.missing.length;
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await pingMissingRaiders({ event: eventId, text });
            setText("");
            onClose();
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const channel = data.event.channelName || data.event.channelId;
    return (
        <Modal
            open={open} onClose={onClose} icon="notify" tone="bad"
            kicker={data.event.title} title={t("raidModals.ping.title")} width={480}
            hint={channelHint(channel)}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="rd-ping-form" icon="notify" running={busy} disabled={!missing}>{t("raidModals.ping.submit", { count: missing })}</Button>
                </>
            )}
        >
            <form id="rd-ping-form" className="rd-form" onSubmit={submit}>
                <p className="rd-muted">{t("raidModals.ping.dmNote")}</p>
                <div className="field">
                    <label htmlFor="rd-ping-text">{t("raidModals.shared.message")} <span className="rd-muted">{t("raidModals.shared.optional")}</span></label>
                    <input id="rd-ping-text" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("raidModals.ping.placeholder")} />
                </div>
            </form>
        </Modal>
    );
}
