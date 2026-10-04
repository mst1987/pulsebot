import { useCallback, useState } from "react";
import { parseSheetLayout, type SheetLayout } from "../lib/raidplan/sheetLayout";

const KEY = "eh.raidplan.sheetLayout";

function load(): SheetLayout {
    try { return parseSheetLayout(window.localStorage.getItem(KEY)); } catch { return parseSheetLayout(null); }
}

/**
 * The sheet's layout as this visitor left it (lib/raidplan/sheetLayout.ts): the boss strip and "Alle Einteilungen", kept in this browser
 * across sections and reloads. A private window that refuses storage keeps it for the page's life only.
 */
export function useSheetLayout(): [SheetLayout, (patch: Partial<SheetLayout>) => void] {
    const [layout, setLayout] = useState<SheetLayout>(load);
    const set = useCallback((patch: Partial<SheetLayout>) => {
        setLayout((cur) => {
            const next = { ...cur, ...patch };
            try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window */ }
            return next;
        });
    }, []);
    return [layout, set];
}
