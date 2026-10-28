import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getVersionLaunch, markVersionLaunch, type ApiError, type LaunchChecklist, type LaunchItem } from "../../api";
import { headLook, itemLabel, itemLink, itemTip, itemValue, statusLook } from "../../lib/settings/versionLaunch";
import { useToast } from "../../components/shell/Jobs";
import { VersionDot } from "../../components/shell/ContentSwitch";
import Badge from "../../components/ui/Badge";
import Segment from "../../components/ui/Segment";
import Switch from "../../components/ui/Switch";
import RaidLoader from "../../components/ui/RaidLoader";
import { FieldLabel } from "../../components/ui/Field";
import { CheckMark, ChevronRightIcon, WarnIcon } from "../../components/ui/icons";
import { tParts, useT } from "../../i18n";
import type { GameVersionOption } from "./SettingsGameVersion";

/** Scroll to a card further up this page (the jump of an item fixed right here). */
function jumpTo(id: string) {
    const el = document.getElementById(id);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function ItemLine({ item, list, versionNames, canExport, busy, onMark }: {
    item: LaunchItem;
    list: LaunchChecklist;
    versionNames: Record<string, string>;
    canExport: boolean;
    busy: boolean;
    onMark: (item: LaunchItem, done: boolean) => void;
}) {
    const t = useT();
    const look = statusLook(item);
    const label = itemLabel(item);
    const link = itemLink(item, { canExport });
    return (
        <li className={`vl-item is-${item.status}${item.optional ? " is-optional" : ""}`} data-item={item.id}>
            <Badge tone={look.tone || undefined} icon={item.status === "done" ? <CheckMark /> : look.tone === "mid" ? <WarnIcon /> : undefined}>{look.label}</Badge>
            <span className="vl-label tipped" tabIndex={0} data-tip={label} data-tip-sub={itemTip(item, list)}>{label}</span>
            <span className="vl-value">{itemValue(item, list, versionNames)}</span>
            <span className="vl-act">
                {item.kind === "manual" && (
                    <Switch
                        className="vl-mark"
                        checked={item.status === "done"}
                        disabled={busy}
                        onChange={(done) => onMark(item, done)}
                        label={<><span className="vl-sr">{t("settings.versionLaunch.markAria", { item: label })} </span><span aria-hidden="true">{t("settings.versionLaunch.mark")}</span></>}
                        tipHead={t("settings.versionLaunch.mark")}
                        tip={t("settings.versionLaunch.manualTip")}
                    />
                )}
                {link && link.kind === "route" && (
                    <Link className="vl-link" to={link.to} data-tip={t("settings.versionLaunch.toLink", { label: link.label })}>{link.label}<ChevronRightIcon /></Link>
                )}
                {link && link.kind === "download" && (
                    <a className="vl-link" href={link.href} download>{link.label}<ChevronRightIcon /></a>
                )}
                {link && link.kind === "jump" && (
                    <button type="button" className="vl-link vl-jump" onClick={() => jumpTo(link.target)}>{t("settings.versionLaunch.jump")}<ChevronRightIcon /></button>
                )}
            </span>
        </li>
    );
}

/**
 * Einstellungen → Spielversion, "Neue Version starten" (#745): the checklist
 * for the day a guild starts a new game version, per target version. The
 * server computes every item from the real data (categories, version
 * settings, templates, series, rosters, guild banks, main version, backup);
 * the items nothing can check carry a switch "erledigt", stored at once (not
 * part of the page's draft). One line per item: badge, label (why and what is
 * open in its tooltip), value, and where it is fixed.
 */
export default function VersionLaunchCard({ versions, canExport, saved }: {
    versions: GameVersionOption[];
    /** The archive download is for full admins. */
    canExport: boolean;
    /** The saved settings: a new value (after a save) reads the list again — it is computed from what is stored. */
    saved?: unknown;
}) {
    const t = useT();
    const toast = useToast();
    const [target, setTarget] = useState("");
    const [list, setList] = useState<LaunchChecklist | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback((versionId: string) => {
        getVersionLaunch(versionId)
            .then((d) => { setList(d.checklist); setError(""); })
            .catch((err) => setError((err as ApiError).message));
    }, []);
    useEffect(() => { load(target); }, [load, target, saved]);

    const mark = async (item: LaunchItem, done: boolean) => {
        if (!list) return;
        setBusy(true);
        try {
            const d = await markVersionLaunch(list.versionId, item.id, done);
            setList(d.checklist);
        } catch (err) {
            toast(t("settings.versionLaunch.markFailed", { message: (err as ApiError).message }), "err");
        } finally {
            setBusy(false);
        }
    };

    const versionNames = Object.fromEntries(versions.map((v) => [v.id, v.short || v.label]));
    const head = list ? headLook(list) : null;
    return (
        <div className="set-card set-form vl-card" id="gv-launch">
            <div className="vl-head">
                <FieldLabel tip={t("settings.versionLaunch.title")} tipSub={t("settings.versionLaunch.titleSub")}>{t("settings.versionLaunch.title")}</FieldLabel>
                {versions.length > 1 && list && (
                    <Segment
                        ariaLabel={t("settings.versionLaunch.target")}
                        size="sm"
                        value={list.versionId}
                        onChange={setTarget}
                        options={versions.map((v) => ({ value: v.id, label: v.short || v.label, tip: v.label, icon: <VersionDot id={v.id} icon={v.icon} label={v.label} /> }))}
                    />
                )}
                {head && <Badge tone={head.tone || undefined} icon={head.tone === "ok" ? <CheckMark /> : undefined}>{head.label}</Badge>}
            </div>
            {!list ? (
                error ? <div className="note">{tParts("settings.versionLaunch.loadError", { message: error })}</div> : <RaidLoader compact text={t("settings.versionLaunch.loading")} />
            ) : (
                <ul className="vl-list">
                    {list.items.map((item) => (
                        <ItemLine key={item.id} item={item} list={list} versionNames={versionNames} canExport={canExport} busy={busy} onMark={mark} />
                    ))}
                </ul>
            )}
        </div>
    );
}
