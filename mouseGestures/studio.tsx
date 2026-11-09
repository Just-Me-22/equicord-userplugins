/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { chooseFile, saveFile } from "@utils/web";
import { Alerts, Modal, openModal, SelectedChannelStore, SelectedGuildStore, showToast, useRef, useState } from "@webpack/common";
import type { CSSProperties, PointerEvent, ReactNode } from "react";

import { Action, allActions, Command, COMMAND_KINDS, CommandKind, commandLabel, opt, OptionDef, resolve, setOpt } from "./actions";
import { MATERIALS, trailClass, trailMarkup, trailVars } from "./overlay";
import { DEFAULT_BINDINGS, settings } from "./settings";
import { bestShape, isReady, normalize, pathLength, Point, SAMPLES, Shape, shapeAction, shapeIcon, THRESHOLD } from "./shapes";
import { arrows, Stroke } from "./stroke";
import { Context, Zone, ZONES } from "./zones";

type Selection = { kind: "try"; } | { kind: "action"; id: string; redraw?: boolean; } | { kind: "shape"; id: string; };

const zoneLabel = (zone: Zone) => ZONES.find(z => z.id === zone)!.label;
const builtins = () => allActions().filter(a => !a.custom && !a.plugin);
const fromPlugins = () => allActions().filter(a => a.plugin);

const clashWith = (action: Action, gesture: string) =>
    allActions().find(a => a.id !== action.id && a.zone === action.zone && settings.store.bindings[a.id] === gesture);

function bind(action: Action, gesture: string) {
    const next = { ...settings.store.bindings };
    const clash = gesture && clashWith(action, gesture);
    if (clash) delete next[clash.id];
    if (gesture) next[action.id] = gesture;
    else delete next[action.id];
    settings.store.bindings = next;
}

function updateShape(id: string, change: Partial<Shape>) {
    settings.store.shapes = settings.store.shapes.map(s => s.id === id ? { ...s, ...change } : s);
}

function updateCommand(id: string, change: Partial<Command>) {
    settings.store.commands = settings.store.commands.map(c => c.id === id ? { ...c, ...change } : c);
}

const trailStyle = () => ({ color: settings.store.trailColor || undefined, ...trailVars() }) as CSSProperties;

function Trail({ points, style, fade, uid, view }: { points: Point[]; style?: string; fade?: string; uid: string; view?: [number, number]; }) {
    return (
        <svg className={trailClass(style)} viewBox={view ? `0 0 ${view[0]} ${view[1]}` : undefined} preserveAspectRatio="xMidYMid meet">
            <g dangerouslySetInnerHTML={{ __html: trailMarkup(points, { style, fade, uid }) }} />
        </svg>
    );
}

export function Keys({ gesture }: { gesture?: string; }) {
    if (!gesture) return <span className="vc-mg-keys vc-mg-keys-empty">Not set</span>;
    return <span className="vc-mg-keys">{arrows(gesture).split(" ").map((a, i) => <kbd key={i}>{a}</kbd>)}</span>;
}

const STEP: Record<string, Point> = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1], 7: [-0.71, -0.71], 9: [0.71, -0.71], 1: [-0.71, 0.71], 3: [0.71, 0.71] };

function fit(points: Point[], w: number, h: number, pad: number): Point[] {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((w - pad * 2) / Math.max(maxX - minX, 0.001), (h - pad * 2) / Math.max(maxY - minY, 0.001), 90);
    const ox = w / 2 - (minX + maxX) / 2 * scale, oy = h / 2 - (minY + maxY) / 2 * scale;
    return points.map(([x, y]) => [ox + x * scale, oy + y * scale]);
}

const fmt = ([x, y]: Point) => `${x.toFixed(1)} ${y.toFixed(1)}`;

function roundedPath(pts: Point[], radius: number) {
    let d = `M${fmt(pts[0])}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
        const l1 = Math.hypot(px - cx, py - cy), l2 = Math.hypot(nx - cx, ny - cy);
        const r = Math.min(radius, l1 / 2, l2 / 2);
        const a: Point = [cx + (px - cx) / l1 * r, cy + (py - cy) / l1 * r];
        const b: Point = [cx + (nx - cx) / l2 * r, cy + (ny - cy) / l2 * r];
        d += ` L${fmt(a)} Q${fmt([cx, cy])} ${fmt(b)}`;
    }
    return `${d} L${fmt(pts[pts.length - 1])}`;
}

function smoothPath(pts: Point[]) {
    let d = `M${fmt(pts[0])}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C${fmt(c1)} ${fmt(c2)} ${fmt(p2)}`;
    }
    return d;
}

const CALM = matchMedia("(prefers-reduced-motion: reduce)");
const DRAW = { dur: "2.8s", keyTimes: "0;0.6;0.86;1", keySplines: "0.65 0 0.35 1;0 0 1 1;0.4 0 1 1", calcMode: "spline", repeatCount: "indefinite" } as const;

function GesturePreview({ gesture, sample, height = 170 }: { gesture?: string; sample?: Point[]; height?: number; }) {
    const width = 420;
    let raw: Point[] | null = sample ?? null;
    if (!raw && gesture) {
        raw = [[0, 0]];
        for (const c of gesture) {
            const [x, y] = raw[raw.length - 1];
            raw.push([x + STEP[c][0], y + STEP[c][1]]);
        }
    }
    if (!raw || raw.length < 2) return <div className="vc-mgs-preview vc-mgs-preview-empty" style={{ height }}>No gesture yet</div>;
    const pts = fit(raw, width, height, 32);
    const d = sample ? smoothPath(pts) : roundedPath(pts, 26);
    const [sx, sy] = pts[0];
    const still = CALM.matches;
    return (
        <div className="vc-mgs-preview" style={{ ...trailStyle(), height }}>
            <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" key={d}>
                <path className="vc-mgs-preview-ghost" d={d} />
                <circle className="vc-mgs-preview-start" cx={sx} cy={sy} r={5} />
                <path className="vc-mgs-preview-line" d={d} pathLength={1} strokeDashoffset={still ? 0 : 1}>
                    {!still && <animate attributeName="stroke-dashoffset" values="1;0;0;0" {...DRAW} />}
                    {!still && <animate attributeName="opacity" values="1;1;1;0" {...DRAW} />}
                </path>
                {!still && (
                    <circle className="vc-mgs-preview-tip" r={7}>
                        <animateMotion path={d} keyPoints="0;1;1;1" {...DRAW} />
                        <animate attributeName="opacity" values="1;1;0;0" {...DRAW} />
                    </circle>
                )}
            </svg>
        </div>
    );
}

function ShapeGlyph({ shape, size = 24 }: { shape: Shape; size?: number; }) {
    const sample = shape.samples[0];
    return (
        <svg className="vc-mgs-glyph" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {sample ? <polyline points={shapeIcon(sample, size)} /> : <circle cx={size / 2} cy={size / 2} r={size / 3} />}
        </svg>
    );
}

function Toggle({ label, note, value, onChange }: { label: string; note?: string; value: boolean; onChange(v: boolean): void; }) {
    return (
        <div className="vc-mg-toggle">
            <span className="vc-mg-toggle-text">
                <span>{label}</span>
                {note && <small>{note}</small>}
            </span>
            <button role="switch" aria-checked={value} aria-label={label} className="vc-mg-switch" onClick={() => onChange(!value)} />
        </div>
    );
}

function Range({ label, min, max, step, value, unit, onChange }: { label: string; min: number; max: number; step: number; value: number; unit: string; onChange(v: number): void; }) {
    const shown = Math.round(value / step) * step;
    return (
        <label className="vc-mgs-range">
            <span>{label}<b>{shown}{unit}</b></span>
            <input type="range" min={min} max={max} step={step} value={shown} onChange={e => onChange(Number(e.currentTarget.value))} />
        </label>
    );
}

function Choice({ options, value, onPick }: { options: { value: string; label: string; }[]; value: string; onPick(v: string): void; }) {
    return (
        <div className="vc-mg-choice" role="radiogroup">
            {options.map(o => (
                <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? "vc-mg-choice-on" : undefined} onClick={() => onPick(o.value)}>{o.label}</button>
            ))}
        </div>
    );
}

function DrawPad({ hint, onStroke, children, height = 220 }: { hint: string; onStroke(points: Point[], gesture: string): void; children?: ReactNode; height?: number; }) {
    const [points, setPoints] = useState<Point[]>([]);
    const [gesture, setGesture] = useState("");
    const stroke = useRef<Stroke | null>(null);
    const box = useRef<HTMLDivElement>(null);

    const local = (e: PointerEvent) => {
        const r = box.current!.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top] as const;
    };

    return (
        <div className="vc-mgs-pad-wrap">
            <div
                ref={box}
                className="vc-mg-pad"
                style={{ ...trailStyle(), height }}
                onPointerDown={e => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const [x, y] = local(e);
                    stroke.current = new Stroke(x, y, settings.store.stepSize, settings.store.diagonals);
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
                onPointerUp={() => {
                    const s = stroke.current;
                    stroke.current = null;
                    if (s && s.points.length > 2) onStroke(s.points, s.gesture);
                }}
            >
                <Trail points={points} uid="pad" />
                {gesture
                    ? <span className="vc-mg-pad-read"><Keys gesture={gesture} /></span>
                    : !points.length && <span className="vc-mg-pad-hint">{hint}</span>}
            </div>
            {children}
        </div>
    );
}

function TryView() {
    const [result, setResult] = useState<{ points: Point[]; gesture: string; } | null>(null);
    const shape = result ? bestShape(result.points, null) : null;
    const matched = shape && shape.score >= THRESHOLD ? shape : null;

    return (
        <div className="vc-mgs-view">
            <h3>Try a gesture</h3>
            <p className="vc-mgs-lede">Draw anything to see what it does in each place. Your shapes are checked first, then the arrow gestures.</p>
            <DrawPad hint="Draw here" height={280} onStroke={(points, gesture) => setResult({ points, gesture })}>
                {result && (
                    <div className="vc-mgs-verdict">
                        <div className="vc-mgs-verdict-head">
                            {matched
                                ? <><span className="vc-mgs-tag">◎ {matched.shape.name}</span><span>{Math.round(matched.score * 100)}% match: {matched.action.label}</span></>
                                : <><Keys gesture={result.gesture} />{shape && <span className="vc-mgs-muted">Closest shape: {shape.shape.name}, {Math.max(0, Math.round(shape.score * 100))}%</span>}</>}
                        </div>
                        {!matched && (
                            <ul className="vc-mgs-zone-results">
                                {ZONES.map(z => {
                                    const ctx: Context = { zones: z.id === "anywhere" ? [] : [z.id], targets: {} };
                                    const action = result.gesture ? resolve(result.gesture, ctx) : undefined;
                                    return (
                                        <li key={z.id}>
                                            <span>{z.label}</span>
                                            <span className={action ? undefined : "vc-mgs-muted"}>{action ? action.label + (action.zone !== z.id && z.id !== "anywhere" ? " (from Anywhere)" : "") : "Nothing"}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                )}
            </DrawPad>
        </div>
    );
}

function OptionField({ action, def }: { action: Action; def: OptionDef; }) {
    settings.use(["options"]);
    const fallback = def.key === "emoji" ? settings.store.reactEmoji : def.default;
    const value = opt(action.id, def.key, fallback);
    if (def.type === "toggle") return <Toggle label={def.label} value={!!value} onChange={v => setOpt(action.id, def.key, v)} />;
    if (def.type === "number") return <Range label={def.label} min={def.min ?? 1} max={def.max ?? 5} step={1} value={Number(value)} unit="" onChange={v => setOpt(action.id, def.key, v)} />;
    if (def.type === "select")
        return (
            <label className="vc-mgs-field">
                <span>{def.label}</span>
                <select className="vc-mgs-select" value={String(value)} onChange={e => setOpt(action.id, def.key, e.currentTarget.value)}>
                    {def.choices!.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
            </label>
        );
    return (
        <label className="vc-mgs-field">
            <span>{def.label}</span>
            <input className="vc-mg-input" value={String(value)} placeholder="💀" onChange={e => setOpt(action.id, def.key, e.currentTarget.value)} />
        </label>
    );
}

function ActionSelect({ value, exclude, onChange }: { value: string; exclude: string; onChange(id: string): void; }) {
    return (
        <select className="vc-mgs-select" value={value} onChange={e => onChange(e.currentTarget.value)}>
            <option value="">Choose a command</option>
            {ZONES.map(z => (
                <optgroup key={z.id} label={z.label}>
                    {allActions().filter(a => a.zone === z.id && a.id !== exclude).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                </optgroup>
            ))}
        </select>
    );
}

function MacroSteps({ command }: { command: Command; }) {
    const steps = command.steps ?? [];
    const set = (next: string[]) => updateCommand(command.id, { steps: next });
    return (
        <div className="vc-mgs-field">
            <span>{command.kind === "radial" ? "Ring items, clockwise from the top" : "Steps"}</span>
            {steps.map((id, i) => (
                <div key={i} className="vc-mgs-step">
                    <b>{i + 1}</b>
                    <ActionSelect value={id} exclude={command.id} onChange={v => set(steps.map((s, k) => k === i ? v : s))} />
                    <button className="vc-mgs-edit" aria-label={`Remove step ${i + 1}`} onClick={() => set(steps.filter((_, k) => k !== i))}>✕</button>
                </div>
            ))}
            <button className="vc-mg-button vc-mg-button-small vc-mgs-start" disabled={steps.length >= 8} onClick={() => set([...steps, ""])}>Add a step</button>
        </div>
    );
}

function CommandFields({ command }: { command: Command; }) {
    const kind = COMMAND_KINDS.find(k => k.value === command.kind)!;
    const useHere = () => {
        const channel = SelectedChannelStore.getChannelId();
        if (channel) updateCommand(command.id, { value: `${location.origin}/channels/${SelectedGuildStore.getGuildId() ?? "@me"}/${channel}` });
    };
    return (
        <div className="vc-mgs-box">
            <label className="vc-mgs-field">
                <span>Name</span>
                <input className="vc-mg-input" value={command.label} placeholder={kind.label} onChange={e => updateCommand(command.id, { label: e.currentTarget.value })} />
            </label>
            <label className="vc-mgs-field">
                <span>What it does</span>
                <select className="vc-mgs-select" value={command.kind} onChange={e => updateCommand(command.id, { kind: e.currentTarget.value as CommandKind })}>
                    {COMMAND_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
            </label>
            {command.kind === "macro" || command.kind === "radial" ? <MacroSteps command={command} /> : <label className="vc-mgs-field">
                <span>{command.kind === "react" ? "Emoji" : command.kind === "link" ? "Link" : command.kind === "channel" ? "Channel" : "Text"}</span>
                {command.kind === "type" || command.kind === "send"
                    ? <textarea className="vc-mg-input vc-mgs-textarea" value={command.value} placeholder={kind.placeholder} onChange={e => updateCommand(command.id, { value: e.currentTarget.value })} />
                    : <input className="vc-mg-input" value={command.value} placeholder={kind.placeholder} onChange={e => updateCommand(command.id, { value: e.currentTarget.value })} />}
            </label>}
            {command.kind === "channel" && <button className="vc-mg-button vc-mg-button-small vc-mgs-start" onClick={useHere}>Use the channel I'm in</button>}
            <p className="vc-mgs-muted">{command.kind === "react" ? "Start this gesture on a message." : command.kind === "macro" ? "Steps run in order, a quarter second apart, using the place you started the gesture." : command.kind === "radial" ? "The ring opens where your gesture ends. Move toward a command and tap, drag to it and let go, or press its number. Esc or the middle closes it." : "Works anywhere you can draw."}</p>
        </div>
    );
}

function ActionView({ action, startRedraw, onDeleted }: { action: Action; startRedraw?: boolean; onDeleted(): void; }) {
    const { bindings, commands } = settings.use(["bindings", "commands"]);
    const [redraw, setRedraw] = useState(!!startRedraw);
    const [draft, setDraft] = useState("");
    const current = bindings[action.id];
    const clash = draft ? clashWith(action, draft) : undefined;
    const elsewhere = current ? allActions().filter(a => a.id !== action.id && a.zone !== action.zone && bindings[a.id] === current) : [];
    const command = action.custom ? commands.find(c => c.id === action.id) : undefined;

    const finish = () => { setDraft(""); setRedraw(false); };

    return (
        <div className="vc-mgs-view">
            <span className="vc-mgs-tag">{command ? "Your command" : action.plugin ? `From ${action.plugin} · ${zoneLabel(action.zone)}` : zoneLabel(action.zone)}</span>
            <h3>{command ? commandLabel(command) : action.label}</h3>

            {redraw ? (
                <DrawPad hint={current ? "Draw the new gesture" : "Draw the gesture for this"} onStroke={(_, gesture) => setDraft(gesture)}>
                    <div className="vc-mg-pad-foot">
                        <span className={clash ? "vc-mg-warn" : undefined}>
                            {!draft ? "Press inside the box and drag." : clash ? `${arrows(draft)} already does “${clash.label}” here. Saving moves it.` : `${arrows(draft)} for “${action.label}”.`}
                        </span>
                        <button className="vc-mg-button" onClick={finish}>Cancel</button>
                        <button className="vc-mg-button vc-mg-button-primary" disabled={!draft} onClick={() => { bind(action, draft); finish(); }}>Save</button>
                    </div>
                </DrawPad>
            ) : (
                <>
                    <GesturePreview gesture={current} />
                    <div className="vc-mgs-current">
                        <Keys gesture={current} />
                        <span className="vc-mgs-spacer" />
                        <button className="vc-mg-button vc-mg-button-small" disabled={!current} onClick={() => bind(action, "")}>Clear</button>
                        <button className="vc-mg-button vc-mg-button-small vc-mg-button-primary" onClick={() => setRedraw(true)}>{current ? "Redraw" : "Draw a gesture"}</button>
                    </div>
                </>
            )}

            {command && <CommandFields command={command} />}

            {!!action.options?.length && (
                <div className="vc-mgs-box">
                    <h4>Options</h4>
                    {action.options.map(def => <OptionField key={def.key} action={action} def={def} />)}
                </div>
            )}

            {elsewhere.length > 0 && (
                <div className="vc-mgs-elsewhere">
                    <h4>The same gesture elsewhere</h4>
                    {elsewhere.map(a => <div key={a.id}><span className="vc-mgs-muted">{zoneLabel(a.zone)}</span><span>{a.label}</span></div>)}
                </div>
            )}
            {!command && <p className="vc-mgs-muted">{ZONES.find(z => z.id === action.zone)!.hint}</p>}

            {command && (
                <button className="vc-mg-button vc-mgs-danger" onClick={() => {
                    settings.store.commands = settings.store.commands.filter(c => c.id !== command.id);
                    bind(action, "");
                    onDeleted();
                }}>Delete command</button>
            )}
        </div>
    );
}

function ShapeView({ shape, onDeleted }: { shape: Shape; onDeleted(): void; }) {
    const [verdict, setVerdict] = useState<{ text: string; good: boolean; } | null>(null);
    const [teach, setTeach] = useState(shape.samples.length < SAMPLES);
    const action = shapeAction(shape);
    const learned = shape.samples.length >= SAMPLES;

    const onStroke = (points: Point[]) => {
        if (pathLength(points) < 60) return setVerdict({ text: "Too short. Draw it bigger.", good: false });
        const latest = settings.store.shapes.find(s => s.id === shape.id)!;
        if (latest.samples.length < SAMPLES) {
            const samples = [...latest.samples, normalize(points)];
            updateShape(shape.id, { samples });
            return setVerdict({ text: samples.length < SAMPLES ? `Drawing ${samples.length} of ${SAMPLES} saved.` : "Learned.", good: true });
        }
        const best = bestShape(points, null, settings.store.shapes.filter(isReady).concat(action ? [] : [latest]));
        if (best && best.score >= THRESHOLD && best.shape.id === shape.id) setVerdict({ text: `Matches, ${Math.round(best.score * 100)}%.`, good: true });
        else if (best && best.score >= THRESHOLD) setVerdict({ text: `That matched “${best.shape.name}” instead.`, good: false });
        else setVerdict({ text: "No match. Draw it closer to your drawings.", good: false });
    };

    return (
        <div className="vc-mgs-view">
            <span className="vc-mgs-tag">Your shape</span>
            <input className="vc-mg-input vc-mgs-title-input" aria-label="Shape name" value={shape.name} placeholder="X, circle, zigzag" onChange={e => updateShape(shape.id, { name: e.currentTarget.value })} />
            <p className="vc-mgs-lede">
                {learned ? "Learned. Draw it in the box to test it, or remove a drawing to teach it again." : `Draw the shape ${SAMPLES - shape.samples.length} more ${SAMPLES - shape.samples.length === 1 ? "time" : "times"}, the way you'll really draw it.`}
            </p>
            <div className="vc-mgs-samples">
                {Array.from({ length: SAMPLES }, (_, i) => {
                    const sample = shape.samples[i];
                    return (
                        <div key={i} className={sample ? "vc-mgs-sample vc-mgs-sample-on" : "vc-mgs-sample"}>
                            {sample ? <svg width={44} height={44} viewBox="0 0 44 44"><polyline points={shapeIcon(sample, 44)} /></svg> : i + 1}
                            {sample && <button aria-label={`Remove drawing ${i + 1}`} onClick={() => { updateShape(shape.id, { samples: shape.samples.filter((_, k) => k !== i) }); setTeach(true); }}>✕</button>}
                        </div>
                    );
                })}
            </div>
            {learned && !teach
                ? <>
                    <GesturePreview sample={shape.samples[0]} />
                    <div className="vc-mgs-current">
                        <span className="vc-mgs-spacer" />
                        <button className="vc-mg-button vc-mg-button-small vc-mg-button-primary" onClick={() => setTeach(true)}>Test it</button>
                    </div>
                </>
                : <DrawPad hint={learned ? "Draw it to test" : "Draw your shape here"} onStroke={onStroke}>
                    {verdict && <div className={verdict.good ? "vc-mgs-verdict-line" : "vc-mgs-verdict-line vc-mg-warn"}>{verdict.text}</div>}
                </DrawPad>}
            <label className="vc-mgs-field">
                <span>What it does</span>
                <select className="vc-mgs-select" value={shape.action} onChange={e => updateShape(shape.id, { action: e.currentTarget.value })}>
                    <option value="">Choose an action</option>
                    {ZONES.map(z => (
                        <optgroup key={z.id} label={z.label}>
                            {allActions().filter(a => a.zone === z.id).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                        </optgroup>
                    ))}
                </select>
            </label>
            <p className="vc-mgs-muted">
                {action ? action.zone === "anywhere" ? "Works anywhere you can draw." : `Works when you start in: ${zoneLabel(action.zone)}.` : "It does nothing until you choose an action."}
            </p>
            <button className="vc-mg-button vc-mgs-danger" onClick={() => {
                settings.store.shapes = settings.store.shapes.filter(s => s.id !== shape.id);
                onDeleted();
            }}>Delete shape</button>
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
    { label: "Coral", value: "#ff8a65" },
    { label: "White", value: "#ffffff" }
];

const CAPS = [
    { value: "round", label: "Round" },
    { value: "square", label: "Square" },
    { value: "butt", label: "Flat" }
];

const PILLS = [
    { value: "cursor", label: "By cursor" },
    { value: "top", label: "Top" },
    { value: "off", label: "Hidden" }
];

function MatchSwatches({ value, onPick }: { value: string; onPick(v: string): void; }) {
    return (
        <div className="vc-mg-swatches">
            <button className={value === "" ? "vc-mg-swatch vc-mg-swatch-off vc-mg-swatch-on" : "vc-mg-swatch vc-mg-swatch-off"} aria-label="Same colour" title="Same colour" onClick={() => onPick("")}>∅</button>
            {["#4fd1a5", "#ffd166", "#ffffff", "#ff7eb6", "#5aa9ff"].map(c => (
                <button key={c} aria-label={c} title={c} className={value === c ? "vc-mg-swatch vc-mg-swatch-on" : "vc-mg-swatch"} style={{ background: c }} onClick={() => onPick(c)} />
            ))}
        </div>
    );
}

const FADES = [
    { value: "full", label: "Whole line" },
    { value: "tail", label: "Comet tail" }
];

const wave = (w: number, h: number, n = 48): Point[] => Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [8 + t * (w - 16), h / 2 + Math.sin(t * Math.PI * 2.2) * (h / 2 - 9)] as Point;
});

const SAMPLE = wave(240, 72, 64);
const TILE = wave(80, 36, 36);

function Swatches({ value, onPick, accent = true }: { value: string; onPick(v: string): void; accent?: boolean; }) {
    const list = accent ? SWATCHES : SWATCHES.slice(1);
    const custom = !list.some(w => w.value === value);
    return (
        <div className="vc-mg-swatches">
            {list.map(w => (
                <button key={w.label} aria-label={w.label} title={w.label} className={value === w.value ? "vc-mg-swatch vc-mg-swatch-on" : "vc-mg-swatch"} style={{ background: w.value || "var(--brand-500, #5865f2)" }} onClick={() => onPick(w.value)} />
            ))}
            <label title="Pick any colour" className={custom ? "vc-mg-swatch vc-mg-swatch-custom vc-mg-swatch-on" : "vc-mg-swatch vc-mg-swatch-custom"} style={custom ? { background: value } : undefined}>
                <input type="color" aria-label="Pick any colour" value={custom && value ? value : "#ff7eb6"} onChange={e => onPick(e.currentTarget.value)} />
            </label>
        </div>
    );
}

function Feel() {
    const s = settings.use(["trailOpacity", "trailGlow", "trailCap", "trailTaper", "tailLength", "fadeOut", "matchColor", "pillPos", "diagonals", "stepSize", "startDistance", "holdToMove", "readyRing", "cheatSheet", "cheatDelay", "trail", "trailColor", "trailColor2", "trailStyle", "trailFade", "trailWidth", "sound", "twoFingerSwipes", "swipeDistance"]);
    const look = `${s.trailStyle}${s.trailFade}${s.trailWidth}${s.trailColor}${s.trailColor2}${s.trailTaper}${s.tailLength}`;

    return (
        <div className="vc-mgs-feel">
            <h3>Trail</h3>
            <Toggle label="Show the trail" value={s.trail} onChange={v => settings.store.trail = v} />
            <div className={s.trail ? "vc-mg-trail-settings" : "vc-mg-trail-settings vc-mg-off"}>
                <div className="vc-mg-sample" style={trailStyle()}>
                    <Trail key={look} points={SAMPLE} uid="sample" view={[240, 72]} />
                </div>
                <span className="vc-mgs-label">Material</span>
                <div className="vc-mgs-materials" role="radiogroup" aria-label="Trail material">
                    {MATERIALS.map(m => (
                        <button key={m.value} role="radio" aria-checked={s.trailStyle === m.value} className={s.trailStyle === m.value ? "vc-mgs-material vc-mgs-material-on" : "vc-mgs-material"} style={trailStyle()} onClick={() => settings.store.trailStyle = m.value}>
                            <Trail key={look} points={TILE} style={m.value} fade="full" uid={`tile-${m.value}`} view={[80, 36]} />
                            <span>{m.label}</span>
                        </button>
                    ))}
                </div>
                <span className="vc-mgs-label">{s.trailStyle === "gradient" ? "Start colour" : "Colour"}</span>
                <Swatches value={s.trailColor} onPick={v => settings.store.trailColor = v} />
                {s.trailStyle === "gradient" && <>
                    <span className="vc-mgs-label">End colour</span>
                    <Swatches value={s.trailColor2} accent={false} onPick={v => settings.store.trailColor2 = v} />
                </>}
                <span className="vc-mgs-label">Fade</span>
                <Choice options={FADES} value={s.trailFade} onPick={v => settings.store.trailFade = v} />
                {s.trailFade === "tail" && <Range label="Tail length" min={12} max={160} step={4} value={s.tailLength} unit=" pts" onChange={v => settings.store.tailLength = v} />}
                <Range label="Thickness" min={2} max={12} step={1} value={s.trailWidth} unit="px" onChange={v => settings.store.trailWidth = v} />
                <Toggle label="Taper" note="Thin at the start, full width at your finger." value={s.trailTaper} onChange={v => settings.store.trailTaper = v} />
                <span className="vc-mgs-label">Line ends</span>
                <Choice options={CAPS} value={s.trailCap} onPick={v => settings.store.trailCap = v} />
                <Range label="Opacity" min={20} max={100} step={5} value={s.trailOpacity} unit="%" onChange={v => settings.store.trailOpacity = v} />
                <Range label="Glow" min={0} max={20} step={1} value={s.trailGlow} unit="px" onChange={v => settings.store.trailGlow = v} />
                <Range label="Fade out" min={80} max={900} step={20} value={s.fadeOut} unit="ms" onChange={v => settings.store.fadeOut = v} />
                <span className="vc-mgs-label">Colour once it matches</span>
                <MatchSwatches value={s.matchColor} onPick={v => settings.store.matchColor = v} />
                <span className="vc-mgs-label">Action label</span>
                <Choice options={PILLS} value={s.pillPos} onPick={v => settings.store.pillPos = v} />
            </div>

            <h3>Drawing</h3>
            <Toggle label="Diagonals" note="↖ ↗ ↙ ↘ count as their own directions." value={s.diagonals} onChange={v => settings.store.diagonals = v} />
            <Range label="Start after" min={6} max={40} step={1} value={s.startDistance} unit="px" onChange={v => settings.store.startDistance = v} />
            <p className="vc-mgs-muted vc-mgs-hint">How far you drag before it counts as a gesture. Raise it if clicks turn into gestures.</p>
            <Range label="Line length" min={20} max={70} step={1} value={s.stepSize} unit="px" onChange={v => settings.store.stepSize = v} />
            <p className="vc-mgs-muted vc-mgs-hint">How long each line of a gesture has to be. Raise it if wobbles add extra arrows.</p>
            <Range label="Hold before moving" min={200} max={2000} step={50} value={s.holdToMove} unit="ms" onChange={v => settings.store.holdToMove = v} />
            <Toggle label="Ready ring" note="Fills where a gesture can start." value={s.readyRing} onChange={v => settings.store.readyRing = v} />

            <h3>Cheat sheet</h3>
            <Toggle label="Show when I pause" note="Stop mid-drag to list what you can draw from there." value={s.cheatSheet} onChange={v => settings.store.cheatSheet = v} />
            <Range label="Pause length" min={300} max={1500} step={50} value={s.cheatDelay} unit="ms" onChange={v => settings.store.cheatDelay = v} />

            <h3>Extras</h3>
            <Toggle label="Tick sound" value={s.sound} onChange={v => settings.store.sound = v} />
            <Toggle label="Two-finger swipes" note="Sideways swipes run → and ←." value={s.twoFingerSwipes} onChange={v => settings.store.twoFingerSwipes = v} />
            {s.twoFingerSwipes && <Range label="Swipe distance" min={60} max={260} step={10} value={s.swipeDistance} unit="px" onChange={v => settings.store.swipeDistance = v} />}
        </div>
    );
}

function Row({ on, onOpen, onEdit, children, keys }: { on: boolean; onOpen(): void; onEdit?(): void; children: ReactNode; keys?: ReactNode; }) {
    return (
        <div className={on ? "vc-mgs-row vc-mgs-row-on" : "vc-mgs-row"}>
            <button className="vc-mgs-row-main" onClick={onOpen}>
                {children}
                {keys}
            </button>
            {onEdit && <button className="vc-mgs-edit" aria-label="Edit gesture" title="Edit gesture" onClick={onEdit}>✎</button>}
        </div>
    );
}

function SectionHead({ title, count, open, onToggle, action }: { title: string; count?: string; open?: boolean; onToggle?(): void; action?: ReactNode; }) {
    return (
        <div className="vc-mgs-section-head">
            {onToggle
                ? <button className="vc-mgs-fold" aria-expanded={open} onClick={onToggle}><span className="vc-mgs-chevron" aria-hidden>{open ? "▾" : "▸"}</span><h4>{title}</h4></button>
                : <h4>{title}</h4>}
            {count && <span className="vc-mg-zone-count">{count}</span>}
            {action}
        </div>
    );
}

function Studio() {
    const { bindings, shapes, commands } = settings.use(["bindings", "shapes", "commands"]);
    const [sel, setSel] = useState<Selection>({ kind: "try" });
    const [open, setOpen] = useState<Partial<Record<Zone | "plugins", boolean>>>({ anywhere: true });
    const action = sel.kind === "action" ? allActions().find(a => a.id === sel.id) : undefined;
    const shape = sel.kind === "shape" ? shapes.find(s => s.id === sel.id) : undefined;
    const customs = allActions().filter(a => a.custom);

    const newShape = () => {
        const id = Date.now().toString(36);
        settings.store.shapes = [...settings.store.shapes, { id, name: `Shape ${shapes.length + 1}`, samples: [], action: "" }];
        setSel({ kind: "shape", id });
    };

    const newCommand = () => {
        const id = `custom.${Date.now().toString(36)}`;
        settings.store.commands = [...commands, { id, label: "", kind: "react", value: "" }];
        setSel({ kind: "action", id });
    };

    const isOn = (id: string) => sel.kind !== "try" && sel.id === id;

    return (
        <div className="vc-mgs">
            <nav className="vc-mgs-list" aria-label="Gestures">
                <Row on={sel.kind === "try"} onOpen={() => setSel({ kind: "try" })}><span className="vc-mgs-try">✎</span><span className="vc-mgs-row-text">Try a gesture</span></Row>

                <SectionHead title="Your shapes" action={<button className="vc-mg-button vc-mg-button-small" onClick={newShape}>New</button>} />
                {!shapes.length && <p className="vc-mgs-muted vc-mgs-empty">Draw an X, a circle or a letter, then give it a job.</p>}
                {shapes.map(s => (
                    <Row key={s.id} on={isOn(s.id)} onOpen={() => setSel({ kind: "shape", id: s.id })}>
                        <ShapeGlyph shape={s} />
                        <span className="vc-mgs-row-text">
                            <span>{s.name || "Untitled"}</span>
                            <small>{!isReady(s) ? s.samples.length < SAMPLES ? `${s.samples.length}/${SAMPLES} drawings` : "Choose an action" : shapeAction(s)!.label}</small>
                        </span>
                    </Row>
                ))}

                <SectionHead title="Your commands" action={<button className="vc-mg-button vc-mg-button-small" onClick={newCommand}>New</button>} />
                {!customs.length && <p className="vc-mgs-muted vc-mgs-empty">React with any emoji, type or send a saved text, open a link, or jump to a channel.</p>}
                {customs.map(a => (
                    <Row key={a.id} on={isOn(a.id)} onOpen={() => setSel({ kind: "action", id: a.id })} onEdit={() => setSel({ kind: "action", id: a.id, redraw: true })} keys={<Keys gesture={bindings[a.id]} />}>
                        <span className="vc-mgs-row-text"><span>{a.label}</span></span>
                    </Row>
                ))}

                {fromPlugins().length > 0 && (
                    <div className="vc-mgs-zone">
                        <SectionHead title="From plugins" count={`${fromPlugins().filter(a => bindings[a.id]).length}/${fromPlugins().length}`} open={open.plugins} onToggle={() => setOpen({ ...open, plugins: !open.plugins })} />
                        {open.plugins && fromPlugins().map(a => (
                            <Row key={a.id} on={isOn(a.id)} onOpen={() => setSel({ kind: "action", id: a.id })} onEdit={() => setSel({ kind: "action", id: a.id, redraw: true })} keys={<Keys gesture={bindings[a.id]} />}>
                                <span className="vc-mgs-row-text"><span>{a.label}</span><small>{a.zone === "messages" ? "On a message" : a.plugin}</small></span>
                            </Row>
                        ))}
                    </div>
                )}

                {ZONES.map(z => {
                    const list = builtins().filter(a => a.zone === z.id);
                    const expanded = open[z.id] ?? false;
                    return (
                        <div key={z.id} className="vc-mgs-zone">
                            <SectionHead title={z.label} count={`${list.filter(a => bindings[a.id]).length}/${list.length}`} open={expanded} onToggle={() => setOpen({ ...open, [z.id]: !expanded })} />
                            {expanded && list.map(a => (
                                <Row key={a.id} on={isOn(a.id)} onOpen={() => setSel({ kind: "action", id: a.id })} onEdit={() => setSel({ kind: "action", id: a.id, redraw: true })} keys={<Keys gesture={bindings[a.id]} />}>
                                    <span className="vc-mgs-row-text"><span>{a.label}</span></span>
                                </Row>
                            ))}
                        </div>
                    );
                })}
            </nav>
            <section className="vc-mgs-detail" aria-live="polite">
                <ErrorBoundary noop>
                    {action ? <ActionView key={`${action.id}${sel.kind === "action" && sel.redraw ? "-r" : ""}`} action={action} startRedraw={sel.kind === "action" && sel.redraw} onDeleted={() => setSel({ kind: "try" })} />
                        : shape ? <ShapeView key={shape.id} shape={shape} onDeleted={() => setSel({ kind: "try" })} />
                            : <TryView />}
                </ErrorBoundary>
            </section>
            <aside className="vc-mgs-side" aria-label="How gestures feel">
                <ErrorBoundary noop><Feel /></ErrorBoundary>
            </aside>
        </div>
    );
}

const FEEL_KEYS = ["trailOpacity", "trailGlow", "trailCap", "trailTaper", "tailLength", "fadeOut", "matchColor", "pillPos", "diagonals", "stepSize", "startDistance", "holdToMove", "readyRing", "cheatSheet", "cheatDelay", "reactEmoji", "trail", "trailColor", "trailColor2", "trailStyle", "trailFade", "trailWidth", "sound", "twoFingerSwipes", "swipeDistance"] as const;

function exportAll() {
    const store = settings.store as any;
    const data = {
        app: "MouseGestures",
        version: 2,
        bindings: settings.store.bindings,
        shapes: settings.store.shapes,
        commands: settings.store.commands,
        options: settings.store.options,
        feel: Object.fromEntries(FEEL_KEYS.map(k => [k, store[k]]))
    };
    saveFile(new File([JSON.stringify(data, null, 2)], "discord-gestures.json", { type: "application/json" }));
}

const validGesture = (g: unknown) => typeof g === "string" && /^[LRUD7913]{1,12}$/.test(g);
const validPoint = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === "number" && Number.isFinite(n));

async function importAll() {
    const file = await chooseFile("application/json");
    if (!file) return;
    let data: any;
    try {
        data = JSON.parse(await file.text());
    } catch {
        return showToast({ text: "That file isn't readable gesture data", variant: "critical" });
    }
    if (data?.app !== "MouseGestures") return showToast({ text: "That file isn't a MouseGestures export", variant: "critical" });

    const kinds = new Set(COMMAND_KINDS.map(k => k.value));
    const commands: Command[] = (Array.isArray(data.commands) ? data.commands : [])
        .filter((c: any) => typeof c?.id === "string" && c.id.startsWith("custom.") && kinds.has(c.kind))
        .map((c: any) => ({ id: c.id, label: String(c.label ?? "").slice(0, 60), kind: c.kind, value: String(c.value ?? "").slice(0, 2000) }));
    const ids = new Set([...builtins().map(a => a.id), ...fromPlugins().map(a => a.id), ...commands.map(c => c.id)]);
    const bindings = Object.fromEntries(Object.entries(data.bindings ?? {}).filter(([id, g]) => ids.has(id) && validGesture(g))) as Record<string, string>;
    const shapes: Shape[] = (Array.isArray(data.shapes) ? data.shapes : [])
        .filter((s: any) => typeof s?.id === "string" && Array.isArray(s.samples) && s.samples.every((x: any) => Array.isArray(x) && x.every(validPoint)))
        .map((s: any) => ({ id: s.id, name: String(s.name ?? "Shape").slice(0, 40), samples: s.samples.slice(0, SAMPLES), action: ids.has(s.action) ? s.action : "" }));
    const options = data.options && typeof data.options === "object" ? Object.fromEntries(Object.entries(data.options).filter(([id, v]) => ids.has(id) && v && typeof v === "object")) : {};

    Alerts.show({
        title: "Replace your gestures?",
        body: `This file has ${Object.keys(bindings).length} gestures, ${shapes.length} shapes and ${commands.length} commands. They replace everything in the studio now, including the Feel settings it carries.`,
        confirmText: "Replace",
        cancelText: "Keep mine",
        onConfirm: () => {
            settings.store.commands = commands;
            settings.store.bindings = bindings;
            settings.store.shapes = shapes;
            settings.store.options = options as any;
            const store = settings.store as any;
            for (const key of FEEL_KEYS) {
                const value = data.feel?.[key];
                if (value !== undefined && typeof value === typeof store[key]) store[key] = value;
            }
            showToast({ text: "Gestures imported", variant: "success" });
        }
    });
}

export function openStudio() {
    openModal(modal => (
        <Modal
            {...modal}
            size="xxl"
            title="Gesture studio"
            subtitle="Draw arrows or your own shapes, and give each one a job in each part of Discord."
            actions={[
                { text: "Done", variant: "primary", onClick: modal.onClose },
                { text: "Export", variant: "secondary", onClick: exportAll },
                { text: "Import", variant: "secondary", onClick: importAll }
            ]}
        >
            <ErrorBoundary noop>
                <Studio />
            </ErrorBoundary>
        </Modal>
    ));
}

export function StudioLauncher() {
    const { bindings, shapes } = settings.use(["bindings", "shapes", "commands"]);
    const all = allActions();
    const set = all.filter(a => bindings[a.id]).length;
    const ready = shapes.filter(isReady).length;

    return (
        <section className="vc-mg-card vc-mgs-launch">
            <div>
                <h2>Gesture studio</h2>
                <p>{set} of {all.length} commands have a gesture, and {ready} {ready === 1 ? "shape is" : "shapes are"} ready. It's also in the Equicord toolbox.</p>
            </div>
            <div className="vc-mgs-launch-actions">
                <button className="vc-mg-button" onClick={() => Alerts.show({
                    title: "Reset every gesture?",
                    body: "Every arrow gesture goes back to the defaults. Your shapes, commands and Feel settings stay.",
                    confirmText: "Reset",
                    cancelText: "Cancel",
                    onConfirm: () => settings.store.bindings = { ...DEFAULT_BINDINGS }
                })}>Reset gestures</button>
                <button className="vc-mg-button vc-mg-button-primary" onClick={openStudio}>Open studio</button>
            </div>
        </section>
    );
}
