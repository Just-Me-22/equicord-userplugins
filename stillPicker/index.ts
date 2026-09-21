/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

const LAYERS = '[class*="layerContainer__"]';
const GRID = '[class*="list__"][class*="scrollbarGutterStable__"]';
const TILE = 'div[class*="GridItem"]';
const HEADINGS = '[class*="headings__"]';

const ROW_ID = "still-picker-row";

/** on while the toggle is on, and it stays on across opening one picker after another,
 *  which is what you want when you are working through all three */
let still = false;

/** the grid is virtualised, so tiles are built and thrown away as you scroll. without
 *  this the ones that scroll into view come back playing. it only runs while the toggle
 *  is on, and it only looks at the nodes that were just added rather than re-reading the
 *  whole grid on every mutation. */
let gridObs: MutationObserver | null = null;
let layerObs: MutationObserver | null = null;
let waiting = 0;

const videosIn = (root: Element): HTMLVideoElement[] => [
    ...(root instanceof HTMLVideoElement ? [root] : []),
    ...root.querySelectorAll("video")
];

function freeze(root: Element) {
    for (const video of videosIn(root)) {
        video.autoplay = false;
        video.pause();
    }
}

function thaw(root: Element) {
    for (const video of videosIn(root)) {
        video.autoplay = true;
        // a backgrounded tab refuses to start playback, and that is not worth reporting
        void video.play().catch(() => { });
    }
}

function watchGrid(grid: Element) {
    gridObs?.disconnect();
    gridObs = new MutationObserver(records => {
        for (const record of records)
            for (const node of record.addedNodes)
                if (node instanceof HTMLElement) freeze(node);
    });
    gridObs.observe(grid, { childList: true, subtree: true });
}

function row(grid: Element): HTMLElement {
    const wrap = document.createElement("label");
    wrap.id = ROW_ID;
    wrap.style.cssText = "display:flex;align-items:center;gap:8px;margin:0 12px 8px;" +
        "font-size:13px;color:var(--text-muted);cursor:pointer;user-select:none";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = still;
    box.style.cssText = "cursor:pointer;margin:0";

    const label = document.createElement("span");
    // says what it does and what it does not, because discord serves decorations as
    // animated images and gives no still version of them to ask for
    label.textContent = "Hold nameplates still (decorations keep moving)";

    box.addEventListener("change", () => {
        still = box.checked;
        if (still) {
            freeze(grid);
            watchGrid(grid);
        } else {
            gridObs?.disconnect();
            gridObs = null;
            thaw(grid);
        }
    });

    wrap.append(box, label);
    return wrap;
}

/** a layer opened or closed. a picker is any layer holding the collectible grid, which
 *  covers the decoration, nameplate and profile effect ones without naming any of them. */
function onLayers() {
    const grid = document.querySelector(`${LAYERS} ${GRID}`);

    if (!grid || !grid.querySelector(TILE)) {
        gridObs?.disconnect();
        gridObs = null;
        return;
    }

    if (!document.getElementById(ROW_ID)) {
        const heading = grid.querySelector(HEADINGS);
        heading?.parentElement?.insertBefore(row(grid), heading.nextSibling);
    }

    if (still) {
        freeze(grid);
        watchGrid(grid);
    }
}

/** the layer container is part of the app shell but is not there the instant a plugin
 *  starts, so this looks for it a few times and then gives up rather than polling on */
function attach() {
    const layers = document.querySelector(LAYERS);

    if (!layers) {
        if (waiting++ > 40) return;
        setTimeout(attach, 500);
        return;
    }

    layerObs = new MutationObserver(onLayers);
    layerObs.observe(layers, { childList: true });
}

export default definePlugin({
    name: "StillPicker",
    description: "Adds a toggle to the nameplate, decoration and profile effect pickers that pauses the animated tiles while you browse. Nameplates and profile effects stop because they are video. Decorations are animated images and Discord serves no still version, so those keep moving.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    start() {
        waiting = 0;
        attach();
    },

    stop() {
        layerObs?.disconnect();
        gridObs?.disconnect();
        layerObs = gridObs = null;
        document.getElementById(ROW_ID)?.remove();
    }
});
