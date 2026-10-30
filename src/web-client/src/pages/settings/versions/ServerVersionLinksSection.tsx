import { useState } from "react";
import Segment from "../../../components/ui/Segment";
import { FieldLabel } from "../../../components/ui/Field";
import OwnValue from "../../../components/ui/OwnValue";
import { Button } from "../../../components/ui/Button";
import { SaveIcon } from "../../../components/ui/icons";
import { useToast } from "../../../components/shell/Jobs";
import { useT } from "../../../i18n";
import { saveVersionOverrides, type AdminConfig, type ApiError } from "../../../api";
import {
    BLIZZARD_REGIONS, VERSION_OVERRIDE_FIELDS, blockOf, effectiveBlock, emptyOwnFields, overrideProblems, overridesToSave,
    placeInLinks, versionLinks,
    type VersionOverride, type VersionOverrideField, type VersionOverrides, type VersionSettingsBlock,
} from "../../../lib/settings/versionLinks";
import type { GameVersionOption } from "./SettingsGameVersion";

// A name to show the links with, as on the standard card.
const SAMPLE_CHARACTER = "Devihra";

const LABEL_KEY: Record<VersionOverrideField, string> = {
    armoryUrlTemplate: "settings.versionLinks.armoryUrl",
    wclUrlTemplate: "settings.versionLinks.wclUrl",
    blizzardRegion: "settings.versionLinks.region",
    blizzardRealmSlug: "settings.versionLinks.realm",
};

/** Deep copy, so an edit never changes the config the page still shows. */
function copyOverrides(raw: VersionOverrides | undefined): VersionOverrides {
    const out: VersionOverrides = {};
    for (const [id, o] of Object.entries(raw || {})) out[id] = { ...o };
    return out;
}

/**
 * Einstellungen → Server → Links & Realm (#923, epic #926): per game version
 * this server's own armory and log templates and its own Battle.net realm.
 * Each field is an OwnValue — off, the server takes the standard of
 * "Alle Server → Spielversion" (shown under it); on, only this server gets the
 * value typed in. Wowhead, Softres, raidsheet and colour stay shared. The
 * section saves itself (only the loaded server's versionOverrides, refused
 * with 409 after a server switch in another tab), so it never mixes with the
 * page's draft.
 */
export default function ServerVersionLinksSection({ versions, mainVersion, standard, saved, serverName, guildId, onSaved }: {
    versions: GameVersionOption[];
    mainVersion: string;
    /** config.versionSettings: the standard of every server. */
    standard: Record<string, Partial<VersionSettingsBlock>>;
    /** config.serverSettings[guildId].versionOverrides as stored. */
    saved: VersionOverrides | undefined;
    serverName: string;
    guildId: string;
    onSaved: (config: AdminConfig) => void;
}) {
    const t = useT();
    const toast = useToast();
    const [picked, setPicked] = useState(mainVersion);
    // A field present here (even "") has its switch on; a missing one takes the standard.
    const [own, setOwn] = useState<VersionOverrides>(() => copyOverrides(saved));
    const [busy, setBusy] = useState(false);
    const version = versions.find((v) => v.id === picked) || versions[0];
    if (!version || !guildId) return null;

    const std = blockOf(standard[version.id]);
    const override: VersionOverride = own[version.id] || {};
    const problems = new Set(overrideProblems(override));
    const empty = new Set(emptyOwnFields(override));
    const anyProblem = Object.values(own).some((o) => overrideProblems(o).length > 0);
    // A switch on with nothing typed would save as "standard" without a word.
    const anyEmpty = Object.values(own).some((o) => emptyOwnFields(o).length > 0);
    const dirty = JSON.stringify(overridesToSave(own)) !== JSON.stringify(overridesToSave(saved || {}));
    const links = versionLinks(std, override);
    const used = effectiveBlock(std, override);
    const id = (field: string) => `svl-${version.id}-${field}`;

    const setField = (field: VersionOverrideField, value: string | undefined) => {
        const next = { ...override };
        if (value === undefined) delete next[field];
        else next[field] = value;
        setOwn({ ...own, [version.id]: next });
    };

    const save = async () => {
        setBusy(true);
        try {
            const res = await saveVersionOverrides(guildId, overridesToSave(own));
            // What the server kept (normalised, lower-case realm) becomes the
            // form again, so "dirty" compares like with like.
            setOwn(copyOverrides(res.config.serverSettings?.[guildId]?.versionOverrides));
            onSaved(res.config);
            toast(t("settings.serverVersionLinks.saved", { server: serverName }));
        } catch (err) {
            // a tab left open after a server switch elsewhere gets 409, not the other server (#921)
            const e = err as ApiError;
            toast(e.code === "server_switched" ? t("settings.serverSwitched") : e.message, "err");
        } finally {
            setBusy(false);
        }
    };

    const fallback = (field: VersionOverrideField) => (field === "blizzardRegion" ? std[field].toUpperCase() : std[field]);
    // The switch on means "an own region" - "none" is the switch off, not an option.
    const startValue = (field: VersionOverrideField) => (field === "blizzardRegion" ? (std[field] || BLIZZARD_REGIONS[0]) : (std[field] || ""));
    const control = (field: VersionOverrideField) => (field === "blizzardRegion" ? (
        <select id={id(field)} value={override[field] || BLIZZARD_REGIONS[0]} onChange={(e) => setField(field, e.target.value)}>
            {BLIZZARD_REGIONS.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
        </select>
    ) : (
        <input
            id={id(field)} value={override[field] || ""} spellCheck={false}
            placeholder={field === "blizzardRealmSlug" ? "realm-slug" : "https://…/{char}"}
            aria-invalid={problems.has(field) || empty.has(field) || undefined}
            onChange={(e) => setField(field, e.target.value)}
        />
    ));

    const preview = [
        { key: "armory", url: links.armory(SAMPLE_CHARACTER) },
        { key: "wcl", url: links.wcl(SAMPLE_CHARACTER) },
    ];

    return (
        <div className="set-card set-form gv-links svl" id="server-version-links">
            <div className="gv-links-head">
                <Segment
                    ariaLabel={t("settings.versionLinks.switch")}
                    size="sm"
                    value={version.id}
                    onChange={setPicked}
                    options={versions.map((v) => ({ value: v.id, label: v.short || v.label, tip: v.label }))}
                />
            </div>
            <p className="gv-hint">{t("settings.serverVersionLinks.hint", { server: serverName, version: version.label })}</p>

            <div className="gv-group">
                {VERSION_OVERRIDE_FIELDS.map((field) => {
                    const isOwn = override[field] !== undefined;
                    // The field's name stays above its switch, so four switches with the
                    // same text are told apart; it labels the input once that is shown.
                    return (
                        <div key={`${version.id}-${field}`} className="svl-item" role="group" aria-labelledby={id(field) + "-name"}>
                            <div id={id(field) + "-name"}>
                                <FieldLabel htmlFor={isOwn ? id(field) : undefined}>{t(LABEL_KEY[field])}</FieldLabel>
                            </div>
                            <OwnValue
                                server={serverName}
                                own={isOwn}
                                onOwnChange={(on) => setField(field, on ? startValue(field) : undefined)}
                                fallback={fallback(field)}
                            >
                                <div className="set-field">
                                    {control(field)}
                                    {problems.has(field) && (
                                        <div className="field-error" role="alert">{t(`settings.versionLinks.invalid.${field}`)}</div>
                                    )}
                                    {empty.has(field) && (
                                        <div className="field-error" role="alert">{t("settings.serverVersionLinks.empty")}</div>
                                    )}
                                    {(field === "blizzardRealmSlug" || field === "blizzardRegion") && !placeInLinks(used, field) && (
                                        <p className="gv-hint">{t(`settings.serverVersionLinks.placeHint.${field}`)}</p>
                                    )}
                                </div>
                            </OwnValue>
                        </div>
                    );
                })}
            </div>

            <div className="gv-preview" aria-label={t("settings.versionLinks.preview")}>
                <span className="gv-preview-label">{t("settings.versionLinks.preview")}</span>
                {preview.map((p) => (p.url
                    ? <a key={p.key} href={p.url} target="_blank" rel="noopener noreferrer">{t(`settings.versionLinks.previewLink.${p.key}`)}</a>
                    : <span key={p.key} className="gv-preview-off">{t(`settings.versionLinks.previewNone.${p.key}`)}</span>))}
            </div>

            <div className="svl-actions">
                {anyEmpty && <span className="gv-hint">{t("settings.serverVersionLinks.emptyBlocked")}</span>}
                <Button variant="go" icon={<SaveIcon />} disabled={busy || !dirty || anyProblem || anyEmpty} onClick={() => { void save(); }}>
                    {busy ? t("settings.saving") : t("common.save")}
                </Button>
            </div>
        </div>
    );
}
