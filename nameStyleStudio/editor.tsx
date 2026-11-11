/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { findByCodeLazy, findStoreLazy } from "@webpack";
import { FluxDispatcher, useEffect, useLayoutEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";
import type { ReactNode } from "react";

import { openBannerGuide } from "./bannerGuide";
import { openBioStudio } from "./bio";
import { emit, themeTarget, useBus } from "./bus";
import { MOODS, toHex } from "./color";
import { suggest, Suggestion } from "./recommend";
import { openTryOn } from "./tryon";

const logger = new Logger("NameStyleStudio");
const setPending = findByCodeLazy('type:"USER_PROFILE_SETTINGS_SET_PENDING_CHANGES"', '"themeColors"in');
const UserProfileSettingsStore = findStoreLazy("UserProfileSettingsStore");

interface SectionKind { id: string; match: RegExp; keys: string[]; }

const KINDS: SectionKind[] = [
    { id: "nameplate", match: /nameplate/i, keys: ["pendingNameplate"] },
    { id: "avatar", match: /avatar|decoration/i, keys: ["pendingAvatar", "pendingAvatarDecoration"] },
    { id: "name", match: /display name|name style/i, keys: ["pendingDisplayNameStyles", "pendingGlobalName", "pendingNickname"] },
    { id: "theme", match: /theme|banner/i, keys: ["pendingThemeColors", "pendingBanner", "pendingAccentColor"] },
    { id: "effect", match: /effect|frame/i, keys: ["pendingProfileEffect", "pendingProfileFrame"] }
];

const kindOf = (heading: unknown) => KINDS.find(k => typeof heading === "string" && k.match.test(heading));

const closed = new Set<string>();

function draftKeys() {
    const out: Record<string, unknown> = {};
    const guild = UserProfileSettingsStore.selectedGuildId;
    for (const scope of [void 0, guild]) {
        if (scope === null) continue;
        const pending = UserProfileSettingsStore.getPendingChanges(scope) ?? {};
        for (const [k, v] of Object.entries(pending)) if (v !== void 0) out[k] = v;
    }
    return out;
}

let held: { guild: string | undefined; snapshot: Record<string, unknown>; }[] | null = null;

function beginCompare() {
    if (held) return;
    const guild = UserProfileSettingsStore.selectedGuildId ?? void 0;
    held = [];
    for (const scope of guild ? [void 0, guild] : [void 0]) {
        const snapshot = { ...(UserProfileSettingsStore.getPendingChanges(scope) ?? {}) };
        held.push({ guild: scope, snapshot });
        const blank = Object.fromEntries(Object.keys(snapshot).map(k => [k, void 0]));
        FluxDispatcher.dispatch({ type: "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES", guildId: scope, ...blank });
    }
}

function endCompare() {
    if (!held) return;
    for (const { guild, snapshot } of held)
        FluxDispatcher.dispatch({ type: "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES", guildId: guild, ...snapshot });
    held = null;
}

function scrollerOf(el: HTMLElement | null) {
    for (let n = el?.parentElement; n; n = n.parentElement) {
        const o = getComputedStyle(n).overflowY;
        if (o === "auto" || o === "scroll") return n;
    }
    return null;
}

function largest(root: Element, selector: string, skip: Element | null) {
    let best: HTMLElement | null = null, area = 0;
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
        if (skip?.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height > area) { area = r.width * r.height; best = el; }
    }
    return best;
}

const TARGETS: Record<string, string> = {
    avatar: 'img[src*="/avatars/"], img[src*="/guilds/"][src*="/avatars/"], [class*="avatar_"] svg',
    name: "[data-username-with-effects]",
    theme: '[style*="--profile-gradient-primary-color"]',
    banner: '[class*="banner"]',
    effect: '[class*="profileEffects"], [class*="effect"]',
    nameplate: '[class*="nameplate"]'
};

function cardOf(dialog: Element, sidebar: Element | null) {
    const banner = largest(dialog, TARGETS.banner, sidebar);
    if (!banner) return null;
    const { width } = banner.getBoundingClientRect();
    let card: HTMLElement = banner;
    for (let n = banner.parentElement; n && n !== dialog; n = n.parentElement) {
        if (n.getBoundingClientRect().width > width + 4) break;
        card = n;
    }
    return card;
}

let spot: HTMLElement | null = null;

function focusCard(anchor: HTMLElement | null, id: string | null) {
    spot?.classList.remove("vc-pe-spot", "vc-pe-spot-glow");
    spot = null;
    if (!anchor || !id) return;
    const dialog = anchor.closest('[role="dialog"]');
    if (!dialog) return;
    const sidebar = scrollerOf(anchor);
    const target = id === "theme" ? cardOf(dialog, sidebar) : largest(dialog, TARGETS[id] ?? "", sidebar);
    if (!target) return;
    spot = target;
    spot.classList.add(id === "avatar" || id === "name" ? "vc-pe-spot-glow" : "vc-pe-spot");
}

let probed = false;

function probe(section: HTMLElement) {
    if (probed) return;
    probed = true;
    setTimeout(() => {
        const describe = (el: Element | null) => el ? `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}` : "none";
        const outline = (el: Element, depth: number): string[] => depth < 0 ? [] : [describe(el), ...[...el.children].slice(0, 6).flatMap(c => outline(c, depth - 1).map(l => "  " + l))];
        const sidebar = scrollerOf(section);
        const dialog = section.closest('[role="dialog"]');
        const lines = [
            "PROBE sidebar " + describe(sidebar) + " parent " + describe(sidebar?.parentElement ?? null) + " width " + (sidebar?.parentElement ? getComputedStyle(sidebar.parentElement).width : "?"),
            ...outline(section, 4),
            ...Object.entries(TARGETS).map(([k, sel]) => `target ${k}: ${describe(dialog ? largest(dialog, sel, sidebar) : null)}`)
        ];
        logger.info(lines.join("\n"));
    }, 1500);
}

function Compare() {
    const unsaved = useStateFromStores([UserProfileSettingsStore], () => UserProfileSettingsStore.hasUnsavedChanges?.() ?? false);
    if (!unsaved && !held) return null;
    return (
        <button
            className="vc-pe-compare"
            aria-label="Hold to compare with your saved profile"
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); beginCompare(); }}
            onPointerUp={endCompare}
            onPointerCancel={endCompare}
            onKeyDown={e => { if (e.key === " " || e.key === "Enter") beginCompare(); }}
            onKeyUp={endCompare}
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
            Hold to compare with saved
        </button>
    );
}

const WATCH = ["pendingAvatar", "pendingBanner", "pendingAvatarDecoration", "pendingNameplate", "pendingDisplayNameStyles"];

const sameRefs = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function Chip({ pair, label, i }: { pair: [number, number]; label: string; i: number; }) {
    return (
        <button
            className="vc-pe-mood"
            title={label}
            aria-label={`${label} theme`}
            style={{ background: `linear-gradient(135deg, ${toHex(pair[0])} 50%, ${toHex(pair[1])} 50%)`, animationDelay: `${i * 30}ms` }}
            onClick={() => setPending({ guildId: themeTarget.guildId ?? void 0, themeColors: pair })}
        />
    );
}

function Moods() {
    const { guildId } = themeTarget;
    const refs = useStateFromStores([UserProfileSettingsStore], () => {
        const scopes = guildId ? [UserProfileSettingsStore.getPendingChanges(guildId) ?? {}, UserProfileSettingsStore.getPendingChanges() ?? {}] : [UserProfileSettingsStore.getPendingChanges() ?? {}];
        return scopes.flatMap(s => WATCH.map(k => s[k]));
    }, [guildId], sameRefs);
    const saved = useStateFromStores([UserStore], () => {
        const me = UserStore.getCurrentUser() as any;
        return [me?.avatar, me?.banner, me?.avatarDecorationData?.asset, me?.collectibles?.nameplate?.asset, JSON.stringify(me?.displayNameStyles ?? null)];
    }, [], sameRefs);
    const [result, setResult] = useState<{ suggestions: Suggestion[]; moods: Suggestion[]; basis: string[]; } | null>(null);

    useEffect(() => {
        let alive = true;
        suggest(guildId).then(r => { if (alive) setResult(r); }, () => void 0);
        return () => { alive = false; };
    }, [guildId, ...refs, ...saved]);

    const basis = result?.basis ?? [];
    const list = basis.length > 1 ? `${basis.slice(0, -1).join(", ")} and ${basis[basis.length - 1]}` : basis[0];

    return (
        <div className="vc-pe-moods" role="group" aria-label="Theme suggestions">
            {!!result?.suggestions.length && (
                <>
                    <span className="vc-pe-moods-label">Suggested from your {list?.toLowerCase()}</span>
                    <div className="vc-pe-mood-row">
                        {result.suggestions.map((s, i) => <Chip key={toHex(s.pair[0]) + toHex(s.pair[1])} pair={s.pair} label={s.label} i={i} />)}
                    </div>
                </>
            )}
            <span className="vc-pe-moods-label">{result?.moods.length ? "Moods in your colours" : "Moods"}</span>
            <div className="vc-pe-mood-row">
                {result?.moods.length
                    ? result.moods.map((m, i) => <Chip key={m.label + toHex(m.pair[0]) + toHex(m.pair[1])} pair={m.pair} label={m.label} i={i} />)
                    : Object.entries(MOODS).map(([name, pair], i) => <Chip key={name} pair={pair} label={name} i={i} />)}
            </div>
        </div>
    );
}

const editingGuild = () => themeTarget.guildId ?? UserProfileSettingsStore.selectedGuildId ?? void 0;

const TOOL_ICONS = {
    bio: "M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3",
    rack: "M3 7h18M7 7l1 13h8l1-13M9 7a3 3 0 0 1 6 0",
    banner: "M3 5h18v10H3zM7 19h10M8 15v4M16 15v4"
};

function Tool({ icon, label, onClick }: { icon: keyof typeof TOOL_ICONS; label: string; onClick(): void; }) {
    return (
        <button className="vc-pe-tool" onClick={onClick}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TOOL_ICONS[icon]} /></svg>
            {label}
        </button>
    );
}

function Tools() {
    return (
        <div className="vc-pe-tools" role="group" aria-label="Profile tools">
            <Tool icon="bio" label="Bio studio" onClick={() => openBioStudio(editingGuild())} />
            <Tool icon="rack" label="Try-on rack" onClick={() => openTryOn(editingGuild())} />
        </div>
    );
}

function Section({ heading, el }: { heading: unknown; el: ReactNode; }) {
    const kind = kindOf(heading);
    const ref = useRef<HTMLDivElement>(null);
    const [last, setLast] = useState(false);
    useBus();

    const changed = useStateFromStores([UserProfileSettingsStore], () => {
        if (!kind) return false;
        const keys = draftKeys();
        return kind.keys.some(k => k in keys);
    });

    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return;
        const group = [...node.children].find(c => !c.classList.contains("vc-pe-moods"));
        group?.classList.add("vc-pe-group");
        group?.firstElementChild?.classList.add("vc-pe-head");
        const siblings = [...(node.parentElement?.querySelectorAll(":scope > .vc-pe-section") ?? [])];
        node.style.setProperty("--vc-pe-i", String(Math.max(0, siblings.indexOf(node))));
        setLast(siblings[siblings.length - 1] === node);
        probe(node);
    }, []);

    const id = kind?.id ?? "other";
    const isClosed = closed.has(id);

    return (
        <div
            ref={ref}
            className={classes("vc-pe-section", isClosed && "vc-pe-closed", changed && "vc-pe-changed")}
            data-vc-pe={id}
            data-vc-pe-label={typeof heading === "string" ? heading : void 0}
            onMouseEnter={() => focusCard(ref.current, kind?.id ?? null)}
            onMouseLeave={() => focusCard(null, null)}
            onClickCapture={e => {
                const t = e.target as HTMLElement;
                if (!t.closest(".vc-pe-head") || t.closest("button, a, [role='button']")) return;
                if (isClosed) closed.delete(id); else closed.add(id);
                emit();
            }}
        >
            {el}
            {kind?.id === "theme" && !isClosed && <Moods />}
            {kind?.id === "theme" && !isClosed && <div className="vc-pe-tools"><Tool icon="banner" label="Banner crop guide" onClick={() => openBannerGuide(editingGuild())} /></div>}
            {last && <Tools />}
            {last && <Compare />}
        </div>
    );
}

export function renderSection(props: { heading: unknown; }, el: ReactNode) {
    return <Section heading={props.heading} el={el} />;
}
