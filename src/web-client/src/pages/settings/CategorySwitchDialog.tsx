import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCategorySwitch, type ApiError, type CategorySwitchPreview, type Role, type RosterSwitchChoice } from "../../api";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import RaidLoader from "../../components/ui/RaidLoader";
import { formatDayDate } from "../../lib/format";
import { useT } from "../../i18n";
import CategorySwitchRoster from "./CategorySwitchRoster";

/**
 * What the orga chose in the dialog: the series' fix ("pause" / a template id / ""), the new default template
 * ("" = none, undefined = unchanged) and the roster (#739; undefined when the category has none to close or open).
 */
export type CategorySwitchChoice = { series: string; defaultTemplateId?: string; roster?: RosterSwitchChoice };

// How many coming raids the dialog lists before it only counts them.
const MAX_RAIDS = 6;

/**
 * Einstellungen → Spielversion (#738): switching a category to another version
 * is a deliberate step that starts a new section. The dialog says what happens —
 * old raids, roster and quota stay under the old version, new raids get the new
 * one, the quota and the roster start afresh — lists the coming raids that keep
 * the old version, and asks for a fix where a series or the default template
 * would no longer fit (a series of another version creates no event). The
 * choice goes into the page draft; the save bar makes it happen.
 */
export default function CategorySwitchDialog({ categoryId, categoryName, versionId, roles = [], onCancel, onConfirm }: {
    categoryId: string;
    categoryName: string;
    versionId: string;
    /** The server's Discord roles, for the new roster's roles (#739). */
    roles?: Role[];
    onCancel: () => void;
    onConfirm: (choice: CategorySwitchChoice) => void;
}) {
    const t = useT();
    const [preview, setPreview] = useState<CategorySwitchPreview | null>(null);
    const [loadError, setLoadError] = useState("");
    const [series, setSeries] = useState("pause");
    const [defaultTemplate, setDefaultTemplate] = useState("");
    // #739: a roster for the new version with the people taken over, no Discord role unless picked
    const [roster, setRoster] = useState<RosterSwitchChoice>({ create: true, copyMembers: true, roleIds: [] });

    useEffect(() => {
        let live = true;
        getCategorySwitch(categoryId, versionId)
            .then((p) => { if (live) setPreview(p); })
            .catch((err) => { if (live) setLoadError((err as ApiError).message); });
        return () => { live = false; };
    }, [categoryId, versionId]);

    const name = categoryName || (preview && preview.name) || categoryId;
    const from = preview ? preview.from.short : "";
    const to = preview ? preview.to.short : "";
    const seriesNeedsFix = !!preview && !!preview.series && !preview.series.fits;
    const defaultNeedsFix = !!preview && !!preview.defaultTemplate && !preview.defaultTemplate.fits;
    const rosterInfo = preview && preview.roster;
    const confirm = () => onConfirm({
        series: seriesNeedsFix ? series : "",
        ...(defaultNeedsFix ? { defaultTemplateId: defaultTemplate } : {}),
        ...(rosterInfo && (rosterInfo.closing || rosterInfo.existing) ? { roster } : {}),
    });

    return (
        <Modal
            open
            onClose={onCancel}
            icon="inv_misc_book_09"
            tone="settings"
            kicker={t("settings.categorySwitch.kicker")}
            title={preview ? t("settings.categorySwitch.title", { name, from: preview.from.label, to: preview.to.label }) : name}
            width={620}
            hint={t("settings.categorySwitch.hint")}
            footer={(
                <>
                    <Button variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
                    <Button onClick={confirm} disabled={!preview}>{t("settings.categorySwitch.confirm", { version: to || versionId })}</Button>
                </>
            )}
        >
            {loadError && <div className="empty is-bad">{t("settings.categorySwitch.error", { message: loadError })}</div>}
            {!loadError && !preview && <RaidLoader compact text={t("settings.categorySwitch.loading")} />}
            {preview && (
                <div className="csw">
                    <p className="csw-intro">{t("settings.categorySwitch.intro")}</p>
                    <ul className="csw-facts">
                        <li>{t("settings.categorySwitch.keep", { from })}</li>
                        <li>{t("settings.categorySwitch.new", { to })}</li>
                        <li>{t("settings.categorySwitch.fresh", { to })}</li>
                    </ul>

                    <section className="csw-part" aria-label={t("settings.categorySwitch.upcomingTitle")}>
                        <h3 className="csw-head">{t("settings.categorySwitch.upcomingTitle")}</h3>
                        {preview.upcoming.length === 0 ? (
                            <p className="csw-quiet">{t("settings.categorySwitch.upcomingNone")}</p>
                        ) : (
                            <>
                                <p>{t("settings.categorySwitch.upcoming", { count: preview.upcoming.length })}</p>
                                <ul className="csw-raids">
                                    {preview.upcoming.slice(0, MAX_RAIDS).map((r) => (
                                        <li key={r.id}>
                                            <span className="csw-date">{formatDayDate(r.startTime * 1000)}</span>
                                            <Link className="mlink" to={`/raids/detail?event=${encodeURIComponent(r.id)}`} target="_blank">{r.title || r.id}</Link>
                                            <Badge>{versionShort(preview, r.versionId)}</Badge>
                                        </li>
                                    ))}
                                </ul>
                                {preview.upcoming.length > MAX_RAIDS && <p className="csw-quiet">{t("settings.categorySwitch.more", { count: preview.upcoming.length - MAX_RAIDS })}</p>}
                            </>
                        )}
                    </section>

                    <CategorySwitchRoster preview={preview} roles={roles} value={roster} onChange={setRoster} />

                    {(preview.series || preview.defaultTemplate) && (
                        <section className="csw-part" aria-label={t("settings.categorySwitch.templatesTitle")}>
                            <h3 className="csw-head">{t("settings.categorySwitch.templatesTitle")}</h3>
                            {preview.series && (seriesNeedsFix ? (
                                <div className="csw-fix">
                                    <p>{t("settings.categorySwitch.seriesMismatch", { name: preview.series.template ? preview.series.template.name : "", version: versionShort(preview, preview.series.template ? preview.series.template.versionId : "") })}</p>
                                    <label className="csw-pick">
                                        <span>{t("settings.categorySwitch.seriesFix")}</span>
                                        <select value={series} onChange={(e) => setSeries(e.target.value)} aria-label={t("settings.categorySwitch.seriesFix")}>
                                            <option value="pause">{t("settings.categorySwitch.seriesPause")}</option>
                                            {preview.templates.map((tp) => <option key={tp.id} value={tp.id}>{t("settings.categorySwitch.useTemplate", { name: tp.name })}</option>)}
                                        </select>
                                    </label>
                                </div>
                            ) : (
                                <p className="csw-quiet">{t("settings.categorySwitch.seriesFits")}</p>
                            ))}
                            {preview.defaultTemplate && (defaultNeedsFix ? (
                                <div className="csw-fix">
                                    <p>{t("settings.categorySwitch.defaultMismatch", { name: preview.defaultTemplate.name, version: versionShort(preview, preview.defaultTemplate.versionId) })}</p>
                                    <label className="csw-pick">
                                        <span>{t("settings.categorySwitch.defaultFix")}</span>
                                        <select value={defaultTemplate} onChange={(e) => setDefaultTemplate(e.target.value)} aria-label={t("settings.categorySwitch.defaultFix")}>
                                            <option value="">{t("settings.categorySwitch.defaultNone")}</option>
                                            {preview.templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
                                        </select>
                                    </label>
                                </div>
                            ) : (
                                <p className="csw-quiet">{t("settings.categorySwitch.defaultFits", { name: preview.defaultTemplate.name })}</p>
                            ))}
                            {(seriesNeedsFix || defaultNeedsFix) && preview.templates.length === 0 && (
                                <p className="csw-quiet">{t("settings.categorySwitch.noTemplates", { to })}</p>
                            )}
                        </section>
                    )}
                </div>
            )}
        </Modal>
    );
}

/** The short name of a version the preview knows (from / to), else its id. */
function versionShort(preview: CategorySwitchPreview, id: string): string {
    if (id === preview.from.id) return preview.from.short;
    if (id === preview.to.id) return preview.to.short;
    return id;
}
