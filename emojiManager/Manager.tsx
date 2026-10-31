/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RenderModalProps } from "@vencord/discord-types";
import { FluxDispatcher, Modal, React, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { Asset, assetsOf, Capacity, fitInto, GuildInfo, Kind, listGuilds, takenNames } from "./data";
import { Dropdown, Option } from "./Dropdown";
import { enqueue, forget, HistoryEntry, Mode, readHistory, restore, stopQueue, Task, useQueue } from "./queue";
import { cl, GuildIcon } from "./ui";

const DRAG_THRESHOLD = 5;
const EDGE_SCROLL = 48;

interface Review {
    target: GuildInfo | null;
    assets: Asset[];
    mode: Mode;
}

interface Drag {
    assets: Asset[];
    x: number;
    y: number;
    over: string | null;
    copy: boolean;
}

interface Marquee {
    x: number;
    y: number;
    w: number;
    h: number;
}

function useStoreTick() {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const bump = () => setTick(value => value + 1);
        const events = ["GUILD_EMOJIS_UPDATE", "GUILD_STICKERS_UPDATE", "GUILD_UPDATE"];
        events.forEach(event => FluxDispatcher.subscribe(event, bump));
        return () => events.forEach(event => FluxDispatcher.unsubscribe(event, bump));
    }, []);
    return tick;
}

const plural = (count: number, one: string, many = one + "s") => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const kindLabel = (kind: Kind, count: number) => kind === "emoji" ? plural(count, "emoji", "emoji") : plural(count, "sticker");

function describeAssets(assets: Asset[]) {
    const emoji = assets.filter(asset => asset.kind === "emoji").length;
    const stickers = assets.length - emoji;
    return [emoji && kindLabel("emoji", emoji), stickers && kindLabel("sticker", stickers)].filter(Boolean).join(" and ");
}

function fitOption(guild: GuildInfo, assets: Asset[], label = guild.name): Option {
    const { fits } = fitInto(guild.capacity, assets);
    if (!assets.length) return { id: guild.id, label, guild };
    if (fits.length === assets.length) return { id: guild.id, label, guild, detail: `All ${assets.length} fit`, tone: "ok" };
    if (!fits.length) return { id: guild.id, label, guild, detail: "No room", tone: "muted" };
    return { id: guild.id, label, guild, detail: `Fits ${fits.length} of ${assets.length}`, tone: "warn" };
}

function Meter({ label, used, max }: { label: string; used: number; max: number; }) {
    const full = used >= max;
    return (
        <span className={cl("meter", { "meter-full": full })} title={`${label}: ${used} of ${max}`}>
            <span className={cl("meter-label")}>{label}</span>
            <span className={cl("meter-count")}>{used}/{max}</span>
        </span>
    );
}

function Meters({ capacity }: { capacity: Capacity; }) {
    return (
        <span className={cl("meters")}>
            <Meter label="Static" used={capacity.static} max={capacity.maxEmoji} />
            <Meter label="Animated" used={capacity.animated} max={capacity.maxEmoji} />
            <Meter label="Stickers" used={capacity.stickers} max={capacity.maxStickers} />
        </span>
    );
}

function Rail({ guilds, current, drag, railRef, onSelect }: {
    guilds: GuildInfo[];
    current: string;
    drag: Drag | null;
    railRef: React.RefObject<HTMLElement | null>;
    onSelect(id: string): void;
}) {
    return (
        <nav className={cl("rail")} aria-label="Servers" ref={railRef}>
            {guilds.map(guild => {
                const droppable = Boolean(drag) && guild.canCreate && guild.id !== current;
                const over = droppable && drag!.over === guild.id;
                const fit = over ? fitInto(guild.capacity, drag!.assets) : null;
                return (
                    <button
                        key={guild.id}
                        data-drop-guild={guild.id}
                        className={cl("rail-item", {
                            "rail-current": guild.id === current,
                            "rail-locked": !guild.canCreate,
                            "rail-target": droppable,
                            "rail-over": over,
                            "rail-partial": Boolean(fit?.overflow.length)
                        })}
                        onClick={() => onSelect(guild.id)}
                    >
                        <GuildIcon guild={guild} />
                        <span className={cl("rail-text")}>
                            <span className={cl("rail-name")}>{guild.name}</span>
                            {fit
                                ? <span className={cl("rail-fit")}>{fit.overflow.length ? `Fits ${fit.fits.length} of ${drag!.assets.length}` : `All ${drag!.assets.length} fit`} · {drag!.copy ? "copy" : "move"}</span>
                                : <Meters capacity={guild.capacity} />}
                        </span>
                    </button>
                );
            })}
        </nav>
    );
}

function ReviewPanel({ review, guilds, source, onClose }: { review: Review; guilds: GuildInfo[]; source: GuildInfo | undefined; onClose(): void; }) {
    const [mode, setMode] = useState<Mode>(review.mode);
    const [target, setTarget] = useState<string | null>(review.target?.id ?? null);
    const [overflowTo, setOverflowTo] = useState<string>("");

    const destination = guilds.find(guild => guild.id === target) ?? null;
    const isDelete = mode === "delete";
    const fit = destination && !isDelete ? fitInto(destination.capacity, review.assets) : { fits: review.assets, overflow: [] };
    const others = guilds.filter(guild => guild.canCreate && guild.id !== destination?.id && guild.id !== source?.id && fitInto(guild.capacity, fit.overflow).fits.length > 0);
    const second = others.find(guild => guild.id === overflowTo) ?? null;
    const secondFit = second ? fitInto(second.capacity, fit.overflow) : null;

    const renames = useMemo(() => {
        if (!destination || isDelete) return [];
        const taken = { emoji: takenNames(destination.id, "emoji"), sticker: takenNames(destination.id, "sticker") };
        return fit.fits.filter(asset => taken[asset.kind].has(asset.name.toLowerCase())).map(asset => asset.name);
    }, [destination, isDelete, fit.fits.length]);

    const total = fit.fits.length + (secondFit?.fits.length ?? 0);
    const verb = isDelete ? "Delete" : mode === "move" ? "Move" : "Copy";
    const canMove = Boolean(source?.canManage);

    function confirm() {
        const tasks: Task[] = isDelete
            ? review.assets.map(asset => ({ asset, mode }))
            : [
                ...fit.fits.map(asset => ({ asset, mode, target: destination!.id })),
                ...(secondFit?.fits ?? []).map(asset => ({ asset, mode, target: second!.id }))
            ];
        enqueue(tasks);
        onClose();
    }

    return (
        <div className={cl("review-backdrop")} onClick={onClose}>
            <div className={cl("review")} role="dialog" aria-label={`${verb} ${describeAssets(review.assets)}`} onClick={event => event.stopPropagation()}>
                <div className={cl("review-head")}>
                    <span className={cl("review-title")}>{verb} {describeAssets(review.assets)}</span>
                    <div className={cl("review-thumbs")}>
                        {review.assets.slice(0, 12).map(asset => <img key={asset.key} src={`${asset.url}?size=48`} alt="" />)}
                        {review.assets.length > 12 && <span className={cl("review-more")}>+{review.assets.length - 12}</span>}
                    </div>
                </div>

                {!isDelete && (
                    <>
                        <div className={cl("review-row")}>
                            <span className={cl("review-label")}>Action</span>
                            <div className={cl("segmented")} role="group" aria-label="Action">
                                <button className={cl("segment", { "segment-active": mode === "move" })} disabled={!canMove} title={canMove ? undefined : "You can't remove expressions from this server"} onClick={() => setMode("move")}>Move</button>
                                <button className={cl("segment", { "segment-active": mode === "copy" })} onClick={() => setMode("copy")}>Copy</button>
                            </div>
                        </div>

                        <div className={cl("review-row")}>
                            <span className={cl("review-label")}>To</span>
                            <Dropdown
                                wide
                                label="Choose a server"
                                value={target}
                                options={guilds.filter(guild => guild.canCreate && guild.id !== source?.id).map(guild => fitOption(guild, review.assets))}
                                onPick={setTarget}
                            />
                        </div>
                    </>
                )}

                {destination && !isDelete && (
                    <ul className={cl("review-notes")}>
                        <li className={cl({ "note-ok": !fit.overflow.length, "note-warn": fit.overflow.length > 0 })}>
                            {fit.overflow.length ? `${fit.fits.length} of ${review.assets.length} fit in ${destination.name}` : `All ${review.assets.length} fit in ${destination.name}`}
                        </li>
                        {fit.overflow.length > 0 && (
                            <li className={cl("note-row")}>
                                <span>The other {fit.overflow.length}:</span>
                                <Dropdown
                                    wide
                                    label="Leave them here"
                                    value={overflowTo}
                                    options={[{ id: "", label: "Leave them here" }, ...others.map(guild => fitOption(guild, fit.overflow, `Send to ${guild.name}`))]}
                                    onPick={setOverflowTo}
                                />
                            </li>
                        )}
                        {secondFit && secondFit.overflow.length > 0 && <li className={cl("note-warn")}>{secondFit.overflow.length} still don't fit anywhere and stay where they are</li>}
                        {renames.length > 0 && <li>{plural(renames.length, "name")} already taken there get a number added: {renames.slice(0, 4).join(", ")}{renames.length > 4 ? "…" : ""}</li>}
                        {mode === "move" && <li className={cl("note-muted")}>Originals are deleted only after the copy succeeds, and kept in History so you can put them back.</li>}
                    </ul>
                )}

                {isDelete && (
                    <ul className={cl("review-notes")}>
                        <li className={cl("note-warn")}>They're removed from {source?.name}.</li>
                        <li className={cl("note-muted")}>A copy of each is kept in History so you can put it back.</li>
                    </ul>
                )}

                <div className={cl("review-actions")}>
                    <button className={cl("button")} onClick={onClose}>Cancel</button>
                    <button
                        className={cl("button", isDelete ? "button-danger" : "button-primary")}
                        disabled={!isDelete && (!destination || total === 0)}
                        onClick={confirm}
                    >
                        {verb} {isDelete ? review.assets.length : total}
                    </button>
                </div>
            </div>
        </div>
    );
}

function QueueBar() {
    const queue = useQueue();
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        if (!queue.waitUntil) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [queue.waitUntil]);

    if (!queue.running && !queue.problems.length) return null;
    const wait = queue.waitUntil ? Math.max(0, Math.ceil((queue.waitUntil - now) / 1000)) : 0;

    return (
        <div className={cl("queue")}>
            <div className={cl("queue-line")}>
                <span className={cl("queue-text")}>
                    {queue.running
                        ? wait ? `Discord asked to wait ${wait}s · ${queue.done} of ${queue.total}` : `Working on ${queue.current ?? "…"} · ${queue.done} of ${queue.total}`
                        : `${queue.done - queue.problems.length} of ${queue.total} done`}
                </span>
                <div className={cl("bar")}><div className={cl("bar-fill")} style={{ width: `${queue.total ? queue.done / queue.total * 100 : 0}%` }} /></div>
                {queue.running && <button className={cl("button")} onClick={stopQueue}>Stop</button>}
            </div>
            {queue.problems.length > 0 && (
                <details className={cl("problems")}>
                    <summary>{plural(queue.problems.length, "problem")}</summary>
                    <ul>{queue.problems.map((problem, i) => <li key={i}><strong>{problem.name}</strong> {problem.error}</li>)}</ul>
                </details>
            )}
        </div>
    );
}

function HistoryView({ onBack }: { onBack(): void; }) {
    const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const urls = useMemo(() => new Map<HistoryEntry, string>(), [entries]);

    const load = () => readHistory().then(setEntries);
    useEffect(() => { void load(); }, []);
    useEffect(() => () => urls.forEach(url => URL.revokeObjectURL(url)), [urls]);

    const urlOf = (entry: HistoryEntry) => {
        let url = urls.get(entry);
        if (!url) urls.set(entry, url = URL.createObjectURL(entry.blob));
        return url;
    };

    async function put(entry: HistoryEntry) {
        setBusy(`${entry.key}:${entry.at}`);
        setError(null);
        try {
            await restore(entry);
            await load();
        } catch (err) {
            setError(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className={cl("history")}>
            <div className={cl("history-head")}>
                <button className={cl("button")} onClick={onBack}>Back</button>
                <span>Moved and deleted expressions, newest first. Putting one back uploads it to the server it came from.</span>
            </div>
            {error && <div className={cl("history-error")}>{error}</div>}
            <div className={cl("history-list")}>
                {entries?.map(entry => {
                    const id = `${entry.key}:${entry.at}`;
                    return (
                        <div key={id} className={cl("history-row")}>
                            <img src={urlOf(entry)} alt="" className={cl("history-thumb", { "history-sticker": entry.kind === "sticker" })} />
                            <span className={cl("history-text")}>
                                <span className={cl("history-name")}>{entry.name}</span>
                                <span className={cl("history-meta")}>
                                    {entry.mode === "move" ? `Moved from ${entry.fromName} to ${entry.toName}` : `Deleted from ${entry.fromName}`} · {new Date(entry.at).toLocaleString()}
                                </span>
                            </span>
                            <button className={cl("button")} disabled={busy !== null} onClick={() => void put(entry)}>{busy === id ? "Putting back…" : "Put back"}</button>
                            <button className={cl("icon-button")} aria-label={`Forget ${entry.name}`} title="Forget" onClick={() => void forget(entry.key, entry.at).then(load)}>×</button>
                        </div>
                    );
                })}
                {entries && !entries.length && <div className={cl("empty")}>Nothing moved or deleted yet</div>}
            </div>
        </div>
    );
}

export function Manager({ modalProps, initialGuild }: { modalProps: RenderModalProps; initialGuild?: string; }) {
    const tick = useStoreTick();
    const guilds = useMemo(listGuilds, [tick]);
    const [guildId, setGuildId] = useState(() => initialGuild && guilds.some(guild => guild.id === initialGuild) ? initialGuild : guilds[0]?.id ?? "");
    const [kind, setKind] = useState<Kind>("emoji");
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [anchor, setAnchor] = useState<string | null>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [marquee, setMarquee] = useState<Marquee | null>(null);
    const [review, setReview] = useState<Review | null>(null);
    const [view, setView] = useState<"grid" | "history">("grid");

    const rootRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const railRef = useRef<HTMLElement>(null);
    const tiles = useRef(new Map<string, HTMLElement>());
    const swallowClick = useRef(false);

    const source = guilds.find(guild => guild.id === guildId);
    const all = useMemo(() => guildId ? assetsOf(guildId, kind) : [], [guildId, kind, tick]);
    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle ? all.filter(asset => asset.name.toLowerCase().includes(needle)) : all;
    }, [all, query]);
    const chosen = all.filter(asset => selected.has(asset.key));

    useEffect(() => {
        setSelected(new Set());
        setAnchor(null);
    }, [guildId, kind]);

    useEffect(() => {
        const keys = new Set(all.map(asset => asset.key));
        setSelected(current => {
            const next = new Set([...current].filter(key => keys.has(key)));
            return next.size === current.size ? current : next;
        });
    }, [all]);

    function clickTile(event: React.MouseEvent, asset: Asset) {
        if (swallowClick.current) {
            swallowClick.current = false;
            return;
        }
        if (event.shiftKey && anchor) {
            const from = visible.findIndex(one => one.key === anchor);
            const to = visible.findIndex(one => one.key === asset.key);
            const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1).map(one => one.key);
            setSelected(current => new Set([...(event.ctrlKey || event.metaKey ? current : []), ...range]));
            return;
        }
        if (event.ctrlKey || event.metaKey) {
            setSelected(current => {
                const next = new Set(current);
                if (!next.delete(asset.key)) next.add(asset.key);
                return next;
            });
        } else {
            setSelected(new Set([asset.key]));
        }
        setAnchor(asset.key);
    }

    function startMarquee(event: React.PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || event.target !== event.currentTarget) return;
        const grid = gridRef.current!;
        const bounds = grid.getBoundingClientRect();
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        const base = additive ? new Set(selected) : new Set<string>();
        const startX = event.clientX - bounds.left + grid.scrollLeft;
        const startY = event.clientY - bounds.top + grid.scrollTop;
        let moved = false;

        grid.setPointerCapture(event.pointerId);

        const move = (e: PointerEvent) => {
            const x = e.clientX - bounds.left + grid.scrollLeft;
            const y = e.clientY - bounds.top + grid.scrollTop;
            if (!moved && Math.hypot(x - startX, y - startY) < 4) return;
            moved = true;

            const rect = { x: Math.min(x, startX), y: Math.min(y, startY), w: Math.abs(x - startX), h: Math.abs(y - startY) };
            setMarquee(rect);

            const next = new Set(base);
            for (const asset of visible) {
                const tile = tiles.current.get(asset.key);
                if (!tile) continue;
                const left = tile.offsetLeft;
                const top = tile.offsetTop;
                if (left < rect.x + rect.w && left + tile.offsetWidth > rect.x && top < rect.y + rect.h && top + tile.offsetHeight > rect.y) next.add(asset.key);
            }
            setSelected(next);
        };

        const end = () => {
            grid.removeEventListener("pointermove", move);
            grid.removeEventListener("pointerup", end);
            grid.removeEventListener("pointercancel", end);
            setMarquee(null);
            if (!moved && !additive) setSelected(new Set());
        };

        grid.addEventListener("pointermove", move);
        grid.addEventListener("pointerup", end);
        grid.addEventListener("pointercancel", end);
    }

    function pressTile(event: React.PointerEvent, asset: Asset) {
        if (event.button !== 0) return;
        const startX = event.clientX;
        const startY = event.clientY;
        let group: Asset[] | null = null;
        let scroller = 0;

        const stopScroll = () => {
            cancelAnimationFrame(scroller);
            scroller = 0;
        };

        const scrollRail = (clientY: number) => {
            stopScroll();
            const rail = railRef.current;
            if (!rail) return;
            const bounds = rail.getBoundingClientRect();
            const step = clientY < bounds.top + EDGE_SCROLL ? -12 : clientY > bounds.bottom - EDGE_SCROLL ? 12 : 0;
            if (!step) return;
            const tick = () => {
                rail.scrollTop += step;
                scroller = requestAnimationFrame(tick);
            };
            scroller = requestAnimationFrame(tick);
        };

        const move = (e: PointerEvent) => {
            if (!group) {
                if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
                group = selected.has(asset.key) ? chosen : [asset];
                if (!selected.has(asset.key)) {
                    setSelected(new Set([asset.key]));
                    setAnchor(asset.key);
                }
            }

            const root = rootRef.current!.getBoundingClientRect();
            const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-drop-guild]");
            const id = hit?.dataset.dropGuild ?? null;
            const target = guilds.find(guild => guild.id === id);
            const valid = target && target.canCreate && target.id !== guildId ? target.id : null;

            const overRail = railRef.current?.contains(e.target as Node) || Boolean(hit);
            if (overRail) scrollRail(e.clientY);
            else stopScroll();

            setDrag({ assets: group, x: e.clientX - root.left, y: e.clientY - root.top, over: valid, copy: e.ctrlKey || e.altKey || !source?.canManage });
        };

        const up = (e: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
            stopScroll();
            if (!group) return;

            swallowClick.current = true;
            setTimeout(() => { swallowClick.current = false; });

            const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-drop-guild]");
            const target = guilds.find(guild => guild.id === hit?.dataset.dropGuild);
            setDrag(null);
            if (target && target.canCreate && target.id !== guildId) {
                setReview({ target, assets: group, mode: e.ctrlKey || e.altKey || !source?.canManage ? "copy" : "move" });
            }
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
    }

    function onKey(event: React.KeyboardEvent) {
        if ((event.target as HTMLElement).tagName === "INPUT" || review) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
            event.preventDefault();
            setSelected(new Set(visible.map(asset => asset.key)));
        } else if (event.key === "Escape" && selected.size) {
            event.stopPropagation();
            setSelected(new Set());
        } else if (event.key === "Delete" && chosen.length && source?.canManage) {
            setReview({ target: null, assets: chosen, mode: "delete" });
        }
    }

    const moveTargets = guilds.filter(guild => guild.canCreate && guild.id !== guildId);

    return (
        <Modal {...modalProps} size="xxl" title="Emoji and stickers">
            <div className={cl("root", { dragging: Boolean(drag) })} onKeyDown={onKey} tabIndex={-1} ref={rootRef}>
                <Rail
                    guilds={guilds}
                    current={guildId}
                    drag={drag}
                    railRef={railRef}
                    onSelect={id => { setGuildId(id); setView("grid"); }}
                />

                <section className={cl("main")}>
                    {view === "history"
                        ? <HistoryView onBack={() => setView("grid")} />
                        : (
                            <>
                                <div className={cl("toolbar")}>
                                    <div className={cl("segmented")} role="group" aria-label="Type">
                                        {(["emoji", "sticker"] as Kind[]).map(value => (
                                            <button key={value} className={cl("segment", { "segment-active": kind === value })} aria-pressed={kind === value} onClick={() => setKind(value)}>
                                                {value === "emoji" ? "Emoji" : "Stickers"}
                                            </button>
                                        ))}
                                    </div>
                                    <input className={cl("input")} type="search" placeholder={`Search ${source?.name ?? ""}`} value={query} onChange={event => setQuery(event.currentTarget.value)} />
                                    <span className={cl("count")}>{selected.size ? `${selected.size} selected` : kindLabel(kind, all.length)}</span>
                                    <Dropdown
                                        label={source?.canManage ? "Move to…" : "Copy to…"}
                                        disabled={!chosen.length || !moveTargets.length}
                                        options={moveTargets.map(guild => fitOption(guild, chosen))}
                                        onPick={id => setReview({ target: guilds.find(guild => guild.id === id) ?? null, assets: chosen, mode: source?.canManage ? "move" : "copy" })}
                                    />
                                    {source?.canManage && (
                                        <button className={cl("button", "button-danger-quiet")} disabled={!chosen.length} onClick={() => setReview({ target: null, assets: chosen, mode: "delete" })}>Delete</button>
                                    )}
                                    <button className={cl("button")} onClick={() => setView("history")}>History</button>
                                </div>

                                <div
                                    ref={gridRef}
                                    className={cl("grid", `grid-${kind}`, { "grid-dragging": Boolean(drag) })}
                                    onPointerDown={startMarquee}
                                    role="listbox"
                                    aria-multiselectable="true"
                                    aria-label={`${kind === "emoji" ? "Emoji" : "Stickers"} in ${source?.name ?? ""}`}
                                >
                                    {visible.map(asset => (
                                        <div
                                            key={asset.key}
                                            ref={element => { if (element) tiles.current.set(asset.key, element); else tiles.current.delete(asset.key); }}
                                            role="option"
                                            aria-selected={selected.has(asset.key)}
                                            title={asset.name}
                                            className={cl("tile", { "tile-selected": selected.has(asset.key), "tile-animated": asset.animated })}
                                            onPointerDown={event => pressTile(event, asset)}
                                            onClick={event => clickTile(event, asset)}
                                        >
                                            <img src={`${asset.url}?size=${kind === "emoji" ? 96 : 160}`} alt="" draggable={false} loading="lazy" />
                                            <span className={cl("tile-name")}>{asset.name}</span>
                                        </div>
                                    ))}
                                    {!visible.length && (
                                        <div className={cl("empty")}>
                                            {query ? "Nothing matches" : `No ${kind === "emoji" ? "emoji" : "stickers"} here`}
                                        </div>
                                    )}
                                    {marquee && <div className={cl("marquee")} style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
                                </div>

                                <div className={cl("hint")}>
                                    Drag onto a server to move · hold Ctrl to copy
                                </div>
                            </>
                        )}

                    <QueueBar />
                </section>

                {review && <ReviewPanel review={review} guilds={guilds} source={source} onClose={() => setReview(null)} />}

                {drag && (
                    <div className={cl("ghost", { "ghost-over": Boolean(drag.over) })} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
                        {drag.assets.slice(0, 3).map((asset, i) => (
                            <img key={asset.key} src={`${asset.url}?size=${asset.kind === "emoji" ? 96 : 160}`} alt="" style={{ zIndex: 3 - i, translate: `${i * 6}px ${i * -6}px` }} />
                        ))}
                        {drag.assets.length > 1 && <span className={cl("ghost-count")}>{drag.assets.length}</span>}
                        {drag.copy && <span className={cl("ghost-copy")}>+</span>}
                    </div>
                )}
            </div>
        </Modal>
    );
}
