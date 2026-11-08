/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useLayoutEffect, useRef, useState } from "@webpack/common";

import { CloseIcon, PenIcon, SpoilerIcon } from "./icons";
import { formatTime, isEdited, Item } from "./image";
import { renderEdits } from "./render";
import { cl, useSize } from "./ui";

const GAP = 4;

interface Row {
    items: Item[];
    height: number;
}

const tileAspect = (item: Item) => Math.min(2.5, Math.max(0.5, item.crop.w / item.crop.h));

function arrange(items: Item[], width: number): Row[] {
    const target = Math.max(120, width / 2.4);
    const rows: Row[] = [];
    let row: Item[] = [];
    let sum = 0;

    for (const item of items) {
        row.push(item);
        sum += tileAspect(item);
        const height = (width - GAP * (row.length - 1)) / sum;
        if (height <= target) {
            rows.push({ items: row, height });
            row = [];
            sum = 0;
        }
    }

    if (row.length) {
        const cap = rows.length ? target * 1.25 : 420;
        rows.push({ items: row, height: Math.min(cap, (width - GAP * (row.length - 1)) / sum) });
    }
    return rows;
}

function Tile({ item, width, height, onOpen, onRemove, onChange }: { item: Item; width: number; height: number; onOpen(): void; onRemove(): void; onChange(patch: Partial<Item>): void; }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [alt, setAlt] = useState(false);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));

        const { crop } = item;
        const scale = Math.max(canvas.width / crop.w, canvas.height / crop.h);
        const offsetX = (canvas.width - crop.w * scale) / 2;
        const offsetY = (canvas.height - crop.h * scale) / 2;

        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(scale, 0, 0, scale, offsetX - crop.x * scale, offsetY - crop.y * scale);
        renderEdits(ctx, item, item.preview);
    }, [item, width, height]);

    const badge = item.kind === "gif" ? "GIF" : item.kind === "video" ? formatTime((item.trim[1] - item.trim[0]) / item.speed) : null;

    return (
        <div className={cl("tile", { "tile-spoiler": item.spoiler })} style={{ width, height }}>
            <button className={cl("tile-open")} aria-label={`Edit ${item.file.name}`} onClick={onOpen}>
                <canvas ref={canvasRef} style={{ width, height }} />
            </button>
            <span className={cl("tile-badges")}>
                {badge && <span className={cl("tile-badge")}>{badge}</span>}
                {isEdited(item) && <span className={cl("tile-badge")}>Edited</span>}
                {item.alt && <span className={cl("tile-badge")}>ALT</span>}
            </span>
            <div className={cl("tile-actions")}>
                <button className={cl("tile-action", { "tile-action-on": item.spoiler })} aria-pressed={item.spoiler} aria-label="Spoiler" title="Spoiler" onClick={() => onChange({ spoiler: !item.spoiler })}><SpoilerIcon /></button>
                <button className={cl("tile-action", "tile-action-text")} aria-expanded={alt} aria-label="Alt text" title="Alt text" onClick={() => setAlt(!alt)}>ALT</button>
                <button className={cl("tile-action")} aria-label={`Edit ${item.file.name}`} onClick={onOpen}><PenIcon /></button>
                <button className={cl("tile-action")} aria-label={`Remove ${item.file.name}`} onClick={onRemove}><CloseIcon /></button>
            </div>
            {alt && (
                <input className={cl("tile-alt")} value={item.alt} maxLength={1024} placeholder="Describe this" autoFocus onChange={e => onChange({ alt: e.currentTarget.value })} onKeyDown={e => { if (e.key === "Enter") setAlt(false); }} />
            )}
        </div>
    );
}

export function Album({ items, onOpen, onRemove, onChange }: { items: Item[]; onOpen(index: number): void; onRemove(item: Item): void; onChange(id: number, patch: Partial<Item>): void; }) {
    const ref = useRef<HTMLDivElement>(null);
    const { width } = useSize(ref);
    const rows = width ? arrange(items, width) : [];

    return (
        <div className={cl("album")} ref={ref}>
            {rows.map((row, r) => (
                <div key={r} className={cl("album-row")} style={{ height: row.height }}>
                    {row.items.map(item => (
                        <Tile
                            key={item.id}
                            item={item}
                            width={tileAspect(item) * row.height}
                            height={row.height}
                            onOpen={() => onOpen(items.indexOf(item))}
                            onRemove={() => onRemove(item)}
                            onChange={patch => onChange(item.id, patch)}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}
