/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { findStoreLazy } from "@webpack";
import { React, ReactDOM, useEffect, useLayoutEffect, useMemo, useRef, useState } from "@webpack/common";
import type { KeyboardEvent, MutableRefObject, ReactNode } from "react";

import { themeTarget } from "./bus";
import { colorsOf, hueKey, matchScore, pendingCount, useColorIndex, wantColors } from "./colorIndex";
import { settings } from "./settings";
import { nameStyleColors, themeColorsNow } from "./sources";

export interface GallerySection<T> { section: string; items: T[]; header?: unknown; }

const CategoryStore = findStoreLazy("CollectiblesCategoryStore");

const NAMED: Record<string, string> = { "vc-cs-favourites": "Favourites", "vc-cs-recent": "Recent" };

function labelOf(s: GallerySection<unknown>): string {
    if (typeof s.header === "string") return s.header;
    const label = (s.header as { props?: { label?: unknown; }; } | undefined)?.props?.label;
    if (typeof label === "string") return label;
    return NAMED[s.section] ?? s.section.replace(/[-_]/g, " ").replace(/^\w/, c => c.toUpperCase());
}

type Item = { skuId: string; label?: string; };
type Size = "s" | "m" | "l";
type Status = "owned" | "premium" | "shop";
type Sort = "default" | "colour" | "match";
type Have = "all" | Status;

export interface GalleryProps<T extends Item> {
    kind: string;
    sections: GallerySection<T>[];
    selectedId: string | null | undefined;
    onSelect(item: T | null): void;
    onOpenShop?(): void;
    thumb(item: T, hovered: boolean): ReactNode;
    source?(item: T): string | undefined;
    replay?: boolean;
    shape?: "square" | "card" | "wide";
}

const SPECIAL = new Set(["None", "Shop"]);
const ANIMATED = 12;
const STATUS: Record<Status, string> = { owned: "Owned", premium: "Nitro", shop: "Shop" };
const SIZES: { id: Size; label: string; cells: number; }[] = [
    { id: "s", label: "Small tiles", cells: 3 },
    { id: "m", label: "Medium tiles", cells: 2 },
    { id: "l", label: "Large tiles", cells: 1 }
];
const SORTS: Record<Sort, string> = { default: "Default order", colour: "By colour", match: "Match my theme" };
const HAVES: Record<Have, string> = { all: "All", owned: "Owned", premium: "Nitro", shop: "Shop" };
const MOVES = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

const memory: Record<string, { chip: string; sort: Sort; have: Have; collection: string; }> = {};

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Watcher { io: IntersectionObserver; nodes: Map<Element, (near: boolean) => void>; }
const watchers = new WeakMap<Element, Watcher>();

function watch(node: Element, onChange: (near: boolean) => void) {
    const grid = node.closest(".vc-cg-grid");
    if (!grid) {
        onChange(true);
        return () => { };
    }
    let w = watchers.get(grid);
    if (!w) {
        const nodes = new Map<Element, (near: boolean) => void>();
        const io = new IntersectionObserver(list => {
            for (const e of list) nodes.get(e.target)?.(e.isIntersecting);
        }, { root: grid, rootMargin: "200px 0px" });
        watchers.set(grid, w = { io, nodes });
    }
    const own = w;
    own.nodes.set(node, onChange);
    own.io.observe(node);
    return () => {
        own.io.unobserve(node);
        own.nodes.delete(node);
        if (own.nodes.size) return;
        own.io.disconnect();
        watchers.delete(grid);
    };
}

function vertical(tiles: HTMLElement[], at: number, dir: 1 | -1) {
    const from = tiles[at].getBoundingClientRect();
    const cx = from.left + from.width / 2;
    let best: HTMLElement | undefined;
    let bestDy = Infinity;
    let bestDx = Infinity;
    for (const t of tiles) {
        const r = t.getBoundingClientRect();
        const dy = (r.top - from.top) * dir;
        if (dy <= 1) continue;
        const dx = Math.abs(r.left + r.width / 2 - cx);
        if (dy < bestDy - 1 || (Math.abs(dy - bestDy) <= 1 && dx < bestDx)) {
            best = t;
            bestDy = dy;
            bestDx = dx;
        }
    }
    return best;
}

function flyTo(tile: HTMLElement, stage: HTMLElement) {
    if (reduceMotion()) return;
    const from = tile.getBoundingClientRect();
    const to = stage.getBoundingClientRect();
    const ghost = tile.cloneNode(true) as HTMLElement;
    ghost.classList.remove("vc-cg-in", "vc-cg-on");
    ghost.classList.add("vc-cg-ghost");
    Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
    document.body.appendChild(ghost);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    ghost.animate([
        { transform: "translate(0, 0) scale(1)", opacity: 0.95 },
        { transform: `translate(${dx}px, ${dy}px) scale(1.6)`, opacity: 0 }
    ], { duration: 280, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }).finished.finally(() => ghost.remove());
}

function SizeIcon({ cells }: { cells: number; }) {
    const gap = 2;
    const side = (14 - gap * (cells - 1)) / cells;
    const rects: ReactNode[] = [];
    for (let y = 0; y < cells; y++)
        for (let x = 0; x < cells; x++)
            rects.push(<rect key={`${x}${y}`} x={1 + x * (side + gap)} y={1 + y * (side + gap)} width={side} height={side} rx={cells === 1 ? 3 : 1.5} />);
    return <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{rects}</svg>;
}

function collectionOf(sku: string): { id: string; name: string; } | null {
    const c = CategoryStore.getCategoryForProduct?.(sku);
    return c?.skuId && c?.name ? { id: c.skuId, name: c.name } : null;
}

interface Api<T> { hover(item: T | null): void; choose(item: T, pointer: boolean): void; thumb(item: T, hovered: boolean): ReactNode; capture: boolean; }

interface TileProps<T> { item: T; selected: boolean; status: Status | null; delay: number | null; api: MutableRefObject<Api<T>>; }

function TileImpl<T extends Item>({ item, selected, status, delay, api }: TileProps<T>) {
    const ref = useRef<HTMLButtonElement>(null);
    const [near, setNear] = useState(false);
    const [hovered, setHovered] = useState(false);
    useEffect(() => watch(ref.current!, setNear), []);

    useEffect(() => {
        if (!near || !api.current.capture || colorsOf(item.skuId)) return;
        const t = setTimeout(() => {
            const img = ref.current?.querySelector<HTMLImageElement>('img[src*="collectibles-shop"]');
            if (img) wantColors(item.skuId, img.src);
        }, 600);
        return () => clearTimeout(t);
    }, [near]);

    const enter = () => {
        setHovered(true);
        api.current.hover(item);
    };

    return (
        <button
            ref={ref}
            data-sku={item.skuId}
            role="option"
            aria-selected={selected}
            aria-label={[item.label ?? item.skuId, status && STATUS[status]].filter(Boolean).join(", ")}
            className={classes("vc-cg-tile", selected && "vc-cg-on", SPECIAL.has(item.skuId) && "vc-cg-special", delay != null && "vc-cg-in")}
            style={delay != null ? { animationDelay: `${delay}ms` } : undefined}
            onMouseEnter={enter}
            onFocus={enter}
            onMouseLeave={() => setHovered(false)}
            onBlur={() => setHovered(false)}
            onClick={e => api.current.choose(item, e.detail > 0)}
        >
            {item.skuId === "None" ? (
                <span className="vc-cg-label">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></svg>
                    None
                </span>
            ) : item.skuId === "Shop" ? (
                <span className="vc-cg-label">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0" /></svg>
                    Shop
                </span>
            ) : near ? api.current.thumb(item, hovered) : null}
            {status && (
                <span className="vc-cg-cap" aria-hidden="true">
                    {item.label && <span className="vc-cg-cap-name">{item.label}</span>}
                    <span className={classes("vc-cg-cap-tag", `vc-cg-cap-${status}`)}>{STATUS[status]}</span>
                </span>
            )}
        </button>
    );
}

let MemoTile: typeof TileImpl | null = null;
const tileType = () => MemoTile ??= React.memo(TileImpl) as typeof TileImpl;

function Select<K extends string>({ value, options, onChange, label }: { value: K; options: Record<K, string>; onChange(v: K): void; label: string; }) {
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    const keys = Object.keys(options) as K[];

    useEffect(() => {
        if (!open) return;
        const away = (e: MouseEvent) => {
            if (!box.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", away, true);
        const on = box.current?.querySelector<HTMLElement>('[aria-selected="true"]');
        on?.focus({ preventScroll: true });
        on?.scrollIntoView({ block: "nearest" });
        return () => document.removeEventListener("mousedown", away, true);
    }, [open]);

    const choose = (k: K) => {
        setOpen(false);
        if (k !== value) onChange(k);
    };

    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
        if (!open) return;
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            box.current?.querySelector<HTMLElement>(".vc-cg-select-button")?.focus();
            return;
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const items = [...box.current!.querySelectorAll<HTMLElement>(".vc-cg-select-item")];
        const at = items.indexOf(document.activeElement as HTMLElement);
        items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    };

    return (
        <div ref={box} className={classes("vc-cg-select", open && "vc-cg-select-open")} onKeyDown={onKey}>
            <button type="button" className="vc-cg-select-button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${options[value]}`} title={label} onClick={() => setOpen(o => !o)}>
                <span>{options[value]}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {open && (
                <div className="vc-cg-select-panel" role="listbox" aria-label={label}>
                    {keys.map(k => (
                        <button key={k} type="button" role="option" aria-selected={k === value} className="vc-cg-select-item" onClick={() => choose(k)}>
                            <span>{options[k]}</span>
                            {k === value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function Gallery<T extends Item>({ kind, sections, selectedId, onSelect, onOpenShop, thumb, source, replay, shape = "square" }: GalleryProps<T>) {
    const mem = memory[kind] ??= { chip: "all", sort: "default", have: "all", collection: "all" };
    const [query, setQuery] = useState("");
    const [chip, setChip] = useState(mem.chip);
    const [sort, setSort] = useState<Sort>(mem.sort);
    const [have, setHave] = useState<Have>(mem.have);
    const [collection, setCollection] = useState(mem.collection);
    const [filters, setFilters] = useState(mem.sort !== "default" || mem.chip !== "all" || mem.collection !== "all");
    const [size, setSize] = useState<Size>(() => settings.store.gallerySize?.[kind] ?? "m");
    const [peek, setPeek] = useState<T | null>(null);
    const [stage, setStage] = useState<HTMLElement | null>(null);
    const root = useRef<HTMLDivElement>(null);
    const grid = useRef<HTMLDivElement>(null);
    const dwell = useRef(0);
    const previewing = useRef(false);
    useColorIndex();

    useLayoutEffect(() => {
        const node = root.current;
        if (!node) return;
        node.closest('[class*="modal_"], [class*="rootWithShadow_"]')?.classList.add("vc-cp", `vc-cp-${kind}`, "vc-cg-host");
        let branch: HTMLElement = node;
        let row = node.parentElement;
        while (row && row.children.length === 1 && !row.matches('[class*="modal_"], [class*="rootWithShadow_"], [role="dialog"]')) {
            branch = row;
            row = row.parentElement;
        }
        if (!row) return;
        row.classList.add("vc-cg-row");
        branch.classList.add("vc-cg-branch");
        let first: HTMLElement | null = null;
        for (const child of row.children) {
            if (child === branch || !(child instanceof HTMLElement)) continue;
            child.classList.add("vc-cg-stage");
            first ??= child;
        }
        setStage(first);
    }, [kind]);

    useEffect(() => () => clearTimeout(dwell.current), []);

    useEffect(() => {
        if (!stage) return;
        const fit = () => {
            const card = [...stage.children].find(c => !c.matches(".vc-cg-tag, .vc-cg-replay")) as HTMLElement | undefined;
            if (!card?.offsetWidth) return;
            const cs = getComputedStyle(stage);
            const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
            if (w <= 0 || h <= 0) return;
            stage.style.setProperty("--vc-cg-fit", Math.min(1, w / card.offsetWidth, h / card.offsetHeight).toFixed(3));
        };
        const ro = new ResizeObserver(fit);
        ro.observe(stage);
        for (const c of stage.children) ro.observe(c);
        fit();
        return () => {
            ro.disconnect();
            stage.style.removeProperty("--vc-cg-fit");
        };
    }, [stage]);

    const owned = useMemo(() => new Set(sections.filter(s => s.section === "purchase").flatMap(s => s.items.map(i => i.skuId))), [sections]);
    const premium = useMemo(() => new Set(sections.filter(s => s.section === "premium_purchase").flatMap(s => s.items.map(i => i.skuId))), [sections]);
    const statusOf = (item: T): Status | null => SPECIAL.has(item.skuId) ? null : owned.has(item.skuId) ? "owned" : premium.has(item.skuId) ? "premium" : "shop";

    const collections = useMemo(() => {
        const bySku = new Map<string, string>();
        const names = new Map<string, { name: string; count: number; }>();
        for (const s of sections)
            for (const item of s.items) {
                if (SPECIAL.has(item.skuId) || bySku.has(item.skuId)) continue;
                const c = collectionOf(item.skuId);
                if (!c) continue;
                bySku.set(item.skuId, c.id);
                const entry = names.get(c.id) ?? { name: c.name, count: 0 };
                entry.count++;
                names.set(c.id, entry);
            }
        const options: Record<string, string> = { all: "All collections" };
        for (const [id, { name, count }] of [...names].sort((a, b) => b[1].count - a[1].count)) options[id] = `${name} (${count})`;
        return { bySku, options, many: names.size > 1 };
    }, [sections]);

    const chips = useMemo(() => [
        { id: "all", label: "All" },
        ...sections.filter(s => s.items.some(i => !SPECIAL.has(i.skuId))).map(s => ({ id: s.section, label: labelOf(s) }))
    ], [sections]);

    const activeChip = chips.some(c => c.id === chip) ? chip : "all";
    const activeCollection = collection in collections.options ? collection : "all";
    const activeFilters = +(sort !== "default") + +(activeChip !== "all") + +(activeCollection !== "all");
    const sectionOptions = useMemo(() => Object.fromEntries(chips.map(c => [c.id, c.id === "all" ? "All sections" : c.label])) as Record<string, string>, [chips]);

    const groups = useMemo(() => {
        const q = query.trim().toLowerCase();
        const seen = new Set<string>();
        const filtering = q || activeChip !== "all" || have !== "all" || activeCollection !== "all";
        const pool = activeChip === "all" ? sections : sections.filter(s => s.section === activeChip);
        return pool.map(s => ({
            id: s.section,
            label: labelOf(s),
            items: s.items.filter(item => {
                if (SPECIAL.has(item.skuId)) return !filtering;
                if (q && !(item.label ?? "").toLowerCase().includes(q)) return false;
                if (have !== "all" && statusOf(item) !== have) return false;
                if (activeCollection !== "all" && collections.bySku.get(item.skuId) !== activeCollection) return false;
                if (!q) return true;
                if (seen.has(item.skuId)) return false;
                seen.add(item.skuId);
                return true;
            })
        })).filter(g => g.items.length > 0);
    }, [sections, activeChip, query, have, activeCollection, collections, owned, premium]);

    useEffect(() => {
        if (sort === "default") return;
        for (const g of groups)
            for (const item of g.items)
                if (!SPECIAL.has(item.skuId)) wantColors(item.skuId, source?.(item));
    }, [sort, groups]);

    const targets = sort === "match" ? [...themeColorsNow(themeTarget.guildId), ...nameStyleColors(themeTarget.guildId) ?? []] : [];
    const sorted = sort === "default" ? groups : groups.map(g => {
        const specials = g.items.filter(i => SPECIAL.has(i.skuId));
        const rest = g.items.filter(i => !SPECIAL.has(i.skuId)).map((item, i) => {
            const colors = colorsOf(item.skuId);
            const key = !colors ? Infinity : sort === "colour" ? hueKey(colors) : targets.length ? matchScore(colors, targets) : 0;
            return { item, key, i };
        });
        rest.sort((a, b) => a.key - b.key || a.i - b.i);
        return { ...g, items: [...specials, ...rest.map(r => r.item)] };
    });
    const reading = sort !== "default" ? pendingCount() : 0;

    const chosen = useRef(selectedId);
    if (!previewing.current) chosen.current = selectedId;

    const find = (id: string | null | undefined) => id == null ? null : sections.flatMap(s => s.items).find(i => i.skuId === id) ?? null;
    const current = find(chosen.current);

    function preview(item: T) {
        previewing.current = true;
        setPeek(item);
        onSelect(item);
    }

    const api = useRef<Api<T>>(null as unknown as Api<T>);
    api.current = {
        thumb,
        capture: !source,
        hover(item) {
            clearTimeout(dwell.current);
            if (item && !SPECIAL.has(item.skuId)) {
                dwell.current = window.setTimeout(() => preview(item), 140);
            } else if (previewing.current) {
                dwell.current = window.setTimeout(() => {
                    previewing.current = false;
                    setPeek(null);
                    onSelect(find(chosen.current));
                }, 60);
            }
        },
        choose(item, pointer) {
            clearTimeout(dwell.current);
            previewing.current = false;
            setPeek(null);
            if (item.skuId === "Shop") return onOpenShop?.();
            if (pointer && stage && item.skuId !== "None") {
                const tile = grid.current?.querySelector<HTMLElement>(`[data-sku="${item.skuId}"]`);
                if (tile) flyTo(tile, stage);
            }
            chosen.current = item.skuId === "None" ? null : item.skuId;
            onSelect(item.skuId === "None" ? null : item);
        }
    };

    function shuffle() {
        const all = sorted.flatMap(g => g.items).filter(i => !SPECIAL.has(i.skuId) && i.skuId !== peek?.skuId);
        const mine = all.filter(i => statusOf(i) !== "shop");
        const pool = mine.length ? mine : all;
        if (!pool.length) return;
        const item = pool[Math.floor(Math.random() * pool.length)];
        clearTimeout(dwell.current);
        preview(item);
        const tile = grid.current?.querySelector<HTMLElement>(`[data-sku="${item.skuId}"]`);
        tile?.scrollIntoView({ block: "nearest" });
    }

    function replayStage() {
        const item = peek ?? current;
        if (!item) return;
        onSelect(null);
        requestAnimationFrame(() => onSelect(item));
    }

    function pickSize(next: Size) {
        setSize(next);
        settings.store.gallerySize = { ...settings.store.gallerySize, [kind]: next };
    }

    function move(e: KeyboardEvent<HTMLDivElement>) {
        if (!MOVES.has(e.key) || !grid.current) return;
        const tiles = [...grid.current.querySelectorAll<HTMLElement>(".vc-cg-tile")];
        const at = tiles.indexOf(document.activeElement as HTMLElement);
        let next: HTMLElement | undefined;
        if (at < 0 || e.key === "Home") next = tiles[0];
        else if (e.key === "End") next = tiles[tiles.length - 1];
        else if (e.key === "ArrowLeft") next = tiles[at - 1];
        else if (e.key === "ArrowRight") next = tiles[at + 1];
        else next = vertical(tiles, at, e.key === "ArrowDown" ? 1 : -1);
        if (!next) return;
        e.preventDefault();
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: "nearest" });
    }

    const isSelected = (item: T) => item.skuId === "None" ? chosen.current == null : item.skuId === chosen.current;
    const headed = sorted.length > 1;
    const Tile = tileType();
    const nameOf = (item: T | null) => item?.label ?? (item ? "Unnamed" : "");
    const tag = peek
        ? { mode: "peek", title: "Previewing", name: nameOf(peek) }
        : current
            ? { mode: "pick", title: "Selected", name: nameOf(current) }
            : { mode: "none", title: "Nothing selected", name: "" };

    const clearFilters = () => {
        setQuery("");
        setHave(mem.have = "all");
        setChip(mem.chip = "all");
        setCollection(mem.collection = "all");
        setSort(mem.sort = "default");
    };

    const foot = (
        <div className={classes("vc-cg-tag", `vc-cg-tag-${tag.mode}`, !stage && "vc-cg-tag-inline")} onMouseEnter={() => api.current.hover(null)}>
            <span key={tag.mode + tag.name} className="vc-cg-tag-in" aria-live="polite">
                <span className="vc-cg-tag-title"><span className="vc-cg-tag-dot" aria-hidden="true" />{tag.title}</span>
                {tag.name && <span className="vc-cg-tag-name">{tag.name}</span>}
            </span>
            {current && (
                <button className="vc-cg-now-remove" style={peek ? { visibility: "hidden" } : undefined} onClick={() => api.current.choose({ skuId: "None" } as T, false)}>Remove</button>
            )}
        </div>
    );

    return (
        <div
            ref={root}
            className={classes("vc-cg", `vc-cg-${shape}`, `vc-cg-kind-${kind}`, `vc-cg-size-${size}`)}
            onMouseLeave={() => api.current.hover(null)}
            onBlur={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) api.current.hover(null);
            }}
            onKeyDown={e => {
                const target = e.target as HTMLElement;
                if (e.key !== " " || target.matches("input, select, textarea") || (target.matches("button") && !target.classList.contains("vc-cg-tile"))) return;
                e.preventDefault();
                shuffle();
            }}
        >
            <div className="vc-cg-top">
                <div className="vc-cg-search">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                    <input
                        value={query}
                        placeholder="Search"
                        aria-label="Search"
                        spellCheck={false}
                        onChange={e => setQuery(e.currentTarget.value)}
                        onKeyDown={e => {
                            if (e.key !== "ArrowDown") return;
                            const first = grid.current?.querySelector<HTMLElement>(".vc-cg-tile");
                            if (!first) return;
                            e.preventDefault();
                            first.focus();
                        }}
                    />
                    {query && <button aria-label="Clear search" onClick={() => setQuery("")}>×</button>}
                </div>
                <button className="vc-cg-filter" aria-expanded={filters} onClick={() => setFilters(v => !v)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
                    Filters
                    {activeFilters > 0 && <span className="vc-cg-badge">{activeFilters}</span>}
                </button>
                <button className="vc-cg-shuffle" title="Shuffle: preview something random (Space)" aria-label="Shuffle" onClick={shuffle}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
                </button>
                <div className="vc-cg-sizes" role="radiogroup" aria-label="Tile size">
                    {SIZES.map(s => (
                        <button key={s.id} role="radio" aria-checked={size === s.id} aria-label={s.label} title={s.label} className={classes("vc-cg-size", size === s.id && "vc-cg-size-on")} onClick={() => pickSize(s.id)}>
                            <SizeIcon cells={s.cells} />
                        </button>
                    ))}
                </div>
            </div>
            <div className="vc-cg-chips" role="radiogroup" aria-label="Show">
                {(Object.keys(HAVES) as Have[]).map(k => (
                    <button key={k} role="radio" aria-checked={have === k} className={classes("vc-cg-chip", have === k && "vc-cg-chip-on")} onClick={() => setHave(mem.have = k)}>
                        {HAVES[k]}
                    </button>
                ))}
            </div>
            {filters && (
                <div className="vc-cg-tools">
                    <Select value={sort} options={SORTS} label="Sort" onChange={v => setSort(mem.sort = v)} />
                    {chips.length > 2 && <Select value={activeChip} options={sectionOptions} label="Section" onChange={v => setChip(mem.chip = v)} />}
                    {collections.many && <Select value={activeCollection} options={collections.options} label="Collection" onChange={v => setCollection(mem.collection = v)} />}
                    {reading > 0 && <span className="vc-cg-reading">Reading colours, {reading} left</span>}
                    {sort !== "default" && !source && <span className="vc-cg-reading">Frames get their colours as you scroll past them</span>}
                </div>
            )}
            <div ref={grid} className="vc-cg-grid" role="listbox" aria-label="Items" onKeyDown={move}>
                {sorted.length === 0 && (
                    <div className="vc-cg-empty">
                        Nothing matches.
                        <button className="vc-cg-clear" onClick={clearFilters}>Clear filters</button>
                    </div>
                )}
                {sorted.map((g, gi) => (
                    <React.Fragment key={g.id}>
                        {headed && (
                            <div className={classes("vc-cg-head", gi === 0 && "vc-cg-head-first")} role="presentation">
                                <span>{g.label}</span>
                                <span className="vc-cg-count">{g.items.filter(i => !SPECIAL.has(i.skuId)).length}</span>
                            </div>
                        )}
                        {g.items.map((item, i) => (
                            <Tile<T>
                                key={`${g.id}:${item.skuId}`}
                                item={item}
                                selected={isSelected(item)}
                                status={statusOf(item)}
                                delay={i < ANIMATED ? Math.min(i, 8) * 20 : null}
                                api={api}
                            />
                        ))}
                    </React.Fragment>
                ))}
            </div>
            {stage ? ReactDOM.createPortal(
                <>
                    {foot}
                    {replay && (peek ?? current) && (
                        <button className="vc-cg-replay" title="Replay the animation" aria-label="Replay the animation" onClick={replayStage}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /></svg>
                        </button>
                    )}
                </>,
                stage
            ) : foot}
        </div>
    );
}
