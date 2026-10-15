// The folded parts of "Mein Profil" (pages/profile): which parts are open.
// A tab opens some parts by default (Meine Infos: attendance and weekdays; a
// character: the roster and, when it has some, the loot) until the raider
// clicks one; from then on opening a part closes the others (one at a time,
// as ever), and closing one leaves the rest open.

/** The parts open after a click on `id`, from the parts open now. */
export function toggleFold<T extends string>(open: T[], id: T): T[] {
    return open.includes(id) ? open.filter((f) => f !== id) : [id];
}
