// "Addons" (#818): the guild's own addons for the game version of the menu —
// one card each with the newest release, a download button per file, "Was ist
// neu?" and a short install guide. Every download goes through the server
// (`/api/addons/download?…`, login required, counted per account); the page
// never sees a GitHub url. The server caches GitHub's answers for ten minutes
// and shows the last good one when GitHub fails (`stale`).
//
// Read with "signup" (every member) or "history" (the loot importers, who had
// the old "Sync-Tool & Addon" page here). A full admin also gets the setup
// hints: a missing or refused GitHub token, with the way to Einstellungen.
//
// Never a blank page: no addons for the version says so (with the versions
// that have some, and for an admin the way to Einstellungen → Module →
// Addons), a failed request says so with "Erneut versuchen". The classes are
// "dlp-", never "ad-": ad blockers hide .ad-card/.ad-grid (styles/addon.css).
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getAddons, type AddonCard, type AddonFile, type AddonsData, type ApiError } from "../../api";
import { AsyncView, Badge, Button, Expand, PageHead, RaidLoader, WowIcon, buttonClass } from "../../components/ui";
import { DownloadIcon, WarnIcon, RefreshIcon } from "../../components/ui/icons";
import { useApi } from "../../hooks/useApi";
import { useContentVersion } from "../../hooks/useContentVersion";
import { formatDate, formatDateTime, formatSize } from "../../lib/format";
import { addonFolder, plainNotes } from "../../lib/addons/addonInstall";
import { useT } from "../../i18n";
import "../../styles/addon.css";
import "../../styles/orga-mark.css";

const ICON = "inv_gizmo_01";
const SETTINGS_LINK = "/settings?section=verbindungen";
const ADDON_SETTINGS_LINK = "/settings?section=addons";

/** "LevelHelper-0.3.0.zip · 380 KB" */
function fileLabel(file: AddonFile): string {
    const size = formatSize(file.size);
    return size ? `${file.name} · ${size}` : file.name;
}

/** Why there is nothing to download, in the words of who is reading. */
function StateNote({ addon, canManage }: { addon: AddonCard; canManage: boolean }) {
    const t = useT();
    if (addon.state === "no_release") return <p className="dlp-state muted">{t("addon.state.noRelease")}</p>;
    if (!canManage) return <p className="dlp-state muted">{t("addon.state.unavailable")}</p>;
    const text = addon.state === "token_missing"
        ? t("addon.admin.tokenMissing", { repo: addon.repo || "" })
        : t(`addon.admin.error.${addon.errorCode || "unreachable"}`);
    return (
        <div className="dlp-state dlp-admin">
            <Badge tone="mid" icon={<WarnIcon />}>{t("addon.admin.badge")}</Badge>
            <span>{text}</span>
            <Link className={buttonClass("ghost", "sm")} to={SETTINGS_LINK}>{t("addon.admin.toSettings")}</Link>
        </div>
    );
}

/** The install steps for the kinds of files the release offers, plus the admin's own note. */
function InstallGuide({ addon, versionId }: { addon: AddonCard; versionId: string }) {
    const t = useT();
    const kinds = new Set((addon.release?.assets || []).map((f) => f.kind));
    const steps: string[] = [];
    if (kinds.has("zip")) steps.push(t("addon.install.zip", { folder: addonFolder(versionId) }));
    if (kinds.has("exe")) steps.push(t("addon.install.exe"));
    if (addon.install) steps.push(addon.install);
    if (!steps.length) return null;
    return (
        <div className="dlp-install">
            <h3>{t("addon.install.title")}</h3>
            <ol>{steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
    );
}

function AddonCardView({ addon, versionId, canManage }: { addon: AddonCard; versionId: string; canManage: boolean }) {
    const t = useT();
    // the Discord centre links here (`#addon-<id>`): open this card's notes and scroll to it
    const { hash } = useLocation();
    const linked = hash === `#addon-${addon.id}`;
    const [open, setOpen] = useState(linked);
    const card = useRef<HTMLElement>(null);
    useEffect(() => {
        if (!linked) return;
        setOpen(true);
        if (card.current && typeof card.current.scrollIntoView === "function") card.current.scrollIntoView({ block: "start" });
    }, [linked]);
    const release = addon.release;
    const date = release && release.publishedAt ? formatDate(Date.parse(release.publishedAt)) : "";
    const notes = release ? plainNotes(release.notes) : "";
    return (
        <section className="dlp-card" id={`addon-${addon.id}`} data-addon={addon.id} ref={card}>
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
                <div className="dlp-files">
                    {release.assets.map((file) => (
                        <a
                            key={file.name}
                            className={buttonClass("primary", "md", true, "dlp-download")}
                            href={file.url}
                            download={file.name}
                            data-tip={file.sha256 ? "SHA-256" : undefined}
                            data-tip-sub={file.sha256 || undefined}
                        >
                            <DownloadIcon />{fileLabel(file)}
                        </a>
                    ))}
                </div>
            ) : release ? (
                <p className="dlp-state muted">{t("addon.state.noFiles")}</p>
            ) : (
                <StateNote addon={addon} canManage={canManage} />
            )}
            {notes && (
                <div className="dlp-news">
                    <Expand open={open} onToggle={() => setOpen(!open)} label={t("addon.news")} />
                    {open && <div className="dlp-notes">{notes}</div>}
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

/** The request failed: what went wrong, and a way to ask again. */
function ErrorState({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
    const t = useT();
    return (
        <div className="empty dlp-error" role="alert">
            <p>{t("addon.loadError")}</p>
            {error.message && <p className="muted">{error.message}</p>}
            <Button variant="ghost" size="sm" icon={<RefreshIcon />} onClick={onRetry}>{t("addon.retry")}</Button>
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
    const { version, versions } = useContentVersion();
    const page = useApi<AddonsData>(() => getAddons(version), [version]);
    const shown = (page.data && page.data.versionId) || version;
    const versionLabel = (versions.find((v) => v.id === shown) || { label: shown }).label;
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
