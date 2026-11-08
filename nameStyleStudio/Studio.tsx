/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { copyToClipboard } from "@utils/clipboard";
import { classes } from "@utils/misc";
import { findComponentByCodeLazy } from "@webpack";
import { useEffect, useMemo, useRef, UserStore, useState } from "@webpack/common";
import type { PointerEvent } from "react";

import { themeTarget } from "./bus";
import { adjust, Adjustment, contrast, discordShades, extractPalette, HARMONIES, Harmony, harmony, intToLab, labToInt, labToLch, lchToInt, luminance, mixLab, NAME_PRESETS, Order, ORDERS, ramp, reorder, resample, sampleStops, Stop, toHex, toHsl, variations } from "./color";
import { NameSuggestion, suggestName } from "./recommend";
import { settings } from "./settings";
import { loadSources, readPixels, Source } from "./sources";
import { Chips, ColorField, Segmented, Tuner, useFrame } from "./ui";

export interface StudioProps {
    effectId: number;
    count: number;
    colors: number[];
    setColors(colors: number[], silent?: boolean): void;
    fontId?: number;
    name?: string;
    presets?: number[][];
    defaultColor?: number;
    setFont?(fontId: number): void;
    setEffect?(effectId: number): void;
}

const NameWithEffects = findComponentByCodeLazy('location:"UserNameWithEffects"');
const STATIC = 1;
const ANIMATED = 2;

const PRISM = 7;
const GUMMY = 8;

type Tab = "shades" | "profile" | "ideas" | "gradient" | "saved";

const SINGLE_TABS: Partial<Record<Tab, string>> = {
    shades: "Shades",
    profile: "From profile",
    ideas: "Ideas",
    saved: "Saved"
};

const MULTI_TABS: Partial<Record<Tab, string>> = {
    profile: "From profile",
    ideas: "Ideas",
    gradient: "Gradient",
    saved: "Saved"
};

const EFFECT_NAMES: Record<number, string> = { 1: "Solid", 3: "Neon", 4: "Toon", 5: "Pop", 6: "Glow" };

const DARK_CHAT = 0x1a1a1e;
const LIGHT_CHAT = 0xffffff;

function lift(c: number, against: number, target: number) {
    const [L, C, h] = labToLch(intToLab(c));
    const step = luminance(against) < 0.2 ? 0.02 : -0.02;
    let out = c, l = L;
    for (let i = 0; i < 50 && contrast(out, against) < target; i++) {
        l = Math.min(1, Math.max(0, l + step));
        out = lchToInt([l, C, h]);
    }
    return out;
}

function ShadesTab({ effectId, color, apply }: { effectId: number; color: number; apply(c: number[]): void; }) {
    const shades = discordShades(color);
    const anatomy: { label: string; color: number; note?: string; }[] = [
        { label: "Fill", color: shades.main },
        ...effectId === 4 ? [{ label: "Outline", color: shades.toonStroke, note: "Toon's outline" }] : [],
        ...effectId === 3 ? [{ label: "Glow", color: shades.neonStroke, note: "Neon's glow" }] : [],
        { label: "Highlight", color: shades.light1 },
        { label: "Bright", color: shades.light2 },
        { label: "Shadow", color: shades.dark1 },
        { label: "Deep", color: shades.dark2 }
    ];

    const onDark = contrast(color, DARK_CHAT);
    const onLight = contrast(color, LIGHT_CHAT);
    const warnings: { text: string; fix?: number; }[] = [];
    if (effectId === 4 && contrast(shades.main, shades.toonStroke) < 1.6)
        warnings.push({ text: "Toon's outline almost disappears into the fill. A lighter colour gives it a visible outline.", fix: lchToInt([Math.min(0.85, labToLch(intToLab(color))[0] + 0.2), labToLch(intToLab(color))[1], labToLch(intToLab(color))[2]]) });
    if (effectId === 3 && (toHsl(color)[1] < 0.35 || toHsl(color)[2] < 0.3))
        warnings.push({ text: "Neon glows best with a bright, saturated colour. Dull or dark colours give a weak glow.", fix: lchToInt([0.75, Math.max(0.2, labToLch(intToLab(color))[1]), labToLch(intToLab(color))[2]]) });
    if (onDark < 3) warnings.push({ text: "Hard to read on dark chat.", fix: lift(color, DARK_CHAT, 4.5) });

    return (
        <>
            <span className="vc-nss-muted">What Discord makes from your colour for {EFFECT_NAMES[effectId] ?? "this effect"}</span>
            <div className="vc-nss-anatomy">
                {anatomy.map(a => (
                    <div key={a.label} className={classes("vc-nss-tone", a.note && "vc-nss-tone-key")} title={a.note ?? toHex(a.color)}>
                        <span style={{ background: toHex(a.color) }} />
                        <span>{a.label}</span>
                    </div>
                ))}
            </div>
            <div className="vc-nss-legible">
                <span className="vc-nss-legible-cell" style={{ background: toHex(DARK_CHAT), color: toHex(color) }}>Dark chat · {onDark.toFixed(1)}</span>
                <span className="vc-nss-legible-cell" style={{ background: toHex(LIGHT_CHAT), color: toHex(color) }}>Light chat · {onLight.toFixed(1)}</span>
            </div>
            {warnings.map(w => (
                <div key={w.text} className="vc-nss-warn">
                    <span>{w.text}</span>
                    {w.fix != null && <button className="vc-nss-chip" onClick={() => apply([w.fix!])}>Fix it</button>}
                </div>
            ))}
        </>
    );
}

function VariationsTab({ color, apply }: { color: number; apply(c: number[]): void; }) {
    return (
        <div className="vc-nss-recipes">
            {variations(color).map(v => (
                <button key={v.label} className="vc-nss-recipe" onClick={() => apply([v.color])}>
                    <span className="vc-nss-strip"><span style={{ background: toHex(color) }} /><span style={{ background: toHex(v.color) }} /></span>
                    <span className="vc-nss-recipe-name">{v.label}</span>
                    <span className="vc-nss-muted">{toHex(v.color)}</span>
                </button>
            ))}
        </div>
    );
}

const NEUTRAL: Adjustment = { hue: 0, chroma: 1, light: 0 };

const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function AdjustTab({ colors, apply }: { colors: number[]; apply(c: number[], live?: boolean): void; }) {
    const [base, setBase] = useState(colors);
    const [adj, setAdj] = useState(NEUTRAL);
    const written = useRef<number[]>(colors);

    useEffect(() => {
        if (same(colors, written.current)) return;
        written.current = colors;
        setBase(colors);
        setAdj(NEUTRAL);
    }, [colors]);

    function change(next: Adjustment, live = true) {
        setAdj(next);
        written.current = adjust(base, next);
        apply(written.current, live);
    }

    const track = (key: keyof Adjustment, min: number, max: number) => {
        const stops = Array.from({ length: 7 }, (_, i) => toHex(adjust([base[0]], { ...adj, [key]: min + (max - min) * i / 6 })[0]));
        return `linear-gradient(to right, ${stops.join(", ")})`;
    };

    const slider = (label: string, key: keyof Adjustment, min: number, max: number, step: number, show: (v: number) => string) => (
        <label className="vc-nss-row vc-nts-tune">
            <span className="vc-nss-muted vc-nss-label">{label}</span>
            <span className="vc-nts-track" style={{ background: track(key, min, max) }}>
                <input type="range" min={min} max={max} step={step} value={adj[key]} aria-label={label} onChange={e => change({ ...adj, [key]: Number(e.currentTarget.value) })} />
            </span>
            <span className="vc-nss-muted vc-nss-value">{show(adj[key])}</span>
        </label>
    );

    return (
        <>
            {slider("Hue", "hue", -180, 180, 1, v => `${v > 0 ? "+" : ""}${v}°`)}
            {slider("Colourfulness", "chroma", 0, 2, 0.01, v => `${Math.round(v * 100)}%`)}
            {slider("Brightness", "light", -0.3, 0.3, 0.005, v => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`)}
            <div className="vc-nss-row">
                <button className="vc-nss-chip" disabled={adj === NEUTRAL} onClick={() => change(NEUTRAL, false)}>Reset</button>
                <span className="vc-nss-muted">Moves every colour together.</span>
            </div>
        </>
    );
}

const memory = { tab: null as Tab | null, target: 0 as number | "all", order: "weight" as Order, rule: "analogous" as Harmony, spread: 30 };

function ProfileTab({ count, apply }: { count: number; apply(c: number[]): void; }) {
    const [sources, setSources] = useState<Source[] | null>(null);
    const [order, setOrder] = useState(memory.order);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [last, setLast] = useState<Source | null>(null);

    useEffect(() => { loadSources().then(setSources, () => setSources([])); }, []);

    async function use(source: Source, how = order) {
        setError(null);
        setLast(source);
        if (source.colors?.length) return apply(ramp(source.colors, count));
        if (!source.image) return;
        setBusy(source.id);
        try {
            const palette = extractPalette(await readPixels(source.image), count, how);
            if (palette.length) apply(palette);
            else setError("That image has no opaque pixels to read.");
        } catch (e) {
            setError(String((e as Error).message ?? e));
        } finally {
            setBusy(null);
        }
    }

    if (!sources) return <div className="vc-nss-muted">Reading your profile…</div>;

    return (
        <>
            <div className="vc-nss-row">
                <span className="vc-nss-muted">Order</span>
                <Chips value={order} options={ORDERS} onChange={o => {
                    setOrder(memory.order = o);
                    if (last?.image) use(last, o);
                }} />
            </div>
            <div className="vc-nss-sources">
                {sources.map(s => {
                    const empty = !s.image && !s.colors?.length;
                    return (
                        <button key={s.id} className={classes("vc-nss-source", last?.id === s.id && "vc-nss-chip-on")} disabled={empty || busy != null} onClick={() => use(s)} title={empty ? `No ${s.label.toLowerCase()} set` : `Use colours from your ${s.label.toLowerCase()}`}>
                            <span className="vc-nss-thumb" style={s.colors?.length
                                ? { background: `linear-gradient(135deg, ${s.colors.map(toHex).join(", ")})` }
                                : s.image ? { backgroundImage: `url("${s.image}")` } : undefined} />
                            <span>{busy === s.id ? "Reading…" : s.label}</span>
                        </button>
                    );
                })}
            </div>
            {error && <div className="vc-nss-error">{error}</div>}
        </>
    );
}

function HarmonyTab({ count, seedFrom, apply }: { count: number; seedFrom: number; apply(c: number[], live?: boolean): void; }) {
    const [seed, setSeed] = useState(seedFrom);
    const [rule, setRule] = useState<Harmony | null>(null);
    const [spread, setSpread] = useState(memory.spread);

    const run = (s: number, r: Harmony | null, sp: number, live = false) => r && apply(harmony(s, r, count, sp), live);
    const tunable = rule === "analogous" || rule === "monochrome";

    return (
        <>
            <div className="vc-nss-row">
                <span className="vc-nss-muted vc-nss-label">Start colour</span>
                <ColorField value={seed} label="Start colour" onChange={c => { setSeed(c); run(c, rule, spread, true); }} />
            </div>
            <div className="vc-nss-muted">Pick a recipe. Each card shows exactly what it makes from your start colour.</div>
            <div className="vc-nss-recipes" role="radiogroup">
                {(Object.keys(HARMONIES) as Harmony[]).map(k => (
                    <button key={k} role="radio" aria-checked={k === rule} className={classes("vc-nss-recipe", k === rule && "vc-nss-recipe-on")} onClick={() => { setRule(memory.rule = k); run(seed, k, spread); }}>
                        <span className="vc-nss-strip">
                            {harmony(seed, k, count, spread).map((c, i) => <span key={i} style={{ background: toHex(c) }} />)}
                        </span>
                        <span className="vc-nss-recipe-name">{HARMONIES[k].label}</span>
                        <span className="vc-nss-muted">{HARMONIES[k].hint}</span>
                    </button>
                ))}
            </div>
            {tunable && (
                <label className="vc-nss-row vc-nts-tune">
                    <span className="vc-nss-muted vc-nss-label">{rule === "analogous" ? "How far apart" : "Light to dark"}</span>
                    <span className="vc-nts-track" style={{ background: `linear-gradient(to right, ${harmony(seed, rule, 5, 90).map(toHex).join(", ")})` }}>
                        <input type="range" min={6} max={90} value={spread} aria-label={rule === "analogous" ? "How far apart" : "Light to dark"} onChange={e => {
                            const v = Number(e.currentTarget.value);
                            setSpread(memory.spread = v);
                            run(seed, rule, v, true);
                        }} />
                    </span>
                    <span className="vc-nss-muted vc-nss-value">{spread}{rule === "analogous" ? "°" : ""}</span>
                </label>
            )}
        </>
    );
}

let stopKey = 0;
const toStops = (colors: number[]): (Stop & { key: number; })[] =>
    colors.map((color, i) => ({ pos: colors.length === 1 ? 0.5 : i / (colors.length - 1), color, key: ++stopKey }));

function GradientTab({ count, colors, apply }: { count: number; colors: number[]; apply(c: number[], live?: boolean): void; }) {
    const [stops, setStops] = useState(() => toStops(colors.length > 1 ? colors : [colors[0], colors[0]]));
    const [selected, setSelected] = useState(stops[0].key);
    const bar = useRef<HTMLDivElement>(null);
    const drag = useRef<number | null>(null);
    const live = useFrame((c: number[]) => apply(c, true));

    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    const current = stops.find(s => s.key === selected) ?? stops[0];

    function update(next: typeof stops) {
        setStops(next);
        live(resample(next, count));
    }

    const posOf = (e: PointerEvent) => {
        const r = bar.current!.getBoundingClientRect();
        return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };

    return (
        <>
            <div
                ref={bar}
                className="vc-nss-bar"
                style={{ background: `linear-gradient(in oklab to right, ${sorted.map(s => `${toHex(s.color)} ${(s.pos * 100).toFixed(1)}%`).join(", ")})` }}
                onPointerDown={e => {
                    if (e.target !== bar.current) return;
                    const pos = posOf(e);
                    const stop = { pos, color: sampleStops(stops, pos), key: ++stopKey };
                    setSelected(stop.key);
                    update([...stops, stop]);
                }}
            >
                {stops.map(s => (
                    <div
                        key={s.key}
                        className={classes("vc-nss-handle", s.key === current.key && "vc-nss-handle-on")}
                        style={{ left: `${s.pos * 100}%`, background: toHex(s.color) }}
                        role="slider"
                        aria-label="Gradient stop"
                        aria-valuenow={Math.round(s.pos * 100)}
                        tabIndex={0}
                        onPointerDown={e => {
                            e.currentTarget.setPointerCapture(e.pointerId);
                            drag.current = s.key;
                            setSelected(s.key);
                        }}
                        onPointerMove={e => {
                            if (drag.current !== s.key) return;
                            const pos = posOf(e);
                            update(stops.map(x => x.key === s.key ? { ...x, pos } : x));
                        }}
                        onPointerUp={() => { drag.current = null; }}
                        onKeyDown={e => {
                            const step = e.key === "ArrowLeft" ? -0.02 : e.key === "ArrowRight" ? 0.02 : 0;
                            if (step) update(stops.map(x => x.key === s.key ? { ...x, pos: Math.min(1, Math.max(0, x.pos + step)) } : x));
                        }}
                    />
                ))}
            </div>
            <div className="vc-nss-ticks">
                {resample(stops, count).map((c, i) => <span key={i} style={{ background: toHex(c) }} />)}
            </div>
            <div className="vc-nss-row">
                <span className="vc-nss-muted">Stop</span>
                <ColorField value={current.color} label="Gradient stop" onChange={c => update(stops.map(x => x.key === current.key ? { ...x, color: c } : x))} />
                <button className="vc-nss-chip" disabled={stops.length <= 2} onClick={() => {
                    const next = stops.filter(x => x.key !== current.key);
                    setSelected(next[0].key);
                    update(next);
                }}>Remove stop</button>
                <button className="vc-nss-chip" onClick={() => update(stops.map(x => ({ ...x, pos: 1 - x.pos })))}>Reverse</button>
            </div>
            <div className="vc-nss-muted vc-nss-hint">Click the bar to add a stop, drag stops to move them. Your {count} colours are read evenly along it.</div>
        </>
    );
}

interface Look { name: string; fontId?: number; effectId: number; colors: number[]; }

const EFFECT_LABEL: Record<number, string> = { 1: "Solid", 2: "Gradient", 3: "Neon", 4: "Toon", 5: "Pop", 6: "Glow", 7: "Prism", 8: "Gummy" };

const lookCode = (l: Look) => `look:${l.fontId ?? 0}:${l.effectId}:${l.colors.map(c => toHex(c).slice(1)).join("-")}`;

function parseLook(text: string): Look | null {
    const m = /^look:(\d+):(\d+):([0-9a-f]{6}(?:-[0-9a-f]{6})*)$/i.exec(text.trim());
    if (!m) return null;
    return { name: "Shared look", fontId: Number(m[1]) || void 0, effectId: Number(m[2]), colors: m[3].split("-").map(h => parseInt(h, 16)) };
}

const sameLook = (a: Look, b: Look) => a.effectId === b.effectId && (a.fontId ?? 0) === (b.fontId ?? 0) && same(a.colors, b.colors);

function LooksTab({ current, name, onApply }: { current: Look; name: string; onApply(l: Look): void; }) {
    const looks = settings.use(["savedLooks"]).savedLooks as Look[];
    const [code, setCode] = useState("");
    const [note, setNote] = useState<string | null>(null);
    const saved = looks.some(l => sameLook(l, current));

    return (
        <>
            {looks.length === 0 && <span className="vc-nss-muted">Save the font, effect and colours you have now to reuse them in one click.</span>}
            <div className="vc-nss-looks">
                {looks.map((l, i) => (
                    <span key={lookCode(l) + i} className={classes("vc-nss-look", sameLook(l, current) && "vc-nss-look-on")}>
                        <button className="vc-nss-look-face" title={`${l.name}, ${EFFECT_LABEL[l.effectId] ?? "Effect"}`} onClick={() => onApply(l)}>
                            <span className="vc-nss-look-name">
                                <ErrorBoundary noop>
                                    <NameWithEffects userName={name} displayNameStyles={{ fontId: l.fontId, effectId: l.effectId, colors: l.colors }} effectDisplayType={STATIC} />
                                </ErrorBoundary>
                            </span>
                            <span className="vc-nss-muted">{l.name} · {EFFECT_LABEL[l.effectId] ?? "Effect"}</span>
                        </button>
                        <button className="vc-nss-look-x" aria-label={`Remove ${l.name}`} onClick={() => { settings.store.savedLooks = looks.filter((_, j) => j !== i); }}>×</button>
                    </span>
                ))}
            </div>
            <div className="vc-nss-row">
                <button className="vc-nss-chip" disabled={saved} onClick={() => { settings.store.savedLooks = [...looks, { ...current, name: `Look ${looks.length + 1}` }]; }}>{saved ? "Saved" : "Save current"}</button>
                <button className="vc-nss-chip" onClick={async () => { await copyToClipboard(lookCode(current)); setNote("Copied. Anyone with this plugin can paste it."); }}>Copy code</button>
            </div>
            <div className="vc-nss-row">
                <input className="vc-nss-hex vc-nts-code" placeholder="look:3:7:ff5aa0-..." value={code} onChange={e => setCode(e.currentTarget.value)} />
                <button className="vc-nss-chip" onClick={() => {
                    const l = parseLook(code);
                    if (!l) return setNote("That code doesn't look like a saved look.");
                    setNote(null);
                    setCode("");
                    onApply(l);
                }}>Use code</button>
            </div>
            {note && <span className="vc-nss-muted">{note}</span>}
        </>
    );
}

function swatchStyle(colors: number[]) {
    return { background: colors.length === 1 ? toHex(colors[0]) : `conic-gradient(${colors.map((c, i) => `${toHex(c)} ${i / colors.length * 360}deg ${(i + 1) / colors.length * 360}deg`).join(", ")})` };
}

function PresetsBlock({ count, apply }: { count: number; apply(c: number[]): void; }) {
    return (
        <>
            <span className="vc-nss-muted">Presets</span>
            <div className="vc-nss-recipes">
                {Object.entries(NAME_PRESETS).map(([label, palette]) => {
                    const colors = Array.from({ length: count }, (_, i) => palette[i % palette.length]);
                    return (
                        <button key={label} className="vc-nss-recipe" onClick={() => apply(colors)}>
                            <span className="vc-nss-strip">{colors.map((c, i) => <span key={i} style={{ background: toHex(c) }} />)}</span>
                            <span className="vc-nss-recipe-name">{label}</span>
                        </button>
                    );
                })}
            </div>
        </>
    );
}

const PICTO = /\p{Extended_Pictographic}/u;

function letterColors(name: string, colors: number[], effectId: number): { ch: string; color: number | null; }[] {
    const chars = [...name];
    if (effectId === GUMMY) {
        let k = 0;
        return chars.map(ch => /\s/.test(ch) || PICTO.test(ch) ? { ch, color: null } : { ch, color: colors[k++ % colors.length] });
    }
    const n = Math.max(1, chars.length);
    const stops = [...colors, colors[0]].map(intToLab);
    return chars.map((ch, i) => {
        if (/\s/.test(ch)) return { ch, color: null };
        const t = (i + 0.5) / n * colors.length;
        const a = Math.floor(t) % colors.length;
        return { ch, color: labToInt(mixLab(stops[a], stops[a + 1], t - Math.floor(t))) };
    });
}

function LetterMap({ name, colors, effectId, onShift }: { name: string; colors: number[]; effectId: number; onShift(dir: 1 | -1): void; }) {
    const map = letterColors(name, colors, effectId);
    return (
        <div className="vc-nss-letters" aria-label="Which colour lands on each letter">
            <button className="vc-nss-icon" aria-label="Shift colours left" title={effectId === GUMMY ? "Shift colours one letter left. Colour 1 also sets Gummy's shading" : "Shift colours left"} onClick={() => onShift(-1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <div className="vc-nss-letter-row">
                {map.map((l, i) => (
                    <span key={i} className={classes("vc-nss-letter", l.color == null && "vc-nss-letter-skip")} style={l.color != null ? { ["--vc-l" as string]: toHex(l.color) } : undefined}>
                        {l.ch === " " ? "\u00a0" : l.ch}
                    </span>
                ))}
            </div>
            <button className="vc-nss-icon" aria-label="Shift colours right" title="Shift colours right" onClick={() => onShift(1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            </button>
        </div>
    );
}

function displayName(name?: string) {
    if (name) return name;
    const user = UserStore.getCurrentUser() as { globalName?: string; username?: string; } | undefined;
    return user?.globalName ?? user?.username ?? "Your name";
}

const ICONS = {
    smooth: "M4 17c3 0 4-10 8-10s5 10 8 10",
    alternate: "M4 7h4l3 10h2l3-10h4",
    reverse: "M7 7h11l-3-3M17 17H6l3 3",
    undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
    redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"
};

const hist = { list: [] as number[][], at: -1, liveUntil: 0, key: "" };
let pendingLook: Look | null = null;
let morphKey = 0;

const unreadable = (c: number) => contrast(c, DARK_CHAT) < 3;

export function Studio({ effectId, count, colors, setColors, fontId, name, presets = [], defaultColor, setFont, setEffect }: StudioProps) {
    const tabs = count === 1 ? SINGLE_TABS : MULTI_TABS;
    const [picked, setTab] = useState<Tab | null>(memory.tab);
    const tab = picked && picked in tabs ? picked : null;
    const [rawTarget, setTarget] = useState(memory.target);
    const target = rawTarget === "all" ? (count > 1 ? "all" : 0) : Math.min(rawTarget, count - 1);
    const [morph, setMorph] = useState<{ from: number[]; key: number; } | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [recs, setRecs] = useState<{ suggestions: NameSuggestion[]; basis: string[]; } | null>(null);
    const [, rerender] = useState(0);

    useEffect(() => {
        let alive = true;
        suggestName(themeTarget.guildId, count, effectId === PRISM || effectId === GUMMY).then(r => { if (alive) setRecs(r); }, () => void 0);
        return () => { alive = false; };
    }, [count, effectId]);

    const slots = useMemo(() => Array.from({ length: count }, (_, i) => colors[Math.min(i, colors.length - 1)] ?? defaultColor ?? 0xffffff), [count, colors, defaultColor]);
    const shown = displayName(name);

    const histKey = `${effectId}:${count}`;
    if (hist.key !== histKey) {
        hist.key = histKey;
        hist.list = [slots];
        hist.at = 0;
        hist.liveUntil = 0;
    }

    function record(next: number[], live: boolean) {
        const now = Date.now();
        if (live && now < hist.liveUntil && hist.at > 0) {
            hist.list[hist.at] = next;
            hist.liveUntil = now + 700;
            return;
        }
        if (!same(hist.list[hist.at] ?? [], slots)) {
            hist.list.splice(hist.at + 1);
            hist.list.push(slots);
            hist.at = hist.list.length - 1;
        }
        hist.list.splice(hist.at + 1);
        hist.list.push(next);
        hist.at = hist.list.length - 1;
        if (hist.list.length > 40) {
            hist.list.shift();
            hist.at--;
        }
        hist.liveUntil = live ? now + 700 : 0;
    }

    function apply(next: number[], live = false) {
        const fitted = next.slice(0, count);
        if (same(fitted, slots)) return;
        record(fitted, live);
        if (!live) setMorph({ from: slots, key: ++morphKey });
        setColors(fitted, true);
        rerender(n => n + 1);
    }

    function jump(at: number) {
        if (at < 0 || at >= hist.list.length) return;
        hist.at = at;
        hist.liveUntil = 0;
        setMorph({ from: slots, key: ++morphKey });
        setColors(hist.list[at], true);
        rerender(n => n + 1);
    }

    const setSlot = (i: number, c: number, live = true) => apply(slots.map((x, j) => j === i ? c : x), live);
    const pick = (t: number | "all") => setTarget(memory.target = t);
    const toggleTab = (t: Tab) => setTab(memory.tab = tab === t ? null : t);

    useEffect(() => {
        const look = pendingLook;
        if (!look || look.effectId !== effectId) return;
        pendingLook = null;
        apply(look.colors);
    }, [effectId, count]);

    function applyLook(l: Look) {
        setNote(null);
        if (l.effectId !== effectId) {
            if (!setEffect) return setNote("Pick that look's effect first, then apply it again.");
            pendingLook = l;
            if (l.fontId != null) setFont?.(l.fontId);
            setEffect(l.effectId);
            return;
        }
        if (l.fontId != null && l.fontId !== fontId) setFont?.(l.fontId);
        apply(l.colors);
    }

    const choices = useMemo(() => {
        const list = presets.filter(p => p.length > 0).map(p => Array.from({ length: count }, (_, i) => p[i % p.length]));
        if (count === 1 && defaultColor != null && !list.some(p => p[0] === defaultColor)) list.unshift([defaultColor]);
        return list;
    }, [presets, count, defaultColor]);

    const tools: { id: keyof typeof ICONS; label: string; title: string; run(): void; }[] = count > 2 ? [
        { id: "smooth", label: "Smooth order", title: effectId === GUMMY ? "Keeps colour 1, which sets Gummy's shading, and puts similar colours on neighbouring letters" : "Orders the colours so each one flows into the next", run: () => apply(reorder(slots, effectId === PRISM || effectId === GUMMY, "smooth")) },
        ...effectId === GUMMY ? [{ id: "alternate" as const, label: "Alternate", title: "Keeps colour 1 and puts the most different colours on neighbouring letters", run: () => apply(reorder(slots, true, "alternate")) }] : [],
        { id: "reverse", label: "Reverse", title: "Reverses the order of the colours", run: () => apply([...slots].reverse()) }
    ] : [];

    const focus = target === "all" ? slots[0] : slots[target];
    const readable = contrast(focus, DARK_CHAT);
    const icon = (id: keyof typeof ICONS) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[id]} /></svg>;

    return (
        <div
            className="vc-nss vc-nss-card"
            onKeyDown={e => {
                if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).matches("input:not([type=range])")) return;
                const k = e.key.toLowerCase();
                if (k === "z" && !e.shiftKey) jump(hist.at - 1);
                else if (k === "y" || (k === "z" && e.shiftKey)) jump(hist.at + 1);
                else return;
                e.preventDefault();
            }}
        >
            <div className="vc-nss-stage" aria-label="Preview of your name">
                <ErrorBoundary noop>
                    <NameWithEffects userName={shown} displayNameStyles={{ fontId, effectId, colors: slots }} effectDisplayType={ANIMATED} loop />
                </ErrorBoundary>
                {morph && (
                    <div key={morph.key} className="vc-nss-morph" aria-hidden="true" onAnimationEnd={() => setMorph(m => m?.key === morph.key ? null : m)}>
                        <ErrorBoundary noop>
                            <NameWithEffects userName={shown} displayNameStyles={{ fontId, effectId, colors: morph.from }} effectDisplayType={STATIC} />
                        </ErrorBoundary>
                    </div>
                )}
            </div>

            {(effectId === GUMMY || effectId === PRISM) && (
                <LetterMap name={shown} colors={slots} effectId={effectId} onShift={dir => apply(dir === 1 ? [slots[slots.length - 1], ...slots.slice(0, -1)] : [...slots.slice(1), slots[0]])} />
            )}

            <div className="vc-nss-dots">
                <div className="vc-nss-dots-set" role="radiogroup" aria-label="Colour to tune">
                    {slots.map((c, i) => (
                        <button
                            key={i}
                            role="radio"
                            aria-checked={target === i}
                            aria-label={`Colour ${i + 1}, ${toHex(c)}`}
                            title={`Colour ${i + 1}`}
                            className={classes("vc-nss-dot", target === i && "vc-nss-dot-on")}
                            style={{ backgroundColor: toHex(c) }}
                            onClick={() => pick(i)}
                        />
                    ))}
                    {count > 1 && (
                        <button role="radio" aria-checked={target === "all"} className={classes("vc-nss-all", target === "all" && "vc-nss-all-on")} onClick={() => pick("all")}>All</button>
                    )}
                </div>
                {choices.length > 0 && <span className="vc-nss-sep" aria-hidden="true" />}
                {choices.length > 0 && (
                    <div className="vc-nss-presets" role="listbox" aria-label="Discord's colours">
                        {choices.map(p => {
                            const on = same(p, slots);
                            const isDefault = count === 1 && p[0] === defaultColor;
                            return (
                                <button
                                    key={p.join()}
                                    role="option"
                                    aria-selected={on}
                                    aria-label={isDefault ? "Default colour" : p.map(toHex).join(", ")}
                                    title={isDefault ? "Default" : p.map(toHex).join("  ")}
                                    className={classes("vc-nss-preset", on && "vc-nss-preset-on", isDefault && "vc-nss-preset-default")}
                                    style={swatchStyle(p)}
                                    onClick={() => apply(p)}
                                />
                            );
                        })}
                    </div>
                )}
            </div>

            {!!recs?.suggestions.length && (
                <div className="vc-nss-recs">
                    <span className="vc-nss-muted vc-nss-recs-label" title={`Built from your ${recs.basis.join(", ").toLowerCase()}`}>For you</span>
                    <div className="vc-nss-presets" role="listbox" aria-label="Suggested from your profile">
                        {recs.suggestions.map(r => (
                            <button
                                key={r.colors.join()}
                                role="option"
                                aria-selected={same(r.colors, slots)}
                                aria-label={r.label}
                                title={r.label}
                                className={classes("vc-nss-preset", same(r.colors, slots) && "vc-nss-preset-on")}
                                style={swatchStyle(r.colors)}
                                onClick={() => apply(r.colors)}
                            />
                        ))}
                    </div>
                </div>
            )}

            <div key={String(target)} className="vc-nss-tuner">
                {target === "all" ? (
                    <AdjustTab key={count} colors={slots} apply={apply} />
                ) : (
                    <>
                        <div className="vc-nss-row vc-nss-fieldrow">
                            <ColorField value={slots[target]} label={`Colour ${target + 1}`} onChange={c => setSlot(target, c)} />
                            <span className={classes("vc-nss-muted", "vc-nss-contrast", readable < 3 && "vc-nss-contrast-low")} title="Contrast against dark chat">Contrast {readable.toFixed(1)}</span>
                            <span className="vc-nss-tools">
                                <button className="vc-nss-icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={hist.at <= 0} onClick={() => jump(hist.at - 1)}>{icon("undo")}</button>
                                <button className="vc-nss-icon" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={hist.at >= hist.list.length - 1} onClick={() => jump(hist.at + 1)}>{icon("redo")}</button>
                                {tools.map(t => (
                                    <button key={t.id} className="vc-nss-icon" aria-label={t.label} title={`${t.label}: ${t.title}`} onClick={t.run}>{icon(t.id)}</button>
                                ))}
                            </span>
                        </div>
                        <Tuner color={slots[target]} onChange={c => setSlot(target, c)} unreadable={unreadable} />
                    </>
                )}
            </div>

            <Segmented value={tab} options={tabs as Record<Tab, string>} onChange={toggleTab} label="More tools" />
            {tab && (
                <div key={tab} className="vc-nss-panel" role="tabpanel">
                    {tab === "shades" && <ShadesTab effectId={effectId} color={slots[0]} apply={apply} />}
                    {tab === "profile" && <ProfileTab count={count} apply={apply} />}
                    {tab === "ideas" && (
                        <>
                            {count === 1 ? <VariationsTab color={slots[0]} apply={apply} /> : <HarmonyTab count={count} seedFrom={slots[0]} apply={apply} />}
                            <PresetsBlock count={count} apply={apply} />
                        </>
                    )}
                    {tab === "gradient" && <GradientTab key={count} count={count} colors={slots} apply={apply} />}
                    {tab === "saved" && <LooksTab current={{ name: "", fontId, effectId, colors: slots }} name={shown} onApply={applyLook} />}
                </div>
            )}
            {note && <span className="vc-nss-muted">{note}</span>}
        </div>
    );
}
