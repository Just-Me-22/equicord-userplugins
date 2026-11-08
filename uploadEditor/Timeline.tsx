/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useRef } from "@webpack/common";

import { formatTime } from "./image";
import { cl } from "./ui";

const MIN_SPAN = 100;

export function Timeline({ duration, trim, time, onTrim, onSeek }: {
    duration: number;
    trim: [number, number];
    time: number;
    onTrim(next: [number, number], start: boolean): void;
    onSeek(ms: number): void;
}) {
    const bar = useRef<HTMLDivElement>(null);
    const drag = useRef<"start" | "end" | "seek" | null>(null);

    const at = (event: React.PointerEvent) => {
        const r = bar.current!.getBoundingClientRect();
        return Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)) * duration;
    };

    function down(event: React.PointerEvent, what: "start" | "end" | "seek") {
        event.preventDefault();
        event.stopPropagation();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        drag.current = what;
        if (what === "seek") onSeek(Math.min(trim[1], Math.max(trim[0], at(event))));
        else onTrim(trim, true);
    }

    function move(event: React.PointerEvent) {
        const what = drag.current;
        if (!what) return;
        const ms = at(event);
        if (what === "seek") onSeek(Math.min(trim[1], Math.max(trim[0], ms)));
        else if (what === "start") onTrim([Math.min(ms, trim[1] - MIN_SPAN), trim[1]], false);
        else onTrim([trim[0], Math.max(ms, trim[0] + MIN_SPAN)], false);
    }

    const up = () => { drag.current = null; };
    const pct = (ms: number) => `${ms / duration * 100}%`;

    function keyHandle(event: React.KeyboardEvent, which: 0 | 1) {
        const step = event.shiftKey ? 1000 : 100;
        const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        if (!delta) return;
        event.preventDefault();
        const next: [number, number] = [...trim];
        next[which] = Math.min(duration, Math.max(0, next[which] + delta));
        if (next[1] - next[0] < MIN_SPAN) return;
        onTrim(next, true);
    }

    return (
        <div className={cl("timeline")}>
            <span className={cl("time")}>{formatTime(trim[0])}</span>
            <div ref={bar} className={cl("track")} onPointerDown={e => down(e, "seek")} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                <div className={cl("track-dim")} style={{ left: 0, width: pct(trim[0]) }} />
                <div className={cl("track-dim")} style={{ left: pct(trim[1]), right: 0 }} />
                <div className={cl("track-range")} style={{ left: pct(trim[0]), width: pct(trim[1] - trim[0]) }} />
                <div className={cl("playhead")} style={{ left: pct(time) }} />
                <div
                    className={cl("trim-handle")}
                    style={{ left: pct(trim[0]) }}
                    role="slider"
                    tabIndex={0}
                    aria-label="Start"
                    aria-valuenow={Math.round(trim[0])}
                    onKeyDown={e => keyHandle(e, 0)}
                    onPointerDown={e => down(e, "start")}
                    onPointerMove={move}
                    onPointerUp={up}
                />
                <div
                    className={cl("trim-handle")}
                    style={{ left: pct(trim[1]) }}
                    role="slider"
                    tabIndex={0}
                    aria-label="End"
                    aria-valuenow={Math.round(trim[1])}
                    onKeyDown={e => keyHandle(e, 1)}
                    onPointerDown={e => down(e, "end")}
                    onPointerMove={move}
                    onPointerUp={up}
                />
            </div>
            <span className={cl("time")}>{formatTime(trim[1])}</span>
        </div>
    );
}
