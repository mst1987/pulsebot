// "Specs bearbeiten": the wishes of one player, wherever they are in the Kader,
// without starting an interview. Same editor as the interview; a version somebody
// else saved meanwhile is never overwritten silently (ConflictBanner). What the
// wishes no longer hold leaves the setup slots on the server.
import { useEffect, useState } from "react";
import { isStale, saveKaderWishes, type KaderEntry, type KaderStaleError, type KaderWish } from "../../../api";
import { Button } from "../../../components/ui";
import { Modal } from "../../../components/ui/overlay/Modal";
import { SaveIcon } from "../../../components/ui/icons/icons";
import { useT } from "../../../i18n";
import { personName } from "../../../lib/kader/live";
import { playerName } from "../../../lib/kader/model";
import { useKader } from "../kaderContext";
import { ConflictBanner, PresenceBanner } from "../live/Presence";
import { WishEditor } from "../WishEditor";

function WishesDialog({ userId, entry, onClose }: { userId: string; entry: KaderEntry; onClose: () => void }) {
    const t = useT();
    const { view, kader, canWrite, run, refresh } = useKader();
    const [draft, setDraft] = useState<KaderWish[]>(entry.wishes);
    const [base, setBase] = useState<KaderEntry>(entry);
    const [conflict, setConflict] = useState<{ by: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const dirty = JSON.stringify(draft) !== JSON.stringify(base.wishes);

    const takeCurrent = () => {
        setDraft(entry.wishes);
        setBase(entry);
        setConflict(null);
    };
    // somebody else's save comes in live: an untouched dialog simply follows it
    useEffect(() => {
        if (!dirty && (entry.interview.rev || 0) !== (base.interview.rev || 0)) takeCurrent();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only a newer version of the entry
    }, [entry.interview.rev]);

    /** Saves the draft; `force` overwrites a version somebody else saved meanwhile. */
    const save = async (force = false) => {
        if (!dirty && !force) return onClose();
        setBusy(true);
        const caught: { stale?: KaderStaleError } = {};
        const saved = await run(saveKaderWishes(kader.id, userId, draft, force ? { force: true } : { baseRev: base.interview.rev || 0 }), {
            onError: (e) => {
                if (!isStale(e)) return false;
                caught.stale = e;
                return true;
            },
        });
        setBusy(false);
        if (caught.stale) {
            setConflict({ by: caught.stale.by || "" });
            void refresh(true);
            return undefined;
        }
        if (saved) onClose();
        return undefined;
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon="kader"
            tone="kader"
            kicker={t("kader.wishes.kicker")}
            title={t("kader.wishes.title", { name: playerName(view, userId, entry) })}
            width={620}
            className="kp-dialog"
            footer={canWrite ? (
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button variant="go" icon={<SaveIcon />} disabled={busy || !!conflict} onClick={() => void save()}>{t("common.apply")}</Button>
                </>
            ) : <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            <div className="kp-stack">
                <PresenceBanner playerId={userId} what="interview" />
                {conflict && (
                    <ConflictBanner busy={busy} text={t("kader.live.conflict.wishes", { name: personName(view, conflict.by) })}
                        onReload={takeCurrent} onOverwrite={() => void save(true)} />
                )}
                <WishEditor wishes={draft} prefill={null} locked={!canWrite} onChange={setDraft} />
            </div>
        </Modal>
    );
}

/** The dialog closes itself when the player is gone (removed live by somebody else). */
export default function WishesModal({ userId, onClose }: { userId: string; onClose: () => void }) {
    const { kader } = useKader();
    const entry = kader.players[userId];
    if (!entry) return null;
    return <WishesDialog userId={userId} entry={entry} onClose={onClose} />;
}
