// "Fehlende pingen": pings exactly the raiders holding a raider role who have
// not reacted yet — in the event channel, on the talk server, or both (#264).
import { useState } from "react";
import { pingMissingRaiders, type ApiError, type PingTarget } from "../../../api";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { useToast } from "../../../components/Jobs";
import TargetField from "./TargetField";
import { targetHint } from "../../../lib/settingsLogic";
import type { RaidCtx } from "../meta";

export default function PingModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const { data, eventId, csrfToken, onChanged } = ctx;
    const missing = data.attendance.missing.length;
    const [text, setText] = useState("");
    const [target, setTarget] = useState<PingTarget>("event");
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await pingMissingRaiders(csrfToken, { event: eventId, text, target });
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
            kicker={data.event.title} title="Fehlende pingen" width={480}
            hint={targetHint(target, channel, data.pingTargets)}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button type="submit" form="rd-ping-form" icon="inv_letter_15" running={busy} disabled={!missing}>{missing} Raider pingen</Button>
                </>
            )}
        >
            <form id="rd-ping-form" className="rd-form" onSubmit={submit}>
                <TargetField info={data.pingTargets} value={target} onChange={setTarget} />
                <div className="field">
                    <label htmlFor="rd-ping-text">Nachricht <span className="rd-muted">optional</span></label>
                    <input id="rd-ping-text" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Bitte meldet euch für den Raid an oder ab." />
                </div>
            </form>
        </Modal>
    );
}
