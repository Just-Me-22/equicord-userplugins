/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { findStoreLazy } from "@webpack";
import type { ComponentType, ReactNode } from "react";

import { Gallery, GallerySection } from "./Gallery";
import { plateRef } from "./preview";

interface Decoration { skuId: string; asset?: string; label?: string; }

interface DecorationArgs {
    props: {
        pendingAvatarDecoration?: Decoration | null;
        onSelect(item: Decoration | null): void;
        onOpenShop(): void;
    };
    sections: GallerySection<Decoration>[];
    canUse: boolean;
}

const decorationSrc = (asset: string) =>
    `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=160&passthrough=true`;

export function decorationGallery({ props, sections }: DecorationArgs, fallback: ReactNode) {
    return (
        <ErrorBoundary fallback={() => fallback as any}>
            <Gallery<Decoration>
                kind="decoration"
                sections={sections}
                selectedId={props.pendingAvatarDecoration?.skuId ?? null}
                onSelect={props.onSelect}
                onOpenShop={props.onOpenShop}
                source={item => item.asset && `https://cdn.discordapp.com/avatar-decoration-presets/${item.asset}.png?size=64&passthrough=false`}
                thumb={item => item.asset
                    ? <img className="vc-cg-img" src={decorationSrc(item.asset)} alt="" loading="lazy" draggable={false} />
                    : <span className="vc-cg-label">{item.label}</span>}
            />
        </ErrorBoundary>
    );
}

const CategoryStore = findStoreLazy("CollectiblesCategoryStore");
const PurchaseStore = findStoreLazy("CollectiblesPurchaseStore");

interface Effect { skuId: string; label?: string; title?: string; thumbnailPreviewSrc?: string; }

function effectConfig(item: Effect): Effect | undefined {
    if (item.thumbnailPreviewSrc) return item;
    return CategoryStore.getProduct?.(item.skuId)?.items?.[0] ?? PurchaseStore.getPurchase?.(item.skuId)?.items?.[0];
}

interface EffectArgs {
    props: { pendingProfileEffect?: Effect | null; onSelect(item: Effect | null): void; onOpenShop(): void; };
    sections: GallerySection<Effect>[];
}

const named = new WeakMap<Effect, Effect>();

function withTitle(item: Effect): Effect {
    if (item.label) return item;
    const cached = named.get(item);
    if (cached) return cached;
    const title = effectConfig(item)?.title;
    if (!title) return item;
    const next = { ...item, label: title };
    named.set(item, next);
    return next;
}

export function effectGallery({ props, sections }: EffectArgs, fallback: ReactNode) {
    const labelled = sections.map(s => ({ ...s, items: s.items.map(withTitle) }));
    return (
        <ErrorBoundary fallback={() => fallback as any}>
            <Gallery<Effect>
                kind="effect"
                shape="card"
                sections={labelled}
                selectedId={props.pendingProfileEffect?.skuId ?? null}
                onSelect={props.onSelect}
                onOpenShop={props.onOpenShop}
                replay
                source={item => {
                    const src = effectConfig(item)?.thumbnailPreviewSrc;
                    return src && `${src}?width=100&height=195`;
                }}
                thumb={item => {
                    const src = effectConfig(item)?.thumbnailPreviewSrc;
                    return src
                        ? <img className="vc-cg-img vc-cg-cover" src={`${src}?width=200&height=390`} alt="" loading="lazy" draggable={false} />
                        : <span className="vc-cg-label">{item.label}</span>;
                }}
            />
        </ErrorBoundary>
    );
}

interface Frame { skuId: string; label?: string; }

interface FrameArgs {
    props: { pendingProfileFrame?: Frame | null; onSelect(item: { skuId: string; type: number; } | null): void; onOpenShop(): void; };
    sections: GallerySection<Frame>[];
    Frame: ComponentType<{ frame: Frame; transparentBackground?: boolean; }>;
}

const PROFILE_FRAME = 3;

export function frameGallery({ props, sections, Frame }: FrameArgs, fallback: ReactNode) {
    return (
        <ErrorBoundary fallback={() => fallback as any}>
            <Gallery<Frame>
                kind="frame"
                shape="card"
                sections={sections}
                selectedId={props.pendingProfileFrame?.skuId ?? null}
                onSelect={item => props.onSelect(item ? { skuId: item.skuId, type: PROFILE_FRAME } : null)}
                onOpenShop={props.onOpenShop}
                replay
                thumb={item => <span className="vc-cg-frame"><Frame frame={item} transparentBackground /></span>}
            />
        </ErrorBoundary>
    );
}

interface Nameplate { skuId: string; label?: string; asset?: string; }

interface NameplateArgs {
    props: { currentUser: unknown; selectedNameplate?: Nameplate | null; onSelect(item: Nameplate | null): void; onOpenShop(): void; };
    sections: GallerySection<Nameplate>[];
    Plate: ComponentType<{ nameplate: Nameplate; user: unknown; showPlaceholderUser: boolean; isHighlighted: boolean; }>;
}

const NONE = { skuId: "None" } as Nameplate;
const SHOP = { skuId: "Shop" } as Nameplate;

export function nameplateGallery({ props, sections, Plate }: NameplateArgs, fallback: ReactNode) {
    plateRef.current = Plate as typeof plateRef.current;
    const owned = sections.findIndex(s => s.section === "purchase");
    const at = owned >= 0 ? owned : 0;
    const withSpecials = sections.map((s, i) => i === at ? { ...s, items: [NONE, SHOP, ...s.items] } : s);
    return (
        <ErrorBoundary fallback={() => fallback as any}>
            <Gallery<Nameplate>
                kind="nameplate"
                shape="wide"
                sections={withSpecials}
                selectedId={props.selectedNameplate?.skuId ?? null}
                onSelect={props.onSelect}
                onOpenShop={props.onOpenShop}
                source={item => item.asset && `https://cdn.discordapp.com/assets/collectibles/${item.asset}static.png`}
                thumb={item => <span className="vc-cg-plate"><Plate nameplate={item} user={props.currentUser} showPlaceholderUser isHighlighted /></span>}
            />
        </ErrorBoundary>
    );
}
