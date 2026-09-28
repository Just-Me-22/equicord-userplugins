/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import definePlugin from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { createRoot, GuildStore, PermissionsBits, PermissionStore } from "@webpack/common";
import type { MouseEvent as ReactMouseEvent } from "react";

import { PreviewHost } from "./Panel";
import { settings } from "./settings";
import {
    cancelClose, clearExit, closeNow, currentTarget, headingToPanel, isHovering, isPinned, keyOf, LAYER, leftRowAt,
    panel, scheduleClose, setTarget, Target
} from "./state";

const SIDEBAR = '[class*="sidebarList"]';
const GUILD_ICON = '[data-list-item-id^="guildsnav___"]';
const LINE = 60;
const SETTLE_EVERY = 80;
const SETTLE_DISTANCE = 4;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

let openTimer: number | undefined;
let settleTimer: number | undefined;
let pointer = { x: 0, y: 0 };
let followFrame = 0;
let pendingKey: string | null = null;

function trackPointer(e: MouseEvent) {
    pointer = { x: e.clientX, y: e.clientY };
}

function cancelOpen() {
    clearTimeout(openTimer);
    clearInterval(settleTimer);
    openTimer = settleTimer = undefined;
    pendingKey = null;
    document.removeEventListener("mousemove", trackPointer);
}

function modifierHeld(e: MouseEvent | ReactMouseEvent) {
    switch (settings.store.instantKey) {
        case "shift": return e.shiftKey;
        case "ctrl": return e.ctrlKey;
        case "alt": return e.altKey;
        default: return false;
    }
}

function hoverStart(e: MouseEvent | ReactMouseEvent, next: Target) {
    if (isPinned()) return;

    const current = currentTarget();
    if (current && keyOf(current) === keyOf(next)) return void cancelClose();
    if (current && headingToPanel(e.clientX, e.clientY)) return;

    const held = modifierHeld(e);
    if (settings.store.requireKey && settings.store.instantKey !== "none" && !held) return;

    clearExit();
    cancelClose();
    if (pendingKey === keyOf(next)) return;
    cancelOpen();
    pendingKey = keyOf(next);

    const open = () => {
        cancelOpen();
        setTarget(next);
    };

    if (held) return open();

    openTimer = window.setTimeout(open, settings.store.hoverDelay);
    if (!settings.store.openOnSettle) return;

    pointer = { x: e.clientX, y: e.clientY };
    let last = pointer;
    document.addEventListener("mousemove", trackPointer, { passive: true });
    settleTimer = window.setInterval(() => {
        if (Math.hypot(pointer.x - last.x, pointer.y - last.y) < SETTLE_DISTANCE) open();
        last = pointer;
    }, SETTLE_EVERY);
}

function hoverEnd(e: MouseEvent | ReactMouseEvent) {
    cancelOpen();
    if (currentTarget()) leftRowAt(e.clientX, e.clientY);
    scheduleClose();
}

function onGuildOver(e: MouseEvent) {
    if (!settings.store.inServers) return;

    const icon = (e.target as Element).closest?.(GUILD_ICON) as HTMLElement | null;
    if (!icon || icon.contains(e.relatedTarget as Node)) return;

    const guildId = icon.dataset.listItemId!.slice("guildsnav___".length);
    if (!/^\d+$/.test(guildId) || !GuildStore.getGuild(guildId)) return;

    hoverStart(e, { kind: "server", guildId, row: icon, rail: icon.closest("nav") ?? icon });
}

function onGuildOut(e: MouseEvent) {
    const icon = (e.target as Element).closest?.(GUILD_ICON);
    if (!icon || icon.contains(e.relatedTarget as Node)) return;
    hoverEnd(e);
}

function inPanel(node: EventTarget | null) {
    return Boolean(node instanceof Node && container?.contains(node));
}

function typingIn(node: EventTarget | null) {
    return node instanceof Element && inPanel(node) && node.matches("input, textarea");
}

function onKeyDown(e: KeyboardEvent) {
    if (!currentTarget()) return;

    if (e.key === "Escape") {
        if (typingIn(e.target)) return;
        return closeNow();
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && (isHovering() || isPinned()) && panel.search) {
        e.preventDefault();
        e.stopPropagation();
        return panel.search();
    }

    const { scroller } = panel;
    if (!scroller || !isHovering() || typingIn(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;

    const { scrollTop, clientHeight, scrollHeight } = scroller;
    let next: number;

    switch (e.key) {
        case "ArrowUp": next = scrollTop - LINE; break;
        case "ArrowDown": next = scrollTop + LINE; break;
        case "PageUp": next = scrollTop - clientHeight * 0.9; break;
        case "PageDown": next = scrollTop + clientHeight * 0.9; break;
        case "Home": next = 0; break;
        case "End": next = scrollHeight; break;
        default: return;
    }

    scroller.scrollTop = next;
    e.preventDefault();
}

function onOutsideClick(e: Event) {
    if (!currentTarget() || isPinned() || inPanel(e.target)) return;
    if ((e.target as Element)?.closest?.(LAYER)) return;
    closeNow();
}

function onScroll(e: Event) {
    const current = currentTarget();
    if (!current || isPinned() || inPanel(e.target)) return;
    if ((e.target as Element)?.closest?.(LAYER)) return;

    if (!(e.target instanceof Node) || !e.target.contains(current.row) || e.target === document) return closeNow();
    if (followFrame) return;

    followFrame = requestAnimationFrame(() => {
        followFrame = 0;
        const latest = currentTarget();
        if (!latest || latest !== current) return;

        const row = latest.row.getBoundingClientRect();
        const rail = latest.rail.getBoundingClientRect();
        if (!latest.row.isConnected || row.bottom < rail.top || row.top > rail.bottom) return closeNow();

        setTarget({ ...latest });
    });
}

function onBlur() {
    if (!isPinned()) closeNow();
}

export default definePlugin({
    name: "ChannelHoverPreview",
    description: "Hovering a DM, a server channel or a server icon opens a window with its recent messages.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    tags: ["Chat", "Utility"],
    settings,

    patches: [
        {
            find: "shouldShowThreadsPopout",
            replacement: {
                match: /(onMouseEnter:\i\|\|\i\?this\.handleMouseEnter:void 0,)/,
                replace: "$1onMouseOver:e=>$self.onRowOver(e,this?.props?.channel),onMouseOut:e=>$self.onRowOut(e),"
            }
        },
        {
            find: "PrivateChannel.renderAvatar: Invalid prop configuration - no user or channel",
            replacement: {
                match: /(innerRef:\i,)(?=to:\i\.\i\.CHANNEL\(\i\.\i,(\i)\.id\))/,
                replace: "$1onMouseOver:e=>$self.onRowOver(e,$2),onMouseOut:e=>$self.onRowOut(e),"
            }
        }
    ],

    onRowOver(e: ReactMouseEvent, channel?: Channel) {
        if (!channel) return;
        if (!(channel.isPrivate() ? settings.store.inDms : settings.store.inChannels)) return;
        if (!channel.isPrivate() && !PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)) return;

        const row = e.currentTarget as HTMLElement;
        hoverStart(e, { kind: "channel", channel, row, rail: row.closest(SIDEBAR) ?? row });
    },

    onRowOut(e: ReactMouseEvent) {
        const to = e.relatedTarget as Node | null;
        if (to && e.currentTarget.contains(to)) return;
        hoverEnd(e);
    },

    start() {
        container = document.createElement("div");
        container.id = "chp-container";
        (document.getElementById("app-mount") ?? document.body).appendChild(container);

        root = createRoot(container);
        root.render(<PreviewHost />);

        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("click", onOutsideClick, true);
        document.addEventListener("mouseover", onGuildOver, { passive: true });
        document.addEventListener("mouseout", onGuildOut, { passive: true });
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("blur", onBlur);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("click", onOutsideClick, true);
        document.removeEventListener("mouseover", onGuildOver);
        document.removeEventListener("mouseout", onGuildOut);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("blur", onBlur);

        cancelOpen();
        cancelAnimationFrame(followFrame);
        followFrame = 0;
        closeNow();

        root?.unmount();
        root = null;
        container?.remove();
        container = null;
    }
});
