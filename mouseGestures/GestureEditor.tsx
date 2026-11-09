/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useRef, useState } from "@webpack/common";
import type { PointerEvent } from "react";

import { Action, ACTIONS, GROUPS, onMessages } from "./actions";
import { DEFAULT_BINDINGS, settings } from "./settings";
import { arrows, Stroke } from "./stroke";

const clashWith = (action: Action, gesture: string) =>
    ACTIONS.find(a => a.id !== action.id && onMessages(a) === onMessages(action) && settings.store.bindings[a.id] === gesture);

function save(action: Action, gesture: string) {
    const next = { ...settings.store.bindings };
    const clash = gesture && clashWith(action, gesture);
    if (clash) delete next[clash.id];
    if (gesture) next[action.id] = gesture;
    else delete next[action.id];
    settings.store.bindings = next;
}

function Pad({ action, onDone }: { action: Action; onDone(): void; }) {
    const [points, setPoints] = useState<[number, number][]>([]);
    const [gesture, setGesture] = useState("");
    const stroke = useRef<Stroke | null>(null);
    const box = useRef<HTMLDivElement>(null);

    const local = (e: PointerEvent) => {
        const r = box.current!.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top] as const;
    };

    const clash = gesture ? clashWith(action, gesture) : undefined;
    const note = clash
        ? `${arrows(gesture)} is on “${clash.label}”. Saving moves it here.`
        : gesture ? `${arrows(gesture)} for “${action.label}”` : "Press inside the box and drag.";

    return (
        <div className="vc-mg-pad-wrap">
            <div
                ref={box}
                className="vc-mg-pad"
                style={{ color: settings.store.trailColor || undefined }}
                onPointerDown={e => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const [x, y] = local(e);
                    stroke.current = new Stroke(x, y, settings.store.stepSize);
                    setPoints([[x, y]]);
                    setGesture("");
                }}
                onPointerMove={e => {
                    const s = stroke.current;
                    if (!s) return;
                    s.add(...local(e));
                    setPoints([...s.points]);
                    setGesture(s.gesture);
                }}
                onPointerUp={() => stroke.current = null}
            >
                <svg><polyline points={points.map(p => p.join(",")).join(" ")} /></svg>
                <span className="vc-mg-pad-hint">{gesture ? arrows(gesture) : "Draw here"}</span>
            </div>
            <div className="vc-mg-pad-foot">
                <span className={clash ? "vc-mg-warn" : undefined}>{note}</span>
                <button className="vc-mg-button vc-mg-button-primary" disabled={!gesture} onClick={() => { save(action, gesture); onDone(); }}>Save</button>
                <button className="vc-mg-button" onClick={onDone}>Cancel</button>
            </div>
        </div>
    );
}

const SWATCHES = [
    { label: "Accent", value: "" },
    { label: "Pink", value: "#ff7eb6" },
    { label: "Sky", value: "#5aa9ff" },
    { label: "Mint", value: "#4fd1a5" },
    { label: "Sun", value: "#ffd166" },
    { label: "Lilac", value: "#b69cff" },
    { label: "White", value: "#ffffff" }
];

export function TrailColorPicker() {
    const { trailColor } = settings.use(["trailColor"]);
    const custom = !SWATCHES.some(s => s.value === trailColor);

    return (
        <div className="vc-mg-colors" style={{ color: trailColor || undefined }}>
            <span className="vc-mg-colors-title">Trail colour</span>
            <div className="vc-mg-swatches">
                {SWATCHES.map(s => (
                    <button
                        key={s.label}
                        aria-label={s.label}
                        title={s.label}
                        className={trailColor === s.value ? "vc-mg-swatch vc-mg-swatch-on" : "vc-mg-swatch"}
                        style={{ background: s.value || "var(--brand-500, #5865f2)" }}
                        onClick={() => settings.store.trailColor = s.value}
                    />
                ))}
                <label title="Pick any colour" className={custom ? "vc-mg-swatch vc-mg-swatch-custom vc-mg-swatch-on" : "vc-mg-swatch vc-mg-swatch-custom"} style={custom ? { background: trailColor } : undefined}>
                    <input type="color" value={custom ? trailColor : "#ff7eb6"} onChange={e => settings.store.trailColor = e.currentTarget.value} />
                </label>
                <svg className="vc-mg-sample" viewBox="0 0 120 32"><polyline points="6,24 40,24 40,8 80,8 80,24 114,24" /></svg>
            </div>
        </div>
    );
}

export function GestureEditor() {
    const { bindings } = settings.use(["bindings"]);
    const [editing, setEditing] = useState<string | null>(null);

    return (
        <div className="vc-mg-editor">
            <div className="vc-mg-editor-head">
                <span>Drag from empty space to draw. On a message, hold Alt and drag from anywhere on it, and the Messages gestures act on that message. The other gestures run anywhere, so one gesture can do both.</span>
                <button className="vc-mg-button" onClick={() => settings.store.bindings = { ...DEFAULT_BINDINGS }}>Reset</button>
            </div>
            {GROUPS.map(group => (
                <section key={group}>
                    <h3 className="vc-mg-group">{group}</h3>
                    {ACTIONS.filter(a => a.group === group).map(action => {
                        const gesture = bindings[action.id];
                        return (
                            <div key={action.id} className="vc-mg-row">
                                <span className="vc-mg-label">{action.label}</span>
                                <span className={gesture ? "vc-mg-chip" : "vc-mg-chip vc-mg-chip-empty"}>{gesture ? arrows(gesture) : "Not set"}</span>
                                <button className="vc-mg-button" onClick={() => setEditing(editing === action.id ? null : action.id)}>{gesture ? "Redraw" : "Draw"}</button>
                                <button className="vc-mg-button" disabled={!gesture} onClick={() => save(action, "")}>Clear</button>
                                {editing === action.id && <Pad action={action} onDone={() => setEditing(null)} />}
                            </div>
                        );
                    })}
                </section>
            ))}
        </div>
    );
}
