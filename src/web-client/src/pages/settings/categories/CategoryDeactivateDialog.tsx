import { useEffect, useState } from "react";
import { getCategoryDeactivate, type ApiError, type DeactivatedCategory } from "../../../api";
import { Modal } from "../../../components/ui/overlay/Modal";
import { Button } from "../../../components/ui/Button";
import RaidLoader from "../../../components/ui/layout/RaidLoader";
import { seriesWhen } from "../../../lib/settings/categoryLifecycle";
import { useT } from "../../../i18n";

/**
 * Einstellungen → Kategorien (#744): saving with a category switched off
 * deactivates it. Nothing is deleted — its series and reminders pause until it
 * is active again, its coming raids stay, the Kaderplaner, the roster dialog and
 * /anwesenheit no longer offer it. The dialog lists that per category before the
 * save goes out (the same pattern as CategorySwitchDialog.tsx); an empty list
 * while raids exist is refused here as on the server.
 */
export default function CategoryDeactivateDialog({ next, guildId = "", names, onCancel, onConfirm }: {
    /** The active categories the save would keep. */
    next: string[];
    /** The server the page loaded ("" = none active): a session switched since answers 409 (#926). */
    guildId?: string;
    /** Category id → name (the page's live list). */
    names: Map<string, string>;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const t = useT();
    const [preview, setPreview] = useState<{ categories: DeactivatedCategory[]; emptyBlocked: boolean } | null>(null);
    const [loadError, setLoadError] = useState("");
    const key = next.join(",");

    useEffect(() => {
        let live = true;
        getCategoryDeactivate(key ? key.split(",") : [], guildId)
            .then((p) => { if (live) setPreview(p); })
            .catch((err) => {
                const e = err as ApiError;
                if (live) setLoadError(e.code === "server_switched" ? t("settings.serverSwitched") : e.message);
            });
        return () => { live = false; };
    }, [key, guildId, t]);

    const nameOf = (c: DeactivatedCategory) => names.get(c.categoryId) || c.name || c.categoryId;

    return (
        <Modal
            open
            onClose={onCancel}
            icon="categories"
            tone="settings"
            kicker={t("settings.categoryDeactivate.kicker")}
            title={t("settings.categoryDeactivate.title", { count: preview ? preview.categories.length : 1 })}
            width={600}
            footer={(
                <>
                    <Button variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
                    <Button onClick={onConfirm} disabled={!preview || preview.emptyBlocked}>{t("settings.categoryDeactivate.confirm")}</Button>
                </>
            )}
        >
            {loadError && <div className="empty is-bad">{t("settings.categorySwitch.error", { message: loadError })}</div>}
            {!loadError && !preview && <RaidLoader compact text={t("settings.categoryDeactivate.loading")} />}
            {preview && (
                <div className="csw">
                    {preview.emptyBlocked && <div className="empty is-bad" role="alert">{t("settings.categoryDeactivate.emptyBlocked")}</div>}
                    <p className="csw-intro">{t("settings.categoryDeactivate.intro")}</p>
                    {preview.categories.map((c) => {
                        const when = seriesWhen(c.series);
                        return (
                            <section key={c.categoryId} className="csw-part" aria-label={nameOf(c)}>
                                <h3 className="csw-head">{nameOf(c)}</h3>
                                <ul className="csw-facts">
                                    <li>{c.series
                                        ? (c.series.enabled ? t("settings.categoryDeactivate.series", { when }) : t("settings.categoryDeactivate.seriesOff"))
                                        : t("settings.categoryDeactivate.noSeries")}</li>
                                    <li>{c.reminders ? t("settings.categoryDeactivate.reminders") : t("settings.categoryDeactivate.noReminders")}</li>
                                    {c.upcoming > 0 && <li>{t("settings.categoryDeactivate.upcoming", { count: c.upcoming })}</li>}
                                </ul>
                            </section>
                        );
                    })}
                    <p className="csw-quiet">{t("settings.categoryDeactivate.keep")}</p>
                </div>
            )}
        </Modal>
    );
}
