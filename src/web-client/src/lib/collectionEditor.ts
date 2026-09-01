import { useSearchParams } from "react-router-dom";

// One editor open at a time over a list of things (raidsheets, templates, …).
//
// A page that renders every entry as its own expanded form is unreadable past
// half a dozen entries, and an "add new" form permanently below the list buries
// the list it belongs to. So: the list is the default view, and exactly one
// editor — a chosen entry or a new one — takes its place.
//
// The open editor lives in the url so it survives a reload and can be linked
// to, and it leaves the page's other params (the settings section, a tab) alone.

export type CollectionEditor = {
    /** "" (list), "new", or the id being edited. */
    open: string;
    isNew: boolean;
    /** The id being edited, "" while creating or listing. */
    editId: string;
    startNew: () => void;
    startEdit: (id: string) => void;
    close: () => void;
};

export function useCollectionEditor(param: string): CollectionEditor {
    const [searchParams, setSearchParams] = useSearchParams();
    const open = searchParams.get(param) || "";

    const set = (value: string) => {
        const params = new URLSearchParams(searchParams);
        if (value) params.set(param, value); else params.delete(param);
        setSearchParams(params);
    };

    return {
        open,
        isNew: open === "new",
        editId: open === "new" ? "" : open,
        startNew: () => set("new"),
        startEdit: (id: string) => set(id),
        close: () => set(""),
    };
}
