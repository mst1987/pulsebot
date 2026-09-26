import { get, send } from "./client";

// Raid templates (#266, src/web/raidTemplates.js): what an evening looks like.
export type RoleRange = { min: number; max: number | null };

export type RaidTemplateInput = {
    id?: string;
    name: string;
    versionId: string;
    /** from the rule set only (GET /api/game-versions) */
    instanceIds: string[];
    /** null = not set yet (a migrated Raid-Helper template) */
    size: number | null;
    composition: { tank: number; healer: number; melee: RoleRange | null; ranged: RoleRange | null };
    /** buff keys of the version */
    requiredBuffs: string[];
    signupDeadline: { hoursBefore: number } | null;
    /** how long an evening of this kind takes, in minutes (#305); null = not set */
    durationMinutes: number | null;
    fairness: boolean;
    wishes: boolean;
    /** what a full raid does with a new "Dabei" (#306): the waiting list, or refuse it */
    overflow?: "bench" | "off";
    /** close the signup by itself once the raid is full (#306) */
    lockAtLimit?: boolean;
    /** the colour bar of the event message (#307), "#rrggbb"; "" = the instance's own */
    color?: string;
    /** the picture of the event message (#307); an empty url = the instance's boss icon */
    image?: EmbedImage;
    /** the letter tiles and role icons of the event message; the event copies it */
    emojiStyle?: EmojiStyle;
    raidhelperTemplateId: string;
};

/** Where a picture sits in the bot's event message (#307) and which one it is. */
export type EmbedImage = { mode: "thumbnail" | "banner"; url: string };
/** The letter tiles and role icons of the event message: three drawn sets, or the flat icons and a plain title. */
export type EmojiStyle = "arcane" | "gold" | "parchment" | "plain";

export type RaidTemplate = RaidTemplateInput & {
    id: string;
    createdAt?: number;
    updatedAt?: number;
    /** migrated without size: badge "Größe ergänzen" */
    needsSize?: boolean;
    /** an instance still "Infos fehlen" */
    incomplete?: boolean;
    /** the categories using it as their default */
    defaultFor?: string[];
};

// Rule sets per game version (src/config/gameVersions, GET /api/game-versions).
export type GameRole = "tank" | "healer" | "melee" | "ranged";

export type GameSpec = {
    /** "<Class>-<Spec>" in Warcraft Logs' spelling, e.g. "Druid-Guardian" */
    key: string;
    id: string;
    classId: string;
    label: string;
    role: GameRole;
    /** raidBuffs.js vocabulary: which buffs the spec wants */
    buffRole: "tank" | "healer" | "melee" | "caster";
    icon: string;
    canTank: boolean;
    canHeal: boolean;
};

export type GameClass = { id: string; label: string; color: string; icon: string; specs: GameSpec[] };

export type Composition = { tanks: number; healers: number; source: "instance" | "default" };

export type GameInstance = {
    id: string;
    name: string;
    short: string;
    sizes: number[];
    defaultSize: number;
    icon: string;
    /** the colour the bot's event message falls back to (#307), "#rrggbb" or "" */
    color: string;
    bosses: string[];
    /** "" while the instance is incomplete */
    finalBoss: string;
    /** "incomplete" = plannable, but the menu shows "Infos fehlen" */
    status: "complete" | "incomplete";
    /** suggested tanks/healers per allowed size */
    suggested: Record<string, Composition>;
};

export type GameBuff = {
    key: string;
    label: string;
    icon: string;
    scope: "party" | "raid";
    /** spec keys that bring the buff */
    providers: string[];
    /** spec keys the buff is worth having on */
    beneficiaries: string[];
};

export type GameVersion = {
    id: "tbc" | "classic" | "forever" | string;
    label: string;
    short: string;
    roles: { id: GameRole; label: string }[];
    classes: GameClass[];
    instances: GameInstance[];
    partyBuffs: GameBuff[];
    raidBuffs: GameBuff[];
};

export type GameVersionsData = { versions: GameVersion[]; defaultVersion: string };

export function getGameVersions(): Promise<GameVersionsData> {
    return get<GameVersionsData>("/api/game-versions");
}

export type RaidTemplatesData = { templates: RaidTemplate[]; categoryNames: Record<string, string> };

export function getRaidTemplates(): Promise<RaidTemplatesData> {
    return get<RaidTemplatesData>("/api/raid-templates");
}

/** Create (no id) or update (id) a raid template. */
export function saveRaidTemplate(csrfToken: string | null, input: RaidTemplateInput): Promise<RaidTemplate> {
    return input.id
        ? send("PATCH", "/api/raid-templates", csrfToken, input)
        : send("POST", "/api/raid-templates", csrfToken, input);
}

/** 409 while a category uses it as its default — the message names the category. */
export function deleteRaidTemplate(csrfToken: string | null, id: string): Promise<{ id: string }> {
    return send("DELETE", "/api/raid-templates", csrfToken, { id });
}

export function importRaidTemplates(csrfToken: string | null): Promise<{ added: number; updated: number; templates: RaidTemplate[] }> {
    return send("POST", "/api/raid-templates/import", csrfToken, {});
}
