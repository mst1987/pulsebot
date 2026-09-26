import { useState, type ReactNode } from "react";
import { getSettings, updateSettings, getIngestTokens, type ApiError } from "../../api";
import { useApi } from "../../hooks/useApi";
import { usePersistedSearchParam } from "../../lib/persistedState";
import RolePermissionsEditor from "../../components/RolePermissions";
import BotCommandAccess from "../../components/BotCommandAccess";
import Segment from "../../components/ui/Segment";
import { useToast } from "../../components/Jobs";
import SectionNav from "../../components/SectionNav";
import CategoryMatrix from "../../components/CategoryMatrix";
import ConnectionsSection from "../../components/SettingsConnections";
import DiscordServersSection from "../../components/SettingsDiscordServers";
import { ChannelPicker, RolePicker } from "../../components/settingsUi";
import { FieldLabel, InfoTip } from "../../components/ui/Field";
import {
    SECTION_PARAM_IDS, visibleSections, resolveSection, groupedSections, savesWithForm, type SettingsSection } from "../../lib/settingsSections";
import { draftChanges, missingConnections, serverIssues } from "../../lib/settingsLogic";
import { Button } from "../../components/ui/Button";
import IconTile from "../../components/ui/IconTile";
import PartHead from "../../components/ui/PartHead";
import "../../styles/einstellungen.css";
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

    if (settingsData.error) return <div className="empty">Fehler beim Laden der Einstellungen: {settingsData.error.message}</div>;
    if (!data || !draft) return <RaidLoader text="Einstellungen werden geladen" />;

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
    const areaNames = new Map(data.areas.map((a) => [a.id, a.label]));
    const categoryNames = new Map(data.categories.map((c) => [c.id, c.name]));
    const changes = draftChanges(saved, draft, {
        role: (id) => (roleNames.has(id) ? `@${roleNames.get(id)}` : id),
        user: (id) => (data.userNames || {})[id] || `Konto ${id}`,
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
            toast("Gespeichert.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    const head = (s: SettingsSection, action?: ReactNode, tip?: string, tipSub?: string) => (
        <PartHead icon={s.icon} tone="settings" title={s.label} crumb={`Einstellungen › ${s.crumb}`} action={action} tip={tip} tipSub={tipSub} />
    );

    const permSwitch = (
        <Segment
            ariaLabel="Berechtigungen"
            size="sm"
            value={permView}
            onChange={(v) => setPermView(v)}
            options={[
                { value: "areas", label: "Bereiche", tip: "Wer im EventHelper welchen Bereich sehen oder bearbeiten darf" },
                { value: "bot", label: "Bot-Befehle", tip: "Wer im Discord welchen Bot-Befehl nutzen darf" },
            ]}
        />
    );

    // The panel of the open section.
    const panel = () => {
        switch (active) {
            case "berechtigungen": return permView === "bot" ? (
                <BotCommandAccess viewSwitch={permSwitch} icon={activeSection.icon} crumb="Zugang · wer darf welchen Bot-Befehl im Discord nutzen" />
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
                    crumb={activeSection.crumb}
                />
            );

            case "verbindungen": return (
                <ConnectionsSection
                    data={data}
                    tokens={tokens}
                    onConfig={(config) => setData({ ...data, config })}
                    onTokensChanged={loadTokens}
                    icon={activeSection.icon}
                    crumb={activeSection.crumb}
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
                    crumb={activeSection.crumb}
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
                    crumb={activeSection.crumb}
                />
            );

            case "raids": return (
                <>
                    {head(activeSection)}
                    <ModuleCard>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-raid-channel" tip="Standard-Kanal" tipSub="Der Kanal, in dem ein neues Raid-Event angelegt wird, wenn beim Anlegen keiner gewählt ist.">Standard-Kanal</FieldLabel>
                            <ChannelPicker id="set-raid-channel" value={draft.raidChannelId} channels={channels} onChange={(raidChannelId) => patch({ raidChannelId })} />
                        </div>
                    </ModuleCard>
                </>
            );

            case "raidsheets": return (
                <>
                    {head(activeSection, undefined, "Raidsheet-Vorlagen", "Google-Sheets nach Content (Tier 4/5 usw.). Beim Füllen wird anhand der Keywords das passende Sheet vorgeschlagen. Ein festes Sheet für eine ganze Raid-Kategorie wird unter Kategorien zugewiesen.")}
                    <RaidsheetsSection sheets={data.raidsheets} onChanged={(msg) => { toast(msg); load(); }} />
                </>
            );

            case "topitems": return (
                <>
                    {head(activeSection, undefined, "Top-Items", "Die richtig großen Drops — Waffen, Legendary-Teile, alles, was die Gilde als besonders wertet. Vergibt ein Raid eines davon, hebt das Dashboard die Vergabe hervor. Welches Loot-Addon eine Kategorie benutzt, steht unter Kategorien.")}
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
                            <FieldLabel tip="Log-Kanäle" tipSub="Kanäle, in denen automatisch Warcraft-Logs gepostet werden. Der Bot hängt dort die Auswertungs-Knöpfe an.">Log-Kanäle</FieldLabel>
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
                            <FieldLabel htmlFor="set-app-channel" tip="Bewerbungs-Kanal" tipSub="Kanal, in dem neue Bewerbungen als Thread gepostet werden.">Bewerbungs-Kanal</FieldLabel>
                            <ChannelPicker id="set-app-channel" value={draft.applicationChannelId} channels={channels} onChange={(applicationChannelId) => patch({ applicationChannelId })} />
                        </div>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-officer" tip="Offizier-Rolle" tipSub="Wird bei neuen Bewerbungen gepingt. Leer lassen für keinen Ping.">Offizier-Rolle</FieldLabel>
                            <RolePicker id="set-officer" value={draft.officerRoleId} roles={data.roles} onChange={(officerRoleId) => patch({ officerRoleId })} placeholder="— kein Ping —" />
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
        group: g.group,
        items: g.items.map((s) => ({
            id: s.id,
            label: s.label,
            icon: s.icon,
            badge: s.id === "verbindungen" ? { count: missing, tone: "mid" as const, tip: `${missing} ${missing === 1 ? "Verbindung" : "Verbindungen"} nicht eingerichtet` }
                : s.id === "discordserver" ? { count: serverGaps, tone: "mid" as const, tip: `${serverGaps} ${serverGaps === 1 ? "Server braucht" : "Server brauchen"} Aufmerksamkeit` }
                : s.id === "kategorien" ? { count: activeCategories, tip: `${activeCategories} aktive Raid-Kategorien` }
                    : null,
        })),
    }));

    const inForm = savesWithForm(active);

    return (
        <>
            <div className="page-head settings-head">
                <IconTile icon="trade_engineering" tone="settings" size="lg" />
                <div className="ph-text">
                    <div className="kicker">System · greift ohne Bot-Neustart</div>
                    <h1>
                        Einstellungen
                        <InfoTip head="Einstellungen" sub={"Alle Werte werden in der Datenbank gespeichert und greifen ohne Bot-Neustart.\nIDs bekommst du in Discord per Rechtsklick → „ID kopieren“ (Entwicklermodus)."} />
                    </h1>
                </div>
            </div>

            <div className="settings-layout">
                <SectionNav groups={navGroups} active={active} onSelect={setSection} ariaLabel="Einstellungs-Bereiche" />
                <div className={`settings-panel${inForm ? " in-form" : ""}`}>
                    {panel()}
                    {changes.length > 0 && (
                        <div className="savebar" role="status" aria-live="polite">
                            <IconTile icon={activeSection.icon} tone="settings" />
                            <b>{changes.length} ungespeicherte {changes.length === 1 ? "Änderung" : "Änderungen"}</b>
                            <span className="savebar-list" data-tip="Ungespeichert" data-tip-sub={changes.join("\n")}>
                                {changes.slice(0, 2).join(", ")}{changes.length > 2 ? ` +${changes.length - 2}` : ""}
                            </span>
                            <span className="grow" />
                            <Button variant="ghost" onClick={() => setDraft(toDraft(data.config))} disabled={saving}>Verwerfen</Button>
                            <Button onClick={submit} disabled={saving}>{saving ? "Speichert…" : "Speichern"}</Button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
