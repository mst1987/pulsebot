import { useState } from "react";
import { Link } from "react-router-dom";
import { closeCategory, type ApiError, type CategoryCloseResult, type MissingCategory } from "../../api";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { seriesWhen } from "../../lib/settings/categoryLifecycle";
import { useT } from "../../i18n";
import { useToast } from "../../components/shell/Jobs";

/**
 * "Kategorie abschließen" (#744) for a category deleted in Discord: what goes
 * (its series, settings and reminders, its Loot-Council profile entry, its place
 * in the Kader's attendance categories) and what stays (raids, loot, logs, the
 * category's version and name — all readable under their version). Its rosters
 * are listed with a link and closed with it (#739: readable, no Discord sync,
 * nobody loses a role).
 */
export default function CategoryCloseDialog({ category, onCancel, onClosed }: {
    category: MissingCategory;
    onCancel: () => void;
    onClosed: (result: CategoryCloseResult) => void;
}) {
    const t = useT();
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const name = category.name || t("settings.categoryClose.unknownName");
    const when = seriesWhen(category.series);
    const settings = category.settings.filter((k) => k !== "categoryReminders");

    const items = [
        category.series ? t("settings.categoryClose.removeSeries", { when }) : "",
        category.reminders ? t("settings.categoryClose.removeReminders") : "",
        settings.length ? t("settings.categoryClose.removeSettings", { count: settings.length }) : "",
        category.active ? t("settings.categoryClose.removeActive") : "",
        category.councilProfile ? t("settings.categoryClose.removeCouncil") : "",
        category.kaders.length ? t("settings.categoryClose.removeKaders", { count: category.kaders.length, names: category.kaders.map((k) => k.name).join(", ") }) : "",
    ].filter(Boolean);

    const confirm = async () => {
        setBusy(true);
        try {
            onClosed(await closeCategory(category.categoryId));
        } catch (err) {
            // the dialog stays open: Discord may have it back, or the bot is offline
            toast((err as ApiError).message, "err");
            setBusy(false);
        }
    };

    return (
        <Modal
            open
            onClose={onCancel}
            icon="categories"
            tone="settings"
            kicker={t("settings.categoryClose.kicker")}
            title={t("settings.categoryClose.title", { name })}
            width={600}
            footer={(
                <>
                    <Button variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
                    <Button variant="danger" onClick={confirm} disabled={busy}>{t("settings.categoryClose.confirm")}</Button>
                </>
            )}
        >
            <div className="csw">
                <p className="csw-intro">{t("settings.categoryClose.intro")}</p>
                {items.length ? (
                    <ul className="csw-facts">{items.map((line) => <li key={line}>{line}</li>)}</ul>
                ) : <p className="csw-quiet">{t("settings.categoryClose.nothing")}</p>}
                {category.upcoming > 0 && <p>{t("settings.categoryClose.upcoming", { count: category.upcoming })}</p>}
                {category.rosters.length > 0 && (
                    <section className="csw-part" aria-label={t("settings.categoryClose.rostersTitle")}>
                        <h3 className="csw-head">{t("settings.categoryClose.rostersTitle")}</h3>
                        <p>{t("settings.categoryClose.rosters")}</p>
                        <ul className="csw-raids">
                            {category.rosters.map((r) => (
                                <li key={r.id}>
                                    <Link className="mlink" to={`/roster/r/${encodeURIComponent(r.id)}`} target="_blank">{r.name || r.id}</Link>
                                    {r.closed && <span className="csw-quiet">{t("settings.categoryClose.rosterClosed")}</span>}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
                <p className="csw-quiet">{t("settings.categoryClose.keep")}</p>
            </div>
        </Modal>
    );
}
