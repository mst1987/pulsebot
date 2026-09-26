import { useState } from "react";
import type { GameClass, GearLevel, ProfileCharacter, ProfileData, ProfileSpec } from "../../api";
import { Badge, Button, IconButton, PartHead, Segment, WowIcon } from "../../components/ui";
import { classColorProps } from "../../components/ClassSpec";
import { type AddWay } from "../../components/profile/AddCharacterDialog";
import { ExternalIcon, TrashIcon, XIcon } from "../../components/icons";
import { classLabel, roleLabel, specLabel } from "../../lib/wowNames";
import { tOr, useT } from "../../i18n";

const LOG_TONE: Record<ProfileSpec["logs"]["status"], "ok" | "mid" | undefined> = { seen: "ok", other: "mid", unknown: undefined };

/** No character yet: the three ways in, nothing else. */
export function FirstCharacter({ onPick }: { onPick: (way: AddWay) => void }) {
    const t = useT();
    const ways: { way: AddWay; icon: string; title: string; text: string }[] = [
        { way: "log", icon: "inv_misc_pocketwatch_01", title: t("profile.first.logTitle"), text: t("profile.first.logText") },
        { way: "armory", icon: "inv_misc_book_09", title: t("profile.first.armoryTitle"), text: t("profile.first.armoryText") },
        { way: "manual", icon: "inv_scroll_03", title: t("profile.first.manualTitle"), text: t("profile.first.manualText") },
    ];
    return (
        <div className="pf-first">
            <PartHead icon="achievement_character_human_male" tone="profile" title={t("profile.first.title")} crumb={t("profile.first.crumb")} />
            <div className="pf-ways">
                {ways.map((w) => (
                    <button key={w.way} type="button" className="pf-way" onClick={() => onPick(w.way)}>
                        <WowIcon name={w.icon} size={32} />
                        <span className="pf-way-title">{w.title}</span>
                        <span className="pf-way-text">{w.text}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

export function CharChip({ character, cls, active, onClick }: { character: ProfileCharacter; cls?: GameClass; active: boolean; onClick: () => void }) {
    const t = useT();
    const color = classColorProps(cls?.color);
    const claimed = character.claimedBy.length > 0;
    return (
        <button type="button" role="tab" aria-selected={active} className={`pf-chip${active ? " is-active" : ""}`} onClick={onClick}>
            {cls && <WowIcon name={cls.icon} size={22} />}
            <span className={color.className} style={color.style}>{character.name}</span>
            {character.main && <span className="pf-chip-main">{t("profile.char.main")}</span>}
            {claimed && (
                <span className="pf-chip-warn" data-tip={t("profile.char.claimed")} data-tip-sub={t("profile.char.claimedChip", { names: character.claimedBy.map((c) => c.name || t("profile.char.unknown")).join(", ") })}>!</span>
            )}
        </button>
    );
}

export function CharacterCard({ character, cls, data, onMain, onSpecs, onRoles, onRemove }: {
    character: ProfileCharacter;
    cls?: GameClass;
    data: ProfileData;
    onMain: () => void;
    onSpecs: (specs: ProfileSpec[]) => void;
    onRoles: (field: RoleField, value: boolean) => void;
    onRemove: () => void;
}) {
    const t = useT();
    const [picking, setPicking] = useState(false);
    const missing = (cls?.specs || []).filter((s) => !character.specs.some((own) => own.key === s.key));
    const crumb = [classLabel(character.className, cls?.label || character.className), character.realm, character.armory?.level ? t("profile.char.level", { level: character.armory.level }) : "", character.armory?.guild || ""]
        .filter(Boolean).join(" · ");

    const addSpec = (key: string) => {
        const spec = cls?.specs.find((s) => s.key === key);
        if (!spec) return;
        onSpecs([...character.specs, {
            key, gear: "usable", label: spec.label, specId: spec.id, role: spec.role, icon: spec.icon,
            canTank: spec.canTank, canHeal: spec.canHeal, logs: { status: "unknown", reports: 0 },
        }]);
        setPicking(false);
    };

    return (
        <section className="pf-card">
            <PartHead
                icon={cls?.icon || "inv_misc_questionmark"}
                title={character.name}
                crumb={crumb}
                action={(
                    <>
                        {character.claimedBy.length > 0 && (
                            <Badge tone="mid" tip={t("profile.char.claimed")} tipSub={t("profile.char.claimedCard", { names: character.claimedBy.map((c) => c.name || t("profile.char.unknown")).join(", ") })}>
                                {t("profile.char.claimedBy", { name: character.claimedBy[0].name || t("profile.char.otherAccount") })}
                            </Badge>
                        )}
                        {character.main
                            ? <Badge tone="accent">{t("profile.char.main")}</Badge>
                            : <Button variant="ghost" size="sm" onClick={onMain}>{t("profile.char.makeMain")}</Button>}
                        {character.armoryUrl && (
                            <a className="ibtn sm" href={character.armoryUrl} target="_blank" rel="noreferrer" aria-label={t("profile.char.armory")} data-tip={t("profile.char.openArmory")}>
                                <ExternalIcon />
                            </a>
                        )}
                        <IconButton icon={<TrashIcon />} tip={t("profile.char.remove")} size="sm" tone="danger" onClick={onRemove} />
                    </>
                )}
            />

            <div className="pf-specs">
                {character.specs.length === 0 && <p className="pf-muted">{t("profile.char.noSpec")}</p>}
                {character.specs.map((s) => {
                    const logTone = LOG_TONE[s.logs.status];
                    const logLabel = s.logs.status === "unknown" ? "" : t(`profile.logs.${s.logs.status}`);
                    const logTip = s.logs.status === "unknown" ? "" : t(`profile.logs.${s.logs.status}Tip`);
                    return (
                        <div key={s.key} className="pf-spec">
                            <WowIcon name={s.icon || "inv_misc_questionmark"} size={30} />
                            <div className="pf-spec-name">
                                <span className="pf-spec-label">{specLabel(s.key, s.label)}</span>
                                <span className="kicker">{s.role ? roleLabel(s.role, data.roles[s.role as keyof ProfileData["roles"]] || "") : ""}</span>
                            </div>
                            {logLabel && (
                                <Badge tone={logTone} tip={logLabel} tipSub={s.logs.reports ? `${logTip}\n${t("profile.logs.reports", { count: s.logs.reports })}` : logTip}>
                                    {logLabel}
                                </Badge>
                            )}
                            <Segment<GearLevel>
                                size="sm"
                                ariaLabel={t("profile.gearAria", { spec: specLabel(s.key, s.label) })}
                                value={s.gear}
                                options={data.gearLevels.map((g) => ({ value: g.id, label: tOr(`profile.gear.${g.id}`, g.label) }))}
                                onChange={(gear) => onSpecs(character.specs.map((x) => (x.key === s.key ? { ...x, gear } : x)))}
                            />
                            <IconButton icon={<XIcon />} tip={t("profile.char.removeSpec")} size="sm" onClick={() => onSpecs(character.specs.filter((x) => x.key !== s.key))} />
                        </div>
                    );
                })}
            </div>

            {missing.length > 0 && (
                <div className="pf-addspec">
                    {picking
                        ? missing.map((s) => (
                            <Button key={s.key} variant="ghost" size="sm" icon={s.icon} onClick={() => addSpec(s.key)}>{specLabel(s.key, s.label)}</Button>
                        ))
                        : <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>{t("profile.char.addSpec")}</Button>}
                </div>
            )}

            <RolesRow character={character} onChange={onRoles} />
        </section>
    );
}

type RoleField = "canOfftank" | "canHeal";

/** "Kann offtanken / heilen" of the selected character — a druid main may tank, the priest twink not. */
function RolesRow({ character, onChange }: { character: ProfileCharacter; onChange: (field: RoleField, value: boolean) => void }) {
    const t = useT();
    const rows: { field: RoleField; icon: string; label: string }[] = [
        { field: "canOfftank", icon: "ability_warrior_defensivestance", label: t("profile.roles.offtank") },
        { field: "canHeal", icon: "spell_holy_flashheal", label: t("profile.roles.heal") },
    ];
    return (
        <div className="pf-roles">
            {rows.map((r) => {
                // a class without a tank / healing spec: off and not switchable
                const possible = character.possible[r.field];
                return (
                    <label key={r.field} className={`pf-role${possible ? "" : " pf-role-off"}`}
                        data-tip={t("profile.roles.forChar", { label: r.label, name: character.name })}
                        data-tip-sub={possible
                            ? t("profile.roles.suggested", { answer: character.suggested[r.field] ? t("profile.roles.yes") : t("profile.roles.no") })
                            : t(`profile.roles.impossible.${r.field}`, { cls: classLabel(character.className, character.className) })}>
                        <WowIcon name={r.icon} size={26} />
                        <span className="pf-role-label">{r.label}</span>
                        <span className="switch">
                            <input type="checkbox" checked={possible && character[r.field]} disabled={!possible} onChange={(e) => onChange(r.field, e.target.checked)} />
                            <span className="switch-track"><span className="switch-thumb" /></span>
                        </span>
                    </label>
                );
            })}
        </div>
    );
}
