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

let canvas: HTMLCanvasElement | null = null;
let pen: CanvasRenderingContext2D | null = null;
let baseColor = "#5865f2";

export function accent() {
    const probe = document.createElement("span");
    probe.style.color = "var(--brand-500, #5865f2)";
    document.body.appendChild(probe);
    const { color } = getComputedStyle(probe);
    probe.remove();
    return color || "#5865f2";
}

function trace(c: CanvasRenderingContext2D, points: Pt[]) {
    c.beginPath();
    c.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
}

function strokeLine(c: CanvasRenderingContext2D, points: Pt[], paint: string | CanvasGradient, glow: string, style: string, width: number, alpha: number) {
    const { trailCap, trailGlow } = settings.store;
    c.save();
    c.globalAlpha = alpha;
    c.lineJoin = "round";
    c.lineCap = trailCap as CanvasLineCap;
    c.strokeStyle = paint;
    c.lineWidth = width;
    c.shadowColor = "rgba(0, 0, 0, 0.45)";
    c.shadowBlur = 2;
    let again: (() => void) | undefined;

    switch (style) {
        case "plain":
            c.globalAlpha = alpha * 0.7;
            c.setLineDash([2, 9]);
            break;
        case "glow":
            c.shadowColor = glow;
            c.shadowBlur = 8;
            break;
        case "neon":
            c.lineWidth = width * 2.2;
            c.globalAlpha = alpha * 0.55;
            c.shadowColor = glow;
            c.shadowBlur = 10;
            again = () => {
                c.globalAlpha = alpha;
                c.shadowBlur = 0;
                c.strokeStyle = "#fff";
                c.lineWidth = width * 0.6;
            };
            break;
        case "marker":
            c.lineWidth = width * 2.8;
            c.globalAlpha = alpha * 0.42;
            c.lineCap = "square";
            c.shadowBlur = 0;
            break;
        case "outline":
            c.lineWidth = width * 2;
            again = () => {
                c.shadowBlur = 0;
                c.strokeStyle = "#16171a";
                c.lineWidth = width * 0.9;
            };
            break;
        case "chalk":
            c.globalAlpha = alpha * 0.9;
            c.lineCap = "butt";
            c.setLineDash([width * 1.4, width * 0.5]);
            break;
        case "sparkle":
            c.lineWidth = 1.5;
            c.globalAlpha = alpha * 0.45;
            again = () => {
                c.globalAlpha = alpha;
                c.lineCap = "round";
                c.lineWidth = width * 1.3;
                c.setLineDash([0, width * 3.2]);
                c.shadowColor = glow;
                c.shadowBlur = 6;
            };
            break;
        case "dotted":
            c.lineCap = "round";
            c.setLineDash([0, width * 2.4]);
            break;
        case "dashed":
            c.lineCap = "butt";
            c.setLineDash([width * 2.6, width * 1.8]);
            break;
    }
    if (trailGlow > 0 && style !== "plain") {
        c.shadowColor = glow;
        c.shadowBlur = Math.max(c.shadowBlur, trailGlow);
    }
    trace(c, points);
    c.stroke();
    if (again) {
        again();
        c.stroke();
    }
    c.restore();
}

function paintTrail(c: CanvasRenderingContext2D, points: Pt[], color: string, miss: boolean) {
    const { trailStyle, trailFade, trailTaper, trailWidth, trailOpacity, tailLength, trailColor2 } = settings.store;
    const style = miss ? "plain" : trailStyle;
    let paint: string | CanvasGradient = color;
    if (style === "gradient" || style === "rainbow") {
        const [x1, y1] = points[0], [x2, y2] = points[points.length - 1];
        const gradient = c.createLinearGradient(x1, y1, x2 + 0.5, y2 + 0.5);
        if (style === "rainbow") [0, 60, 120, 180, 240, 300].forEach((h, i) => gradient.addColorStop(i / 5, `hsl(${h} 95% 62%)`));
        else {
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, trailColor2);
        }
        paint = gradient;
    }
    const alpha = trailOpacity / 100;
    const tail = trailFade === "tail";
    if (!tail && !trailTaper) return strokeLine(c, points, paint, color, style, trailWidth, alpha);
    const source = tail ? points.slice(-Math.max(8, tailLength)) : points;
    const size = Math.max(2, Math.ceil(source.length / CHUNKS));
    const chunks = Math.ceil(source.length / size);
    for (let i = 0; i * size < source.length - 1; i++) {
        const t = (i + 1) / chunks;
        strokeLine(c, source.slice(i * size, (i + 1) * size + 1), paint, color, style, trailWidth * (trailTaper ? 0.25 + 0.75 * t : 1), alpha * (tail ? t : 1));
    }
}

function paintPill(c: CanvasRenderingContext2D, x: number, y: number, keys: string, label: string | null, color: string, w: number, h: number) {
    const text = label ?? "No action";
    c.save();
    c.font = '600 13px "gg sans", "Noto Sans", "Helvetica Neue", Arial, sans-serif';
    c.textBaseline = "middle";
    const keysWidth = c.measureText(keys).width;
    const width = 12 + keysWidth + 8 + c.measureText(text).width + 12, height = 30;
    const top = settings.store.pillPos === "top";
    const px = top ? (w - width) / 2 : Math.max(8, Math.min(x + 18, w - width - 8));
    const py = top ? 16 : Math.max(4, Math.min(y + 52 > h ? y - 44 : y + 18, h - height - 4));
    c.shadowColor = "rgba(0, 0, 0, 0.3)";
    c.shadowBlur = 14;
    c.shadowOffsetY = 4;
    c.fillStyle = "rgba(17, 18, 20, 0.9)";
    c.beginPath();
    c.roundRect(px, py, width, height, 15);
    c.fill();
    c.shadowColor = "transparent";
    c.fillStyle = color;
    c.fillText(keys, px + 12, py + height / 2 + 0.5);
    c.fillStyle = label ? "#fff" : "rgba(255, 255, 255, 0.6)";
    c.fillText(text, px + 20 + keysWidth, py + height / 2 + 0.5);
    c.restore();
}

export function openOverlay() {
    canvas?.remove();
    const scale = devicePixelRatio || 1;
    canvas = document.createElement("canvas");
    canvas.className = "vc-mg-overlay";
    canvas.width = Math.round(innerWidth * scale);
    canvas.height = Math.round(innerHeight * scale);
    canvas.style.setProperty("--vc-mg-out", `${settings.store.fadeOut}ms`);
    document.body.appendChild(canvas);
    pen = canvas.getContext("2d");
    pen?.scale(scale, scale);
    baseColor = settings.store.trailColor || accent();
}

export function paintFrame(c: CanvasRenderingContext2D, points: Pt[], x: number, y: number, keys: string, label: string | null, base: string, w: number, h: number) {
    const miss = !!keys && !label;
    const color = miss ? "#8b8e94" : (label && settings.store.matchColor) || base;
    c.clearRect(0, 0, w, h);
    if (points.length > 1) paintTrail(c, points, color, miss);
    if (keys && settings.store.pillPos !== "off") paintPill(c, x, y, keys, label, color, w, h);
}

export function drawOverlay(points: Pt[], x: number, y: number, keys: string, label: string | null) {
    if (pen) paintFrame(pen, points, x, y, keys, label, baseColor, innerWidth, innerHeight);
}

export function closeOverlay(matched: boolean) {
    const el = canvas;
    canvas = null;
    pen = null;
    if (!el) return;
    el.classList.add(matched ? "vc-mg-overlay-done" : "vc-mg-overlay-miss");
    setTimeout(() => el.remove(), settings.store.fadeOut + 40);
}

let ready: HTMLDivElement | null = null;

export function showReady(x: number, y: number, fill = 0) {
    ready?.remove();
    ready = document.createElement("div");
    ready.className = "vc-mg-ready";
    if (fill > 0) ready.style.setProperty("--vc-mg-ready", `${fill}ms`);
    ready.style.left = `${x}px`;
    ready.style.top = `${y}px`;
    ready.style.color = settings.store.trailColor;
    ready.innerHTML = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" pathLength="1"/></svg>';
    document.body.appendChild(ready);
}

export function readyGo() {
    ready?.classList.add("vc-mg-ready-go");
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
