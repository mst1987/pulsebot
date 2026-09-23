import { useRef, useState } from "react";
import { deleteRaidplanMap, uploadRaidplanMap, type ApiError, type RaidplanBoss } from "../../../api";
import { Button, Modal, useConfirm } from "../../../components/ui";
import { useToast } from "../../../components/Jobs";
import { useT } from "../../../i18n";

const MAX_BYTES = 3 * 1024 * 1024;

/**
 * The room map of a boss: one for this boss, and one for the whole instance
 * that every boss without its own falls back to. Only uploads and removals live
 * here; the board just shows whichever map applies. The server checks the
 * file's real type and size again.
 */
export default function MapModal({ open, onClose, csrfToken, boss, instanceHasMap, onChanged }: {
    open: boolean;
    onClose: () => void;
    csrfToken: string | null;
    boss: RaidplanBoss | null;
    /** Whether the instance has a map of its own (the boss may show it as its fallback). */
    instanceHasMap: boolean;
    onChanged: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const [busy, setBusy] = useState(false);
    const bossInput = useRef<HTMLInputElement>(null);
    const instanceInput = useRef<HTMLInputElement>(null);
    if (!boss) return null;

    const upload = async (key: string, file: File | undefined) => {
        if (!file) return;
        if (file.size > MAX_BYTES) { toast(t("raidBoard.board.mapTooBig"), "err"); return; }
        setBusy(true);
        try {
            await uploadRaidplanMap(csrfToken, key, file);
            toast(t("raidBoard.board.mapUploaded"));
            onChanged();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const remove = async (key: string) => {
        if (!(await ask({ title: t("raidBoard.board.mapRemoveTitle"), text: t("raidBoard.board.mapRemoveText"), action: t("raidBoard.board.mapRemove"), tone: "danger" }))) return;
        setBusy(true);
        try {
            await deleteRaidplanMap(csrfToken, key);
            toast(t("raidBoard.board.mapRemoved"));
            onChanged();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const entry = (key: string, label: string, has: boolean, input: React.RefObject<HTMLInputElement>) => (
        <div className="rp-map-row">
            <div className="rp-map-info">
                <strong>{label}</strong>
                <span className="rp-muted">{has ? "✓" : "–"}</span>
            </div>
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { upload(key, e.target.files?.[0]); e.target.value = ""; }} />
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => input.current?.click()}>
                {has ? t("raidBoard.board.mapReplace") : t("raidBoard.board.mapUpload")}
            </Button>
            {has && <Button variant="danger" size="sm" disabled={busy} onClick={() => remove(key)}>{t("raidBoard.board.mapRemove")}</Button>}
        </div>
    );

    return (
        <Modal open={open} onClose={onClose} icon="inv_misc_map_01" title={t("raidBoard.board.mapUpload")} width={520} hint={t("raidBoard.board.mapHelp")}>
            {entry(boss.key, `${t("raidBoard.board.mapForBoss")}: ${boss.name}`, boss.ownMap, bossInput)}
            {entry(boss.instanceId, `${t("raidBoard.board.mapForInstance")}: ${boss.instanceName}`, instanceHasMap, instanceInput)}
        </Modal>
    );
}
