// Tab "Setup" of the raid detail: the setup editor of the page's event — or, in
// a raid group (#811), of the raid its tabs switched to ("Raid 1 | Raid 2").
// Each raid is its own editor (keyed by id, so its moves and presence never mix
// with another's); the shared pool comes from the server.
import { useEffect, useState } from "react";
import type { RaidCtx } from "../meta";
import SetupEditor from "./SetupEditor";

export default function SetupTab({ ctx }: { ctx: RaidCtx }) {
    const [raid, setRaid] = useState(ctx.eventId);
    // another event opened on the same page: start at that one
    useEffect(() => setRaid(ctx.eventId), [ctx.eventId]);
    return <SetupEditor key={raid} ctx={ctx} raidId={raid} onSwitchRaid={setRaid} />;
}
