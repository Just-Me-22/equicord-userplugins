/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { copyToClipboard } from "@utils/clipboard";
import { classes } from "@utils/misc";
import { findByCodeLazy, findStoreLazy } from "@webpack";
import { Modal, openModal, React, useEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

import { StudioTarget, themeTarget } from "./bus";
import { accentIdeas, contrast, extractPalette, makeReadable, MOODS, parseThemeCode, pickPair, readability, themeCode, toHex } from "./color";
import { RealPreview } from "./preview";
import { settings } from "./settings";
import { bannerImage, currentEffect, effectPalette, loadSources, nameStyleColors, readPixels, sampleCover, Source } from "./sources";
import { ColorField, Segmented, Tuner } from "./ui";

const setPending = findByCodeLazy('type:"USER_PROFILE_SETTINGS_SET_PENDING_CHANGES"', '"themeColors"in');
const UserProfileSettingsStore = findStoreLazy("UserProfileSettingsStore");

export type ThemeStudioProps = StudioTarget;

type Pair = [number, number];
type Slot = 0 | 1;
type Tab = "edit" | "ideas" | "match" | "saved";

const TABS: Record<Tab, string> = {
    edit: "Edit",
    ideas: "Ideas",
    match: "Match",
    saved: "Saved"
};

const SLOT_NAMES = ["Primary", "Accent"] as const;

const memory = { slot: 0 as Slot, tab: "edit" as Tab, matchName: false, view: "popout" as "popout" | "compact" | "message" };
let sampleInto: ((c: number) => void) | null = null;
const history = { list: [] as Pair[], at: -1, ab: null as Pair | null, liveUntil: 0 };

const COLOR_COUNT: Record<number, number> = { 2: 2, 7: 5, 8: 4 };

interface Match { id: string; label: string; image?: string; colors?: number[]; effect?: string; }

const samePair = (a: Pair, b: Pair) => a[0] === b[0] && a[1] === b[1];

function PairChip({ pair, title, active, onClick, onRemove }: { pair: Pair; title?: string; active?: boolean; onClick(): void; onRemove?(): void; }) {
    return (
        <span className={classes("vc-nts-chip", active && "vc-nts-chip-on")}>
            <button className="vc-nts-chip-face" title={title ?? `${toHex(pair[0])} / ${toHex(pair[1])}`} onClick={onClick}>
                <span style={{ background: toHex(pair[0]) }} />
                <span style={{ background: toHex(pair[1]) }} />
            </button>
            {onRemove && <button className="vc-nts-chip-x" aria-label="Remove" onClick={onRemove}>×</button>}
        </span>
    );
}

export function ThemeStudio({ guildId, primary, secondary }: ThemeStudioProps) {
    const [slot, setSlot] = useState<Slot>(memory.slot);
    const [tab, setTab] = useState<Tab>(memory.tab);
    const [matches, setMatches] = useState<Match[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [matchName, setMatchName] = useState(memory.matchName);
    const [code, setCode] = useState("");
    const [, rerender] = useState(0);
    const saved = settings.use(["savedThemes"]).savedThemes;

    const pair: Pair = [primary, secondary];
    const write = (next: Pair) => setPending({ guildId: guildId ?? void 0, themeColors: next });

    function commit(next: Pair, live = false) {
        if (samePair(next, pair)) return;
        const now = Date.now();
        if (live && now < history.liveUntil && history.at >= 0) {
            history.list[history.at] = next;
            history.liveUntil = now + 700;
            write(next);
            rerender(n => n + 1);
            return;
        }
        history.liveUntil = live ? now + 700 : 0;
        if (history.at < 0 || !samePair(history.list[history.at], pair)) {
            history.list.splice(history.at + 1);
            history.list.push(pair);
            history.at = history.list.length - 1;
        }
        history.ab = pair;
        history.list.splice(history.at + 1);
        history.list.push(next);
        history.at = history.list.length - 1;
        if (history.list.length > 40) {
            history.list.shift();
            history.at--;
        }
        write(next);
        rerender(n => n + 1);
    }

    function jump(i: number) {
        history.at = i;
        write(history.list[i]);
        rerender(n => n + 1);
    }

    const setSlotColor = (c: number) => commit(slot === 0 ? [c, secondary] : [primary, c], true);
    sampleInto = c => commit(slot === 0 ? [c, secondary] : [primary, c]);

    useEffect(() => {
        loadSources(guildId).then(sources => {
            const list: Match[] = sources.filter((s: Source) => s.image).map(s => ({ id: s.id, label: s.label, image: s.image }));
            const names = nameStyleColors(guildId);
            if (names) list.push({ id: "name", label: "Name style", colors: names });
            const effect = currentEffect(guildId);
            if (effect) list.push({ id: "effect", label: "Profile effect", image: effect.thumbnail, effect: effect.skuId });
            setMatches(list);
        }, () => setMatches([]));
    }, []);

    function matchNameStyle(palette: number[]) {
        const pending = UserProfileSettingsStore.getPendingChanges?.(guildId ?? void 0) ?? {};
        const current = "pendingDisplayNameStyles" in pending ? pending.pendingDisplayNameStyles : (UserStore.getCurrentUser() as any)?.displayNameStyles;
        if (!current?.effectId) return setNote("Pick a display name style first, then this can match it.");
        const count = COLOR_COUNT[current.effectId] ?? 1;
        const colors = Array.from({ length: count }, (_, i) => palette[i % palette.length]);
        setPending({ guildId: guildId ?? void 0, displayNameStyles: { ...current, colors } });
    }

    async function match(m: Match) {
        setNote(null);
        if (m.colors) return commit(pickPair(m.colors));
        setBusy(m.id);
        try {
            const palette = m.effect ? await effectPalette(m.effect) : extractPalette(await readPixels(m.image!), 6, "weight");
            if (!palette.length) return setNote("That image has no opaque pixels to read.");
            commit(pickPair(palette));
            if (matchName) matchNameStyle(palette);
        } catch (e) {
            setNote(String((e as Error).message ?? e));
        } finally {
            setBusy(null);
        }
    }

    const { ratio, text } = readability(primary, secondary);
    const verdict = ratio >= 7 ? "Very readable" : ratio >= 4.5 ? "Readable" : ratio >= 3 ? "Hard to read" : "Unreadable";
    const recent = history.list.slice(-12);
    const offset = history.list.length - recent.length;

    return (
        <>
            <div className="vc-nss-body">
                <div className="vc-nts-pair" role="radiogroup" aria-label="Theme colour to edit">
                    {SLOT_NAMES.map((name, i) => (
                        <button key={name} role="radio" aria-checked={slot === i} className={classes("vc-nts-slot", slot === i && "vc-nts-slot-on")} onClick={() => setSlot(memory.slot = i as Slot)}>
                            <span className="vc-nts-swatch" style={{ background: toHex(pair[i]) }} />
                            <span className="vc-nts-slot-text">
                                <span className="vc-nss-muted">{name}</span>
                                <span className="vc-nts-hex">{toHex(pair[i])}</span>
                            </span>
                        </button>
                    ))}
                </div>

                <div className="vc-nss-row">
                    <button className="vc-nss-chip" onClick={() => commit([secondary, primary])}>Swap</button>
                    <button className="vc-nss-chip" disabled={!history.ab} title="Flip between this theme and the one before your last change" onClick={() => history.ab && commit(history.ab)}>A/B</button>
                    <button className="vc-nss-chip" disabled={history.at <= 0} onClick={() => jump(history.at - 1)}>Undo</button>
                    <button className="vc-nss-chip" disabled={history.at >= history.list.length - 1} onClick={() => jump(history.at + 1)}>Redo</button>
                </div>
                {recent.length > 1 && (
                    <div className="vc-nts-timeline" aria-label="Changes this session">
                        {recent.map((p, i) => <PairChip key={i + offset} pair={p} active={i + offset === history.at} onClick={() => jump(i + offset)} />)}
                    </div>
                )}

                <Segmented value={tab} options={TABS} onChange={t => setTab(memory.tab = t)} label="Theme tools" />

                <div className="vc-nss-panel">
                    {tab === "edit" && (
                        <>
                            <div className="vc-nss-row">
                                <span className="vc-nss-muted vc-nss-label">{SLOT_NAMES[slot]}</span>
                                <ColorField value={pair[slot]} label={SLOT_NAMES[slot]} onChange={setSlotColor} />
                            </div>
                            <Tuner key={slot} color={pair[slot]} onChange={setSlotColor} />
                        </>
                    )}

                    {tab === "ideas" && (
                        <>
                            <span className="vc-nss-muted">Accents that suit your primary colour</span>
                            <div className="vc-nss-recipes">
                                {accentIdeas(primary).map(idea => (
                                    <button key={idea.key} className={classes("vc-nss-recipe", idea.color === secondary && "vc-nss-recipe-on")} onClick={() => commit([primary, idea.color])}>
                                        <span className="vc-nss-strip"><span style={{ background: toHex(primary) }} /><span style={{ background: toHex(idea.color) }} /></span>
                                        <span className="vc-nss-recipe-name">{idea.label}</span>
                                        <span className="vc-nss-muted">{toHex(idea.color)}</span>
                                    </button>
                                ))}
                            </div>
                            <span className="vc-nss-muted">Moods</span>
                            <div className="vc-nss-recipes">
                                {Object.entries(MOODS).map(([name, p]) => (
                                    <button key={name} className={classes("vc-nss-recipe", samePair(p, pair) && "vc-nss-recipe-on")} onClick={() => commit(p)}>
                                        <span className="vc-nss-strip"><span style={{ background: toHex(p[0]) }} /><span style={{ background: toHex(p[1]) }} /></span>
                                        <span className="vc-nss-recipe-name">{name}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    {tab === "match" && (
                        <>
                            {!matches ? <span className="vc-nss-muted">Reading your profile…</span> : (
                                <div className="vc-nss-sources">
                                    {matches.map(m => (
                                        <button key={m.id} className="vc-nss-source" disabled={busy != null} onClick={() => match(m)} title={`Theme from your ${m.label.toLowerCase()}`}>
                                            <span className="vc-nss-thumb" style={m.colors
                                                ? { background: `linear-gradient(135deg, ${m.colors.map(toHex).join(", ")})` }
                                                : m.image ? { backgroundImage: `url("${m.image}")` } : undefined} />
                                            <span>{busy === m.id ? "Reading…" : m.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <label className="vc-nss-row vc-nts-check">
                                <input type="checkbox" checked={matchName} onChange={e => setMatchName(memory.matchName = e.currentTarget.checked)} />
                                <span>Also set my name style colours from the same image</span>
                            </label>
                        </>
                    )}

                    {tab === "saved" && (
                        <>
                            <div className="vc-nts-timeline">
                                {saved.length === 0 && <span className="vc-nss-muted">Nothing saved yet. Save the theme you have now to keep it.</span>}
                                {saved.map((p, i) => (
                                    <PairChip key={i} pair={p} active={samePair(p, pair)} onClick={() => commit(p)} onRemove={() => { settings.store.savedThemes = saved.filter((_, j) => j !== i); }} />
                                ))}
                            </div>
                            <div className="vc-nss-row">
                                <button className="vc-nss-chip" disabled={saved.some(p => samePair(p, pair))} onClick={() => { settings.store.savedThemes = [...saved, pair]; }}>Save current</button>
                                <button className="vc-nss-chip" onClick={async () => { await copyToClipboard(themeCode(pair)); setNote("Copied. Anyone with this plugin can paste it."); }}>Copy code</button>
                            </div>
                            <div className="vc-nss-row">
                                <input className="vc-nss-hex vc-nts-code" placeholder="theme:#2b1a3d,#ff9e7a" value={code} onChange={e => setCode(e.currentTarget.value)} />
                                <button className="vc-nss-chip" onClick={() => {
                                    const p = parseThemeCode(code);
                                    if (!p) return setNote("That code needs two hex colours.");
                                    setNote(null);
                                    setCode("");
                                    commit(p);
                                }}>Apply code</button>
                            </div>
                        </>
                    )}

                    {note && <div className="vc-nss-muted">{note}</div>}
                </div>

                <div className={classes("vc-nts-read", ratio < 4.5 && "vc-nts-read-low")}>
                    <span className="vc-nts-read-chip" style={{ background: `linear-gradient(to bottom, ${toHex(primary)}, ${toHex(secondary)})`, color: toHex(text) }}>Aa</span>
                    <span className="vc-nts-read-text">
                        <span>{verdict}</span>
                        <span className="vc-nss-muted">Text contrast {ratio.toFixed(1)} : 1{ratio < 4.5 ? ", aim for 4.5" : ""}</span>
                    </span>
                    {ratio < 4.5 && <button className="vc-nss-chip" onClick={() => commit(makeReadable(primary, secondary))}>Fix it</button>}
                </div>
            </div>
        </>
    );
}

function LiveThemeStudio({ guildId, primary, secondary }: ThemeStudioProps) {
    const pending = useStateFromStores([UserProfileSettingsStore], () => UserProfileSettingsStore.getPendingChanges?.(guildId ?? void 0)?.pendingThemeColors as number[] | null | undefined);
    const pair = pending?.length === 2 ? pending : [primary, secondary];
    return <ThemeStudio guildId={guildId} primary={pair[0]} secondary={pair[1]} />;
}

type View = "popout" | "compact" | "message";

const VIEWS: Record<View, string> = { popout: "Popout", compact: "Compact", message: "Message box" };

const ICON_PATHS = {
    light: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
    pick: "M20.7 3.3a3.1 3.1 0 0 0-4.4 0l-2.6 2.6-1.4-1.4-1.4 1.4 1.4 1.4-7.9 7.9A2 2 0 0 0 4 16.6V20h3.4a2 2 0 0 0 1.4-.6l7.9-7.9 1.4 1.4 1.4-1.4-1.4-1.4 2.6-2.6a3.1 3.1 0 0 0 0-4.2Z",
    check: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    replay: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5"
};

function ToolIcon({ d }: { d: string; }) {
    return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

function parseRgb(css: string): number | null {
    const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(css);
    if (!m || (m[4] != null && Number(m[4]) < 0.3)) return null;
    return Number(m[1]) << 16 | Number(m[2]) << 8 | Number(m[3]);
}

const mixRgb = (a: number, b: number, t: number) => [16, 8, 0].reduce((out, s) => out | Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t) << s, 0);

function flagHardText(root: HTMLElement, pair: Pair): number {
    const box = root.getBoundingClientRect();
    let flagged = 0;
    for (const el of root.querySelectorAll<HTMLElement>("*")) {
        if (el.closest('[class*="banner_"]')) continue;
        const hasText = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent!.trim().length > 0);
        if (!hasText) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const fg = parseRgb(getComputedStyle(el).color);
        if (fg == null) continue;
        const bg = mixRgb(pair[0], pair[1], Math.min(1, Math.max(0, (r.top + r.height / 2 - box.top) / box.height)));
        if (contrast(fg, bg) >= 4.5) continue;
        el.classList.add("vc-nts-flag");
        flagged++;
    }
    setTimeout(() => root.querySelectorAll(".vc-nts-flag").forEach(el => el.classList.remove("vc-nts-flag")), 2600);
    return flagged;
}

type Layer = "banner" | "effect" | "frame" | "decoration" | "avatar";

const LAYERS: Record<Layer, string> = { banner: "Banner", effect: "Effect", frame: "Frame", decoration: "Decoration", avatar: "Avatar" };

function PreviewPanel({ guildId, primary, secondary }: ThemeStudioProps) {
    const [hidden, setHidden] = useState<Set<Layer>>(() => new Set());
    const [lit, setLit] = useState<Layer | null>(null);
    const [view, setView] = useState<View>(memory.view);
    const [light, setLight] = useState(false);
    const [picking, setPicking] = useState(false);
    const [restart, setRestart] = useState(0);
    const [note, setNote] = useState<string | null>(null);
    const box = useRef<HTMLDivElement>(null);
    const pending = useStateFromStores([UserProfileSettingsStore], () => UserProfileSettingsStore.getPendingChanges?.(guildId ?? void 0)?.pendingThemeColors as number[] | null | undefined);
    const pair: Pair = pending?.length === 2 ? [pending[0], pending[1]] : [primary, secondary];

    async function pickAt(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        const banner = (e.target as Element).closest<HTMLElement>('[class*="banner_"]');
        if (!banner || !box.current?.contains(banner)) return setNote("Click on your banner to take a colour from it.");
        const src = await bannerImage(guildId);
        if (!src) return setNote("You don't have a banner image to pick from.");
        const r = banner.getBoundingClientRect();
        try {
            const c = await sampleCover(src, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r.width, r.height);
            sampleInto?.(c);
            setNote(`Took ${toHex(c)} from your banner.`);
        } catch (err) {
            setNote(String((err as Error).message ?? err));
        }
        setPicking(false);
    }

    return (
        <div className="vc-nts-modal-preview">
            <Segmented value={view} options={VIEWS} onChange={v => setView(memory.view = v)} label="Preview style" />
            <div className="vc-nts-ptools">
                <button className={classes("vc-nss-icon", light && "vc-nts-ptool-on")} aria-pressed={light} title="See it on Discord's light mode" aria-label="Light mode check" onClick={() => setLight(!light)}><ToolIcon d={ICON_PATHS.light} /></button>
                <button className={classes("vc-nss-icon", picking && "vc-nts-ptool-on")} aria-pressed={picking} title="Pick a colour from your banner" aria-label="Pick from banner" onClick={() => { setPicking(!picking); setNote(picking ? null : "Click your banner to take a colour for the selected slot."); }}><ToolIcon d={ICON_PATHS.pick} /></button>
                <button className="vc-nss-icon" title="Outline text that's hard to read" aria-label="Check readability" onClick={() => {
                    if (!box.current) return;
                    const n = flagHardText(box.current, pair);
                    setNote(n ? `${n} bit${n === 1 ? "" : "s"} of text ${n === 1 ? "is" : "are"} hard to read, outlined for a moment.` : "Everything on your profile reads clearly.");
                }}><ToolIcon d={ICON_PATHS.check} /></button>
                <button className="vc-nss-icon" title="Replay your profile effect" aria-label="Replay effect" onClick={() => setRestart(n => n + 1)}><ToolIcon d={ICON_PATHS.replay} /></button>
            </div>
            <div className="vc-nts-layers" role="group" aria-label="Show or hide layers">
                {(Object.keys(LAYERS) as Layer[]).map(l => (
                    <button
                        key={l}
                        aria-pressed={!hidden.has(l)}
                        title={hidden.has(l) ? `Show the ${LAYERS[l].toLowerCase()}` : `Hide the ${LAYERS[l].toLowerCase()}`}
                        className={classes("vc-nts-layer", hidden.has(l) && "vc-nts-layer-off")}
                        onMouseEnter={() => setLit(l)}
                        onMouseLeave={() => setLit(null)}
                        onFocus={() => setLit(l)}
                        onBlur={() => setLit(null)}
                        onClick={() => setHidden(prev => {
                            const next = new Set(prev);
                            if (next.has(l)) next.delete(l); else next.add(l);
                            return next;
                        })}
                    >
                        {LAYERS[l]}
                    </button>
                ))}
            </div>
            <div
                ref={box}
                className={classes("vc-nts-stagebox", light ? "theme-light" : "theme-dark", picking && "vc-nts-picking", ...[...hidden].map(l => `vc-nts-hide-${l}`), lit && `vc-nts-lit-${lit}`)}
                onClickCapture={picking ? pickAt : undefined}
                aria-label="Your profile with these colours"
            >
                <ErrorBoundary noop>
                    <RealPreview guildId={guildId} view={view} restart={restart} />
                </ErrorBoundary>
            </div>
            {note && <span className="vc-nss-muted vc-nts-pnote">{note}</span>}
        </div>
    );
}

function openThemeStudio(props: ThemeStudioProps) {
    openModal(modal => (
        <Modal
            {...modal}
            size="lg"
            title="Theme studio"
            actions={[{ text: "Done", variant: "primary", onClick: modal.onClose }]}
        >
            <div className="vc-nts-modal">
                <ErrorBoundary noop>
                    <div className="vc-nts-modal-tools">
                        <LiveThemeStudio {...props} />
                    </div>
                </ErrorBoundary>
                <ErrorBoundary noop>
                    <PreviewPanel {...props} />
                </ErrorBoundary>
            </div>
        </Modal>
    ));
}

export function ThemeStudioLauncher(props: ThemeStudioProps) {
    themeTarget.guildId = props.guildId;

    return (
        <button className="vc-nts-launch" onClick={() => openThemeStudio(props)}>
            <span className="vc-nts-launch-dots"><span style={{ background: toHex(props.primary) }} /><span style={{ background: toHex(props.secondary) }} /></span>
            <span>Studio</span>
        </button>
    );
}
