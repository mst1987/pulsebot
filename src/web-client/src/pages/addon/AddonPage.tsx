// "Addons" (#818): the guild's own addons for the game version of the menu —
// one card each with the newest release, a download button per file, "Was ist
// neu?" with the way to all patch notes (the detail page /addon/<id>,
// AddonDetailPage.tsx) and a short install guide. Every download goes through
// the server (`/api/addons/download?…`, login required, counted per account);
// the page never sees a GitHub url. The server caches GitHub's answers for ten
// minutes and shows the last good one when GitHub fails (`stale`).
//
// Read with "signup" (every member) or "history" (the loot importers, who had
// the old "Sync-Tool & Addon" page here). A full admin also gets the setup
// hints: a missing or refused GitHub token, with the way to Einstellungen.
//
// Never a blank page: no addons for the version says so (with the versions
// that have some, and for an admin the way to Einstellungen → Module →
// Addons), a failed request says so with "Erneut versuchen". The classes are
// "dlp-", never "ad-": ad blockers hide .ad-card/.ad-grid (styles/addon.css).
//
// Old Discord links point at a card's anchor (`/addon#addon-<id>`): they are
// sent on to the detail page, which shows the addon whatever version the menu
// shows (a card of another version would simply not be here).
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getAddons, type AddonCard, type AddonsData } from "../../api";
import { AsyncView, Badge, Expand, PageHead, RaidLoader, WowIcon, buttonClass } from "../../components/ui";
import { NotesIcon, WarnIcon } from "../../components/ui/icons/icons";
import { useApi } from "../../hooks/useApi";
import { useContentVersion } from "../../hooks/useContentVersion";
import { formatDate, formatDateTime } from "../../lib/format";
import { TOKEN_SETTINGS_LINK as SETTINGS_LINK, addonDetailPath as detailPath, plainNotes } from "../../lib/addons/addonInstall";
import { useT } from "../../i18n";
import { CurseforgeLink, DownloadButtons, ErrorState, InstallGuide, StateNote } from "./AddonParts";
import "../../styles/addon.css";
import "../../styles/orga-mark.css";

const ICON = "addons";
const ADDON_SETTINGS_LINK = "/settings/all?section=addons";
const OLD_ANCHOR = /^#addon-(.+)$/;

/** A percent-encoded part of the address, or the text as it is when it does not decode. */
function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function AddonCardView({ addon, versionId, canManage }: { addon: AddonCard; versionId: string; canManage: boolean }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const release = addon.release;
    const date = release && release.publishedAt ? formatDate(Date.parse(release.publishedAt)) : "";
    const notes = release ? plainNotes(release.notes) : "";
    return (
        <section className="dlp-card" id={`addon-${addon.id}`} data-addon={addon.id}>
            <div className="dlp-card-head">
                <WowIcon name={addon.icon} size={40} />
                <div>
                    <h2>{addon.name}</h2>
                    {addon.orgaOnly && (
                        <span className="orga-chip-lbl" data-tip={t("addon.admin.orga")} data-tip-sub={t("addon.admin.orgaTip")}>{t("addon.admin.orga")}</span>
                    )}
                    {release && (
                        <div className="dlp-version muted">
                            {t("addon.version", { version: release.version })}{date ? ` · ${date}` : ""}
                        </div>
                    )}
                </div>
            </div>
            {addon.description && <p className="dlp-desc">{addon.description}</p>}
            {addon.stale && release && (
                <p className="dlp-stale">{t("addon.state.stale", { time: formatDateTime(addon.fetchedAt) })}</p>
            )}
            {release && release.assets.length ? (
                <div className="dlp-files"><DownloadButtons files={release.assets} /><CurseforgeLink addon={addon} /></div>
            ) : (
                <>
                    {release ? <p className="dlp-state muted">{t("addon.state.noFiles")}</p> : <StateNote addon={addon} canManage={canManage} />}
                    {addon.curseforge && <div className="dlp-files"><CurseforgeLink addon={addon} /></div>}
                </>
            )}
            {notes && (
                <div className="dlp-news">
                    <Expand open={open} onToggle={() => setOpen(!open)} label={t("addon.news")} />
                    {open && <div className="dlp-notes">{notes}</div>}
                    {/* the box shows the start only (200 px, faded): the whole notes are on the detail page */}
                    <Link className={buttonClass("ghost", "sm", true, "dlp-all")} to={detailPath(addon.id)}>
                        <NotesIcon />{t("addon.allNotes")}
                    </Link>
                </div>
            )}
            {release && <InstallGuide addon={addon} versionId={versionId} />}
        </section>
    );
}

/** No addon for this version: says so, names the versions that have some, and shows an admin where to set them up. */
function EmptyState({ data, versionLabel }: { data: AddonsData; versionLabel: string }) {
    const t = useT();
    const elsewhere = (data.addonVersions || []).filter((v) => v.id !== data.versionId);
    return (
        <div className="empty dlp-empty">
            <WowIcon name={ICON} size={48} />
            <p>{t("addon.empty", { version: versionLabel })}</p>
            {elsewhere.length > 0 && (
                <p className="muted">{t("addon.emptyElsewhere", { versions: elsewhere.map((v) => v.label).join(", ") })}</p>
            )}
            {data.canManage && (
                <Link className={buttonClass("ghost", "sm")} to={ADDON_SETTINGS_LINK}>{t("addon.admin.toAddonSettings")}</Link>
            )}
        </div>
    );
}

function Content({ data, versionLabel }: { data: AddonsData; versionLabel: string }) {
    const t = useT();
    if (!data.addons.length) return <EmptyState data={data} versionLabel={versionLabel} />;
    const tokenMissing = data.canManage && data.tokenSet === false && data.addons.some((a) => a.state === "token_missing");
    return (
        <>
            {tokenMissing && (
                <div className="dlp-state dlp-admin dlp-banner">
                    <Badge tone="mid" icon={<WarnIcon />}>{t("addon.admin.badge")}</Badge>
                    <span>{t("addon.admin.tokenBanner")}</span>
                    <Link className={buttonClass("ghost", "sm")} to={SETTINGS_LINK}>{t("addon.admin.toSettings")}</Link>
                </div>
            )}
            <div className="dlp-grid">
                {data.addons.map((addon) => (
                    <AddonCardView key={addon.id} addon={addon} versionId={data.versionId} canManage={data.canManage} />
                ))}
            </div>
            <p className="dlp-foot muted">{t("addon.limit", { count: data.downloadLimit })}</p>
        </>
    );
}

export default function AddonPage() {
    const t = useT();
    const { hash } = useLocation();
    const navigate = useNavigate();
    const linked = OLD_ANCHOR.exec(hash);
    const linkedId = linked ? safeDecode(linked[1]) : "";
    // an old link (`/addon#addon-<id>`, Discord before the detail page): on to /addon/<id>
    useEffect(() => {
        if (linkedId) navigate(detailPath(linkedId), { replace: true });
    }, [linkedId, navigate]);
    const { version, versions } = useContentVersion();
    const page = useApi<AddonsData>(() => getAddons(version), [version], { enabled: !linkedId });
    const shown = (page.data && page.data.versionId) || version;
    const versionLabel = (versions.find((v) => v.id === shown) || { label: shown }).label;
    if (linkedId) return <RaidLoader text={t("addon.loading")} />;
    return (
        <>
            <PageHead icon={ICON} tone="system" title={t("addon.title")} />
            <AsyncView
                state={page}
                loading={<RaidLoader text={t("addon.loading")} />}
                error={(err) => <ErrorState error={err} onRetry={() => { void page.reload(); }} />}
            >
                {(data) => <Content data={data} versionLabel={versionLabel} />}
            </AsyncView>
        </>
    );
}
