// "Fehlende pingen": pings exactly the raiders holding a raider role who have
// not reacted yet — in the event channel, on the talk server, or both (#264).
import { useState } from "react";
import { pingMissingRaiders, type ApiError, type PingTarget } from "../../../api";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { useToast } from "../../../components/Jobs";
import TargetField from "./TargetField";
import { targetHint } from "../../../lib/settingsLogic";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

export default function PingModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId, onChanged } = ctx;
    const missing = data.attendance.missing.length;
    const [text, setText] = useState("");
    const [target, setTarget] = useState<PingTarget>("event");
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await pingMissingRaiders({ event: eventId, text, target });
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
            open={open} onClose={onClose} icon="spell_holy_borrowedtime" tone="bad"
            kicker={data.event.title} title={t("raidModals.ping.title")} width={480}
            hint={targetHint(target, channel, data.pingTargets)}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="rd-ping-form" icon="inv_letter_15" running={busy} disabled={!missing}>{t("raidModals.ping.submit", { count: missing })}</Button>
                </>
            )}
        >
            <form id="rd-ping-form" className="rd-form" onSubmit={submit}>
                <TargetField info={data.pingTargets} value={target} onChange={setTarget} />
                <div className="field">
                    <label htmlFor="rd-ping-text">{t("raidModals.shared.message")} <span className="rd-muted">{t("raidModals.shared.optional")}</span></label>
                    <input id="rd-ping-text" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("raidModals.ping.placeholder")} />
                </div>
            </form>
        </Modal>
    );
}
