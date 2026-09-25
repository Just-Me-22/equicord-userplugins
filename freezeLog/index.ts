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

interface Chain {
    type: string;
    first: number;
    last: number;
    count: number;
    overlaps: number;
    busy: number;
}

const THRESHOLD = 200;
const SLOW_MESSAGE = 60;
const SLOW_LOAD = 1000;
const CHAIN_GAP = 2000;
const CHAIN_MIN = 5;
const CHAT = 'ol[data-list-id="chat-messages"]';
const BIG = 1500;
const INPUTS = ["pointerdown", "keydown", "wheel", "focus", "blur"];

let observer: PerformanceObserver | undefined;
let loads: PerformanceObserver | undefined;
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
const chains = new Map<string, Chain>();

const logger = () => (FluxDispatcher as any).actionLogger as ActionLogger;
const iso = (time: number) => new Date(performance.timeOrigin + time).toISOString();

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
    dispatches.push(current);
    if (dispatches.length > 100) dispatches.shift();
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

function topmost() {
    return [...document.querySelectorAll('[role="dialog"], [id^="popout_"]')].pop();
}

function nameOf(el: Element | undefined) {
    if (!el) return null;
    const heading = el.getAttribute("aria-labelledby");
    const text = el.getAttribute("aria-label")
        || (heading && document.getElementById(heading)?.textContent)
        || el.querySelector("h1, h2, [role=heading]")?.textContent;
    return text?.trim().slice(0, 60) || describe(el);
}

function events(start: number, end: number) {
    const out: { type: string; at: number; times: number; }[] = [];
    for (const d of dispatches) {
        if (d.at <= start - 1000 || d.at >= end) continue;
        const prev = out[out.length - 1];
        if (prev?.type === d.type) prev.times++;
        else out.push({ type: d.type, at: d.at, times: 1 });
    }
    return out.map(e => `${Math.round(e.at - start)} ${e.type}${e.times > 1 ? ` x${e.times}` : ""}`);
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

function messageInfo() {
    lastWasSlow = true;
    const list = chat();
    if (!list) return null;
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
        at: iso(start),
        ms: Math.round(frame.duration),
        blocking: Math.round(frame.blockingDuration),
        style: Math.round(styleOf(frame)),
        render: frame.renderStart ? Math.round(end - frame.renderStart) : 0,
        focused: document.hasFocus(),
        hidden: document.hidden,
        path: location.pathname,
        open: nameOf(topmost()),
        focus: describe(document.activeElement),
        elements: document.getElementsByTagName("*").length,
        message: message ? messageInfo() : undefined,
        before: recent
            .filter(e => e.at > start - 1000 && e.at < end)
            .map(e => `${e.type} ${Math.round(e.at - start)}`),
        events: events(start, end),
        changes: changes
            .filter(c => c.at > start - 1000 && c.at < end)
            .map(c => `${Math.round(c.at - start)} ${c.what}`),
        flux: dispatches
            .filter(d => d.ms >= 10 && d.at >= start && d.at < end)
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

function short(url: string) {
    const { host, pathname, searchParams } = new URL(url);
    for (const key of ["ex", "is", "hm"]) searchParams.delete(key);
    const query = searchParams.toString();
    return `${host}${pathname}${query && "?" + query}`.replace(/\d{15,}|(?:a_)?[0-9a-f]{32}/g, "#");
}

function reportChain(route: string, chain: Chain) {
    chains.delete(route);
    const span = chain.last - chain.first;
    if (chain.count < CHAIN_MIN || chain.overlaps > chain.count / 4 || span < CHAIN_GAP) return;

    pending.push(JSON.stringify({
        at: iso(chain.first),
        kind: "single-file chain",
        type: chain.type,
        route,
        count: chain.count,
        ms: Math.round(span),
        between: Math.max(0, Math.round(span - chain.busy))
    }));
}

function addToChain(route: string, entry: PerformanceResourceTiming) {
    const end = entry.startTime + entry.duration;
    const chain = chains.get(route);

    if (!chain || entry.startTime - chain.last > CHAIN_GAP) {
        if (chain) reportChain(route, chain);
        chains.set(route, { type: entry.initiatorType, first: entry.startTime, last: end, count: 1, overlaps: 0, busy: entry.duration });
        return;
    }

    if (entry.startTime < chain.last) chain.overlaps++;
    chain.last = Math.max(chain.last, end);
    chain.count++;
    chain.busy += entry.duration;
}

function loaded(list: PerformanceObserverEntryList) {
    const entries = list.getEntries() as PerformanceResourceTiming[];
    const open = entries.some(e => e.duration >= SLOW_LOAD) ? nameOf(topmost()) : null;

    for (const entry of entries) {
        const route = short(entry.name);
        if (entry.responseStatus === 429) pending.push(JSON.stringify({ at: iso(entry.startTime), kind: "rate limited", route }));

        if (entry.duration >= SLOW_LOAD) {
            const timed = entry.requestStart > 0;
            pending.push(JSON.stringify({
                at: iso(entry.startTime),
                kind: "slow load",
                type: entry.initiatorType,
                route,
                ms: Math.round(entry.duration),
                waiting: timed ? Math.round(entry.requestStart - entry.startTime) : undefined,
                server: timed ? Math.round(entry.responseStart - entry.requestStart) : undefined,
                downloading: timed ? Math.round(entry.responseEnd - entry.responseStart) : undefined,
                kb: Math.round(entry.decodedBodySize / 1024) || undefined,
                status: entry.responseStatus || undefined,
                path: location.pathname,
                open
            }));
        }

        addToChain(route, entry);
    }
}

function flush() {
    chat();
    watchBig();
    const now = performance.now();
    for (const [route, chain] of chains) if (now - chain.last > CHAIN_GAP) reportChain(route, chain);
    if (!pending.length) return;
    Native.append(pending.join("\n") + "\n");
    pending = [];
}

export default definePlugin({
    name: "FreezeLog",
    description: "Writes freezes over 200ms, chat messages slower than 60ms to style, loads over 1s, requests sent one at a time and rate limits to freezeLog/freezes.jsonl in the Equicord folder.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    start() {
        pending.push(JSON.stringify({ at: new Date().toISOString(), kind: "start", sinceLoad: Math.round(performance.now() / 1000) }));
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

        loads = new PerformanceObserver(loaded);
        loads.observe({ type: "resource", buffered: true });

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
        loads?.disconnect();
        watcher?.disconnect();
        clearInterval(timer);
        flush();
        chains.clear();
    }
});
