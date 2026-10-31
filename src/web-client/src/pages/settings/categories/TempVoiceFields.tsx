import type { Category } from "../../../api/discord/channels";
import { useT } from "../../../i18n";
import Chip from "../../../components/ui/Chip";
import NumberStepper from "../../../components/ui/form/NumberStepper";
import {
    CLOSE_AFTER_MAX, clockMinus, EMPTY_CLOSE_MINUTES, isTemporary, LEAD_MAX, NAME_TEMPLATE_MAX,
    tempVoiceFor, voiceNameFor, type TempVoiceMode, type TempVoiceSettings,
} from "../../../lib/discord/tempVoice";
import CategoryField, { CategorySubField } from "./CategoryField";

// "Sprachkanal je Raid" in the tab "Neue Events" (docs/channels.md): the source of
// a category's voice channel (none / a fixed one / temporary ones) and, when the
// bot creates channels, how: Discord category, name, when it creates and closes
// them, who may join. The fixed channel stays in categoryVoiceChannel (onVoiceChannel);
// everything else goes to categoryTempVoice, the category's settings handed over whole.

const MODES: TempVoiceMode[] = ["none", "existing", "temp"];
const MODE_KEY: Record<TempVoiceMode, string> = { none: "None", existing: "Existing", temp: "Temp" };
const TAGS = ["raid", "nr", "datum", "leader"];
// The preview's example raid: SSC on Saturday 31.10. at 20:00 (Berlin), led by Lahelo.
const SAMPLE = { raid: "SSC", start: Date.UTC(2026, 9, 31, 19, 0) / 1000, leader: "Lahelo" };
const SAMPLE_START = "20:00";
const SAMPLE_END = "23:00";

/** An on/off switch, like the other switches of the card (CategoryDetail). */
function Toggle({ checked, onChange, ariaLabel }: { checked: boolean; onChange: () => void; ariaLabel: string }) {
    return (
        <label className="switch">
            <input type="checkbox" checked={checked} onChange={onChange} aria-label={ariaLabel} />
            <span className="switch-track"><span className="switch-thumb" /></span>
        </label>
    );
}

/** What the bot lacks for temporary channels under the chosen parent (or on the server); ManageRoles only counts with "only assigned". */
function lackedRights(rights: Record<string, string[]> | null | undefined, s: TempVoiceSettings): string[] {
    if (!rights) return [];
    const lacked = rights[s.parentId] ?? rights[""] ?? [];
    return s.onlyAssigned ? lacked : lacked.filter((r) => r !== "ManageRoles");
}

export default function TempVoiceFields({ cat, name, stored, voiceChannelId, voiceChannels, parents, lang, rights, onChange, onVoiceChannel }: {
    cat: Category;
    name: string;
    /** What the category stores (only what differs from the defaults). */
    stored?: Partial<TempVoiceSettings>;
    voiceChannelId: string;
    voiceChannels: { id: string; name: string; category?: string }[];
    /** The server's Discord categories, the parents a temporary channel can go under. */
    parents: Category[];
    /** The language of the category's posts, for the weekday of the preview; missing = German. */
    lang?: string;
    /** What the bot lacks for temporary channels per Discord category ("" = the server); null/missing = unknown. */
    rights?: Record<string, string[]> | null;
    onChange: (categoryId: string, value: TempVoiceSettings) => void;
    onVoiceChannel: (categoryId: string, channelId: string) => void;
}) {
    const t = useT();
    const s = tempVoiceFor(stored, voiceChannelId);
    const set = (next: Partial<TempVoiceSettings>) => onChange(cat.id, { ...s, ...next });
    const showTemp = isTemporary(s, 2);
    const preview = (template: string, index: number, total: number, leader = "") =>
        voiceNameFor(template, { raid: SAMPLE.raid, start: SAMPLE.start, index, total, leader, lang });
    const lacked = lackedRights(rights, s);
    const insert = (tag: string) => {
        const base = s.nameTemplate.trimEnd();
        set({ nameTemplate: `${base}${base ? " " : ""}{${tag}}`.slice(0, NAME_TEMPLATE_MAX) });
    };

    const source = (
        <CategoryField label={t("settings.categories.tempVoice")} sub={t("settings.categories.tempVoiceShort")} more={t("settings.categories.tempVoiceSub")}>
            <div className="cat-voice">
                <div className="cat-voice-modes" role="radiogroup" aria-label={t("settings.categories.tempVoiceAria", { name })}>
                    {MODES.map((mode) => (
                        <label key={mode} className="cat-voice-mode" data-on={s.mode === mode || undefined}>
                            <input type="radio" name={`catvoicemode-${cat.id}`} value={mode} checked={s.mode === mode} onChange={() => set({ mode })} />
                            <span className="cat-voice-mode-text">
                                <strong>{t(`settings.categories.tempVoiceMode${MODE_KEY[mode]}`)}</strong>
                                <span>{t(`settings.categories.tempVoiceMode${MODE_KEY[mode]}Sub`)}</span>
                            </span>
                        </label>
                    ))}
                </div>
                {s.mode === "existing" && (
                    <div className="cat-subfields cat-voice-existing">
                        <CategorySubField label={t("settings.categories.tempVoiceChannel")} htmlFor={voiceChannels.length ? `catvoice-${cat.id}` : undefined}>
                            {voiceChannels.length ? (
                                <select id={`catvoice-${cat.id}`} value={voiceChannelId} onChange={(e) => onVoiceChannel(cat.id, e.target.value)}>
                                    <option value="">{t("settings.categories.noVoiceOption")}</option>
                                    {voiceChannels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                                </select>
                            ) : <span className="note">{t("settings.categories.noVoice")}</span>}
                        </CategorySubField>
                        <CategorySubField label={t("settings.categories.tempVoiceFromRaid2")} sub={t("settings.categories.tempVoiceFromRaid2Sub")}>
                            <Toggle checked={s.fromRaid2} onChange={() => set({ fromRaid2: !s.fromRaid2 })} ariaLabel={t("settings.categories.tempVoiceFromRaid2")} />
                        </CategorySubField>
                    </div>
                )}
            </div>
        </CategoryField>
    );
    if (!showTemp) return source;

    return (
        <>
            {source}
            <CategoryField label={t("settings.categories.tempChannels")} sub={t("settings.categories.tempChannelsShort")}>
                <div className="cat-subfields cat-voice-temp">
                    {lacked.length > 0 && (
                        <div className="note is-bad" role="status" data-testid="temp-voice-rights">
                            {t("settings.categories.tempRightsMissing", { rights: lacked.map((r) => t(`settings.categories.tempRight.${r}`)).join(", ") })}
                        </div>
                    )}
                    <CategorySubField label={t("settings.categories.tempParent")} htmlFor={`catvoiceparent-${cat.id}`}>
                        <select id={`catvoiceparent-${cat.id}`} value={s.parentId} onChange={(e) => set({ parentId: e.target.value })}>
                            <option value="">{t("settings.categories.tempParentNone")}</option>
                            {s.parentId && !parents.some((p) => p.id === s.parentId) && <option value={s.parentId}>{s.parentId}</option>}
                            {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </CategorySubField>
                    <div className="cat-subfield cat-voice-name">
                        <label className="cat-field-label" htmlFor={`catvoicename-${cat.id}`}>{t("settings.categories.tempName")}</label>
                        <input id={`catvoicename-${cat.id}`} type="text" className="mono" maxLength={NAME_TEMPLATE_MAX} value={s.nameTemplate}
                            onChange={(e) => set({ nameTemplate: e.target.value })} />
                        <div className="chip-row">
                            <span className="note">{t("settings.categories.tempNameInsert")}</span>
                            {TAGS.map((tag) => (
                                <Chip key={tag} onClick={() => insert(tag)} tip={t("settings.categories.tempNameAdd", { tag: `{${tag}}` })}>{`{${tag}}`}</Chip>
                            ))}
                        </div>
                        <dl className="cat-voice-preview" data-testid="temp-voice-preview">
                            <dt>{t("settings.categories.tempPreviewOne")}</dt>
                            <dd className="mono">{preview(s.nameTemplate, 1, 1)}</dd>
                            <dt>{t("settings.categories.tempPreviewTwo")}</dt>
                            <dd className="mono">{preview(s.nameTemplate, 1, 2)} {t("settings.categories.tempPreviewAnd")} {preview(s.nameTemplate, 2, 2)}</dd>
                            <dt>{t("settings.categories.tempPreviewLeader", { tag: "{leader}" })}</dt>
                            <dd className="mono">{preview("{raid} {nr} · {leader}", 2, 2, SAMPLE.leader)}</dd>
                        </dl>
                        <span className="note">{t("settings.categories.tempNameHint")}</span>
                    </div>
                    <CategorySubField label={t("settings.categories.tempLead")} sub={t("settings.categories.tempLeadExample", { time: clockMinus(SAMPLE_START, s.leadMinutes) })}>
                        <div className="cat-quota">
                            <NumberStepper size="sm" value={s.leadMinutes} min={0} max={LEAD_MAX} step={5} editable commit="input"
                                onChange={(leadMinutes) => set({ leadMinutes })}
                                ariaLabel={t("settings.categories.tempLead")} lessLabel={t("settings.categories.tempLeadLess")} moreLabel={t("settings.categories.tempLeadMore")} />
                            <span className="note">{t("settings.categories.tempLeadUnit")}</span>
                        </div>
                    </CategorySubField>
                    <CategorySubField label={t("settings.categories.tempClose")}
                        sub={<>{t("settings.categories.tempCloseExample", { time: clockMinus(SAMPLE_END, -s.closeAfterMinutes) })}<br />{t("settings.categories.tempCloseHint", { minutes: EMPTY_CLOSE_MINUTES })}</>}>
                        <div className="cat-quota">
                            <span className="note">{t("settings.categories.tempCloseLatest")}</span>
                            <NumberStepper size="sm" value={s.closeAfterMinutes} min={0} max={CLOSE_AFTER_MAX} step={5} editable commit="input"
                                onChange={(closeAfterMinutes) => set({ closeAfterMinutes })}
                                ariaLabel={t("settings.categories.tempClose")} lessLabel={t("settings.categories.tempCloseLess")} moreLabel={t("settings.categories.tempCloseMore")} />
                            <span className="note">{t("settings.categories.tempCloseUnit")}</span>
                        </div>
                    </CategorySubField>
                    <CategorySubField label={t("settings.categories.tempOnlyAssigned")} sub={t("settings.categories.tempOnlyAssignedSub")}>
                        <Toggle checked={s.onlyAssigned} onChange={() => set({ onlyAssigned: !s.onlyAssigned })} ariaLabel={t("settings.categories.tempOnlyAssigned")} />
                    </CategorySubField>
                </div>
            </CategoryField>
        </>
    );
}
