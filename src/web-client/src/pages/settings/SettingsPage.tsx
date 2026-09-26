import { useState, type ReactNode } from "react";
import { getSettings, updateSettings, getIngestTokens, type ApiError } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePersistedSearchParam } from "../../lib/persistedState";
import RolePermissionsEditor from "./RolePermissions";
import BotCommandAccess from "./BotCommandAccess";
import Segment from "../../components/ui/Segment";
import { useToast } from "../../components/Jobs";
import SectionNav from "../../components/SectionNav";
import CategoryMatrix from "./CategoryMatrix";
import ConnectionsSection from "./SettingsConnections";
import DiscordServersSection from "./SettingsDiscordServers";
import { ChannelPicker, RolePicker } from "../../components/settings/settingsUi";
import { FieldLabel, InfoTip } from "../../components/ui/Field";
import {
    SECTION_PARAM_IDS, visibleSections, resolveSection, groupedSections, savesWithForm, groupLabel, sectionCrumb, sectionLabel,
    type SettingsSection } from "../../lib/settingsSections";
import { areaLabel, draftChanges, missingConnections, serverIssues } from "../../lib/settingsLogic";
import { tParts, useT } from "../../i18n";
import { Button } from "../../components/ui/Button";
import IconTile from "../../components/ui/IconTile";
import PartHead from "../../components/ui/PartHead";
import "../../styles/settings.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { type Draft, toDraft } from "./settingsDraft";
import { RaidsheetsSection } from "./RaidsheetsSection";
import { ChannelListField, TopItemsField } from "./SettingsFields";

/** A module's fields on the panel card, each hint moved into its label's tooltip. */
function ModuleCard({ children }: { children: ReactNode }) {
    return <div className="set-card set-form">{children}</div>;
}

type PermView = "areas" | "bot";

const PERM_VIEWS: readonly PermView[] = ["areas", "bot"];

export default function SettingsPage() {
    const t = useT();
    // The draft is cut from the answer as it lands — not from `data`: the parts
    // that save themselves update `data` without touching an unsaved draft.
    const [draft, setDraft] = useState<Draft | null>(null);
    const settingsData = useApi(() => getSettings().then((d) => { setDraft(toDraft(d.config)); return d; }), []);
    const { data, setData } = settingsData;
    const [saving, setSaving] = useState(false);
    const toast = useToast();
    // In the url as well as remembered, so a hint elsewhere in the menu can link
    // straight at the section it names ("…siehe Einstellungen → Kategorien").
    // Old ids stay allowed and are redirected by resolveSection().
    const [section, setSection] = usePersistedSearchParam(
        "settings-section", "section", "berechtigungen", SECTION_PARAM_IDS,
    );
    // Berechtigungen has two views: the menu's areas and the bot commands.
    const [permView, setPermView] = usePersistedSearchParam<PermView>("settings-perm-view", "perm", "areas", PERM_VIEWS);

    const load = settingsData.reload;
    // The token list is full-admin-only; it feeds the Loot-Sync card and the
    // "Verbindungen" badge. A failed load counts as "no tokens", as before.
    const canManage = !!data?.canManageAccess;
    const tokensData = useApi(() => getIngestTokens().then((r) => r.tokens), [], { enabled: canManage });
    const tokens = tokensData.error ? null : tokensData.data;
    const loadTokens = tokensData.reload;

    if (settingsData.error) return <div className="empty">{tParts("settings.page.loadError", { message: settingsData.error.message })}</div>;
    if (!data || !draft) return <RaidLoader text={t("settings.page.loading")} />;

    // A user who only holds write on "Einstellungen" never sees the access
    // section; a remembered id that is gone resolves to the first section they
    // may open instead of hiding everything.
    const sections = visibleSections(data.canManageAccess);
    const active = resolveSection(section, sections);
    const activeSection = sections.find((s) => s.id === active)!;
    const channels = data.channels || [];

    const patch = (fields: Partial<Draft>) => setDraft({ ...draft, ...fields });

    const toggleCategory = (id: string) => {
        const has = draft.categoryIds.includes(id);
        patch({ categoryIds: has ? draft.categoryIds.filter((c) => c !== id) : [...draft.categoryIds, id] });
    };
    const toggleRole = (catId: string, roleId: string) => {
        const current = new Set(draft.categoryRoles[catId] || []);
        if (current.has(roleId)) current.delete(roleId); else current.add(roleId);
        patch({ categoryRoles: { ...draft.categoryRoles, [catId]: [...current] } });
    };

    const saved = toDraft(data.config);
    const roleNames = new Map(data.roles.map((r) => [r.id, r.name]));
    const areaNames = new Map(data.areas.map((a) => [a.id, areaLabel(a)]));
    const categoryNames = new Map(data.categories.map((c) => [c.id, c.name]));
    const changes = draftChanges(saved, draft, {
        role: (id) => (roleNames.has(id) ? `@${roleNames.get(id)}` : id),
        user: (id) => (data.userNames || {})[id] || t("settings.account", { id }),
        area: (id) => areaNames.get(id) || id,
        category: (id) => categoryNames.get(id) || id,
    });

    const submit = async () => {
        setSaving(true);
        try {
            const { config } = await updateSettings({
                // Access config is full-admin-only; sending it as anyone else
                // would (rightly) be rejected with a 403.
                ...(data.canManageAccess ? {
                    adminRoleIds: draft.adminRoleIds,
                    rolePermissions: draft.rolePermissions,
                    baseAccess: draft.baseAccess,
                    userPermissions: draft.userPermissions,
                } : {}),
                officerRoleId: draft.officerRoleId.trim(),
                applicationChannelId: draft.applicationChannelId.trim(),
                categoryIds: draft.categoryIds,
                categoryRoles: draft.categoryRoles,
                logChannelIds: draft.logChannelIds,
                raidDefaults: { channelId: draft.raidChannelId.trim() },
                categoryLootTool: draft.categoryLootTool,
                // Merged on the server: "automatisch" is sent as "" and drops the entry.
                categoryLootSystem: draft.categoryLootSystem,
                categorySignupSource: draft.categorySignupSource,
                // Merged on the server: a category switched off is sent as false.
                categorySetupDms: draft.categorySetupDms,
                // #305: both merged on the server — a category switched off is
                // sent as false, a cleared voice channel as "".
                categoryDiscordEvent: draft.categoryDiscordEvent,
                categoryVoiceChannel: draft.categoryVoiceChannel,
                // Merged per category on the server; one back at the defaults drops out.
                categoryMessageLook: draft.categoryMessageLook,
                categoryAnnounce: draft.categoryAnnounce,
                // Merged on the server: "optional" drops the entry again.
                categorySignupNotes: draft.categorySignupNotes,
                // Merged on the server like the voice channel: "" = back to the default (#335).
                categorySignupNoteChannel: draft.categorySignupNoteChannel,
                // Sent whole: a category set back to "keine" is left out.
                categoryRaidTemplate: Object.fromEntries(Object.entries(draft.categoryRaidTemplate).filter(([, id]) => id)),
                // Sent whole: the store replaces the map, so clearing a url is
                // what removes that category's sheet.
                categorySheets: Object.fromEntries(
                    Object.entries(draft.categorySheets).map(([id, s]) => [id, { url: s.url.trim(), name: s.name.trim() }]),
                ),
                topItems: draft.topItems,
            });
            setData({ ...data, config });
            setDraft(toDraft(config));
            toast(t("settings.savedToast"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    const head = (s: SettingsSection, action?: ReactNode, tip?: string, tipSub?: string) => (
        <PartHead icon={s.icon} tone="settings" title={sectionLabel(s)} crumb={t("settings.crumb", { crumb: sectionCrumb(s) })} action={action} tip={tip} tipSub={tipSub} />
    );
    const activeCrumb = sectionCrumb(activeSection);

    const permSwitch = (
        <Segment
            ariaLabel={t("settings.sections.berechtigungen.label")}
            size="sm"
            value={permView}
            onChange={(v) => setPermView(v)}
            options={[
                { value: "areas", label: t("settings.page.permView.areas"), tip: t("settings.page.permView.areasTip") },
                { value: "bot", label: t("settings.page.permView.bot"), tip: t("settings.page.permView.botTip") },
            ]}
        />
    );

    // The panel of the open section.
    const panel = () => {
        switch (active) {
            case "berechtigungen": return permView === "bot" ? (
                <BotCommandAccess viewSwitch={permSwitch} icon={activeSection.icon} crumb={t("settings.page.botCrumb")} />
            ) : (
                <RolePermissionsEditor
                    viewSwitch={permSwitch}
                    areas={data.areas}
                    roles={data.roles}
                    adminRoleIds={draft.adminRoleIds}
                    onAdminRoleIds={(adminRoleIds) => patch({ adminRoleIds })}
                    value={draft.rolePermissions}
                    onChange={(rolePermissions) => patch({ rolePermissions })}
                    baseAccess={draft.baseAccess}
                    onBaseAccessChange={(baseAccess) => patch({ baseAccess })}
                    userPermissions={draft.userPermissions}
                    onUserPermissionsChange={(userPermissions) => patch({ userPermissions })}
                    userNames={data.userNames || {}}
                    icon={activeSection.icon}
                    crumb={activeCrumb}
                />
            );

            case "verbindungen": return (
                <ConnectionsSection
                    data={data}
                    tokens={tokens}
                    onConfig={(config) => setData({ ...data, config })}
                    onTokensChanged={loadTokens}
                    icon={activeSection.icon}
                    crumb={activeCrumb}
                />
            );

            case "discordserver": return (
                <DiscordServersSection
                    onConfig={(config) => {
                        setData({ ...data, config });
                        // The cards behind the sidebar badge changed with the servers;
                        // only they are refreshed, so an unsaved draft elsewhere survives.
                        getSettings().then((d) => setData((cur) => (cur ? { ...cur, servers: d.servers } : cur))).catch(() => {});
                    }}
                    icon={activeSection.icon}
                    crumb={activeCrumb}
                />
            );

            case "kategorien": return (
                <CategoryMatrix
                    categories={data.categories}
                    roles={data.roles}
                    categoryIds={draft.categoryIds}
                    categoryRoles={draft.categoryRoles}
                    categoryLootTool={draft.categoryLootTool}
                    categoryLootSystem={draft.categoryLootSystem}
                    onLootSystem={(id, system) => patch({ categoryLootSystem: { ...draft.categoryLootSystem, [id]: system } })}
                    categorySignupSource={draft.categorySignupSource}
                    signupSourceDefault={draft.signupSourceDefault}
                    categorySetupDms={draft.categorySetupDms}
                    categoryDiscordEvent={draft.categoryDiscordEvent}
                    categoryVoiceChannel={draft.categoryVoiceChannel}
                    voiceChannels={data.voiceChannels || []}
                    categoryMessageLook={draft.categoryMessageLook}
                    onMessageLook={(id, look) => patch({ categoryMessageLook: { ...draft.categoryMessageLook, [id]: look } })}
                    categoryAnnounce={draft.categoryAnnounce}
                    categorySignupNotes={draft.categorySignupNotes}
                    onSignupNotes={(id, mode) => patch({ categorySignupNotes: { ...draft.categorySignupNotes, [id]: mode } })}
                    categorySignupNoteChannel={draft.categorySignupNoteChannel}
                    noteChannels={data.noteChannels}
                    onSignupNoteChannel={(id, channelId) => patch({ categorySignupNoteChannel: { ...draft.categorySignupNoteChannel, [id]: channelId } })}
                    categorySheets={draft.categorySheets}
                    savedCategoryRoles={data.config.categoryRoles || {}}
                    onToggleCategory={toggleCategory}
                    onToggleRole={toggleRole}
                    onLootTool={(id, tool) => patch({ categoryLootTool: { ...draft.categoryLootTool, [id]: tool } })}
                    onSignupSource={(id, source) => patch({ categorySignupSource: { ...draft.categorySignupSource, [id]: source } })}
                    onSetupDms={(id, on) => patch({ categorySetupDms: { ...draft.categorySetupDms, [id]: on } })}
                    onDiscordEvent={(id, on) => patch({ categoryDiscordEvent: { ...draft.categoryDiscordEvent, [id]: on } })}
                    onVoiceChannel={(id, channelId) => patch({ categoryVoiceChannel: { ...draft.categoryVoiceChannel, [id]: channelId } })}
                    onAnnounce={(id, mode) => patch({
                        categoryAnnounce: { ...draft.categoryAnnounce, [id]: { enabled: !!mode, target: mode || "event" } },
                    })}
                    onSheet={(id, sheet) => patch({ categorySheets: { ...draft.categorySheets, [id]: sheet } })}
                    raidTemplates={{
                        options: data.raidTemplates || [],
                        value: draft.categoryRaidTemplate,
                        onChange: (id, templateId) => patch({ categoryRaidTemplate: { ...draft.categoryRaidTemplate, [id]: templateId } }),
                    }}
                    icon={activeSection.icon}
                    crumb={activeCrumb}
                />
            );

            case "raids": return (
                <>
                    {head(activeSection)}
                    <ModuleCard>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-raid-channel" tip={t("settings.page.raidChannel")} tipSub={t("settings.page.raidChannelSub")}>{t("settings.page.raidChannel")}</FieldLabel>
                            <ChannelPicker id="set-raid-channel" value={draft.raidChannelId} channels={channels} onChange={(raidChannelId) => patch({ raidChannelId })} />
                        </div>
                    </ModuleCard>
                </>
            );

            case "raidsheets": return (
                <>
                    {head(activeSection, undefined, t("settings.page.raidsheetsTip"), t("settings.page.raidsheetsSub"))}
                    <RaidsheetsSection sheets={data.raidsheets} onChanged={(msg) => { toast(msg); load(); }} />
                </>
            );

            case "topitems": return (
                <>
                    {head(activeSection, undefined, sectionLabel(activeSection), t("settings.page.topItemsSub"))}
                    <ModuleCard>
                        <TopItemsField items={draft.topItems} onChange={(topItems) => patch({ topItems })} />
                    </ModuleCard>
                </>
            );

            case "logs": return (
                <>
                    {head(activeSection)}
                    <ModuleCard>
                        <div className="set-field">
                            <FieldLabel tip={t("settings.page.logChannels")} tipSub={t("settings.page.logChannelsSub")}>{t("settings.page.logChannels")}</FieldLabel>
                            <ChannelListField ids={draft.logChannelIds} channels={channels} onChange={(logChannelIds) => patch({ logChannelIds })} />
                        </div>
                    </ModuleCard>
                </>
            );

            case "recruitment": return (
                <>
                    {head(activeSection)}
                    <ModuleCard>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-app-channel" tip={t("settings.page.appChannel")} tipSub={t("settings.page.appChannelSub")}>{t("settings.page.appChannel")}</FieldLabel>
                            <ChannelPicker id="set-app-channel" value={draft.applicationChannelId} channels={channels} onChange={(applicationChannelId) => patch({ applicationChannelId })} />
                        </div>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-officer" tip={t("settings.page.officerRole")} tipSub={t("settings.page.officerRoleSub")}>{t("settings.page.officerRole")}</FieldLabel>
                            <RolePicker id="set-officer" value={draft.officerRoleId} roles={data.roles} onChange={(officerRoleId) => patch({ officerRoleId })} placeholder={t("settings.page.noPing")} />
                        </div>
                    </ModuleCard>
                </>
            );

            default: return null;
        }
    };

    // The badges of the column: what is open in a section, so nobody has to
    // open each one to find the gap.
    const missing = missingConnections(data, tokens, data.canManageAccess);
    const serverGaps = serverIssues(data.servers);
    const activeCategories = draft.categoryIds.length;
    const navGroups = groupedSections(sections).map((g) => ({
        group: groupLabel(g.group),
        items: g.items.map((s) => ({
            id: s.id,
            label: sectionLabel(s),
            icon: s.icon,
            badge: s.id === "verbindungen" ? { count: missing, tone: "mid" as const, tip: t("settings.page.badgeConnections", { count: missing }) }
                : s.id === "discordserver" ? { count: serverGaps, tone: "mid" as const, tip: t("settings.page.badgeServers", { count: serverGaps }) }
                : s.id === "kategorien" ? { count: activeCategories, tip: t("settings.page.badgeCategories", { count: activeCategories }) }
                    : null,
        })),
    }));

    const inForm = savesWithForm(active);

    return (
        <>
            <div className="page-head settings-head">
                <IconTile icon="trade_engineering" tone="settings" size="lg" />
                <div className="ph-text">
                    <div className="kicker">{t("settings.page.kicker")}</div>
                    <h1>
                        {t("shell.menu.settings")}
                        <InfoTip head={t("shell.menu.settings")} sub={t("settings.page.infoSub")} />
                    </h1>
                </div>
            </div>

            <div className="settings-layout">
                <SectionNav groups={navGroups} active={active} onSelect={setSection} ariaLabel={t("settings.page.navAria")} />
                <div className={`settings-panel${inForm ? " in-form" : ""}`}>
                    {panel()}
                    {changes.length > 0 && (
                        <div className="savebar" role="status" aria-live="polite">
                            <IconTile icon={activeSection.icon} tone="settings" />
                            <b>{t("settings.page.unsaved", { count: changes.length })}</b>
                            <span className="savebar-list" data-tip={t("settings.page.unsavedTip")} data-tip-sub={changes.join("\n")}>
                                {changes.slice(0, 2).join(", ")}{changes.length > 2 ? ` +${changes.length - 2}` : ""}
                            </span>
                            <span className="grow" />
                            <Button variant="ghost" onClick={() => setDraft(toDraft(data.config))} disabled={saving}>{t("common.discard")}</Button>
                            <Button onClick={submit} disabled={saving}>{saving ? t("settings.saving") : t("common.save")}</Button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
