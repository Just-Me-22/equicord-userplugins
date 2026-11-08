/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { chooseFile } from "@utils/web";
import { FluxDispatcher } from "@webpack/common";

type Fit = "fill" | "fit" | "stretch" | "center" | "tile";
type Placement = { x: number; y: number; zoom: number; blur: number; dim: number; fit: Fit; };
type Picture = { id: string; name: string; placement?: Partial<Placement>; };
type Slider = "zoom" | "blur" | "dim";

const ROOT = '[class*="baseLayer_"] > div[class*="base_"]';
const KNOBS = {
    x: "--lp-wallpaper-x",
    y: "--lp-wallpaper-y",
    zoom: "--lp-wallpaper-zoom",
    blur: "--lp-wallpaper-blur",
    dim: "--lp-wallpaper-dim",
    fit: "--lp-wallpaper-fit",
    repeat: "--lp-wallpaper-repeat"
};

const FITS: Record<Fit, { label: string; title: string; size: string; repeat: string; }> = {
    fill: { label: "Fill", title: "Covers the window, cropping what does not fit", size: "cover", repeat: "no-repeat" },
    fit: { label: "Fit", title: "Shows the whole picture, with bars where it is short", size: "contain", repeat: "no-repeat" },
    stretch: { label: "Stretch", title: "Squeezes the picture to the window's exact shape", size: "100% 100%", repeat: "no-repeat" },
    center: { label: "Center", title: "Keeps the picture at its own size", size: "auto", repeat: "no-repeat" },
    tile: { label: "Tile", title: "Repeats the picture at its own size", size: "auto", repeat: "repeat" }
};

function fitOf(size: string, repeat: string): Fit {
    if (size === "contain") return "fit";
    if (size === "100% 100%") return "stretch";
    if (size === "auto") return repeat.startsWith("repeat") ? "tile" : "center";
    return "fill";
}

const logger = new Logger("WallpaperPlacer");
const store = DataStore.createStore("WallpaperPlacer", "pictures");
const INDEX = "index";
const fileKey = (id: string) => `file:${id}`;

const settings = definePluginSettings({
    place: {
        type: OptionType.COMPONENT,
        description: "Drag the theme's wallpaper into place, zoom it with the scroll wheel, set its blur and dim, and add your own pictures and GIFs. Ctrl+Alt+W opens it from anywhere.",
        component: () => (
            <div style={{ display: "flex", gap: 8 }}>
                <Button onClick={() => { FluxDispatcher.dispatch({ type: "LAYER_POP_ALL" }); setTimeout(open, 350); }}>
                    Place the wallpaper
                </Button>
                <Button variant="secondary" onClick={forget}>Go back to the theme's wallpaper</Button>
            </div>
        )
    },
    picture: { type: OptionType.STRING, default: "", hidden: true, description: "" },
    placed: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    x: { type: OptionType.NUMBER, default: 50, hidden: true, description: "" },
    y: { type: OptionType.NUMBER, default: 50, hidden: true, description: "" },
    zoom: { type: OptionType.NUMBER, default: 1, hidden: true, description: "" },
    blur: { type: OptionType.NUMBER, default: 0, hidden: true, description: "" },
    dim: { type: OptionType.NUMBER, default: 0.5, hidden: true, description: "" },
    fit: { type: OptionType.STRING, default: "fill", hidden: true, description: "" }
});

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const readIndex = () => DataStore.get<Picture[]>(INDEX, store).then(list => list ?? []);
const writeIndex = (list: Picture[]) => DataStore.set(INDEX, list, store);

const urls = new Map<string, string>();
async function urlFor(id: string) {
    const known = urls.get(id);
    if (known) return known;
    const blob = await DataStore.get<Blob>(fileKey(id), store);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
}

function percent(value: string) {
    if (value.endsWith("%")) return parseFloat(value);
    return { left: 0, top: 0, right: 100, bottom: 100 }[value] ?? 50;
}

function theme() {
    const cs = getComputedStyle(document.documentElement);
    const read = (knob: string) => cs.getPropertyValue(knob).trim();
    return {
        src: /url\(["']?([^"')]+)["']?\)/.exec(read("--lp-wallpaper"))?.[1] ?? "",
        light: parseFloat(read("--lp-wallpaper-light")) || 0,
        placement: {
            x: percent(read(KNOBS.x)),
            y: percent(read(KNOBS.y)),
            zoom: parseFloat(read(KNOBS.zoom)) || 1,
            blur: parseFloat(read(KNOBS.blur)) || 0,
            dim: parseFloat(read(KNOBS.dim)) || 0,
            fit: fitOf(read(KNOBS.fit) || "cover", read(KNOBS.repeat) || "no-repeat")
        } as Placement
    };
}

function knobs(p: Placement) {
    return [
        `${KNOBS.x}: ${p.x.toFixed(1)}%;`,
        `${KNOBS.y}: ${p.y.toFixed(1)}%;`,
        `${KNOBS.zoom}: ${Math.round(p.zoom * 100) / 100};`,
        `${KNOBS.blur}: ${p.blur}px;`,
        `${KNOBS.dim}: ${p.dim};`,
        `${KNOBS.fit}: ${FITS[p.fit].size};`,
        `${KNOBS.repeat}: ${FITS[p.fit].repeat};`
    ];
}

const withFit = (p: Partial<Placement> & Omit<Placement, "fit">): Placement => ({ ...p, fit: p.fit && p.fit in FITS ? p.fit : "fill" });

const savedTheme = (): Placement => {
    const { x, y, zoom, blur, dim, fit } = settings.store;
    return withFit({ x, y, zoom, blur, dim, fit: fit as Fit });
};

let saved: HTMLStyleElement | null = null;

async function applySaved() {
    let lines: string[] = [];
    const id = settings.store.picture;
    if (id) {
        const entry = (await readIndex()).find(e => e.id === id);
        const src = entry && await urlFor(id);
        if (entry && src) lines = [`--lp-wallpaper: url("${src}");`, ...knobs(withFit({ ...theme().placement, ...entry.placement }))];
        else settings.store.picture = "";
    }
    if (!lines.length && settings.store.placed) lines = knobs(savedTheme());

    if (!saved) {
        saved = document.createElement("style");
        saved.id = "vc-wpp-saved";
    }
    if (!saved.isConnected) document.head.append(saved);
    saved.textContent = lines.length ? `${ROOT} {\n  ${lines.join("\n  ")}\n}` : "";
}

function forget() {
    settings.store.placed = false;
    settings.store.picture = "";
    applySaved();
}

const STYLE = `
html.vc-wpp-see ${ROOT} > * { opacity: 0.25 !important; }
#vc-wpp-overlay { position: fixed; inset: 0; z-index: 2147483000; cursor: grab; }
#vc-wpp-overlay.vc-wpp-dragging { cursor: grabbing; }
#vc-wpp-card {
    position: absolute; right: 24px; bottom: 24px; width: 300px; cursor: default;
    display: grid; gap: 10px; padding: 14px 16px; border-radius: 12px;
    background: var(--background-floating, #111); color: var(--text-normal, #fff);
    font: 14px/1.4 var(--font-primary, sans-serif); box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
}
#vc-wpp-card p { margin: 0; color: var(--text-muted, #aaa); font-size: 12px; }
#vc-wpp-card label { display: grid; gap: 2px; font-size: 12px; color: var(--text-muted, #aaa); }
#vc-wpp-card input[type="range"] { width: 100%; accent-color: var(--brand-500, #5865f2); }
#vc-wpp-card .vc-wpp-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
#vc-wpp-card button {
    padding: 5px 10px; border-radius: 8px; border: 0; cursor: pointer; font: inherit;
    background: var(--background-modifier-hover, #333); color: inherit;
}
#vc-wpp-card button.vc-wpp-save { background: var(--brand-500, #5865f2); color: #fff; }
#vc-wpp-card .vc-wpp-gallery { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
#vc-wpp-card .vc-wpp-tile {
    position: relative; aspect-ratio: 1; padding: 0; border-radius: 8px; overflow: hidden;
    display: grid; place-items: center; font-size: 11px; cursor: pointer;
    background: var(--background-modifier-hover, #333); outline: 2px solid transparent;
}
#vc-wpp-card .vc-wpp-tile.vc-wpp-on { outline-color: var(--brand-500, #5865f2); }
#vc-wpp-card .vc-wpp-tile img { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
#vc-wpp-card .vc-wpp-remove {
    position: absolute; top: 2px; right: 2px; padding: 0 5px; border-radius: 6px;
    font-size: 11px; line-height: 16px; background: rgb(0 0 0 / 0.65); color: #fff;
}
#vc-wpp-card .vc-wpp-remove.vc-wpp-sure { background: var(--status-danger, #da373c); }
#vc-wpp-card .vc-wpp-fits { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
#vc-wpp-card .vc-wpp-fits button { padding: 4px 0; font-size: 12px; }
#vc-wpp-card .vc-wpp-fits button.vc-wpp-on { background: var(--brand-500, #5865f2); color: #fff; }
`;

const CARD = `
    <div id="vc-wpp-card">
        <p>Drag to move the picture, scroll to zoom. Enter keeps it, Esc puts it back.</p>
        <div class="vc-wpp-gallery"></div>
        <div class="vc-wpp-fits"></div>
        <label>Zoom <input type="range" data-k="zoom" min="1" max="4" step="0.01"></label>
        <label>Blur <input type="range" data-k="blur" min="0" max="10" step="0.5"></label>
        <label>Dim <input type="range" data-k="dim" min="0" max="0.9" step="0.01"></label>
        <label class="vc-wpp-row"><input type="checkbox" data-see checked> See through the panels</label>
        <div class="vc-wpp-row">
            <button data-act="save" class="vc-wpp-save">Keep</button>
            <button data-act="cancel">Put it back</button>
            <button data-act="copy">Copy as CSS</button>
        </div>
    </div>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string>; }, ...children: Node[]) {
    const node = document.createElement(tag);
    const { dataset, ...rest } = props;
    Object.assign(node, rest);
    if (dataset) Object.assign(node.dataset, dataset);
    node.append(...children);
    return node;
}

let session = false;
let teardown: (() => void) | null = null;

async function open() {
    if (session) return;
    session = true;

    const base = theme();
    let list = await readIndex();
    let current = settings.store.picture;

    const placementFor = (id: string, from: Placement): Placement => {
        if (!id) return settings.store.placed ? savedTheme() : { ...base.placement };
        const stored = list.find(e => e.id === id)?.placement;
        return withFit({ x: 50, y: 50, zoom: 1, blur: from.blur, dim: from.dim, fit: "fill", ...stored });
    };

    let p = placementFor(current, base.placement);
    let src = current ? await urlFor(current) : base.src;
    if (!src) {
        current = "";
        src = base.src;
        p = placementFor("", base.placement);
    }

    let natural: { w: number; h: number; } | null = null;
    const measure = (from: string) => {
        natural = null;
        const img = new Image();
        img.onload = () => { natural = { w: img.naturalWidth, h: img.naturalHeight }; };
        img.src = from;
    };
    measure(src);

    const style = el("style", { textContent: STYLE + "\n.vc-wpp-live::before {}" });
    document.head.append(style);
    const live = ([...style.sheet!.cssRules].pop() as CSSStyleRule).style;
    const layer = document.querySelector(ROOT);
    layer?.classList.add("vc-wpp-live");
    document.documentElement.classList.add("vc-wpp-see");

    const overlay = el("div", { id: "vc-wpp-overlay", innerHTML: CARD });
    document.body.append(overlay);
    const card = overlay.querySelector<HTMLElement>("#vc-wpp-card")!;
    const gallery = card.querySelector<HTMLElement>(".vc-wpp-gallery")!;
    const fits = card.querySelector<HTMLElement>(".vc-wpp-fits")!;
    const sliders = [...card.querySelectorAll<HTMLInputElement>("input[data-k]")];

    fits.append(...(Object.keys(FITS) as Fit[]).map(fit =>
        el("button", { textContent: FITS[fit].label, title: FITS[fit].title, dataset: { fit } })));

    const preview = () => {
        const pos = `${p.x.toFixed(2)}% ${p.y.toFixed(2)}%`;
        const wash = (rgb: string, a: number) => `linear-gradient(rgba(${rgb}, ${a}), rgba(${rgb}, ${a}))`;
        live.setProperty("background-image", `${wash("255, 255, 255", base.light)}, ${wash("0, 0, 0", p.dim)}, url("${src}")`, "important");
        live.setProperty("background-size", `cover, cover, ${FITS[p.fit].size}`, "important");
        live.setProperty("background-repeat", FITS[p.fit].repeat, "important");
        live.setProperty("background-position", `center, center, ${pos}`, "important");
        live.setProperty("transform-origin", pos, "important");
        live.setProperty("transform", `scale(${p.zoom})`, "important");
        live.setProperty("filter", `blur(${p.blur}px)`, "important");
        live.setProperty("inset", `${-3 * p.blur}px`, "important");
    };
    const sync = () => {
        for (const s of sliders) s.value = String(p[s.dataset.k as Slider]);
        for (const b of fits.querySelectorAll<HTMLElement>("[data-fit]")) b.classList.toggle("vc-wpp-on", b.dataset.fit === p.fit);
        preview();
    };

    const renderGallery = async () => {
        const tiles: HTMLElement[] = [el("button", { className: "vc-wpp-tile" + (current ? "" : " vc-wpp-on"), textContent: "Theme", title: "The theme's own wallpaper", dataset: { pick: "" } })];
        for (const entry of list) {
            const url = await urlFor(entry.id);
            if (!url) continue;
            tiles.push(el("button", { className: "vc-wpp-tile" + (entry.id === current ? " vc-wpp-on" : ""), title: entry.name, dataset: { pick: entry.id } },
                el("img", { src: url, alt: "" }),
                el("span", { className: "vc-wpp-remove", textContent: "×", title: "Remove", dataset: { remove: entry.id } })
            ));
        }
        tiles.push(el("button", { className: "vc-wpp-tile", textContent: "+", title: "Add a picture or GIF", dataset: { act: "add" } }));
        gallery.replaceChildren(...tiles);
    };

    const pick = async (id: string) => {
        const next = id ? await urlFor(id) : base.src;
        if (!next) return;
        p = placementFor(id, p);
        current = id;
        src = next;
        measure(src);
        sync();
        renderGallery();
    };

    const add = async () => {
        const file = await chooseFile("image/*");
        if (!file) return;
        const id = crypto.randomUUID();
        await DataStore.set(fileKey(id), file, store);
        list = [...list, { id, name: file.name }];
        await writeIndex(list);
        await pick(id);
    };

    const remove = async (id: string) => {
        await DataStore.del(fileKey(id), store);
        list = list.filter(e => e.id !== id);
        await writeIndex(list);
        const url = urls.get(id);
        if (url) URL.revokeObjectURL(url);
        urls.delete(id);
        if (settings.store.picture === id) {
            settings.store.picture = "";
            await applySaved();
        }
        if (current === id) await pick("");
        else renderGallery();
    };

    sync();
    renderGallery();

    for (const s of sliders) s.addEventListener("input", () => {
        p[s.dataset.k as Slider] = parseFloat(s.value);
        preview();
    });
    card.querySelector<HTMLInputElement>("input[data-see]")!
        .addEventListener("change", e => document.documentElement.classList.toggle("vc-wpp-see", (e.target as HTMLInputElement).checked));

    card.addEventListener("click", e => {
        const target = e.target as HTMLElement;
        const removeId = target.dataset.remove;
        if (removeId) {
            e.stopPropagation();
            if (target.classList.contains("vc-wpp-sure")) remove(removeId).catch(err => logger.error("could not remove the picture", err));
            else {
                target.classList.add("vc-wpp-sure");
                target.textContent = "Remove?";
            }
            return;
        }
        const tile = target.closest<HTMLElement>("[data-pick]");
        if (tile) { pick(tile.dataset.pick!); return; }
        const fit = target.closest<HTMLElement>("[data-fit]")?.dataset.fit as Fit | undefined;
        if (fit) { p.fit = fit; sync(); return; }
        const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
        if (act === "add") add().catch(err => logger.error("could not add the picture", err));
        else if (act === "save") close(true);
        else if (act === "cancel") close(false);
        else if (act === "copy") copyWithToast(knobs(p).map(line => "  " + line).join("\n"), "Copied the wallpaper lines");
    });

    let last: { x: number; y: number; } | null = null;
    overlay.addEventListener("pointerdown", e => {
        if (card.contains(e.target as Node)) return;
        last = { x: e.clientX, y: e.clientY };
        overlay.setPointerCapture(e.pointerId);
        overlay.classList.add("vc-wpp-dragging");
    });
    overlay.addEventListener("pointermove", e => {
        if (!last || !natural) return;
        const W = innerWidth, H = innerHeight;
        const { w, h } = natural;
        const scale = p.fit === "fill" ? Math.max(W / w, H / h) : p.fit === "fit" ? Math.min(W / w, H / h) : 1;
        const [shownW, shownH] = p.fit === "stretch" ? [W, H] : [w * scale, h * scale];
        const slackX = W - shownW * p.zoom, slackY = H - shownH * p.zoom;
        if (Math.abs(slackX) > 0.5) p.x = clamp(p.x + (e.clientX - last.x) / slackX * 100, 0, 100);
        if (Math.abs(slackY) > 0.5) p.y = clamp(p.y + (e.clientY - last.y) / slackY * 100, 0, 100);
        last = { x: e.clientX, y: e.clientY };
        preview();
    });
    const stop = () => { last = null; overlay.classList.remove("vc-wpp-dragging"); };
    overlay.addEventListener("pointerup", stop);
    overlay.addEventListener("pointercancel", stop);
    overlay.addEventListener("wheel", e => {
        if (card.contains(e.target as Node)) return;
        e.preventDefault();
        p.zoom = clamp(p.zoom * Math.exp(-e.deltaY * 0.0015), 1, 4);
        sync();
    }, { passive: false });

    const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Enter" && e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        close(e.key === "Enter");
    };
    addEventListener("keydown", onKey, true);

    async function close(save: boolean) {
        removeEventListener("keydown", onKey, true);
        overlay.remove();
        teardown = null;
        if (save) {
            if (current) {
                list = list.map(e => e.id === current ? { ...e, placement: { ...p } } : e);
                await writeIndex(list);
            } else {
                Object.assign(settings.store, p, { placed: true });
            }
            settings.store.picture = current;
            await applySaved().catch(err => logger.error("could not save the wallpaper", err));
        }
        layer?.classList.remove("vc-wpp-live");
        document.documentElement.classList.remove("vc-wpp-see");
        style.remove();
        session = false;
    }
    teardown = () => { close(false); };
}

function onShortcut(e: KeyboardEvent) {
    if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === "KeyW") {
        e.preventDefault();
        open().catch(err => {
            session = false;
            logger.error("could not open the placer", err);
        });
    }
}

export default definePlugin({
    name: "WallpaperPlacer",
    description: "Drag, zoom, blur and dim a theme's wallpaper by hand instead of guessing pixel offsets, and swap in your own pictures and GIFs. Works with themes that use the --lp-wallpaper knobs, like LilyPichu Revived.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    settings,

    start() {
        applySaved().catch(err => logger.error("could not apply the saved wallpaper", err));
        addEventListener("keydown", onShortcut);
    },

    stop() {
        removeEventListener("keydown", onShortcut);
        teardown?.();
        saved?.remove();
        saved = null;
        for (const url of urls.values()) URL.revokeObjectURL(url);
        urls.clear();
    }
});
