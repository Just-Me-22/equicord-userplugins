/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import definePlugin from "@utils/types";
import { StickersStore } from "@webpack/common";

const KEY = "FavStickerOrder";
const CELL = '[class*="stickerNode"]';
const DRAG_THRESHOLD = 6;
/** how close to the top or bottom edge starts the scroll, and the fastest it goes */
const EDGE = 64;
const MAX_SPEED = 18;

/** the ids the user has arranged, which may name stickers they since unfavourited */
let saved: string[] = [];
/** returned to Discord unchanged between renders, so its useMemo does not thrash */
let memo: string[] = [];

function arrange(ids: string[]): string[] {
    if (!saved.length) return ids;
    const rank = new Map(saved.map((id, i) => [id, i]));
    // Array.prototype.sort is stable, so anything favourited since the last drag
    // keeps Discord's own position among the other newcomers at the end
    return [...ids].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
}

/** called from the patch, on every render of the favourites section */
export function order(ids: string[]): string[] {
    const next = arrange(ids);
    if (next.length === memo.length && next.every((id, i) => id === memo[i])) return memo;
    memo = next;
    return next;
}

async function persist(ids: string[]) {
    saved = ids;
    memo = [];
    await DataStore.set(KEY, ids);
    // the favourites row reads through useStateFromStores([StickersStore]), so
    // nudging that store is what makes the new order appear without reopening
    try { (StickersStore as any).emitChange?.(); } catch { /* discord renamed it, reopening still works */ }
}

/** the id is in the asset url, which survives every class rename Discord ships */
function stickerIdOf(cell: Element | null): string | null {
    const src = cell?.querySelector("img")?.getAttribute("src");
    return src?.match(/\/stickers\/(\d+)/)?.[1] ?? null;
}

function cellAt(x: number, y: number): Element | null {
    return document.elementFromPoint(x, y)?.closest(CELL) ?? null;
}

/** the picker's own scroller, not the page: the grid is virtualised inside it */
function scrollerOf(el: Element): HTMLElement | null {
    for (let n = el.parentElement; n; n = n.parentElement) {
        if (n.scrollHeight <= n.clientHeight + 1) continue;
        if (/auto|scroll/.test(getComputedStyle(n).overflowY)) return n;
    }
    return null;
}

const STYLE_ID = "fav-sticker-order-css";

function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
/* the sticker in your hand: shrunk and faded so it reads as lifted off the grid,
   and transparent to hit testing so the slot underneath is a valid drop */
.fso-dragging{
  opacity:.26;
  transform:scale(.92);
  pointer-events:none;
  transition:transform 140ms cubic-bezier(.16,1,.3,1),opacity 140ms linear;
}

/* the copy that rides the cursor. the outer element only ever gets a translate so
   the position update stays on the compositor; the wobble lives on the inner one
   so the two transforms never overwrite each other */
.fso-ghost{
  position:fixed;left:0;top:0;z-index:10000;
  pointer-events:none;
  will-change:transform;
}
/* pivots from the top edge, so the sticker dangles from the cursor rather than
   being centred on it. the cursor sits at the pinch point, which is also the point
   the drop target is measured from, so the swing never moves what you are aiming at */
.fso-ghost-inner{
  width:100%;height:100%;
  transform-origin:50% 0;
  animation:fso-hang 210ms ease-in-out infinite alternate;
  filter:drop-shadow(0 12px 20px rgb(0 0 0 / .5));
}
.fso-ghost-inner img{width:100%;height:100%;display:block}
@keyframes fso-hang{
  from{transform:scale(1.08) rotate(-3deg)}
  to{transform:scale(1.08) rotate(3deg)}
}

/* the drop marker is an insertion bar on the leading edge, not a box around the
   sticker: the sticker lands BEFORE the one you are over, and a bar says that where
   an outline only says "this one" */
.fso-target{
  position:relative;
  transform:translateX(5px);
  transition:transform 170ms cubic-bezier(.16,1,.3,1);
}
.fso-target::before{
  content:"";
  position:absolute;
  left:-6px;top:4px;bottom:4px;width:3px;
  border-radius:3px;
  background:linear-gradient(180deg,#8ea1ff,var(--brand-500,#5865f2));
  box-shadow:0 0 12px 2px color-mix(in srgb,var(--brand-500,#5865f2) 70%,transparent);
  animation:fso-bar 190ms cubic-bezier(.34,1.56,.64,1);
}
@keyframes fso-bar{from{transform:scaleY(.2);opacity:0}to{transform:scaleY(1);opacity:1}}

/* follow through: the sticker that just landed settles into its new slot, so the
   drop is confirmed without a toast */
.fso-landed{animation:fso-landed 260ms cubic-bezier(.34,1.56,.64,1)}
@keyframes fso-landed{0%{transform:scale(.86)}55%{transform:scale(1.07)}100%{transform:scale(1)}}

@media (prefers-reduced-motion:reduce){
  .fso-dragging,.fso-target{transition:none}
  .fso-target::before,.fso-landed{animation:none}
  .fso-ghost-inner{animation:none;transform:scale(1.08) rotate(0deg)}
}`;
    document.documentElement.appendChild(style);
}

let held: { id: string; cell: Element; x: number; y: number; } | null = null;
let dragging = false;
let target: Element | null = null;
let suppressClick = false;
let scroller: HTMLElement | null = null;
let ghost: HTMLElement | null = null;
let pointer = { x: 0, y: 0 };
let speed = 0;
let scrollRaf = 0;

function makeGhost(cell: Element) {
    const img = cell.querySelector("img");
    if (!img) return;
    const box = cell.getBoundingClientRect();

    ghost = document.createElement("div");
    ghost.className = "fso-ghost";
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${box.height}px`;

    const inner = document.createElement("div");
    inner.className = "fso-ghost-inner";
    const copy = document.createElement("img");
    copy.src = img.getAttribute("src") ?? "";
    inner.appendChild(copy);
    ghost.appendChild(inner);
    document.body.appendChild(ghost);
    moveGhost();
}

function moveGhost() {
    if (!ghost) return;
    const half = parseFloat(ghost.style.width) / 2;
    // the pinch is just above the cursor, so the sticker hangs into free space
    ghost.style.transform = `translate3d(${pointer.x - half}px,${pointer.y - 10}px,0)`;
}

function dropGhost() {
    ghost?.remove();
    ghost = null;
}

function markTarget() {
    const over = cellAt(pointer.x, pointer.y);
    const id = stickerIdOf(over);
    const valid = over && over !== held?.cell && id && memo.includes(id) ? over : null;
    if (valid === target) return;
    target?.classList.remove("fso-target");
    target = valid;
    target?.classList.add("fso-target");
}

/** holding the sticker near an edge scrolls the grid, the way dragging a file near
 *  the edge of a list does. the target is recomputed each frame because the content
 *  moves under a pointer that is standing still. */
function autoScroll() {
    if (!scroller || !speed) { scrollRaf = 0; return; }
    scroller.scrollTop += speed;
    markTarget();
    scrollRaf = requestAnimationFrame(autoScroll);
}

function updateSpeed() {
    if (!scroller) { speed = 0; return; }
    const box = scroller.getBoundingClientRect();
    const fromTop = pointer.y - box.top;
    const fromBottom = box.bottom - pointer.y;

    speed =
        fromTop < EDGE ? -Math.ceil(((EDGE - fromTop) / EDGE) * MAX_SPEED) :
        fromBottom < EDGE ? Math.ceil(((EDGE - fromBottom) / EDGE) * MAX_SPEED) :
        0;

    if (speed && !scrollRaf) scrollRaf = requestAnimationFrame(autoScroll);
}

function stopScroll() {
    speed = 0;
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
    scroller = null;
}

function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const cell = (e.target as Element)?.closest?.(CELL);
    if (!cell) return;

    const id = stickerIdOf(cell);
    // only a favourite can be rearranged; a pack sticker has no place in the order
    if (!id || !memo.includes(id)) return;

    held = { id, cell, x: e.clientX, y: e.clientY };
    dragging = false;
}

function onPointerMove(e: PointerEvent) {
    if (!held) return;

    if (!dragging) {
        // under the threshold this is still a click, and a click sends the sticker
        if (Math.hypot(e.clientX - held.x, e.clientY - held.y) < DRAG_THRESHOLD) return;
        dragging = true;
        held.cell.classList.add("fso-dragging");
        scroller = scrollerOf(held.cell);
        pointer = { x: e.clientX, y: e.clientY };
        makeGhost(held.cell);
    }

    e.preventDefault();
    pointer = { x: e.clientX, y: e.clientY };
    moveGhost();
    markTarget();
    updateSpeed();
}

function onPointerUp(e: PointerEvent) {
    if (!held) return;
    const from = held;
    const drop = dragging ? target : null;

    from.cell.classList.remove("fso-dragging");
    target?.classList.remove("fso-target");
    dropGhost();
    stopScroll();
    target = null;
    held = null;

    if (!dragging) return;
    dragging = false;
    suppressClick = true;
    e.preventDefault();
    e.stopImmediatePropagation();

    const dropId = stickerIdOf(drop);
    if (!dropId || dropId === from.id) return;

    const next = memo.filter(id => id !== from.id);
    next.splice(next.indexOf(dropId), 0, from.id);
    persist(next).then(() => settle(from.id));
}

let settleTimer = 0;

/** react rebuilds the cell at the new position, so the animation can only be put on
 *  it once that has happened. one frame is enough and there is nothing to wait on. */
function settle(id: string) {
    requestAnimationFrame(() => {
        const cell = [...document.querySelectorAll(CELL)]
            .find(c => stickerIdOf(c) === id);
        if (!cell) return;
        cell.classList.add("fso-landed");
        clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => cell.classList.remove("fso-landed"), 300);
    });
}

/** a drag ends on the sticker under the cursor, and letting go there would otherwise
 *  send it. the pointerup handler cannot stop a click that react already scheduled */
function onClick(e: MouseEvent) {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
}

export default definePlugin({
    name: "FavStickerOrder",
    description: "Drag your favourite stickers into whatever order you want, and keep it. Only the Favorites section moves; packs and server stickers are left alone.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    patches: [
        {
            // "rowCountBySection" alone is in nine modules and only one holds the
            // favourites list, so a plain string find lands on the wrong one and is
            // spent. both strings together, close, only occur in the grid builder.
            find: /rowCountBySection[\s\S]{0,600}?favoriteStickers\?\.stickerIds/,
            replacement: {
                match: /(\i\.favoriteStickers\?\.stickerIds\?\?\i)/,
                replace: "$self.order($1)"
            }
        }
    ],

    order,

    async start() {
        ensureCss();
        saved = await DataStore.get<string[]>(KEY) ?? [];
        memo = [];
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("pointermove", onPointerMove, true);
        document.addEventListener("pointerup", onPointerUp, true);
        document.addEventListener("click", onClick, true);
    },

    stop() {
        document.getElementById(STYLE_ID)?.remove();
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("pointermove", onPointerMove, true);
        document.removeEventListener("pointerup", onPointerUp, true);
        document.removeEventListener("click", onClick, true);
        dropGhost();
        stopScroll();
        clearTimeout(settleTimer);
        held = null;
        target = null;
    }
});
