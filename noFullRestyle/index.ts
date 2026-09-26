/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin, { StartAt } from "@utils/types";

const HOVER = "vc-region-hover";
const RING = "vc-region-ring";
const BASE = '[class*="baseLayer_"] > div[class*="base__"]';
const REGIONS = [
    `${BASE} > div[class*="bar_"]`,
    'nav[class*="guilds_"]',
    'div[class*="sidebarList"]',
    'nav[class*="privateChannels_"]',
    'div[class*="chat_"] section[class*="title_"]',
    'main[class*="chatContent"]'
].join(",");

const MUSIC = "vc-spotify-shown";
const DROP_HAS = /:has\([^()]*(?:data-app-right-panel|\.gameOption_)[^()]*\)/g;
const AFTER_ANY = / \* \+ (?:\*|(?=::?(?:before|after)))/g;

let ring: HTMLDivElement | undefined;
let panels: Element | null = null;
let findPanels: ReturnType<typeof setInterval> | undefined;
const music = new MutationObserver(syncMusic);
let swapped: { rule: CSSStyleRule; original: string; }[] = [];
const links = new MutationObserver(records => {
    for (const { addedNodes } of records)
        for (const node of addedNodes)
            if (node instanceof HTMLLinkElement) watchSheet(node);
});

function swapRules(list: CSSRuleList) {
    for (const rule of list) {
        if (rule instanceof CSSStyleRule) {
            const next = rule.selectorText.replace(DROP_HAS, "").replace(AFTER_ANY, " :not(:first-child)");
            if (next === rule.selectorText) continue;
            swapped.push({ rule, original: rule.selectorText });
            rule.selectorText = next;
        } else if (rule instanceof CSSGroupingRule) swapRules(rule.cssRules);
    }
}

function watchSheet(link: HTMLLinkElement) {
    const swap = () => {
        try {
            if (link.sheet) swapRules(link.sheet.cssRules);
        } catch { }
    };
    if (link.sheet) swap();
    else link.addEventListener("load", swap, { once: true });
}

function restoreRules() {
    for (const { rule, original } of swapped) rule.selectorText = original;
    swapped = [];
}

function syncMusic() {
    document.documentElement.classList.toggle(MUSIC, document.getElementById("vc-spotify-player") !== null);
}

function watchPanels() {
    if (panels?.isConnected) return;
    panels = document.querySelector('section[class*="panels_"]');
    music.disconnect();
    if (panels) music.observe(panels, { childList: true });
    syncMusic();
}

function light(base: Element | null) {
    if (base && ring!.parentElement !== base) base.append(ring!);
    ring!.classList.toggle(HOVER, base !== null);
}

function onOver(e: PointerEvent) {
    const target = e.target as Element;
    light(target.closest?.(REGIONS) ? target.closest(BASE) : null);
}

function onOut(e: PointerEvent) {
    if (!e.relatedTarget) light(null);
}

export default definePlugin({
    name: "NoFullRestyle",
    description: "Stops three things that make Discord re-style the whole app: the screen reader announcer being moved to the start of the page when a modal opens, the focus class flipping on the page root when the window gains or loses focus, and the mouse/keyboard class flipping when you switch between typing and clicking. Loading spinners keep spinning while Discord is in the background, and keyboard focus outlines no longer show. Also marks the app while you hover the server list, channel list or chat, so a theme can light it up without a :has() rule. The class goes on an empty .vc-region-ring overlay inside it. Puts .vc-spotify-shown on the page root while the MusicControls Spotify player is showing, for the same reason. Also rewrites Discord's `> * + *` rules as `> :not(:first-child)` and drops the :has() from its side-panel and game search rules, because they re-styled a whole list or the whole app when a modal or panel opened.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    startAt: StartAt.DOMContentLoaded,

    start() {
        ring = document.createElement("div");
        ring.className = RING;
        ring.style.cssText = "position:absolute;inset:0;pointer-events:none";
        document.addEventListener("pointerover", onOver, { passive: true });
        document.addEventListener("pointerout", onOut, { passive: true });

        watchPanels();
        findPanels = setInterval(watchPanels, 1000);

        document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach(watchSheet);
        links.observe(document.head, { childList: true });
    },

    stop() {
        document.removeEventListener("pointerover", onOver);
        document.removeEventListener("pointerout", onOut);
        ring?.remove();
        ring = undefined;
        clearInterval(findPanels);
        music.disconnect();
        panels = null;
        document.documentElement.classList.remove(MUSIC);
        links.disconnect();
        restoreRules();
    },

    patches: [
        {
            find: '.dataset.liveAnnouncer="true"',
            all: true,
            replacement: {
                match: /(this\.parentNode|document\.body)\.prepend\(this\.node\)/g,
                replace: "$1.append(this.node)"
            }
        },
        {
            find: '"app-focused":',
            replacement: [
                {
                    match: /"app-focused":\i/,
                    replace: '"app-focused":!0'
                },
                {
                    match: /"keyboard-mode":\i/,
                    replace: '"keyboard-mode":!1'
                },
                {
                    match: /"mouse-mode":\i/,
                    replace: '"mouse-mode":!0'
                }
            ]
        }
    ]
});
