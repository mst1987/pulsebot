import { get } from "./client";
import type { Role } from "./settings";

// ---- Bot-Befehle (Einstellungen → Berechtigungen), full admins only ----

export type BotAccessMode = "everyone" | "roles" | "admins";
export type BotAccessRule = { mode: BotAccessMode; roleIds: string[] };

export type BotCommand = {
    name: string;
    description: string;
    group: string;
    kind: "slash" | "button";
    /** What the code proposes when nothing is stored. */
    defaultAccess: BotAccessRule;
    /** The stored setting, null = the default applies. */
    access: BotAccessRule | null;
    effective: BotAccessRule;
    /** Buttons, selects and modals that inherit this command's access. */
    inherits: string[];
};

export type BotCommandGroup = { id: string; label: string; icon: string };

/** A role of the event guild; memberCount is null when the bot cannot tell. */
export type BotRole = Role & { memberCount: number | null };

export type BotCommandsData = {
    groups: BotCommandGroup[];
    commands: BotCommand[];
    roles: BotRole[];
    guildId: string;
    guildName: string;
};

export function getBotCommands(): Promise<BotCommandsData> {
    return get<BotCommandsData>("/api/bot-commands");
}
