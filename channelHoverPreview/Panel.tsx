/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { ThemeStore, useEffect, useLayoutEffect, useRef, useState, useStateFromStores } from "@webpack/common";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { ChannelBody } from "./Body";
import { ServerBody } from "./ServerBody";
import { settings } from "./settings";
import { keyOf, onPanelEnter, onPanelLeave, panel, setPinned, Target, useTarget } from "./state";

const EDGE = 8;
const CLOSE_MS = 120;
const GLIDE_MS = 180;

interface Place {
    left: number;
    top: number;
    side: "right" | "left";
    origin: number;
}

function place(target: Target, width: number, height: number): Place {
    const row = target.row.getBoundingClientRect();
    const rail = target.rail.getBoundingClientRect();
    const rowTop = target.kind === "server" ? row.bottom + 4 : row.top;

    const right = rail.right + EDGE;
    const side = right + width > window.innerWidth - EDGE ? "left" : "right";
    const left = side === "right" ? right : rail.left - width - EDGE;
    const top = Math.max(EDGE, Math.min(rowTop, window.innerHeight - height - EDGE));

    return { left: Math.max(EDGE, left), top, side, origin: row.top + row.height / 2 - top };
}

function Shell({ target, closing }: { target: Target; closing: boolean; }) {
    const { width, maxHeight, messageGap, animation, scrollbar, collapseMedia } =
        settings.use(["width", "maxHeight", "messageGap", "animation", "scrollbar", "collapseMedia"]);
    const theme = useStateFromStores([ThemeStore], () => ThemeStore.theme);

    const el = useRef<HTMLDivElement | null>(null);
    const [spot, setSpot] = useState<Place | null>(null);
    const [moved, setMoved] = useState<{ left: number; top: number; } | null>(null);
    const [size, setSize] = useState<{ width: number; height: number; } | null>(null);
    const [gliding, setGliding] = useState(false);
    const lastKey = useRef(keyOf(target));
    const [entering, setEntering] = useState(animation !== "none");

    const key = keyOf(target);
    const w = size?.width ?? width;
    const h = size?.height ?? maxHeight;

    useLayoutEffect(() => {
        const box = el.current;
        if (!box) return;

        const measure = () => setSpot(place(target, box.offsetWidth, box.offsetHeight));
        measure();

        const observer = new ResizeObserver(measure);
        observer.observe(box);
        return () => observer.disconnect();
    }, [target, w]);

    useEffect(() => {
        if (lastKey.current === key) return;
        lastKey.current = key;
        setGliding(true);
        const timer = setTimeout(() => setGliding(false), GLIDE_MS);
        return () => clearTimeout(timer);
    }, [key]);

    const startDrag = (e: ReactPointerEvent) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, textarea") || !spot) return;

        const from = { x: e.clientX, y: e.clientY, left: moved?.left ?? spot.left, top: moved?.top ?? spot.top };
        const handle = e.currentTarget as HTMLElement;
        handle.setPointerCapture(e.pointerId);
        setPinned(true);

        const move = (ev: PointerEvent) => setMoved({ left: from.left + ev.clientX - from.x, top: Math.max(0, from.top + ev.clientY - from.y) });
        const up = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", up);
            handle.removeEventListener("pointercancel", up);
        };

        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
    };

    const startResize = (e: ReactPointerEvent) => {
        if (e.button !== 0 || !spot) return;
        e.preventDefault();

        const handle = e.currentTarget as HTMLElement;
        handle.setPointerCapture(e.pointerId);
        const from = { x: e.clientX, y: e.clientY, width: w, height: h };
        const grow = spot.side === "right" || moved ? 1 : -1;
        let next = { width: w, height: h };

        const move = (ev: PointerEvent) => {
            next = {
                width: Math.max(300, Math.min(900, from.width + (ev.clientX - from.x) * grow)),
                height: Math.max(160, Math.min(window.innerHeight - 120, from.height + ev.clientY - from.y))
            };
            setSize(next);
        };
        const up = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", up);
            handle.removeEventListener("pointercancel", up);
            settings.store.width = next.width;
            settings.store.maxHeight = next.height;
            setSize(null);
        };

        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
    };

    const at = moved ?? spot;
    const classes = [
        "chp-panel",
        `chp-bar-${scrollbar}`,
        theme === "light" ? "theme-light" : "theme-dark",
        spot && entering && `chp-anim-${animation}`,
        gliding && "chp-glide",
        closing && "chp-closing",
        collapseMedia && "chp-collapse",
        target.kind === "server" && "chp-server"
    ];
    if (theme !== "light" && theme !== "dark") classes.push(`theme-${theme}`);

    return (
        <div
            ref={node => { el.current = node; panel.el = node; }}
            className={classes.filter(Boolean).join(" ")}
            onMouseEnter={onPanelEnter}
            onMouseLeave={onPanelLeave}
            onAnimationEnd={e => {
                if (e.target === e.currentTarget) setEntering(false);
            }}
            style={{
                width: w,
                translate: at ? `${at.left}px ${at.top}px` : undefined,
                visibility: spot ? "visible" : "hidden",
                "--chp-gap": `${messageGap}px`,
                "--chp-from": spot?.side === "left" ? "6px" : "-6px",
                "--chp-origin": `${spot?.side === "left" ? "right" : "left"} ${spot?.origin ?? 0}px`
            } as CSSProperties}
        >
            <div className="chp-body" key={key}>
                {target.kind === "channel"
                    ? <ChannelBody channel={target.channel} onDragStart={startDrag} maxHeight={h} />
                    : <ServerBody guildId={target.guildId} onDragStart={startDrag} />}
            </div>
            <div
                className={spot?.side === "left" && !moved ? "chp-resize chp-resize-left" : "chp-resize"}
                onPointerDown={startResize}
                aria-hidden="true"
            />
        </div>
    );
}

export function PreviewHost() {
    const { target } = useTarget();
    const [last, setLast] = useState<Target | null>(target);

    useEffect(() => {
        if (target) return void setLast(target);
        if (!last) return;
        const timer = setTimeout(() => setLast(null), CLOSE_MS);
        return () => clearTimeout(timer);
    }, [target]);

    const shown = target ?? last;
    if (!shown) return null;

    return (
        <ErrorBoundary noop>
            <Shell target={shown} closing={!target} />
        </ErrorBoundary>
    );
}
