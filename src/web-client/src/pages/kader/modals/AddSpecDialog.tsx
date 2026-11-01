// One new spec for a player, from wherever a spec is chosen (WishPicker's "Spec
// hinzufügen …", a row without any spec): class and spec as in the wish editor.
// The spec is saved at the end of the wishes first and only then handed on (if
// the caller wants it), because the server checks the composition plan and the
// setup slots against the wishes. A version somebody else saved meanwhile is reloaded with a hint
// and the choice stays, so one more click adds it to the fresh wishes.
import { useState } from "react";
import { isStale, saveKaderWishes, type KaderEntry, type KaderWish } from "../../../api";
import { Button } from "../../../components/ui";
import { Modal } from "../../../components/ui/overlay/Modal";
import { PlusIcon } from "../../../components/ui/icons/icons";
import { useT } from "../../../i18n";
import { MAX_WISHES } from "../../../lib/kader/interview";
import { playerName } from "../../../lib/kader/model";
import { useKader } from "../kaderContext";
import { WishAddRow } from "../WishEditor";

export default function AddSpecDialog({ userId, entry, onAdded, onClose }: {
    userId: string;
    entry: KaderEntry;
    onAdded?: (pick: KaderWish) => void;
    onClose: () => void;
}) {
    const t = useT();
    const { view, kader, run, refresh } = useKader();
    const [busy, setBusy] = useState(false);
    const [stale, setStale] = useState(false);

    const add = async (pick: KaderWish): Promise<boolean> => {
        if (entry.wishes.some((w) => w.spec === pick.spec)) {
            onClose();
            onAdded?.(pick);
            return true;
        }
        if (entry.wishes.length >= MAX_WISHES) return false;
        setBusy(true);
        setStale(false);
        const caught = { stale: false };
        const saved = await run(saveKaderWishes(kader.id, userId, [...entry.wishes, pick], { baseRev: entry.interview.rev || 0 }), {
            onError: (e) => {
                if (!isStale(e)) return false;
                caught.stale = true;
                return true;
            },
        });
        setBusy(false);
        if (caught.stale) {
            setStale(true);
            void refresh(true);
            return false;
        }
        if (!saved) return false;
        onClose();
        onAdded?.(pick);
        return true;
    };

    return (
        <Modal open onClose={onClose} icon="kader" tone="kader" kicker={t("kader.wishes.kicker")} title={t("kader.wishes.addOf", { name: playerName(view, userId, entry) })}
            width={520} className="kp-dialog" footer={<Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>}>
            <div className="kp-stack">
                {stale && <p className="kp-hint" role="alert">{t("kader.wishes.addStale")}</p>}
                <WishAddRow wishes={entry.wishes} busy={busy} onAdd={add} />
            </div>
        </Modal>
    );
}

/** "Spec hinzufügen" where a player has none to choose from yet; `onAdded`, if given, runs once the spec is saved. */
export function AddSpecButton({ userId, entry, onAdded }: { userId: string; entry: KaderEntry; onAdded?: (pick: KaderWish) => void }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => setOpen(true)}>{t("kader.wishes.add")}</Button>
            {open && <AddSpecDialog userId={userId} entry={entry} onAdded={onAdded} onClose={() => setOpen(false)} />}
        </>
    );
}
