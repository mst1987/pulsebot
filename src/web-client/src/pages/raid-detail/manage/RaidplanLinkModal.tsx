// "Raidplan aktivieren" for a Raid-Helper event (docs/raidplan.md, "Raid-Helper-Events"): the event has no instance, size or game
// version of its own, so they are taken from its title and shown here to be checked - instance chips, size, version. The line-up itself
// comes from Raid-Helper and stays read only; the dialog says so, and warns when Raid-Helper does not name the groups.
import { useEffect, useState } from "react";
import { getRaidplanLink, setRaidplanLink, type ApiError } from "../../../api";
import { useApi } from "../../../hooks/useApi";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { useToast } from "../../../components/Jobs";
import { linkSizes, linkStart } from "../../../lib/eventManage";
import { useT } from "../../../i18n";
import type { RaidCtx } from "../meta";

export default function RaidplanLinkModal({ ctx, open, onClose, onDone }: { ctx: RaidCtx; open: boolean; onClose: () => void; onDone: () => void }) {
    const t = useT();
    const { data, eventId } = ctx;
    const toast = useToast();
    const [chosen, setChosen] = useState<string[]>([]);
    const [size, setSize] = useState(0);
    const [busy, setBusy] = useState(false);

    // Asked each time the dialog opens (nothing to pick from while it loads); a failed load is a toast, the dialog stays.
    const linkData = useApi(() => getRaidplanLink(eventId).then((v) => {
        const start = linkStart(v.link, v.suggestion);
        setChosen(start.instanceIds);
        setSize(start.size);
        return v;
    }), [eventId], { enabled: open });
    const view = linkData.loading ? null : linkData.data;
    useEffect(() => { if (linkData.error) toast(linkData.error.message, "err"); }, [linkData.error, toast]);

    const sizes = view ? linkSizes(view.instances, chosen) : [];
    const toggle = (id: string) => {
        const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
        setChosen(next);
        const fit = view ? linkSizes(view.instances, next) : [];
        if (fit.length > 0 && !fit.includes(size)) setSize(fit[fit.length - 1]);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chosen.length) return;
        setBusy(true);
        try {
            await setRaidplanLink({ event: eventId, enabled: true, instanceIds: chosen, size, versionId: view ? view.suggestion.versionId : "tbc" });
            toast(t("raidDetail.raidplanLink.activated"));
            onClose();
            onDone();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const detected = !!view && view.suggestion.instanceIds.length > 0;
    const lineup = view ? view.lineup : undefined;
    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_map02" tone="raids"
            kicker={data.event.title} title={t("raidDetail.raidplanLink.title")} width={560}
            hint={t("raidDetail.raidplanLink.readOnly")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="em-rplink-form" variant="primary" running={busy} disabled={!view || chosen.length === 0}>{t("raidDetail.raidplanLink.confirm")}</Button>
                </>
            )}
        >
            {!view && <p className="em-sub">{t("raidDetail.page.loading")}</p>}
            {view && (
                <form id="em-rplink-form" className="rd-form" onSubmit={submit}>
                    {view.raidhelperDisabled && <p className="flash flash-err em-flash">{t("raidDetail.manage.raidplanDisabled")}</p>}
                    <div className="field">
                        <label>{t("raidDetail.raidplanLink.instances")} <span className="rd-muted">{detected ? t("raidDetail.raidplanLink.detected") : t("raidDetail.raidplanLink.noneDetected")}</span></label>
                        <div className="em-chips" role="group" aria-label={t("raidDetail.raidplanLink.instances")}>
                            {view.instances.map((i) => (
                                <button key={i.id} type="button" className={`em-chip${chosen.includes(i.id) ? " on" : ""}`} aria-pressed={chosen.includes(i.id)} data-tip={i.name} onClick={() => toggle(i.id)}>
                                    {i.short || i.name}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="em-fields">
                        <div className="field">
                            <label htmlFor="em-rplink-size">{t("raidDetail.raidplanLink.size")}</label>
                            <select id="em-rplink-size" value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={sizes.length === 0}>
                                {sizes.length === 0 && <option value={0}>{t("raidDetail.raidplanLink.sizeNone")}</option>}
                                {sizes.map((s) => <option key={s} value={s}>{t("raidDetail.raidplanLink.sizeValue", { size: s })}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="em-rplink-version">{t("raidDetail.raidplanLink.version")}</label>
                            <select id="em-rplink-version" value={view.suggestion.versionId} disabled>
                                <option value="tbc">{t("raidDetail.raidplanLink.versionTbc")}</option>
                            </select>
                        </div>
                    </div>
                    {lineup && (
                        <p className="em-sub">
                            {lineup.available ? t("raidDetail.raidplanLink.players", { count: lineup.count }) : t("raidDetail.raidplanLink.noPlayers")}
                            {lineup.available && lineup.unmatchedNames > 0 && ` · ${t("raidBoard.rh.unmatched", { count: lineup.unmatchedNames })}`}
                        </p>
                    )}
                    {lineup && lineup.available && !lineup.hasGroups && <p className="rp-warn em-flash">{t("raidBoard.rh.noGroups")}</p>}
                </form>
            )}
        </Modal>
    );
}
