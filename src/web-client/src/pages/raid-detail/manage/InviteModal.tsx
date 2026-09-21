// "Invite callen": pings the raiders of groups 1–5 of the approved setup in the
// event channel with "/w <Charakter> inv" — the character being the one the
// caller raids with (inviteCall.js). The dialog shows exactly that line and how
// many are pinged, straight from the server's dry run, before anything goes out.
import { useEffect, useState } from "react";
import { callInvite, previewInviteCall, type ApiError } from "../../../api";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { useToast } from "../../../components/Jobs";
import type { RaidCtx } from "../meta";

type Preview = { count: number; text: string; groups: number[] };

export default function InviteModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const { data, eventId, csrfToken, onChanged } = ctx;
    const [preview, setPreview] = useState<Preview | null>(null);
    const [problem, setProblem] = useState("");
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    useEffect(() => {
        if (!open) return;
        let alive = true;
        setPreview(null);
        setProblem("");
        previewInviteCall(csrfToken, eventId)
            .then((p) => { if (alive) setPreview(p); })
            .catch((err: ApiError) => { if (alive) setProblem(err.message); });
        return () => {
            alive = false;
        };
    }, [open, csrfToken, eventId]);

    const submit = async () => {
        setBusy(true);
        try {
            const r = await callInvite(csrfToken, eventId);
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
            open={open} onClose={onClose} icon="spell_holy_prayerofspirit" tone="raids"
            kicker={data.event.title} title="Invite callen" width={460}
            hint={channel ? `Post im Event-Kanal #${channel}` : undefined}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button icon="inv_letter_15" running={busy} disabled={!preview} onClick={submit}>
                        {preview ? `${preview.count} Raider pingen` : "Pingen"}
                    </Button>
                </>
            )}
        >
            {problem && <div className="flash flash-err em-flash">{problem}</div>}
            {!problem && (
                <div className={`em-preview${preview ? "" : " is-loading"}`}>
                    <div className="em-cell">
                        <span className="kicker">Nachricht</span>
                        <span className="em-val em-mono" data-tip={preview?.text || ""}>{preview?.text || "…"}</span>
                    </div>
                    <div className="em-cell">
                        <span className="kicker">Gepingt</span>
                        <span className="em-val">{preview ? `${preview.count} Raider` : "…"}</span>
                        <span
                            className="em-sub"
                            tabIndex={0}
                            data-tip="Wer gepingt wird"
                            data-tip-sub="Alle Raider aus Gruppe 1–5 des freigegebenen Setups, du selbst nicht. Gruppe 6–8 und die Bank warten."
                        >
                            {preview ? `Gruppe ${preview.groups.join(", ")}` : ""}
                        </span>
                    </div>
                </div>
            )}
        </Modal>
    );
}
