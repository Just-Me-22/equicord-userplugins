/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { useEffect, useLayoutEffect, useRef, useState } from "@webpack/common";

import { fromHex, intToLab, labToLch, lchToInt, toHex } from "./color";

export const canDrop = "EyeDropper" in window;

export async function eyeDropper(): Promise<number | null> {
    try {
        const { sRGBHex } = await new (window as any).EyeDropper().open();
        return fromHex(sRGBHex);
    } catch {
        return null;
    }
}

export function useFrame<T>(fn: (v: T) => void) {
    const latest = useRef<T | null>(null);
    const queued = useRef(0);
    const fnRef = useRef(fn);
    fnRef.current = fn;
    useEffect(() => () => cancelAnimationFrame(queued.current), []);
    return (v: T) => {
        latest.current = v;
        if (queued.current) return;
        queued.current = requestAnimationFrame(() => {
            queued.current = 0;
            fnRef.current(latest.current!);
        });
    };
}

export function ColorField({ value, onChange, label }: { value: number; onChange(c: number): void; label: string; }) {
    const [text, setText] = useState(toHex(value));
    const live = useFrame(onChange);

    useEffect(() => setText(toHex(value)), [value]);

    return (
        <div className="vc-nss-field">
            <label className="vc-nss-swatch" style={{ background: toHex(value) }} aria-label={label}>
                <input type="color" value={toHex(value)} onInput={e => live(fromHex(e.currentTarget.value)!)} />
            </label>
            <input
                className="vc-nss-hex"
                value={text}
                spellCheck={false}
                maxLength={7}
                aria-label={`${label} hex`}
                onChange={e => {
                    setText(e.currentTarget.value);
                    const c = fromHex(e.currentTarget.value);
                    if (c != null && e.currentTarget.value.replace("#", "").length === 6) onChange(c);
                }}
                onBlur={() => setText(toHex(value))}
            />
            {canDrop && (
                <button
                    className="vc-nss-icon"
                    title="Pick a colour from anywhere on screen"
                    aria-label={`${label} eyedropper`}
                    onClick={async () => {
                        const c = await eyeDropper();
                        if (c != null) onChange(c);
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.7 3.3a3.1 3.1 0 0 0-4.4 0l-2.6 2.6-1.4-1.4-1.4 1.4 1.4 1.4-7.9 7.9A2 2 0 0 0 4 16.6V20h3.4a2 2 0 0 0 1.4-.6l7.9-7.9 1.4 1.4 1.4-1.4-1.4-1.4 2.6-2.6a3.1 3.1 0 0 0 0-4.2ZM7.4 18H6v-1.4l7.9-7.9 1.4 1.4L7.4 18Z" /></svg>
                </button>
            )}
        </div>
    );
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: Record<T, string>; onChange(v: T): void; }) {
    return (
        <div className="vc-nss-chips" role="radiogroup">
            {(Object.keys(options) as T[]).map(k => (
                <button key={k} role="radio" aria-checked={k === value} className={classes("vc-nss-chip", k === value && "vc-nss-chip-on")} onClick={() => onChange(k)}>
                    {options[k]}
                </button>
            ))}
        </div>
    );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T | null; options: Record<T, string>; onChange(v: T): void; label: string; }) {
    const box = useRef<HTMLDivElement>(null);
    const [bar, setBar] = useState<{ x: number; w: number; } | null>(null);
    const placed = useRef(false);
    const keys = Object.keys(options) as T[];

    useLayoutEffect(() => {
        const measure = () => {
            const el = value ? box.current?.querySelector<HTMLElement>(`[data-seg="${value}"]`) : null;
            setBar(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
        };
        measure();
        const ro = new ResizeObserver(measure);
        if (box.current) ro.observe(box.current);
        return () => ro.disconnect();
    }, [value, keys.join()]);

    const instant = !placed.current && bar != null;
    if (bar) placed.current = true;

    return (
        <div ref={box} className="vc-nss-seg" role="tablist" aria-label={label}>
            <span
                aria-hidden="true"
                className={classes("vc-nss-seg-bar", !bar && "vc-nss-seg-bar-off", instant && "vc-nss-seg-bar-instant")}
                style={bar ? { transform: `translateX(${bar.x}px)`, width: bar.w } : undefined}
            />
            {keys.map(k => (
                <button key={k} data-seg={k} role="tab" aria-selected={value === k} className={classes("vc-nss-seg-item", value === k && "vc-nss-seg-on")} onClick={() => onChange(k)}>
                    {options[k]}
                </button>
            ))}
        </div>
    );
}

const thumbAt = (t: number) => `calc(9px + (100% - 18px) * ${Math.min(1, Math.max(0, t))})`;

export function Tuner({ color, onChange, unreadable }: { color: number; onChange(c: number): void; unreadable?(c: number): boolean; }) {
    const [lch, setLch] = useState(() => labToLch(intToLab(color)));
    const [origin] = useState(() => labToLch(intToLab(color)));
    const written = useRef(color);
    const live = useFrame(onChange);

    useEffect(() => {
        if (color === written.current) return;
        written.current = color;
        setLch(labToLch(intToLab(color)));
    }, [color]);

    function set(i: 0 | 1 | 2, v: number) {
        const next = [...lch] as typeof lch;
        next[i] = v;
        setLch(next);
        written.current = lchToInt(next);
        live(written.current);
    }

    const [L, C, h] = lch;

    let lightTrack = `linear-gradient(to right, #000, ${toHex(lchToInt([0.6, C, h]))}, #fff)`;
    if (unreadable) {
        const steps = 40;
        const stops: string[] = [];
        for (let k = 0; k < steps; k++) {
            const shade = unreadable(lchToInt([(k + 0.5) / steps, C, h])) ? "rgb(0 0 0 / 62%)" : "transparent";
            stops.push(`${shade} ${k / steps * 100}%`, `${shade} ${(k + 1) / steps * 100}%`);
        }
        lightTrack = `linear-gradient(to right, ${stops.join(", ")}), ${lightTrack}`;
    }

    const row = (label: string, i: 0 | 1 | 2, max: number, step: number, show: (v: number) => string, track: string, title?: string) => (
        <label className="vc-nss-row vc-nts-tune" title={title} onDoubleClick={() => set(i, origin[i])}>
            <span className="vc-nss-muted vc-nss-label">{label}</span>
            <span className="vc-nts-track" style={{ background: track }}>
                <span className="vc-nts-origin" style={{ left: thumbAt(origin[i] / max) }} aria-hidden="true" />
                <input type="range" min={0} max={max} step={step} value={lch[i]} aria-label={label} onChange={e => set(i, Number(e.currentTarget.value))} />
            </span>
            <span className="vc-nss-muted vc-nss-value">{show(lch[i])}</span>
        </label>
    );

    return (
        <>
            {row("Hue", 2, 360, 1, v => `${Math.round(v)}°`, `linear-gradient(to right, ${Array.from({ length: 7 }, (_, i) => toHex(lchToInt([L, C, i * 60]))).join(", ")})`)}
            {row("Colour", 1, 0.37, 0.005, v => `${Math.round(v / 0.37 * 100)}%`, `linear-gradient(to right, ${toHex(lchToInt([L, 0, h]))}, ${toHex(lchToInt([L, 0.37, h]))})`)}
            {row("Light", 0, 1, 0.005, v => `${Math.round(v * 100)}%`, lightTrack, unreadable ? "Shaded parts are hard to read on dark chat" : undefined)}
        </>
    );
}
