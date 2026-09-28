/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Channel } from "@vencord/discord-types";
import { useEffect, useState } from "@webpack/common";
import type { MouseEvent as ReactMouseEvent } from "react";

export const LAYER = '[class*="layerContainer"], [role="menu"], [role="dialog"]';

const CLOSE_GRACE = 200;
const TOWARD_GRACE = 450;

export type Target =
    | { kind: "channel"; channel: Channel; row: HTMLElement; rail: HTMLElement; }
    | { kind: "server"; guildId: string; row: HTMLElement; rail: HTMLElement; };

export const keyOf = (value: Target) => value.kind === "channel" ? value.channel.id : `guild-${value.guildId}`;

let target: Target | null = null;
let pinned = false;
let hovering = false;
let closeTimer: number | undefined;
let exit: { x: number; y: number; } | null = null;

export const panel: { el: HTMLDivElement | null; scroller: HTMLDivElement | null; search: (() => void) | null; } = {
    el: null,
    scroller: null,
    search: null
};

const listeners = new Set<() => void>();

function notify() {
    for (const listener of listeners) listener();
}

export function currentTarget() {
    return target;
}

export function isPinned() {
    return pinned;
}

export function isHovering() {
    return hovering;
}

export function setTarget(next: Target | null) {
    if (!target && !next) return;
    target = next;
    if (!next) pinned = false;
    notify();
}

export function setPinned(next: boolean) {
    if (pinned === next) return;
    pinned = next;
    notify();
}

export function useTarget() {
    const [state, setState] = useState({ target, pinned });

    useEffect(() => {
        const update = () => setState({ target, pinned });
        listeners.add(update);
        return () => void listeners.delete(update);
    }, []);

    return state;
}

function typingInside() {
    const active = document.activeElement;
    return Boolean(active && panel.el?.contains(active) && active.matches("input, textarea"));
}

export function cancelClose() {
    clearTimeout(closeTimer);
    closeTimer = undefined;
}

export function scheduleClose() {
    if (!target || closeTimer || pinned || typingInside()) return;
    closeTimer = window.setTimeout(() => {
        closeTimer = undefined;
        if (!hovering) setTarget(null);
    }, exit ? TOWARD_GRACE : CLOSE_GRACE);
}

export function closeNow() {
    cancelClose();
    hovering = false;
    exit = null;
    setTarget(null);
}

export function onPanelEnter() {
    hovering = true;
    exit = null;
    cancelClose();
}

export function onPanelLeave(e: ReactMouseEvent) {
    if ((e.relatedTarget as HTMLElement)?.closest?.(LAYER)) return;
    hovering = false;
    scheduleClose();
}

export function leftRowAt(x: number, y: number) {
    exit = { x, y };
}

export function clearExit() {
    exit = null;
}

function side(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

export function headingToPanel(x: number, y: number) {
    const box = panel.el?.getBoundingClientRect();
    if (!exit || !box) return false;

    const edge = box.left >= exit.x ? box.left : box.right;
    const a = side(exit.x, exit.y, edge, box.top - 24, x, y);
    const b = side(edge, box.top - 24, edge, box.bottom + 24, x, y);
    const c = side(edge, box.bottom + 24, exit.x, exit.y, x, y);

    return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0);
}
