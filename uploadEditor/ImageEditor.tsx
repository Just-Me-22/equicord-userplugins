/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useLayoutEffect, useRef, useState } from "@webpack/common";

import { BackIcon, CropIcon, PenIcon, ResetIcon, UndoIcon } from "./icons";
import { drawPreview, fitAspect, Handle, Item, moveCrop, paintStroke, Rect, resizeCrop, Stroke } from "./image";
import { cl, useSize } from "./ui";

type Mode = "view" | "crop" | "draw";
type AspectKey = "free" | "original" | "1:1" | "4:3" | "16:9";

const ASPECTS: [AspectKey, string][] = [["free", "Free"], ["original", "Original"], ["1:1", "1:1"], ["4:3", "4:3"], ["16:9", "16:9"]];
const COLORS = [["#ffffff", "White"], ["#000000", "Black"], ["#f23f43", "Red"], ["#f0b232", "Yellow"], ["#23a55a", "Green"], ["#5865f2", "Blue"], ["#eb459e", "Pink"]] as const;
const SIZES = [[4, "Thin"], [8, "Medium"], [16, "Thick"]] as const;
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN_CROP = 24;

function aspectOf(key: AspectKey, item: Item) {
    switch (key) {
        case "free": return null;
        case "original": return item.width / item.height;
        case "1:1": return 1;
        case "4:3": return 4 / 3;
        case "16:9": return 16 / 9;
    }
}

interface DragState {
    handle: Handle;
    startX: number;
    startY: number;
    crop: Rect;
}

export function ImageEditor({ item, onChange, onBack, position }: {
    item: Item;
    onChange(patch: Partial<Item>): void;
    onBack?(): void;
    position?: string;
}) {
    const [mode, setMode] = useState<Mode>("view");
    const [aspectKey, setAspectKey] = useState<AspectKey>("free");
    const [color, setColor] = useState<string>(COLORS[2][0]);
    const [size, setSize] = useState<number>(SIZES[1][0]);
    const [dragging, setDragging] = useState(false);

    const stageRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const liveRef = useRef<Stroke | null>(null);

    const stage = useSize(stageRef);
    const full: Rect = { x: 0, y: 0, w: item.width, h: item.height };
    const region = mode === "crop" ? full : item.crop;
    const scale = stage.width && stage.height ? Math.min(stage.width / region.w, stage.height / region.h) : 0;
    const cssWidth = region.w * scale;
    const cssHeight = region.h * scale;

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
        drawPreview(ctx, item);
        item.strokes.forEach(stroke => paintStroke(ctx, stroke));
        if (liveRef.current) paintStroke(ctx, liveRef.current);

        if (mode === "crop") {
            const { crop } = item;
            ctx.fillStyle = "rgb(0 0 0 / 0.55)";
            ctx.beginPath();
            ctx.rect(0, 0, full.w, full.h);
            ctx.rect(crop.x, crop.y, crop.w, crop.h);
            ctx.fill("evenodd");
        }
    }

    useLayoutEffect(redraw);

    function chooseAspect(key: AspectKey) {
        setAspectKey(key);
        const aspect = aspectOf(key, item);
        if (aspect) onChange({ crop: fitAspect(item, aspect) });
    }

    function startDrag(event: React.PointerEvent<HTMLElement>, handle: Handle) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { handle, startX: event.clientX, startY: event.clientY, crop: item.crop };
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
                : resizeCrop(drag.crop, drag.handle, dx, dy, aspectOf(aspectKey, item), full.w, full.h, MIN_CROP / scale)
        });
    }

    function endDrag() {
        dragRef.current = null;
        setDragging(false);
    }

    function toImage(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
        const bounds = event.currentTarget.getBoundingClientRect();
        return [region.x + (event.clientX - bounds.left) / scale, region.y + (event.clientY - bounds.top) / scale];
    }

    function onCanvasDown(event: React.PointerEvent<HTMLCanvasElement>) {
        if (mode === "view") {
            setMode("crop");
            return;
        }
        if (mode !== "draw" || !scale) return;

        event.currentTarget.setPointerCapture(event.pointerId);
        liveRef.current = { color, size: size / scale, points: [toImage(event)] };
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
        onChange({ strokes: [...item.strokes, stroke] });
    }

    const toggle = (target: Mode) => setMode(current => current === target ? "view" : target);
    const box = item.crop;
    const cropped = box.x !== 0 || box.y !== 0 || box.w !== full.w || box.h !== full.h;

    return (
        <>
            <div className={cl("stage")} ref={stageRef}>
                {onBack && (
                    <button className={cl("back")} onClick={onBack}>
                        <BackIcon />All pictures{position && <span className={cl("back-position")}>{position}</span>}
                    </button>
                )}
                <div className={cl("frame")} style={{ width: cssWidth, height: cssHeight }}>
                    <canvas
                        ref={canvasRef}
                        className={cl("canvas", `canvas-${mode}`)}
                        style={{ width: cssWidth, height: cssHeight }}
                        onPointerDown={onCanvasDown}
                        onPointerMove={onCanvasMove}
                        onPointerUp={onCanvasUp}
                        onPointerCancel={onCanvasUp}
                    />
                    {mode === "crop" && scale > 0 && (
                        <div
                            className={cl("crop", { "crop-dragging": dragging })}
                            style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}
                            onPointerDown={event => startDrag(event, "move")}
                            onPointerMove={onDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                        >
                            {HANDLES.map(handle => (
                                <div
                                    key={handle}
                                    className={cl("handle", `handle-${handle}`)}
                                    onPointerDown={event => startDrag(event, handle)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className={cl("toolbar")}>
                <div className={cl("segmented")} role="group" aria-label="Tool">
                    <button className={cl("segment", { "segment-active": mode === "crop" })} aria-pressed={mode === "crop"} onClick={() => toggle("crop")}>
                        <CropIcon />Crop
                    </button>
                    <button className={cl("segment", { "segment-active": mode === "draw" })} aria-pressed={mode === "draw"} onClick={() => toggle("draw")}>
                        <PenIcon />Draw
                    </button>
                </div>

                {mode === "crop" && (
                    <div className={cl("options")}>
                        <div className={cl("segmented")} role="group" aria-label="Aspect ratio">
                            {ASPECTS.map(([key, label]) => (
                                <button key={key} className={cl("segment", "segment-compact", { "segment-active": aspectKey === key })} aria-pressed={aspectKey === key} onClick={() => chooseAspect(key)}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        <button className={cl("icon-button")} aria-label="Reset crop" title="Reset" disabled={!cropped} onClick={() => { setAspectKey("free"); onChange({ crop: full }); }}>
                            <ResetIcon />
                        </button>
                    </div>
                )}

                {mode === "draw" && (
                    <div className={cl("options")}>
                        <div className={cl("swatches")} role="group" aria-label="Colour">
                            {COLORS.map(([swatch, name]) => (
                                <button
                                    key={swatch}
                                    aria-label={name}
                                    aria-pressed={color === swatch}
                                    className={cl("swatch", { "swatch-active": color === swatch })}
                                    style={{ color: swatch }}
                                    onClick={() => setColor(swatch)}
                                />
                            ))}
                        </div>
                        <div className={cl("segmented")} role="group" aria-label="Brush size">
                            {SIZES.map(([px, name]) => (
                                <button key={px} aria-label={name} aria-pressed={size === px} className={cl("segment", "segment-square", { "segment-active": size === px })} onClick={() => setSize(px)}>
                                    <span className={cl("dot")} style={{ width: Math.min(px, 14), height: Math.min(px, 14) }} />
                                </button>
                            ))}
                        </div>
                        <button className={cl("icon-button")} aria-label="Undo" title="Undo" disabled={!item.strokes.length} onClick={() => onChange({ strokes: item.strokes.slice(0, -1) })}>
                            <UndoIcon />
                        </button>
                    </div>
                )}

                <span className={cl("dimensions")}>{Math.round(box.w)} × {Math.round(box.h)}</span>
            </div>
        </>
    );
}
