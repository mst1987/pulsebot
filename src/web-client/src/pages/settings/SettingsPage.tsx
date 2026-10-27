import { useState, type ReactNode } from "react";
import {
    getSettings, updateSettings, serverCategoriesOf, getIngestTokens, getAvailabilityPanels, getOrgaHubs, type ApiError, type AvailabilityLink, type AvailabilityPanel, type OrgaHub, type OrgaLink,
} from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePersistedSearchParam } from "../../lib/ui/persistedState";
import RolePermissionsEditor from "./RolePermissions";
import BotCommandAccess from "./BotCommandAccess";
import FullAdminRoles from "./FullAdminRoles";
import { accessPatch } from "../../lib/settings/accessPatch";
import Segment from "../../components/ui/Segment";
import { useToast } from "../../components/shell/Jobs";
import SectionRail, { RailLayout } from "../../components/ui/SectionRail";
import CategoryMatrix from "./CategoryMatrix";
import ConnectionsSection from "./SettingsConnections";
import AddonsSection from "./AddonsSection";
import DiscordServersSection from "./SettingsDiscordServers";
import RaidhelperServerSection from "./SettingsRaidhelperServer";
import WclGuildsSection from "./SettingsWclGuilds";
import { ChannelPicker, RolePicker } from "../../components/settings/settingsUi";
import { FieldLabel, InfoTip } from "../../components/ui/Field";
import {
    SECTION_PARAM_IDS, visibleSections, resolveSection, groupedSections, savesWithForm, groupLabel, sectionCrumb, sectionLabel,
    type SettingsSection } from "../../lib/settings/settingsSections";
import { areaLabel, draftChanges, logChannelsChanged } from "../../lib/settings/settingsLogic";
import { sectionBadge, settingsNavCounts } from "../../lib/settings/settingsNav";
import { tParts, useT } from "../../i18n";
import { Button } from "../../components/ui/Button";
import IconTile from "../../components/ui/IconTile";
import PartHead from "../../components/ui/PartHead";
import "../../styles/settings.css";
import RaidLoader from "../../components/ui/RaidLoader";
import { type Draft, toDraft, serverDefaultsChanges } from "./settingsDraft";
import { RaidsheetsSection } from "./RaidsheetsSection";
import { LogChannelsField, TopItemsField } from "./SettingsFields";
import GameVersionSection, { VersionSettingsCard } from "./SettingsGameVersion";
import CategorySwitchDialog, { type CategorySwitchChoice } from "./CategorySwitchDialog";
import CategoryDeactivateDialog from "./CategoryDeactivateDialog";
import CategoryCloseDialog from "./CategoryCloseDialog";
import { deactivatedIds } from "../../lib/settings/categoryLifecycle";
import type { CategoryCloseResult, MissingCategory, WclGuild } from "../../api";
import { categoryVersionsToSave, isVersionSwitch, savedCategoryVersion, switchFixesToSend } from "../../lib/settings/categoryVersions";
import HideOtherVersionsCard from "./HideOtherVersionsCard";
import BotLanguageCard from "./BotLanguageCard";
import DiscordVisualsCard from "./DiscordVisualsCard";
import DungeonRecordsCard from "./DungeonRecordsCard";
import VersionFeaturesCard from "./VersionFeaturesCard";
import VersionLaunchCard from "./VersionLaunchCard";
import ServerVersionLinksSection from "./ServerVersionLinksSection";
import { withDisabled } from "../../lib/settings/versionFeatures";
import { useContentVersion } from "../../hooks/useContentVersion";
import { XIcon, SaveIcon } from "../../components/ui/icons";

/** A module's fields on the panel card, each hint moved into its label's tooltip. */
function ModuleCard({ children }: { children: ReactNode }) {
    return <div className="set-card set-form">{children}</div>;
}

type PermView = "areas" | "bot";

const PERM_VIEWS: readonly PermView[] = ["areas", "bot"];
// one stable empty list, so a server without WCL guilds hands the section the same array every render
const NO_WCL_GUILDS: WclGuild[] = [];

export default function SettingsPage() {
    const t = useT();
    // The draft is cut from the answer as it lands — not from `data`: the parts
    // that save themselves update `data` without touching an unsaved draft.
    const [draft, setDraft] = useState<Draft | null>(null);
    const settingsData = useApi(() => getSettings().then((d) => { setDraft(toDraft(d.config, d.activeGuildId)); return d; }), []);
    const { data, setData } = settingsData;
    const [saving, setSaving] = useState(false);
    const toast = useToast();
    // A changed main version or "Andere Versionen ausblenden" (#563) changes the menu's content switch.
    const content = useContentVersion();
    // In the url as well as remembered, so a hint elsewhere in the menu can link
    // straight at the section it names ("…siehe Einstellungen → Kategorien").
    // Old ids stay allowed and are redirected by resolveSection(). A section
    // opened through such a link is remembered too, like one picked in the
    // rail: the plain "Einstellungen" entry lands on the section opened last.
    const [section, setSection] = usePersistedSearchParam(
        "settings-section", "section", "berechtigungen", SECTION_PARAM_IDS, true,
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
    // The absence/attendance panels per category: posted and removed at once, never through the draft.
    // The organizer's link buttons come with them and are saved the same way.
    const panelsData = useApi(() => getAvailabilityPanels().then((r) => ({ panels: r.panels, links: r.links || {}, maxLinks: r.maxLinks || 5 })), [], { enabled: !!data });
    const setPanel = (categoryId: string, panel: AvailabilityPanel | null) => panelsData.setData((cur) => (cur ? {
        ...cur,
        panels: [...cur.panels.filter((p) => p.categoryId !== categoryId), ...(panel ? [panel] : [])],
    } : cur));
    const setLinks = (categoryId: string, links: AvailabilityLink[]) => panelsData.setData((cur) => {
        if (!cur) return cur;
        const rest = { ...cur.links };
        delete rest[categoryId];
        return { ...cur, links: links.length ? { ...rest, [categoryId]: links } : rest };
    });
    // The Orga-Zentrale per category: posted and removed at once like the panels.
    // Its link buttons come with it and are saved the same way.
    const hubsData = useApi(() => getOrgaHubs().then((r) => ({ hubs: r.hubs || [], links: r.links || {}, maxLinks: r.maxLinks || 5 })), [], { enabled: !!data });
    const setHub = (categoryId: string, hub: OrgaHub | null) => hubsData.setData((cur) => (cur ? {
        ...cur,
        hubs: [...cur.hubs.filter((h) => h.categoryId !== categoryId), ...(hub ? [hub] : [])],
    } : cur));
    const setOrgaLinks = (categoryId: string, links: OrgaLink[]) => hubsData.setData((cur) => {
        if (!cur) return cur;
        const rest = { ...cur.links };
        delete rest[categoryId];
        return { ...cur, links: links.length ? { ...rest, [categoryId]: links } : rest };
    });
    // #738: the category whose version switch waits for the confirmation dialog.
    const [switching, setSwitching] = useState<{ id: string; versionId: string } | null>(null);
    // #744: a save that deactivates categories first shows what pauses; a category
    // deleted in Discord is closed through its own dialog.
    const [deactivating, setDeactivating] = useState(false);
    const [closing, setClosing] = useState<MissingCategory | null>(null);

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
    // #738: another version for a category that was active is a switch (a new
    // section) and waits for the dialog; a new category, or going back to the
    // saved version, changes the draft at once and drops the dialog's choices.
    const setCategoryVersion = (id: string, versionId: string) => {
        if (isVersionSwitch(data.config, id, versionId)) {
            setSwitching({ id, versionId });
            return;
        }
        const fixes = { ...draft.categorySwitchFixes };
        delete fixes[id];
        const back = savedCategoryVersion(data.config, id) === versionId;
        patch({
            categoryVersion: { ...draft.categoryVersion, [id]: versionId },
            categorySwitchFixes: fixes,
            ...(back ? { categoryRaidTemplate: { ...draft.categoryRaidTemplate, [id]: (data.config.categoryRaidTemplate || {})[id] || "" } } : {}),
        });
    };
    const confirmSwitch = (choice: CategorySwitchChoice) => {
        if (!switching) return;
        const { id, versionId } = switching;
        patch({
            categoryVersion: { ...draft.categoryVersion, [id]: versionId },
            // #739: the roster choice rides along; the save closes the old roster and maybe starts the new one
            categorySwitchFixes: { ...draft.categorySwitchFixes, [id]: { series: choice.series, ...(choice.roster ? { roster: choice.roster } : {}) } },
            ...(choice.defaultTemplateId !== undefined ? { categoryRaidTemplate: { ...draft.categoryRaidTemplate, [id]: choice.defaultTemplateId } } : {}),
        });
        setSwitching(null);
    };
    const toggleRole = (catId: string, roleId: string) => {
        const current = new Set(draft.categoryRoles[catId] || []);
        if (current.has(roleId)) current.delete(roleId); else current.add(roleId);
        patch({ categoryRoles: { ...draft.categoryRoles, [catId]: [...current] } });
    };

    const saved = toDraft(data.config, data.activeGuildId);
    const roleNames = new Map(data.roles.map((r) => [r.id, r.name]));
    const areaNames = new Map(data.areas.map((a) => [a.id, areaLabel(a)]));
    const categoryNames = new Map(data.categories.map((c) => [c.id, c.name]));
    const versionNames = new Map((data.gameVersions || []).map((v) => [v.id, v.short || v.label]));
    const changes = draftChanges(saved, draft, {
        role: (id) => (roleNames.has(id) ? `@${roleNames.get(id)}` : id),
        user: (id) => (data.userNames || {})[id] || t("settings.account", { id }),
        area: (id) => areaNames.get(id) || id,
        category: (id) => categoryNames.get(id) || id,
        version: (id) => versionNames.get(id) || id,
    });

    // #744: switching a category off pauses its series and reminders — the dialog says so before the save.
    const submit = () => {
        if (deactivatedIds(data.config.categoryIds, draft.categoryIds).length) {
            setDeactivating(true);
            return;
        }
        void save();
    };

    // "Kategorie abschließen" is only offered without unsaved changes, so the draft can follow the server.
    const afterClose = (result: CategoryCloseResult) => {
        setData({ ...data, ...serverCategoriesOf(result), config: result.config, missingCategories: result.missingCategories });
        setDraft(toDraft(result.config, data.activeGuildId));
        setClosing(null);
        toast(t("settings.categoryClose.done", { name: result.name || t("settings.categoryClose.unknownName") }));
    };

    const save = async () => {
        setDeactivating(false);
        setSaving(true);
        const defaultsChanged = serverDefaultsChanges(saved, draft);
        const serverDefaults = Object.keys(defaultsChanged).length
            ? { ...defaultsChanged, serverSettingsGuildId: data.activeGuildId || "" } : {};
        try {
            const answer = await updateSettings({
                // Access config is full-admin-only; sending it as anyone else
                // would (rightly) be rejected with a 403. Only the fields the
                // draft changed (#925): the active server is per session, and
                // an untouched field from an old tab would overwrite the rights
                // of the server another tab switched to.
                // A server's rights go with the server this page loaded: a switched session answers 409.
                ...(data.canManageAccess ? accessPatch(draft, saved, data.activeGuildId || "") : {}),
                // #924: the active server's own values, only the ones changed here.
                ...serverDefaults,
                // #926: the categories (only this server's part changes), #921 the log channels and #924 the
                // values above belong to the server this page loaded — sent with it, so a tab left on another
                // server is refused (409) instead of writing there. "" = none was active (the categories then
                // edit the first server, the bot language its default).
                categoryIds: draft.categoryIds,
                serverSettingsGuildId: data.activeGuildId || "",
                categoryRoles: draft.categoryRoles,
                // the log channels only when changed (they need an active server)
                ...(data.activeGuildId && logChannelsChanged(saved, draft) ? { logChannels: draft.logChannels } : {}),
                categoryLootTool: draft.categoryLootTool,
                // Merged on the server: "automatisch" is sent as "" and drops the entry.
                categoryLootSystem: draft.categoryLootSystem,
                categorySignupSource: draft.categorySignupSource,
                // Merged on the server: a category switched off is sent as false.
                categorySetupDms: draft.categorySetupDms,
                categoryLanguage: draft.categoryLanguage,
                // Each category sent whole ({ show, window, absences }); the store drops one back at the defaults.
                categoryAttendance: draft.categoryAttendance,
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
                // Merged on the server: 8 (the default) drops the entry again.
                categorySignupCharacters: draft.categorySignupCharacters,
                // Sent whole: a category set back to "keine" is left out.
                categoryRaidTemplate: Object.fromEntries(Object.entries(draft.categoryRaidTemplate).filter(([, id]) => id)),
                // #541/#738: sent whole as well; every active category with its version
                // (one switched on just now with the main version — the server refuses none).
                mainVersion: draft.mainVersion,
                categoryVersion: categoryVersionsToSave(draft.categoryVersion, draft.categoryIds, draft.mainVersion),
                // #738: what the switch dialog chose for a switched category's series.
                categorySwitchFixes: switchFixesToSend(draft.categorySwitchFixes, data.config, draft.categoryVersion),
                // #563: only the main version everywhere while it is on.
                hideOtherVersions: draft.hideOtherVersions,
                // the drawn pictures (a test): every switch, merged on the server
                discordVisuals: draft.discordVisuals,
                // the dungeon record post: both fields, merged on the server
                dungeonRecords: draft.dungeonRecords,
                // #542: every version's block, merged per field on the server; a wrong value comes back as 400 with its field.
                // #761: with each version's features switched off, sent whole.
                versionSettings: withDisabled(draft.versionSettings, draft.versionDisabled),
                // Sent whole: the store replaces the map, so clearing a url is
                // what removes that category's sheet.
                categorySheets: Object.fromEntries(
                    Object.entries(draft.categorySheets).map(([id, s]) => [id, { url: s.url.trim(), name: s.name.trim() }]),
                ),
                // Raid plan or sheet per category: merged on the server, only picked modes are sent.
                categoryPlanning: draft.categoryPlanning,
                topItems: draft.topItems,
            });
            const { config, switchedCategories = [], deactivatedCategories = [] } = answer;
            // #926: the active server's part of the categories, and what is proven gone there
            setData({ ...data, ...serverCategoriesOf(answer), ...(answer.missingCategories ? { missingCategories: answer.missingCategories } : {}), config });
            setDraft(toDraft(config, data.activeGuildId));
            toast(t("settings.savedToast"));
            // #738: each switched category started a new section.
            for (const sw of switchedCategories) {
                const name = categoryNames.get(sw.categoryId) || sw.name || sw.categoryId;
                const version = versionNames.get(sw.toVersion) || sw.toVersion;
                toast(t("settings.categorySwitch.switched", { name, version }));
                // #739: what happened to its roster
                const roster = sw.roster;
                if (roster && roster.created) toast(t("settings.categorySwitch.rosterCreated", { name: roster.created.name, version, count: roster.created.members }));
                else if (roster && roster.reopened) toast(t("settings.categorySwitch.rosterReopened", { name: roster.reopened.name }));
            }
            // #744: each deactivated category rests (series, reminders) until it is active again.
            for (const d of deactivatedCategories) {
                toast(t("settings.categoryDeactivate.done", { name: categoryNames.get(d.categoryId) || d.categoryId }));
            }
            // a changed version colour (#742) is read from the session too
            const colors = (map?: Record<string, { color?: string }>) => Object.entries(map || {}).map(([id, b]) => `${id}=${b?.color || ""}`).sort().join();
            if (switchedCategories.length || (config.mainVersion || "tbc") !== (saved.mainVersion || "tbc") || !!config.hideOtherVersions !== saved.hideOtherVersions
                || colors(config.versionSettings) !== colors(saved.versionSettings)) {
                void content.refresh();
            }
        } catch (err) {
            const e = err as ApiError;
            // #921: another tab switched the session's server since this page loaded
            // #924: channels and roles always belong to one server — none is picked
            const known: Record<string, string> = { server_switched: "settings.serverSwitched", no_active_server: "settings.noActiveServer" };
            toast(e.code && known[e.code] ? t(known[e.code]) : e.message, "err");
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
                    roleOrigins={data.roleOrigins || {}}
                    adminRoleIds={draft.adminRoleIds}
                    value={draft.rolePermissions}
                    onChange={(rolePermissions) => patch({ rolePermissions })}
                    baseAccess={draft.baseAccess}
                    onBaseAccessChange={(baseAccess) => patch({ baseAccess })}
                    userPermissions={draft.userPermissions}
                    onUserPermissionsChange={(userPermissions) => patch({ userPermissions })}
                    orgaRoleIds={draft.orgaRoleIds}
                    onOrgaRoleIds={(orgaRoleIds) => patch({ orgaRoleIds })}
                    userNames={data.userNames || {}}
                    userAvatars={data.userAvatars || {}}
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
                <>
                <CategoryMatrix
                    categories={data.categories}
                    roles={data.roles}
                    categoryIds={draft.categoryIds}
                    missing={data.missingCategories || []}
                    unproven={data.unprovenCategoryIds || []}
                    otherServer={data.otherServerCategoryIds || []}
                    serverListed={data.serverListed !== false}
                    onCloseCategory={setClosing}
                    closeBlocked={changes.length > 0}
                    categoryRoles={draft.categoryRoles}
                    categoryLootTool={draft.categoryLootTool}
                    categoryLootSystem={draft.categoryLootSystem}
                    onLootSystem={(id, system) => patch({ categoryLootSystem: { ...draft.categoryLootSystem, [id]: system } })}
                    categorySignupSource={draft.categorySignupSource}
                    signupSourceDefault={draft.signupSourceDefault}
                    raidhelperActive={data.raidhelperActive}
                    categorySetupDms={draft.categorySetupDms}
                    categoryLanguage={draft.categoryLanguage}
                    categoryAttendance={draft.categoryAttendance}
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
                    categorySignupCharacters={draft.categorySignupCharacters}
                    onSignupCharacters={(id, count) => patch({ categorySignupCharacters: { ...draft.categorySignupCharacters, [id]: count } })}
                    categorySheets={draft.categorySheets}
                    categoryPlanning={draft.categoryPlanning}
                    onPlanning={(id, mode) => patch({ categoryPlanning: { ...draft.categoryPlanning, [id]: mode } })}
                    savedCategoryRoles={data.config.categoryRoles || {}}
                    onToggleCategory={toggleCategory}
                    onToggleRole={toggleRole}
                    onLootTool={(id, tool) => patch({ categoryLootTool: { ...draft.categoryLootTool, [id]: tool } })}
                    onSignupSource={(id, source) => patch({ categorySignupSource: { ...draft.categorySignupSource, [id]: source } })}
                    onSetupDms={(id, on) => patch({ categorySetupDms: { ...draft.categorySetupDms, [id]: on } })}
                    onLanguage={(id, lang) => patch({ categoryLanguage: { ...draft.categoryLanguage, [id]: lang } })}
                    onAttendance={(id, value) => patch({ categoryAttendance: { ...draft.categoryAttendance, [id]: value } })}
                    onDiscordEvent={(id, on) => patch({ categoryDiscordEvent: { ...draft.categoryDiscordEvent, [id]: on } })}
                    onVoiceChannel={(id, channelId) => patch({ categoryVoiceChannel: { ...draft.categoryVoiceChannel, [id]: channelId } })}
                    onAnnounce={(id, mode) => patch({
                        categoryAnnounce: { ...draft.categoryAnnounce, [id]: { enabled: !!mode } },
                    })}
                    onSheet={(id, sheet) => patch({ categorySheets: { ...draft.categorySheets, [id]: sheet } })}
                    raidTemplates={{
                        options: data.raidTemplates || [],
                        value: draft.categoryRaidTemplate,
                        onChange: (id, templateId) => patch({ categoryRaidTemplate: { ...draft.categoryRaidTemplate, [id]: templateId } }),
                    }}
                    // a failed load leaves the row out rather than offering to post a second panel
                    availabilityPanels={panelsData.data ? {
                        panels: panelsData.data.panels,
                        links: panelsData.data.links,
                        maxLinks: panelsData.data.maxLinks,
                        channels: data.noteChannels ? data.noteChannels.channels : [],
                        onChange: setPanel,
                        onLinks: setLinks,
                    } : undefined}
                    orgaHubs={hubsData.data ? {
                        hubs: hubsData.data.hubs,
                        links: hubsData.data.links,
                        maxLinks: hubsData.data.maxLinks,
                        channels: data.noteChannels ? data.noteChannels.channels : [],
                        onChange: setHub,
                        onLinks: setOrgaLinks,
                    } : undefined}
                    icon={activeSection.icon}
                    crumb={activeCrumb}
                />
                {closing && <CategoryCloseDialog category={closing} onCancel={() => setClosing(null)} onClosed={afterClose} />}
                </>
            );

            case "spielversion": return (
                <>
                    {head(activeSection)}
                    <GameVersionSection
                        versions={data.gameVersions || []}
                        categories={data.categories}
                        activeIds={draft.categoryIds}
                        mainVersion={draft.mainVersion}
                        categoryVersion={draft.categoryVersion}
                        savedIds={data.config.categoryIds || []}
                        categoryEras={data.config.categoryEras}
                        onMainVersion={(mainVersion) => patch({ mainVersion })}
                        onCategoryVersion={setCategoryVersion}
                    />
                    {switching && (
                        <CategorySwitchDialog
                            categoryId={switching.id}
                            categoryName={categoryNames.get(switching.id) || ""}
                            versionId={switching.versionId}
                            roles={data.roles}
                            onCancel={() => setSwitching(null)}
                            onConfirm={confirmSwitch}
                        />
                    )}
                    <HideOtherVersionsCard
                        versions={data.gameVersions || []}
                        mainVersion={draft.mainVersion}
                        hidden={draft.hideOtherVersions}
                        upcoming={data.upcomingByVersion}
                        dataVersions={data.dataVersions}
                        canExport={data.canManageAccess}
                        onChange={(hideOtherVersions) => patch({ hideOtherVersions })}
                    />
                    <VersionFeaturesCard
                        versions={data.gameVersions || []}
                        matrix={data.versionCapabilities}
                        disabled={draft.versionDisabled}
                        onChange={(id, list) => patch({ versionDisabled: { ...draft.versionDisabled, [id]: list } })}
                    />
                    <VersionSettingsCard
                        versions={data.gameVersions || []}
                        mainVersion={draft.mainVersion}
                        value={draft.versionSettings}
                        defaults={data.versionDefaults}
                        raidsheets={data.raidsheets || []}
                        onChange={(id, block) => patch({ versionSettings: { ...draft.versionSettings, [id]: block } })}
                    />
                    <VersionLaunchCard versions={data.gameVersions || []} canExport={data.canManageAccess} saved={data.config} />
                </>
            );

            case "raids": return (
                <>
                    {head(activeSection)}
                    <BotLanguageCard
                        value={draft.botLanguage}
                        own={draft.botLanguageOwn}
                        defaultValue={draft.botLanguageDefault}
                        server={data.activeGuildId ? (data.bot?.guildName || data.activeGuildId) : ""}
                        canEditDefault={data.canManageAccess}
                        onChange={(next) => patch(next)}
                    />
                    <DiscordVisualsCard value={draft.discordVisuals} onChange={(discordVisuals) => patch({ discordVisuals })} />
                    <ModuleCard>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-raid-channel" tip={t("settings.page.raidChannel")} tipSub={t("settings.page.raidChannelSub")}>{t("settings.page.raidChannel")}</FieldLabel>
                            <ChannelPicker id="set-raid-channel" value={draft.raidChannelId} channels={channels} onChange={(raidChannelId) => patch({ raidChannelId })} />
                        </div>
                    </ModuleCard>
                </>
            );

            // #923: the server's own armory/log links and realm, field by field over "Spielversion"
            case "versionlinks": return (
                <>
                    {head(activeSection, undefined, sectionLabel(activeSection), t("settings.serverVersionLinks.sub"))}
                    <ServerVersionLinksSection
                        key={data.activeGuildId}
                        versions={data.gameVersions || []}
                        mainVersion={draft.mainVersion}
                        standard={data.config.versionSettings || {}}
                        saved={data.config.serverSettings?.[data.activeGuildId]?.versionOverrides}
                        serverName={(data.bot && data.bot.guildName) || data.activeGuildId}
                        guildId={data.activeGuildId}
                        onSaved={(config) => setData({ ...data, config })}
                    />
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
                            {data.activeGuildId ? (
                                <LogChannelsField
                                    entries={draft.logChannels} channels={channels}
                                    versions={(data.gameVersions || []).map((v) => ({ id: v.id, label: v.label }))}
                                    onChange={(logChannels) => patch({ logChannels })}
                                />
                            ) : <p className="muted">{t("settings.fields.logNoServer")}</p>}
                        </div>
                        {/* #922 the WCL guild per version of the active server, saved on its own */}
                        {data.activeGuildId && (
                            <WclGuildsSection
                                value={data.config.serverSettings?.[data.activeGuildId]?.wclGuilds || NO_WCL_GUILDS}
                                activeGuildId={data.activeGuildId}
                                versions={(data.gameVersions || []).map((v) => ({ id: v.id, label: v.label }))}
                                onSaved={(wclGuilds) => setData((cur) => {
                                    if (!cur || !cur.activeGuildId) return cur;
                                    const all = cur.config.serverSettings || {};
                                    return { ...cur, config: { ...cur.config, serverSettings: { ...all, [cur.activeGuildId]: { ...(all[cur.activeGuildId] || {}), wclGuilds } } } };
                                })}
                            />
                        )}
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

            case "vollAdmins": return (
                <FullAdminRoles
                    roles={data.adminRoles || []}
                    roleOrigins={data.roleOrigins || {}}
                    value={draft.adminRoleIds}
                    onChange={(adminRoleIds) => patch({ adminRoleIds })}
                    icon={activeSection.icon}
                    title={sectionLabel(activeSection)}
                    crumb={activeCrumb}
                />
            );

            case "addons": return (
                <>
                    {head(activeSection, undefined, sectionLabel(activeSection), t("addon.settings.sectionSub"))}
                    <AddonsSection data={data} onConfig={(config) => setData({ ...data, config })} />
                </>
            );

            case "raidhelper": return (
                <>
                    {head(activeSection, undefined, sectionLabel(activeSection), t("settings.raidhelperServer.sectionSub"))}
                    <RaidhelperServerSection
                        value={data.raidhelper || null}
                        activeGuildId={data.activeGuildId}
                        onSaved={(raidhelper) => setData({ ...data, raidhelper, raidhelperActive: raidhelper.active })}
                    />
                </>
            );

            case "dungeons": return (
                <>
                    {head(activeSection)}
                    <DungeonRecordsCard value={draft.dungeonRecords} channels={channels} onChange={(dungeonRecords) => patch({ dungeonRecords })} />
                </>
            );

            default: return null;
        }
    };

    // The icon rail left of the page (design "C · Schmale Icon-Leiste"): every
    // section the account may open, by group, with the badges of what is open
    // there — counted from the draft, so they follow an unsaved edit. A pick
    // keeps the page mounted, so the draft and the save bar survive it.
    const navCounts = settingsNavCounts({ data, tokens, canManageAccess: data.canManageAccess, activeCategories: draft.categoryIds.length });
    // The server block names the server its values belong to (#918).
    const serverName = (data.bot && data.bot.guildName) || "";
    const navGroups = groupedSections(sections).map((g) => ({
        group: groupLabel(g.group),
        sub: g.group === "server" && serverName ? serverName : undefined,
        items: g.items.map((s) => ({ id: s.id, label: sectionLabel(s), icon: s.icon, badge: sectionBadge(s.id, navCounts) })),
    }));

    const inForm = savesWithForm(active);
    const rail = <SectionRail groups={navGroups} active={active} onSelect={setSection} ariaLabel={t("settings.page.navAria")} />;

    return (
        <RailLayout rail={rail} className="settings-layout">
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

            <div className={`settings-panel${inForm ? " in-form" : ""}`} data-section={active}>
                {panel()}
                {changes.length > 0 && (
                    <div className="savebar" role="status" aria-live="polite">
                        <IconTile icon={activeSection.icon} tone="settings" />
                        <b>{t("settings.page.unsaved", { count: changes.length })}</b>
                        <span className="savebar-list" data-tip={t("settings.page.unsavedTip")} data-tip-sub={changes.join("\n")}>
                            {changes.slice(0, 2).join(", ")}{changes.length > 2 ? ` +${changes.length - 2}` : ""}
                        </span>
                        <span className="grow" />
                        <Button variant="no" icon={<XIcon />} onClick={() => setDraft(toDraft(data.config, data.activeGuildId))} disabled={saving}>{t("common.discard")}</Button>
                        <Button variant="go" icon={<SaveIcon />} onClick={submit} disabled={saving}>{saving ? t("settings.saving") : t("common.save")}</Button>
                    </div>
                )}
                {deactivating && (
                    <CategoryDeactivateDialog next={draft.categoryIds} guildId={data.activeGuildId || ""} names={categoryNames} onCancel={() => setDeactivating(false)} onConfirm={() => void save()} />
                )}
            </div>
        </RailLayout>
    );
}
