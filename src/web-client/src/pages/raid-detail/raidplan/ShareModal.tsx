import { Button, Modal, useConfirm } from "../../../components/ui";
import type { RaidplanBoard, RaidplanBoss } from "../../../api";
import { sheetIncluded, sheetKeysFor } from "../../../lib/raidplan";
import { useToast } from "../../../components/Jobs";
import { useT } from "../../../i18n";

/**
 * "Freigeben & teilen": publishes the saved plan under a link anyone can read
 * without logging in, takes it back, or replaces the link (the old one then
 * stops working). The link is minted on the first publish and stays while the
 * plan is withdrawn — it just does not answer then.
 */
export default function ShareModal({ open, onClose, published, publicPath, dirty, hasApprovedSetup, busy, onPublish, onRotate, sections, draft, onSheet }: {
    open: boolean;
    onClose: () => void;
    published: boolean;
    publicPath: string;
    dirty: boolean;
    hasApprovedSetup: boolean;
    busy: boolean;
    onPublish: (published: boolean) => void;
    onRotate: () => void;
    /** the sections that hold something, and the draft they are switched in or out in */
    sections: RaidplanBoss[];
    draft: Record<string, Partial<RaidplanBoard>>;
    onSheet: (changes: Record<string, boolean>) => void;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const url = publicPath ? `${window.location.origin}${publicPath}` : "";

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            toast(t("raidBoard.share.copied"));
        } catch {
            // no clipboard permission: the field is selectable, so the link can still be copied by hand
        }
    };
    const rotate = async () => {
        if (!(await ask({ title: t("raidBoard.share.rotateTitle"), text: t("raidBoard.share.rotateText"), action: t("raidBoard.share.rotate"), tone: "primary", icon: "inv_misc_key_03" }))) return;
        onRotate();
    };

    const label = (b: RaidplanBoss) => (b.general ? t("raidBoard.assign.general") : b.trash ? `${b.instanceName ? `${b.instanceName}: ` : ""}${t("raidBoard.assign.trash")}` : b.name);
    const quick = (mode: string) => {
        const inKeys = new Set(sheetKeysFor(sections, mode));
        const changes: Record<string, boolean> = {};
        for (const b of sections) changes[b.key] = inKeys.has(b.key);
        onSheet(changes);
    };
    const outCount = sections.filter((b) => !sheetIncluded(draft, b.key)).length;

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_note_02" title={t("raidBoard.share.title")} width={520}
            footer={published
                ? <Button variant="ghost" onClick={() => onPublish(false)} disabled={busy}>{t("raidBoard.share.unpublish")}</Button>
                : <Button onClick={() => onPublish(true)} disabled={busy}>{t("raidBoard.share.publish")}</Button>}
        >
            <p className="rp-muted">{t("raidBoard.share.text")}</p>
            {dirty && <p className="rp-warn">{t("raidBoard.share.unsavedHint")}</p>}
            {!hasApprovedSetup && <p className="rp-warn">{t("raidBoard.share.noSetup")}</p>}
            {sections.length > 0 && (
                <div className="rp-share rp-sheetpick">
                    <span className="rp-kicker">{t("raidBoard.sheet.title")}</span>
                    <div className="rp-share-line">
                        {["all", "none", "bosses", "noTrash"].map((m) => (
                            <Button key={m} variant="ghost" size="sm" onClick={() => quick(m)}>{t(`raidBoard.sheet.quick.${m}`)}</Button>
                        ))}
                    </div>
                    <ul className="rp-sheetlist">
                        {sections.map((b) => (
                            <li key={b.key}>
                                <label>
                                    <input type="checkbox" checked={sheetIncluded(draft, b.key)} onChange={(e) => onSheet({ [b.key]: e.target.checked })} />
                                    <span>{label(b)}</span>
                                </label>
                            </li>
                        ))}
                    </ul>
                    {outCount > 0 && <p className="rp-muted">{t("raidBoard.sheet.outCount", { n: outCount })}</p>}
                </div>
            )}
            {url && (
                <div className="rp-share">
                    <span className="rp-kicker">{t("raidBoard.share.link")}</span>
                    <div className="rp-share-line">
                        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t("raidBoard.share.link")} />
                        <Button variant="ghost" size="sm" onClick={copy}>{t("raidBoard.share.copy")}</Button>
                    </div>
                    <div className="rp-share-line">
                        {published && <a className="mlink" href={publicPath} target="_blank" rel="noreferrer">{t("raidBoard.share.open")}</a>}
                        <Button variant="ghost" size="sm" onClick={rotate} disabled={busy}>{t("raidBoard.share.rotate")}</Button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
