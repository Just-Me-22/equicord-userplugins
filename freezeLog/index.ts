/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin, { PluginNative } from "@utils/types";
import { FluxDispatcher, SelectedChannelStore } from "@webpack/common";

const Native = VencordNative.pluginHelpers.FreezeLog as PluginNative<typeof import("./native")>;

interface Script {
    duration: number;
    forcedStyleAndLayoutDuration: number;
    invokerType: string;
    invoker: string;
    sourceFunctionName: string;
    sourceURL: string;
    sourceCharPosition: number;
}

interface Dispatch {
    type: string;
    at: number;
    ms: number;
    stores: [string, number][];
}

interface ActionLogger {
    on(event: string, listener: (...args: any[]) => void): void;
    off(event: string, listener: (...args: any[]) => void): void;
}

interface Frame extends PerformanceEntry {
    blockingDuration: number;
    renderStart: number;
    styleAndLayoutStart: number;
    scripts: Script[];
}

const THRESHOLD = 200;
const SLOW_MESSAGE = 60;
const CHAT = 'ol[data-list-id="chat-messages"]';
const BIG = 1500;
const INPUTS = ["pointerdown", "keydown", "wheel", "focus", "blur"];

let observer: PerformanceObserver | undefined;
let watcher: MutationObserver | undefined;
const changes: { at: number; what: string; }[] = [];
let timer: ReturnType<typeof setInterval> | undefined;
let pending: string[] = [];
const recent: { type: string; at: number; }[] = [];
const dispatches: Dispatch[] = [];
let current: Dispatch | undefined;
let lastMessage = 0;
let lastFast = 0;
let lastWasSlow = false;
const opened = new WeakMap<Element, number>();
const checked = new WeakSet<Element>();

const logger = () => (FluxDispatcher as any).actionLogger as ActionLogger;

function chat() {
    const list = document.querySelector(CHAT);
    if (list && !opened.has(list)) opened.set(list, performance.now());
    return list;
}

function begin(action: { type: string; channelId?: string; }) {
    current = { type: action.type, at: performance.now(), ms: 0, stores: [] };
    if (action.type === "MESSAGE_CREATE" && action.channelId === SelectedChannelStore.getChannelId()) {
        if (lastMessage && !lastWasSlow) lastFast = lastMessage;
        lastMessage = current.at;
        lastWasSlow = false;
        chat();
    }
    return false;
}

function trace(_type: string, store: string, ms: number) {
    if (current && ms >= 2) current.stores.push([store, Math.round(ms)]);
}

function end() {
    if (!current) return;
    current.ms = Math.round(performance.now() - current.at);
    if (current.ms >= 10) {
        dispatches.push(current);
        if (dispatches.length > 30) dispatches.shift();
    }
    current = undefined;
}

function note(event: Event) {
    if ((event.type === "focus" || event.type === "blur") && event.target !== window) return;
    recent.push({ type: event.type, at: event.timeStamp });
    if (recent.length > 20) recent.shift();
}

function describe(el: Element | null | undefined) {
    if (!el || el === document.body) return null;
    const label = el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.id;
    const name = el.className && typeof el.className === "string" ? el.className.split(/\s/)[0] : "";
    return `${el.tagName.toLowerCase()} ${name} ${label ?? ""}`.trim();
}

function tokens(attr: string, value: string | null) {
    return new Set((value ?? "").split(attr === "style" ? ";" : /\s+/).map(t => t.trim()).filter(Boolean));
}

function diff(attr: string, before: string | null, after: string | null) {
    const was = tokens(attr, before), now = tokens(attr, after);
    const added = [...now].filter(t => !was.has(t)), removed = [...was].filter(t => !now.has(t));
    return `${added.length ? "+" + added.join(" +") : ""} ${removed.length ? "-" + removed.join(" -") : ""}`.trim().slice(0, 200);
}

function label(node: Node) {
    const el = node instanceof Element ? node : node.parentElement;
    return el ? describe(el) ?? el.tagName.toLowerCase() : node.nodeName;
}

function watched(records: MutationRecord[]) {
    const at = performance.now();
    for (const r of records) {
        const what = r.type === "attributes"
            ? `${label(r.target)} [${r.attributeName}] ${diff(r.attributeName!, r.oldValue, (r.target as Element).getAttribute(r.attributeName!))}`
            : `head ${r.type} ${label(r.target)} +${r.addedNodes.length} -${r.removedNodes.length}`;
        changes.push({ at, what });
        if (changes.length > 40) changes.shift();
    }
}

function watchBig() {
    const queue: Element[] = [document.documentElement];
    for (const el of queue) {
        watcher!.observe(el, { attributes: true, attributeOldValue: true });
        for (const child of el.children)
            if (child !== document.head && child.getElementsByTagName("*").length >= BIG) queue.push(child);
    }
    watcher!.observe(document.head, { childList: true, subtree: true, characterData: true });
}

function styleOf(frame: Frame) {
    return frame.styleAndLayoutStart ? frame.startTime + frame.duration - frame.styleAndLayoutStart : 0;
}

function insertCost(parent: Element) {
    const row = document.createElement("li");
    document.body.offsetHeight;
    const start = performance.now();
    parent.append(row);
    getComputedStyle(row).color;
    const ms = performance.now() - start;
    row.remove();
    return Math.round(ms);
}

function compare(list: Element) {
    if (!list.isConnected) return;
    const copy = list.cloneNode(true) as Element;
    list.after(copy);
    document.body.offsetHeight;
    const fresh = insertCost(copy);
    copy.remove();
    pending.push(JSON.stringify({ at: new Date().toISOString(), kind: "list check", list: insertCost(list), fresh }));
}

function messageInfo() {
    lastWasSlow = true;
    const list = chat();
    if (!list) return null;
    if (!checked.has(list)) {
        checked.add(list);
        requestIdleCallback(() => compare(list), { timeout: 2000 });
    }
    return {
        listAge: Math.round((performance.now() - opened.get(list)!) / 1000),
        rows: list.childElementCount,
        sinceFast: lastFast ? Math.round((lastMessage - lastFast) / 1000) : null
    };
}

function record(frame: Frame, message: boolean) {
    const start = frame.startTime;
    const end = start + frame.duration;

    pending.push(JSON.stringify({
        at: new Date(performance.timeOrigin + start).toISOString(),
        ms: Math.round(frame.duration),
        blocking: Math.round(frame.blockingDuration),
        style: Math.round(styleOf(frame)),
        render: frame.renderStart ? Math.round(end - frame.renderStart) : 0,
        focused: document.hasFocus(),
        hidden: document.hidden,
        path: location.pathname,
        open: describe([...document.querySelectorAll('[role="dialog"], [id^="popout_"]')].pop()),
        focus: describe(document.activeElement),
        elements: document.getElementsByTagName("*").length,
        message: message ? messageInfo() : undefined,
        before: recent
            .filter(e => e.at > start - 1000 && e.at < end)
            .map(e => `${e.type} ${Math.round(e.at - start)}`),
        changes: changes
            .filter(c => c.at > start - 1000 && c.at < end)
            .map(c => `${Math.round(c.at - start)} ${c.what}`),
        flux: dispatches
            .filter(d => d.at >= start && d.at < end)
            .map(d => ({
                type: d.type,
                ms: d.ms,
                stores: d.stores.sort((a, b) => b[1] - a[1]).slice(0, 6)
            })),
        scripts: [...frame.scripts]
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 5)
            .map(s => ({
                ms: Math.round(s.duration),
                forced: Math.round(s.forcedStyleAndLayoutDuration),
                invoker: `${s.invokerType} ${s.invoker}`,
                fn: s.sourceFunctionName,
                src: `${s.sourceURL.split("/").pop()}:${s.sourceCharPosition}`
            }))
    }));
}

function flush() {
    chat();
    watchBig();
    if (!pending.length) return;
    Native.append(pending.join("\n") + "\n");
    pending = [];
}

export default definePlugin({
    name: "FreezeLog",
    description: "Writes every freeze longer than 200ms, and every new chat message that takes more than 60ms to style, to freezeLog/freezes.jsonl in the Equicord folder, with the scripts that ran and what you did just before it.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    start() {
        for (const type of INPUTS) window.addEventListener(type, note, { capture: true, passive: true });

        FluxDispatcher.addInterceptor(begin);
        logger().on("trace", trace);
        logger().on("log", end);

        observer = new PerformanceObserver(list => {
            for (const frame of list.getEntries() as Frame[]) {
                const message = lastMessage >= frame.startTime - 300 && lastMessage < frame.startTime + frame.duration && styleOf(frame) >= SLOW_MESSAGE;
                if (message || frame.duration >= THRESHOLD) record(frame, message);
            }
        });
        observer.observe({ type: "long-animation-frame", buffered: true });

        watcher = new MutationObserver(watched);
        watchBig();

        timer = setInterval(flush, 10_000);
    },

    stop() {
        for (const type of INPUTS) window.removeEventListener(type, note, { capture: true });

        const interceptors: unknown[] = FluxDispatcher._interceptors;
        interceptors.splice(interceptors.indexOf(begin), 1);
        logger().off("trace", trace);
        logger().off("log", end);
        observer?.disconnect();
        watcher?.disconnect();
        clearInterval(timer);
        flush();
    }
});
