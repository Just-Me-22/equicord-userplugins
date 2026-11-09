/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "./settings";

type Pt = [number, number];

const CHUNKS = 8;
const ACCENT = "var(--brand-500, #5865f2)";

export const MATERIALS = [
    { value: "solid", label: "Solid" },
    { value: "glow", label: "Glow" },
    { value: "neon", label: "Neon" },
    { value: "gradient", label: "Gradient" },
    { value: "rainbow", label: "Rainbow" },
    { value: "marker", label: "Marker" },
    { value: "outline", label: "Outline" },
    { value: "chalk", label: "Chalk" },
    { value: "sparkle", label: "Sparkle" },
    { value: "dotted", label: "Dotted" },
    { value: "dashed", label: "Dashed" }
];

export interface TrailLook {
    style?: string;
    fade?: string;
    taper?: boolean;
    plain?: boolean;
    uid?: string;
}

const LAYERED: Record<string, string> = { neon: "vc-mg-core", outline: "vc-mg-inner", sparkle: "vc-mg-faint" };

function defs(points: Pt[], style: string, uid: string) {
    if (style === "chalk")
        return `<defs><filter id="${uid}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`;
    if (style !== "gradient" && style !== "rainbow") return "";
    const [x1, y1] = points[0];
    let [x2, y2] = points[points.length - 1];
    if (Math.hypot(x2 - x1, y2 - y1) < 1) x2 += 1;
    const stops = style === "rainbow"
        ? [0, 60, 120, 180, 240, 300].map((h, i) => `<stop offset="${i / 5}" style="stop-color:hsl(${h} 95% 62%)"/>`).join("")
        : `<stop offset="0" style="stop-color:${settings.store.trailColor || ACCENT}"/><stop offset="1" style="stop-color:${settings.store.trailColor2}"/>`;
    return `<defs><linearGradient id="${uid}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2 + 0.01}">${stops}</linearGradient></defs>`;
}

function line(pts: Pt[], opacity: number, style: string, uid: string, plain: boolean, taper = 1) {
    const points = pts.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(" ");
    const paint = plain ? "" : style === "gradient" || style === "rainbow" ? `stroke:url(#${uid});` : style === "chalk" ? `filter:url(#${uid});` : "";
    const css = ` style="--vc-mg-taper:${taper.toFixed(2)};${paint}"`;
    const layer = LAYERED[style] ? `<polyline class="${LAYERED[style]}" points="${points}" opacity="${opacity}"${css}/>` : "";
    return `<polyline points="${points}" opacity="${opacity}"${css}/>${layer}`;
}

export function trailMarkup(points: Pt[], look: TrailLook = {}) {
    if (points.length < 2) return "";
    const style = look.style ?? settings.store.trailStyle;
    const fade = look.fade ?? settings.store.trailFade;
    const uid = `vc-mg-paint-${look.uid ?? "overlay"}`;
    const plain = !!look.plain;
    const head = plain ? "" : defs(points, style, uid);
    const taper = look.taper ?? settings.store.trailTaper;
    if (fade !== "tail" && !taper) return head + line(points, 1, style, uid, plain);
    const source = fade === "tail" ? points.slice(-Math.max(8, settings.store.tailLength)) : points;
    const size = Math.max(2, Math.ceil(source.length / CHUNKS));
    const chunks = Math.ceil(source.length / size);
    let out = head;
    for (let i = 0; i * size < source.length - 1; i++) {
        const t = (i + 1) / chunks;
        out += line(source.slice(i * size, (i + 1) * size + 1), fade === "tail" ? t : 1, style, uid, plain, taper ? 0.25 + 0.75 * t : 1);
    }
    return out;
}

export const trailClass = (style = settings.store.trailStyle) => `vc-mg-trail vc-mg-style-${style}`;

export function trailVars(): Record<string, string> {
    const { trailWidth, trailOpacity, trailGlow, trailCap, fadeOut } = settings.store;
    return {
        "--vc-mg-width": `${trailWidth}px`,
        "--vc-mg-opacity": String(trailOpacity / 100),
        "--vc-mg-glow-filter": trailGlow > 0 ? `drop-shadow(0 0 ${trailGlow}px currentColor)` : "none",
        "--vc-mg-cap": trailCap,
        "--vc-mg-out": `${fadeOut}ms`
    };
}

let root: HTMLDivElement | null = null;

export function openOverlay() {
    root?.remove();
    root = document.createElement("div");
    root.className = `vc-mg-overlay ${trailClass()}`;
    root.style.color = settings.store.trailColor;
    for (const [k, v] of Object.entries(trailVars())) root.style.setProperty(k, v);
    root.classList.toggle("vc-mg-pill-top", settings.store.pillPos === "top");
    root.innerHTML = '<svg><g></g></svg><div class="vc-mg-pill" hidden><b></b><span></span></div>';
    document.body.appendChild(root);
}

export function drawOverlay(points: Pt[], x: number, y: number, keys: string, label: string | null) {
    if (!root) return;
    const miss = !!keys && !label;
    root.querySelector("g")!.innerHTML = trailMarkup(points, { plain: miss });
    root.classList.toggle("vc-mg-overlay-nomatch", miss);
    root.style.color = label && settings.store.matchColor ? settings.store.matchColor : settings.store.trailColor;
    const pill = root.querySelector<HTMLDivElement>(".vc-mg-pill")!;
    pill.hidden = !keys || settings.store.pillPos === "off";
    if (!keys) return;
    pill.querySelector("b")!.textContent = keys;
    pill.querySelector("span")!.textContent = label ?? "No action";
    pill.classList.toggle("vc-mg-pill-miss", !label);
    if (settings.store.pillPos === "top") return;
    pill.style.left = `${Math.min(x + 18, innerWidth - pill.offsetWidth - 8)}px`;
    pill.style.top = `${y + 52 > innerHeight ? y - 44 : y + 18}px`;
}

export function closeOverlay(matched: boolean) {
    const el = root;
    root = null;
    if (!el) return;
    el.classList.add(matched ? "vc-mg-overlay-done" : "vc-mg-overlay-miss");
    setTimeout(() => el.remove(), settings.store.fadeOut + 40);
}

let ready: HTMLDivElement | null = null;

export function showReady(x: number, y: number) {
    ready?.remove();
    ready = document.createElement("div");
    ready.className = "vc-mg-ready";
    ready.style.left = `${x}px`;
    ready.style.top = `${y}px`;
    ready.style.color = settings.store.trailColor;
    ready.innerHTML = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" pathLength="1"/></svg>';
    document.body.appendChild(ready);
}

export function dropReady() {
    const el = ready;
    ready = null;
    if (!el) return;
    el.classList.add("vc-mg-ready-out");
    setTimeout(() => el.remove(), 140);
}

let audio: AudioContext | null = null;

export function tick() {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.05);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.13);
}
