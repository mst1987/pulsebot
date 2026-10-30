// "Roster als Bild" (docs/roster-profile.md): helpers of the dialog without React.

/** The download's file name: "roster-<name>.png", the name reduced to safe characters. */
export function imageFileName(name: string): string {
    const slug = name.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `roster-${slug || "bild"}.png`;
}
