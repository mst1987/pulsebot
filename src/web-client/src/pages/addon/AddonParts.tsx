// The pieces the page "Addons" (#818) and the detail page /addon/<id> share:
// the download buttons (always the server's route, never GitHub), why there is
// nothing to download, and the install steps.
import { Link } from "react-router-dom";
import type { AddonCard, AddonFile, ApiError } from "../../api";
import { Badge, Button, buttonClass } from "../../components/ui";
import { DownloadIcon, RefreshIcon, WarnIcon } from "../../components/ui/icons";
import { TOKEN_SETTINGS_LINK, addonFolder, fileLabel } from "../../lib/addons/addonInstall";
import { useT } from "../../i18n";

/** The request failed: what went wrong, and a way to ask again. */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
    const t = useT();
    return (
        <div className="empty dlp-error" role="alert">
            <p>{t("addon.loadError")}</p>
            {error.message && <p className="muted">{error.message}</p>}
            <Button variant="ghost" size="sm" icon={<RefreshIcon />} onClick={onRetry}>{t("addon.retry")}</Button>
        </div>
    );
}

/** One download button per offered file: the server's route, the SHA-256 in the tooltip. */
export function DownloadButtons({ files, className = "" }: { files: AddonFile[]; className?: string }) {
    return (
        <>
            {files.map((file) => (
                <a
                    key={file.name}
                    className={buttonClass("primary", "md", true, ["dlp-download", className].filter(Boolean).join(" "))}
                    href={file.url}
                    download={file.name}
                    data-tip={file.sha256 ? "SHA-256" : undefined}
                    data-tip-sub={file.sha256 || undefined}
                >
                    <DownloadIcon /><span className="dlp-file-label">{fileLabel(file)}</span>
                </a>
            ))}
        </>
    );
}

/** Why there is nothing to download, in the words of who is reading. */
export function StateNote({ addon, canManage }: { addon: AddonCard; canManage: boolean }) {
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
            <Link className={buttonClass("ghost", "sm")} to={TOKEN_SETTINGS_LINK}>{t("addon.admin.toSettings")}</Link>
        </div>
    );
}

/**
 * The install steps for the kinds of files the release offers, plus the admin's own note.
 * The zip goes into the folder of `versionId`; with `folders` instead (the detail page,
 * an addon for several versions none of which the menu shows) each version's folder is named.
 */
export function InstallGuide({ addon, versionId = "", folders, className = "" }: {
    addon: AddonCard;
    versionId?: string;
    /** every version's folder with the version's name: "<WoW>\_anniversary_\… (WoW TBC)" */
    folders?: { id: string; label: string }[];
    className?: string;
}) {
    const t = useT();
    const kinds = new Set((addon.release?.assets || []).map((f) => f.kind));
    const steps: string[] = [];
    const folder = folders && folders.length > 1
        ? folders.map((v) => `${addonFolder(v.id)} (${v.label})`).join(` ${t("addon.install.or")} `)
        : addonFolder(folders && folders.length === 1 ? folders[0].id : versionId);
    if (kinds.has("zip")) steps.push(t("addon.install.zip", { folder }));
    if (kinds.has("exe")) steps.push(t("addon.install.exe"));
    if (addon.install) steps.push(addon.install);
    if (!steps.length) return null;
    return (
        <div className={["dlp-install", className].filter(Boolean).join(" ")}>
            <h3>{t("addon.install.title")}</h3>
            <ol>{steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
    );
}
