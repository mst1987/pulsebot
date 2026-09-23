import { useRef, useState } from "react";
import { deleteRaidplanMap, uploadRaidplanMap, type ApiError } from "../../../api";
import { Button, Modal, useConfirm } from "../../../components/ui";
import { useToast } from "../../../components/Jobs";
import { useT } from "../../../i18n";

const MAX_BYTES = 3 * 1024 * 1024;

/** One map a boss can have: `override` = it hides the defaults below it, so removing it is "back to the default". */
export type MapRow = { key: string; label: string; has: boolean; override: boolean };

/**
 * The room maps of a boss, most specific first: this plan's (or this template's)
 * own map, then the boss's default, then the instance's default. Every row can be
 * uploaded, replaced or removed; the board shows the first one that exists. An
 * override's "remove" reads "Auf Standard zurücksetzen". The server checks the
 * file's real type and size again.
 */
export default function MapModal({ open, onClose, csrfToken, rows, onChanged }: {
    open: boolean;
    onClose: () => void;
    csrfToken: string | null;
    rows: MapRow[];
    onChanged: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const [busy, setBusy] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const [target, setTarget] = useState("");

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

    const remove = async (row: MapRow) => {
        const question = row.override
            ? { title: t("raidBoard.board.mapResetTitle"), text: t("raidBoard.board.mapResetText"), action: t("raidBoard.board.mapReset") }
            : { title: t("raidBoard.board.mapRemoveTitle"), text: t("raidBoard.board.mapRemoveText"), action: t("raidBoard.board.mapRemove") };
        if (!(await ask({ ...question, tone: "danger" }))) return;
        setBusy(true);
        try {
            await deleteRaidplanMap(csrfToken, row.key);
            toast(row.override ? t("raidBoard.board.mapWasReset") : t("raidBoard.board.mapRemoved"));
            onChanged();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} icon="inv_misc_map02" title={t("raidBoard.board.mapTitle")} width={560} hint={t("raidBoard.board.mapHelp")}>
            <input
                ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden
                onChange={(e) => { upload(target, e.target.files?.[0]); e.target.value = ""; }}
            />
            {rows.map((row) => (
                <div key={row.key} className="rp-map-row">
                    <div className="rp-map-info">
                        <strong>{row.label}</strong>
                        <span className="rp-muted">{row.has ? t("raidBoard.board.mapHas") : t("raidBoard.board.mapNone")}</span>
                    </div>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setTarget(row.key); input.current?.click(); }}>
                        {row.has ? t("raidBoard.board.mapReplace") : t("raidBoard.board.mapUpload")}
                    </Button>
                    {row.has && (
                        <Button variant="danger" size="sm" disabled={busy} onClick={() => remove(row)}>
                            {row.override ? t("raidBoard.board.mapReset") : t("raidBoard.board.mapRemove")}
                        </Button>
                    )}
                </div>
            ))}
        </Modal>
    );
}
