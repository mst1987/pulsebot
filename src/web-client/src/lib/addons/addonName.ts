// The name the login notice shows for an addon's detail page (/addon/<id>)
// before anyone is logged in. The addon list (and with it the real name) is
// only for members, so the visitor reads the id, made readable:
// "levelhelper" -> "Levelhelper", "eventhelper-sync" -> "Eventhelper Sync".
// Kept apart from addonInstall.ts: App.tsx needs it in the first chunk.

/** The id of an address part as a name: decoded, words split at "-"/"_", each capitalised; "" for nothing. */
export function addonNameOf(idPart: string): string {
    let id = String(idPart || "");
    try {
        id = decodeURIComponent(id);
    } catch {
        // a broken escape stays as it is
    }
    return id
        .split(/[-_\s]+/)
        .filter(Boolean)
        .slice(0, 6)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
        .slice(0, 60);
}
