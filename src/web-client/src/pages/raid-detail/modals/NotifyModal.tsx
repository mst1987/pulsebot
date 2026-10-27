// "Anmelde-Aufruf": posts a call-to-signup message from a template into the
// event channel and pings the chosen roles there (#894: no other server any more).
import { useState } from "react";
import { Link } from "react-router-dom";
import { canAccess, notifyRaid, type ApiError } from "../../../api";
import { channelHint } from "../../../lib/settings/settingsLogic";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { useToast } from "../../../components/shell/Jobs";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

export default function NotifyModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId, onChanged } = ctx;
    const { notifyTemplates, roles, event: ev } = data;
    const [templateId, setTemplateId] = useState(notifyTemplates[0]?.id ?? "");
    const [roleIds, setRoleIds] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const toggleRole = (id: string) => setRoleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const r = await notifyRaid({ event: eventId, templateId: templateId || notifyTemplates[0]?.id || "", channelId: ev.channelId, roleIds });
            onClose();
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const channel = ev.channelName || ev.channelId;
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_letter_15" tone="raids"
            kicker={ev.title} title={t("raidModals.notify.title")} width={560}
            hint={channelHint(channel)}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    {notifyTemplates.length > 0 && (
                        <Button type="submit" form="rd-notify-form" icon="inv_letter_15" running={busy}>{t("raidModals.notify.post")}</Button>
                    )}
                </>
            )}
        >
            {!notifyTemplates.length ? (
                // the templates are written with `raids` write (global): without it no link into a dead end (#729)
                !ctx.user || canAccess(ctx.user, "raids", "write") ? (
                    <p className="rd-empty">
                        {t("raidModals.notify.noTemplatesBefore")} <Link className="mlink" to="/raids/templates">{t("raidModals.notify.noTemplatesLink")}</Link>{t("raidModals.notify.noTemplatesAfter")}
                    </p>
                ) : <p className="rd-empty">{t("raidModals.notify.noTemplatesOrga")}</p>
            ) : (
                <form id="rd-notify-form" className="rd-form" onSubmit={submit}>
                    <div className="field">
                        <label htmlFor="rd-notify-template">{t("raidModals.notify.template")}</label>
                        <select id="rd-notify-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
                            {notifyTemplates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name || t("raidModals.notify.unnamed")}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label data-tip={t("raidModals.notify.rolesTip")} data-tip-sub={t("raidModals.notify.rolesTipEvent")} className="tipped">{t("raidModals.notify.rolesLabel")}</label>
                        {roles.length
                            ? (
                                <div className="rd-checks">
                                    {roles.map((r) => (
                                        <label key={r.id} className={`rd-check${roleIds.includes(r.id) ? " on" : ""}`}>
                                            <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />
                                            @{r.name}
                                        </label>
                                    ))}
                                </div>
                            )
                            : <p className="rd-empty">{t("raidModals.notify.noRoles")}</p>}
                    </div>
                </form>
            )}
        </Modal>
    );
}
