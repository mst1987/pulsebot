// "Sync-Tool & Addon": the download page for the loot sync tool (Windows exe)
// and the WoW addon (zip), always the newest release of the public repo.
// The server caches GitHub's answer for an hour (classes/addonRelease.js); the
// buttons are GitHub's own download links, nothing is proxied. Without a
// release (GitHub unreachable, nothing cached) the page offers the releases
// page instead. Reading takes "history" (the people who import loot).
import { getAddonRelease, type AddonAsset, type AddonReleaseData } from "../../api";
import { AsyncView, PageHead, RaidLoader, WowIcon, buttonClass } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { formatDate, formatSize } from "../../lib/format";
import { useT } from "../../i18n";
import "../../styles/addon.css";

const ICON = "inv_gizmo_01";

function DownloadCard({ icon, title, text, asset, label }: { icon: string; title: string; text: string; asset: AddonAsset | null; label: string }) {
    const t = useT();
    const size = asset ? formatSize(asset.size) : "";
    return (
        <section className="ad-card">
            <div className="ad-card-head">
                <WowIcon name={icon} size={40} />
                <div>
                    <h2>{title}</h2>
                    <p className="muted">{text}</p>
                </div>
            </div>
            {asset ? (
                <>
                    <a className={`${buttonClass("primary")} ad-download`} href={asset.url} rel="noopener noreferrer">{label}</a>
                    <div className="ad-file muted">{asset.name}{size ? ` · ${size}` : ""}</div>
                </>
            ) : (
                <p className="muted">{t("addon.missing")}</p>
            )}
        </section>
    );
}

function Content({ data }: { data: AddonReleaseData }) {
    const t = useT();
    const { release, fallbackUrl } = data;
    if (!release) {
        return (
            <div className="empty ad-fallback">
                <WowIcon name={ICON} size={48} />
                <h2>{t("addon.fallback.title")}</h2>
                <p>{t("addon.fallback.text")}</p>
                <a className={buttonClass("primary")} href={fallbackUrl} target="_blank" rel="noopener noreferrer">{t("addon.fallback.open")}</a>
            </div>
        );
    }
    const date = release.publishedAt ? formatDate(Date.parse(release.publishedAt)) : "";
    return (
        <>
            <div className="ad-version">
                <span className="ad-version-num">{t("addon.version", { version: release.version })}</span>
                {date && <span className="muted">{t("addon.published", { date })}</span>}
                <a className="ad-news" href={release.url} target="_blank" rel="noopener noreferrer">{t("addon.news")}</a>
            </div>
            <div className="ad-grid">
                <DownloadCard icon="inv_gizmo_02" title={t("addon.exe.title")} text={t("addon.exe.text")} asset={release.exe} label={t("addon.exe.button")} />
                <DownloadCard icon="inv_misc_book_09" title={t("addon.zip.title")} text={t("addon.zip.text")} asset={release.zip} label={t("addon.zip.button")} />
            </div>
            <section className="ad-install">
                <h2>{t("addon.install.title")}</h2>
                <div className="ad-install-cols">
                    <div>
                        <h3>{t("addon.install.zipTitle")}</h3>
                        <ol>
                            <li>{t("addon.install.zip1")}</li>
                            <li>{t("addon.install.zip2")}</li>
                            <li>{t("addon.install.zip3")}</li>
                        </ol>
                    </div>
                    <div>
                        <h3>{t("addon.install.exeTitle")}</h3>
                        <ol>
                            <li>{t("addon.install.exe1")}</li>
                            <li>{t("addon.install.exe2")}</li>
                        </ol>
                    </div>
                </div>
                <p className="muted">{t("addon.install.update")}</p>
            </section>
        </>
    );
}

export default function AddonPage() {
    const t = useT();
    const page = useApi<AddonReleaseData>(() => getAddonRelease(), []);
    return (
        <>
            <PageHead
                icon={ICON}
                tone="system"
                title={t("addon.title")}
            />
            <AsyncView state={page} loading={<RaidLoader text={t("addon.loading")} />}>
                {(data) => <Content data={data} />}
            </AsyncView>
        </>
    );
}
