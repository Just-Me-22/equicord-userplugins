/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin, { PluginNative } from "@utils/types";

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

interface Frame extends PerformanceEntry {
    blockingDuration: number;
    renderStart: number;
    styleAndLayoutStart: number;
    scripts: Script[];
}

const THRESHOLD = 200;
const INPUTS = ["pointerdown", "keydown", "wheel", "focus", "blur"];

let observer: PerformanceObserver | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let pending: string[] = [];
const recent: { type: string; at: number; }[] = [];

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

function record(frame: Frame) {
    const start = frame.startTime;
    const end = start + frame.duration;

    pending.push(JSON.stringify({
        at: new Date(performance.timeOrigin + start).toISOString(),
        ms: Math.round(frame.duration),
        blocking: Math.round(frame.blockingDuration),
        style: frame.styleAndLayoutStart ? Math.round(end - frame.styleAndLayoutStart) : 0,
        render: frame.renderStart ? Math.round(end - frame.renderStart) : 0,
        focused: document.hasFocus(),
        hidden: document.hidden,
        path: location.pathname,
        open: describe([...document.querySelectorAll('[role="dialog"], [id^="popout_"]')].pop()),
        focus: describe(document.activeElement),
        elements: document.getElementsByTagName("*").length,
        before: recent
            .filter(e => e.at > start - 1000 && e.at < end)
            .map(e => `${e.type} ${Math.round(e.at - start)}`),
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
    if (!pending.length) return;
    Native.append(pending.join("\n") + "\n");
    pending = [];
}

export default definePlugin({
    name: "FreezeLog",
    description: "Writes every freeze longer than 200ms to freezeLog/freezes.jsonl in the Equicord folder, with the scripts that ran and what you did just before it.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    start() {
        for (const type of INPUTS) window.addEventListener(type, note, { capture: true, passive: true });

        observer = new PerformanceObserver(list => {
            for (const frame of list.getEntries() as Frame[])
                if (frame.duration >= THRESHOLD) record(frame);
        });
        observer.observe({ type: "long-animation-frame", buffered: true });

        timer = setInterval(flush, 10_000);
    },

    stop() {
        for (const type of INPUTS) window.removeEventListener(type, note, { capture: true });
        observer?.disconnect();
        clearInterval(timer);
        flush();
    }
});
