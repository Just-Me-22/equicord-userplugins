/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { createRoot, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

import { getQuery, refresh, restartFilter, setQuery } from "./filter";
import { settings } from "./settings";

const cl = classNameFactory("vc-channel-peek-");

function Bar() {
    const { hideRead } = settings.use(["hideRead"]);
    const [value, setValue] = useState(getQuery());

    return <div className={cl("filter")}>
        <input
            className={cl("filter-input")}
            value={value}
            placeholder="Filter channels"
            onChange={e => {
                setValue(e.currentTarget.value);
                setQuery(e.currentTarget.value);
            }}
            onKeyDown={e => {
                if (e.key !== "Escape") return;
                setValue("");
                setQuery("");
            }}
        />
        <button
            className={cl("filter-toggle", { "filter-toggle-on": hideRead })}
            aria-pressed={hideRead}
            aria-label="Hide channels with nothing unread"
            onClick={() => {
                settings.store.hideRead = !hideRead;
                refresh();
            }}
        >
            Unread
        </button>
    </div>;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function nav() {
    return document.querySelector<HTMLElement>('nav:not([class*="privateChannels_"])');
}

export function attachFilterBar() {
    if (!settings.store.filterBar) return;

    const target = nav();
    if (!target) return;
    if (host && target.firstChild === host) return;

    if (!host) {
        host = document.createElement("div");
        host.className = cl("filter-host");
        root = createRoot(host);
        root.render(<Bar />);
    }

    target.prepend(host);
    restartFilter();
}

export function stopFilterBar() {
    root?.unmount();
    host?.remove();
    root = undefined;
    host = undefined;
}
