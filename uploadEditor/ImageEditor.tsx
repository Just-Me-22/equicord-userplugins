/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useEffect, useLayoutEffect, useRef, useState } from "@webpack/common";

import { AdjustIcon, BackIcon, CameraIcon, CropIcon, EyeIcon, PauseIcon, PenIcon, PlayIcon, ResetIcon, SoundIcon, SpoilerIcon, TextIcon, TrashIcon, UndoIcon } from "./icons";
import { Direction, Edits, Filters, fitAspect, formatTime, frameAt, Handle, Item, moveCrop, NEUTRAL, outputSize, Overlay, Rect, resizeCrop, Stroke } from "./image";
import { Finding, findText } from "./media/redact";
import { FONTS, overlayBox, paintStroke, PRESETS, renderEdits } from "./render";
import { Timeline } from "./Timeline";
import { cl, useSize } from "./ui";

type Mode = "view" | "crop" | "draw" | "text" | "adjust";
type Brush = "pen" | "blur" | "pixelate";

interface Shape { key: string; label: string; aspect: (item: Item) => number | null; output?: { w: number; h: number; }; guide?: "circle"; }

const SHAPES: Shape[] = [
    { key: "free", label: "Free", aspect: () => null },
    { key: "original", label: "Original", aspect: item => item.width / item.height },
    { key: "1:1", label: "1:1", aspect: () => 1 },
    { key: "4:3", label: "4:3", aspect: () => 4 / 3 },
    { key: "16:9", label: "16:9", aspect: () => 16 / 9 }
];

const PROFILE_SHAPES: Shape[] = [
    { key: "avatar", label: "Avatar", aspect: () => 1, output: { w: 512, h: 512 }, guide: "circle" },
    { key: "banner", label: "Banner", aspect: () => 680 / 240, output: { w: 680, h: 240 } },
    { key: "icon", label: "Server icon", aspect: () => 1, output: { w: 512, h: 512 }, guide: "circle" },
    { key: "emoji", label: "Emoji", aspect: () => 1, output: { w: 128, h: 128 } },
    { key: "sticker", label: "Sticker", aspect: () => 1, output: { w: 320, h: 320 } }
];

const COLORS = [["#ffffff", "White"], ["#000000", "Black"], ["#f23f43", "Red"], ["#f0b232", "Yellow"], ["#23a55a", "Green"], ["#5865f2", "Blue"], ["#eb459e", "Pink"]] as const;
const SIZES = [[4, "Thin"], [8, "Medium"], [16, "Thick"]] as const;
const SPEEDS = [0.5, 1, 1.5, 2];
const DIRECTIONS: [Direction, string][] = [["forward", "Forward"], ["reverse", "Reverse"], ["boomerang", "Boomerang"]];
const STICKERS = ["😂", "😭", "💀", "🔥", "❤️", "✨", "👀", "🙏", "😳", "🥺", "💖", "⭐", "👑", "🎉", "😎", "🤡", "💯", "🫶", "🌸", "🦋"];
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN_CROP = 24;

let overlayId = 0;

interface DragState { handle: Handle; startX: number; startY: number; crop: Rect; }

export interface EditorProps {
    item: Item;
    onChange(patch: Partial<Edits & Pick<Item, "spoiler" | "alt">>, record?: boolean): void;
    onUndo(): void;
    onBack?(): void;
    onGrab?(ms: number): void;
    position?: string;
}

function Slider({ label, value, min, max, step, show, onStart, onChange }: { label: string; value: number; min: number; max: number; step: number; show: string; onStart(): void; onChange(v: number): void; }) {
    return (
        <label className={cl("slider")}>
            <span>{label}</span>
            <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onPointerDown={onStart} onKeyDown={onStart} onChange={e => onChange(Number(e.currentTarget.value))} />
            <span className={cl("slider-value")}>{show}</span>
        </label>
    );
}

export function ImageEditor({ item, onChange, onUndo, onBack, onGrab, position }: EditorProps) {
    const [mode, setMode] = useState<Mode>("view");
    const [shapeKey, setShapeKey] = useState("free");
    const [brush, setBrush] = useState<Brush>("pen");
    const [color, setColor] = useState<string>(COLORS[2][0]);
    const [size, setSize] = useState<number>(SIZES[1][0]);
    const [dragging, setDragging] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);
    const [findings, setFindings] = useState<{ list: Finding[]; picked: Set<number>; smart: boolean; } | null>(null);
    const [finding, setFinding] = useState(false);
    const [compare, setCompare] = useState(false);
    const [altOpen, setAltOpen] = useState(false);
    const [time, setTime] = useState(item.trim[0]);
    const [playing, setPlaying] = useState(item.kind !== "image");
    const [muted, setMuted] = useState(true);

    const animated = item.kind !== "image";
    const stageRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const liveRef = useRef<Stroke | null>(null);
    const moveRef = useRef<{ id: number; startX: number; startY: number; x: number; y: number; } | null>(null);
    const timeRef = useRef(time);
    const dirRef = useRef<1 | -1>(1);
    timeRef.current = time;

    const stage = useSize(stageRef);
    const full: Rect = { x: 0, y: 0, w: item.width, h: item.height };
    const region = mode === "crop" || compare ? full : item.crop;
    const scale = stage.width && stage.height ? Math.min(stage.width / region.w, stage.height / region.h) : 0;
    const cssWidth = region.w * scale;
    const cssHeight = region.h * scale;

    function source(): CanvasImageSource {
        if (item.kind === "gif") return frameAt(item, timeRef.current)?.bitmap ?? item.preview;
        if (item.kind === "video") {
            const v = videoRef.current;
            return v && v.readyState >= 2 ? v : item.preview;
        }
        return item.preview;
    }

    function redraw() {
        const canvas = canvasRef.current;
        if (!canvas || !scale) return;
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(cssWidth * dpr));
        const height = Math.max(1, Math.round(cssHeight * dpr));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;

        const ctx = canvas.getContext("2d")!;
        const k = scale * dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.setTransform(k, 0, 0, k, -region.x * k, -region.y * k);
        renderEdits(ctx, item, source(), compare);
        if (liveRef.current && !compare) paintStroke(ctx, liveRef.current.effect ? { ...liveRef.current, color: "rgb(255 255 255 / 0.35)" } : liveRef.current);

        if (mode === "crop" && !compare) {
            const { crop } = item;
            ctx.fillStyle = "rgb(0 0 0 / 0.55)";
            ctx.beginPath();
            ctx.rect(0, 0, full.w, full.h);
            ctx.rect(crop.x, crop.y, crop.w, crop.h);
            ctx.fill("evenodd");
        }
    }

    useLayoutEffect(redraw);

    const redrawRef = useRef(redraw);
    redrawRef.current = redraw;

    useEffect(() => {
        if (!animated || !playing) return;
        let frame = 0;
        let last = performance.now();
        const video = videoRef.current;
        if (item.kind === "video" && video) {
            video.playbackRate = item.speed;
            if (video.currentTime * 1000 < item.trim[0] || video.currentTime * 1000 >= item.trim[1]) video.currentTime = item.trim[0] / 1000;
            void video.play().catch(() => { });
        }
        const loop = (now: number) => {
            const dt = now - last;
            last = now;
            const [a, b] = item.trim;
            if (item.kind === "video" && video) {
                let t = video.currentTime * 1000;
                if (t >= b - 15 || t < a) {
                    video.currentTime = a / 1000;
                    t = a;
                }
                timeRef.current = t;
            } else {
                let t = timeRef.current;
                const step = dt * item.speed;
                if (item.direction === "reverse") {
                    t -= step;
                    if (t < a) t = b - 1;
                } else if (item.direction === "boomerang") {
                    t += step * dirRef.current;
                    if (t >= b) { t = b - 1; dirRef.current = -1; }
                    if (t < a) { t = a; dirRef.current = 1; }
                } else {
                    t += step;
                    if (t >= b) t = a;
                }
                timeRef.current = t;
            }
            setTime(timeRef.current);
            redrawRef.current();
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
        return () => {
            cancelAnimationFrame(frame);
            video?.pause();
        };
    }, [playing, item.speed, item.direction, item.trim[0], item.trim[1], animated]);

    useEffect(() => {
        const v = videoRef.current;
        if (v) v.muted = muted;
    }, [muted]);

    function seekTo(ms: number) {
        timeRef.current = ms;
        setTime(ms);
        const v = videoRef.current;
        if (v) v.currentTime = ms / 1000;
        else redrawRef.current();
    }

    function chooseShape(shape: Shape) {
        setShapeKey(shape.key);
        const aspect = shape.aspect(item);
        onChange({ ...aspect ? { crop: fitAspect(item, aspect) } : {}, output: shape.output ?? null, guide: shape.guide ?? null }, true);
    }

    const currentShape = [...SHAPES, ...PROFILE_SHAPES].find(s => s.key === shapeKey) ?? SHAPES[0];

    function startDrag(event: React.PointerEvent<HTMLElement>, handle: Handle) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { handle, startX: event.clientX, startY: event.clientY, crop: item.crop };
        onChange({}, true);
        setDragging(true);
    }

    function onDrag(event: React.PointerEvent<HTMLElement>) {
        const drag = dragRef.current;
        if (!drag || !scale) return;
        const dx = (event.clientX - drag.startX) / scale;
        const dy = (event.clientY - drag.startY) / scale;
        onChange({
            crop: drag.handle === "move"
                ? moveCrop(drag.crop, dx, dy, full.w, full.h)
                : resizeCrop(drag.crop, drag.handle, dx, dy, currentShape.aspect(item), full.w, full.h, MIN_CROP / scale)
        });
    }

    function endDrag() {
        dragRef.current = null;
        setDragging(false);
    }

    const toImage = (event: React.PointerEvent): [number, number] => {
        const bounds = canvasRef.current!.getBoundingClientRect();
        return [region.x + (event.clientX - bounds.left) / scale, region.y + (event.clientY - bounds.top) / scale];
    };

    function addOverlay(text: string, at: [number, number], sticker: boolean) {
        const unit = Math.min(item.crop.w, item.crop.h);
        const o: Overlay = { id: overlayId++, text, x: at[0], y: at[1], size: Math.round(unit * (sticker ? 0.16 : 0.08)), color: "#ffffff", outline: !sticker, font: "sans" };
        onChange({ overlays: [...item.overlays, o] }, true);
        setSelected(o.id);
    }

    function onCanvasDown(event: React.PointerEvent<HTMLCanvasElement>) {
        if (mode === "view") { setMode("crop"); return; }
        if (mode === "text") {
            addOverlay("Your text", toImage(event), false);
            return;
        }
        if (mode !== "draw" || !scale) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const effect = brush === "pen" ? undefined : brush;
        const px = brush === "pen" ? size : size * 4;
        liveRef.current = { color, size: px / scale, points: [toImage(event)], effect };
        redraw();
    }

    function onCanvasMove(event: React.PointerEvent<HTMLCanvasElement>) {
        if (!liveRef.current) return;
        liveRef.current.points.push(toImage(event));
        redraw();
    }

    function onCanvasUp() {
        const stroke = liveRef.current;
        if (!stroke) return;
        liveRef.current = null;
        onChange({ strokes: [...item.strokes, stroke] }, true);
    }

    function startMove(event: React.PointerEvent, o: Overlay) {
        if (mode !== "text") return;
        event.preventDefault();
        event.stopPropagation();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        setSelected(o.id);
        onChange({}, true);
        moveRef.current = { id: o.id, startX: event.clientX, startY: event.clientY, x: o.x, y: o.y };
    }

    function onMove(event: React.PointerEvent) {
        const m = moveRef.current;
        if (!m || !scale) return;
        const x = m.x + (event.clientX - m.startX) / scale;
        const y = m.y + (event.clientY - m.startY) / scale;
        onChange({ overlays: item.overlays.map(o => o.id === m.id ? { ...o, x, y } : o) });
    }

    const updateOverlay = (patch: Partial<Overlay>, record = false) =>
        onChange({ overlays: item.overlays.map(o => o.id === selected ? { ...o, ...patch } : o) }, record);

    async function runFind() {
        setFinding(true);
        try {
            const { findings: list, smart } = await findText(item.preview, item.preview.width / item.width);
            setFindings({ list, smart, picked: new Set(list.map((f, i) => smart && !f.label.startsWith("Looks private") ? -1 : i).filter(i => i >= 0)) });
        } finally {
            setFinding(false);
        }
    }

    function applyFindings() {
        if (!findings) return;
        const rects = findings.list.filter((_, i) => findings.picked.has(i)).map(f => ({ color: "#000", size: 0, points: [], effect: "blur" as const, rect: f.rect }));
        if (rects.length) onChange({ strokes: [...item.strokes, ...rects] }, true);
        setFindings(null);
    }

    function setFilter(patch: Partial<Filters>) {
        onChange({ filters: { ...item.filters, ...patch } });
    }

    const toggle = (target: Mode) => {
        setMode(current => current === target ? "view" : target);
        setFindings(null);
    };
    const box = item.crop;
    const cropped = box.x !== 0 || box.y !== 0 || box.w !== full.w || box.h !== full.h;
    const current = item.overlays.find(o => o.id === selected) ?? null;
    const [outW, outH] = outputSize(item);
    const toCss = (r: Rect) => ({ left: (r.x - region.x) * scale, top: (r.y - region.y) * scale, width: r.w * scale, height: r.h * scale });

    return (
        <>
            <div className={cl("stage")} ref={stageRef}>
                {onBack && (
                    <button className={cl("back")} onClick={onBack}>
                        <BackIcon />All files{position && <span className={cl("back-position")}>{position}</span>}
                    </button>
                )}
                {item.kind === "video" && <video ref={videoRef} className={cl("hidden-video")} src={item.mediaUrl} muted playsInline preload="auto" onSeeked={() => redrawRef.current()} onLoadedData={() => redrawRef.current()} />}
                <div className={cl("frame", { "frame-spoiler": item.spoiler && mode === "view" })} style={{ width: cssWidth, height: cssHeight }}>
                    <canvas
                        ref={canvasRef}
                        className={cl("canvas", `canvas-${mode}`)}
                        style={{ width: cssWidth, height: cssHeight }}
                        onPointerDown={onCanvasDown}
                        onPointerMove={onCanvasMove}
                        onPointerUp={onCanvasUp}
                        onPointerCancel={onCanvasUp}
                    />
                    {!compare && (mode === "text" || mode === "view") && scale > 0 && item.overlays.map(o => (
                        <div
                            key={o.id}
                            className={cl("overlay", { "overlay-active": mode === "text" && o.id === selected, "overlay-idle": mode !== "text" })}
                            style={toCss(overlayBox(o))}
                            onPointerDown={e => startMove(e, o)}
                            onPointerMove={onMove}
                            onPointerUp={() => { moveRef.current = null; }}
                        />
                    ))}
                    {findings && scale > 0 && findings.list.map((f, i) => (
                        <button
                            key={i}
                            title={f.label}
                            aria-pressed={findings.picked.has(i)}
                            className={cl("finding", { "finding-on": findings.picked.has(i) })}
                            style={toCss(f.rect)}
                            onClick={() => {
                                const picked = new Set(findings.picked);
                                if (picked.has(i)) picked.delete(i); else picked.add(i);
                                setFindings({ ...findings, picked });
                            }}
                        />
                    ))}
                    {mode === "crop" && !compare && scale > 0 && (
                        <div
                            className={cl("crop", { "crop-dragging": dragging, "crop-circle": item.guide === "circle" })}
                            style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}
                            onPointerDown={event => startDrag(event, "move")}
                            onPointerMove={onDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                        >
                            {HANDLES.map(handle => (
                                <div key={handle} className={cl("handle", `handle-${handle}`)} onPointerDown={event => startDrag(event, handle)} />
                            ))}
                        </div>
                    )}
                </div>
                {compare && <span className={cl("compare-tag")}>Original</span>}
            </div>

            {animated && (
                <div className={cl("media-bar")}>
                    <button className={cl("icon-button")} aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
                    <span className={cl("time")}>{formatTime(time - item.trim[0])}</span>
                    <Timeline
                        duration={item.duration}
                        trim={item.trim}
                        time={time}
                        onTrim={(next, start) => onChange({ trim: next }, start)}
                        onSeek={ms => { setPlaying(false); seekTo(ms); }}
                    />
                    {item.kind === "video" && <button className={cl("icon-button")} aria-label={muted ? "Unmute preview" : "Mute preview"} onClick={() => setMuted(!muted)}><SoundIcon off={muted} /></button>}
                    {onGrab && <button className={cl("icon-button")} aria-label="Save this frame as a picture" title="Save this frame as a picture" onClick={() => onGrab(timeRef.current)}><CameraIcon /></button>}
                </div>
            )}

            {animated && (
                <div className={cl("toolbar", "toolbar-sub")}>
                    <div className={cl("segmented")} role="group" aria-label="Speed">
                        {SPEEDS.map(s => (
                            <button key={s} className={cl("segment", "segment-compact", { "segment-active": item.speed === s })} aria-pressed={item.speed === s} onClick={() => onChange({ speed: s }, true)}>{s}×</button>
                        ))}
                    </div>
                    {item.kind === "gif" && (
                        <div className={cl("segmented")} role="group" aria-label="Direction">
                            {DIRECTIONS.map(([key, label]) => (
                                <button key={key} className={cl("segment", "segment-compact", { "segment-active": item.direction === key })} aria-pressed={item.direction === key} onClick={() => onChange({ direction: key }, true)}>{label}</button>
                            ))}
                        </div>
                    )}
                    {item.kind === "video" && (item.speed !== 1) && <span className={cl("note")}>Sound is kept only at 1×</span>}
                </div>
            )}

            <div className={cl("toolbar")}>
                <div className={cl("segmented")} role="group" aria-label="Tool">
                    <button className={cl("segment", { "segment-active": mode === "crop" })} aria-pressed={mode === "crop"} onClick={() => toggle("crop")}><CropIcon />Crop</button>
                    <button className={cl("segment", { "segment-active": mode === "draw" })} aria-pressed={mode === "draw"} onClick={() => toggle("draw")}><PenIcon />Draw</button>
                    <button className={cl("segment", { "segment-active": mode === "text" })} aria-pressed={mode === "text"} onClick={() => toggle("text")}><TextIcon />Text</button>
                    <button className={cl("segment", { "segment-active": mode === "adjust" })} aria-pressed={mode === "adjust"} onClick={() => toggle("adjust")}><AdjustIcon />Adjust</button>
                </div>
                <div className={cl("options", "options-end")}>
                    <button
                        className={cl("icon-button", { "icon-button-on": compare })}
                        aria-label="Hold to see the original"
                        title="Hold to see the original"
                        onPointerDown={() => setCompare(true)}
                        onPointerUp={() => setCompare(false)}
                        onPointerLeave={() => setCompare(false)}
                        onKeyDown={e => { if (e.key === " " || e.key === "Enter") setCompare(true); }}
                        onKeyUp={() => setCompare(false)}
                    ><EyeIcon /></button>
                    <button className={cl("icon-button")} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!item.history.length} onClick={onUndo}><UndoIcon /></button>
                    <button className={cl("icon-button", { "icon-button-on": item.spoiler })} aria-pressed={item.spoiler} aria-label="Mark as spoiler" title="Spoiler" onClick={() => onChange({ spoiler: !item.spoiler })}><SpoilerIcon /></button>
                    <button className={cl("alt-button", { "icon-button-on": altOpen || !!item.alt })} aria-expanded={altOpen} title="Describe this for screen readers" onClick={() => setAltOpen(!altOpen)}>ALT</button>
                </div>
            </div>

            {altOpen && (
                <div className={cl("toolbar")}>
                    <input className={cl("alt-input")} value={item.alt} maxLength={1024} placeholder="Describe what's in it, for people using screen readers" autoFocus onChange={e => onChange({ alt: e.currentTarget.value })} />
                </div>
            )}

            {mode === "crop" && (
                <div className={cl("toolbar", "toolbar-sub")}>
                    <div className={cl("segmented")} role="group" aria-label="Aspect ratio">
                        {SHAPES.map(s => (
                            <button key={s.key} className={cl("segment", "segment-compact", { "segment-active": shapeKey === s.key })} aria-pressed={shapeKey === s.key} onClick={() => chooseShape(s)}>{s.label}</button>
                        ))}
                    </div>
                    <div className={cl("segmented")} role="group" aria-label="Profile sizes">
                        {PROFILE_SHAPES.map(s => (
                            <button key={s.key} className={cl("segment", "segment-compact", { "segment-active": shapeKey === s.key })} aria-pressed={shapeKey === s.key} onClick={() => chooseShape(s)}>{s.label}</button>
                        ))}
                    </div>
                    <button className={cl("icon-button")} aria-label="Reset crop" title="Reset" disabled={!cropped && !item.output} onClick={() => { setShapeKey("free"); onChange({ crop: full, output: null, guide: null }, true); }}><ResetIcon /></button>
                </div>
            )}

            {mode === "draw" && (
                <div className={cl("toolbar", "toolbar-sub")}>
                    <div className={cl("segmented")} role="group" aria-label="Brush">
                        {(["pen", "blur", "pixelate"] as Brush[]).map(b => (
                            <button key={b} className={cl("segment", "segment-compact", { "segment-active": brush === b })} aria-pressed={brush === b} onClick={() => setBrush(b)}>{b === "pen" ? "Pen" : b === "blur" ? "Blur" : "Pixelate"}</button>
                        ))}
                    </div>
                    {brush === "pen" && (
                        <div className={cl("swatches")} role="group" aria-label="Colour">
                            {COLORS.map(([swatch, name]) => (
                                <button key={swatch} aria-label={name} aria-pressed={color === swatch} className={cl("swatch", { "swatch-active": color === swatch })} style={{ color: swatch }} onClick={() => setColor(swatch)} />
                            ))}
                        </div>
                    )}
                    <div className={cl("segmented")} role="group" aria-label="Brush size">
                        {SIZES.map(([px, name]) => (
                            <button key={px} aria-label={name} aria-pressed={size === px} className={cl("segment", "segment-square", { "segment-active": size === px })} onClick={() => setSize(px)}>
                                <span className={cl("dot")} style={{ width: Math.min(px, 14), height: Math.min(px, 14) }} />
                            </button>
                        ))}
                    </div>
                    {brush !== "pen" && item.kind === "image" && (
                        findings
                            ? <>
                                <button className={cl("pill")} onClick={applyFindings}>Blur {findings.picked.size} {findings.picked.size === 1 ? "area" : "areas"}</button>
                                <button className={cl("pill", "pill-quiet")} onClick={() => setFindings(null)}>Cancel</button>
                                <span className={cl("note")}>{findings.list.length ? (findings.smart ? "Private-looking text is preselected. Click boxes to change." : "Click the text boxes you want hidden.") : "No text found."}</span>
                            </>
                            : <button className={cl("pill")} disabled={finding} onClick={runFind}>{finding ? "Looking…" : "Find text"}</button>
                    )}
                </div>
            )}

            {mode === "text" && (
                <div className={cl("toolbar", "toolbar-sub", "toolbar-wrap")}>
                    {!current && <span className={cl("note")}>Click the picture to add text, or pick a sticker.</span>}
                    {current && (
                        <>
                            <input className={cl("text-input")} value={current.text} aria-label="Text" autoFocus onFocus={() => onChange({}, true)} onChange={e => updateOverlay({ text: e.currentTarget.value })} />
                            <div className={cl("segmented")} role="group" aria-label="Font">
                                {Object.entries(FONTS).map(([key, f]) => (
                                    <button key={key} className={cl("segment", "segment-compact", { "segment-active": current.font === key })} style={{ fontFamily: f.css }} onClick={() => updateOverlay({ font: key }, true)}>{f.label}</button>
                                ))}
                            </div>
                            <div className={cl("swatches")} role="group" aria-label="Text colour">
                                {COLORS.map(([swatch, name]) => (
                                    <button key={swatch} aria-label={name} aria-pressed={current.color === swatch} className={cl("swatch", { "swatch-active": current.color === swatch })} style={{ color: swatch }} onClick={() => updateOverlay({ color: swatch }, true)} />
                                ))}
                            </div>
                            <button className={cl("pill", { "pill-on": current.outline })} aria-pressed={current.outline} onClick={() => updateOverlay({ outline: !current.outline }, true)}>Outline</button>
                            <Slider label="Size" value={current.size} min={8} max={Math.round(Math.min(item.crop.w, item.crop.h) * 0.6)} step={1} show={`${current.size}`} onStart={() => onChange({}, true)} onChange={v => updateOverlay({ size: v })} />
                            <button className={cl("icon-button")} aria-label="Delete" title="Delete" onClick={() => { onChange({ overlays: item.overlays.filter(o => o.id !== current.id) }, true); setSelected(null); }}><TrashIcon /></button>
                        </>
                    )}
                    <div className={cl("stickers")} role="group" aria-label="Stickers">
                        {STICKERS.map(s => (
                            <button key={s} className={cl("sticker")} aria-label={`Add ${s}`} onClick={() => addOverlay(s, [item.crop.x + item.crop.w / 2, item.crop.y + item.crop.h / 2], true)}>{s}</button>
                        ))}
                    </div>
                </div>
            )}

            {mode === "adjust" && (
                <div className={cl("toolbar", "toolbar-sub", "toolbar-wrap")}>
                    <div className={cl("presets")} role="group" aria-label="Looks">
                        {Object.entries(PRESETS).map(([name, f]) => (
                            <button key={name} className={cl("pill", { "pill-on": JSON.stringify(f) === JSON.stringify(item.filters) })} onClick={() => onChange({ filters: { ...f } }, true)}>{name}</button>
                        ))}
                    </div>
                    <Slider label="Brightness" value={item.filters.brightness} min={0.5} max={1.5} step={0.01} show={`${Math.round((item.filters.brightness - 1) * 100)}`} onStart={() => onChange({}, true)} onChange={v => setFilter({ brightness: v })} />
                    <Slider label="Contrast" value={item.filters.contrast} min={0.5} max={1.6} step={0.01} show={`${Math.round((item.filters.contrast - 1) * 100)}`} onStart={() => onChange({}, true)} onChange={v => setFilter({ contrast: v })} />
                    <Slider label="Saturation" value={item.filters.saturation} min={0} max={2} step={0.01} show={`${Math.round((item.filters.saturation - 1) * 100)}`} onStart={() => onChange({}, true)} onChange={v => setFilter({ saturation: v })} />
                    <Slider label="Warmth" value={item.filters.warmth} min={-1} max={1} step={0.01} show={`${Math.round(item.filters.warmth * 100)}`} onStart={() => onChange({}, true)} onChange={v => setFilter({ warmth: v })} />
                    <button className={cl("icon-button")} aria-label="Reset adjustments" title="Reset" disabled={JSON.stringify(item.filters) === JSON.stringify(NEUTRAL)} onClick={() => onChange({ filters: { ...NEUTRAL } }, true)}><ResetIcon /></button>
                </div>
            )}

            <div className={cl("status")}>
                <span className={cl("dimensions")}>{outW} × {outH}{item.output ? ` · ${currentShape.label.toLowerCase()} size` : ""}</span>
                {animated && <span className={cl("dimensions")}>{formatTime((item.trim[1] - item.trim[0]) / item.speed * (item.direction === "boomerang" ? 2 : 1))} {item.kind === "gif" ? "GIF" : "video, saved as WebM"}</span>}
            </div>
        </>
    );
}
