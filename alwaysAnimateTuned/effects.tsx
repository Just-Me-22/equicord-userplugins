/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { findByCodeLazy, findComponentByCodeLazy } from "@webpack";
import { useEffect, useRef, useState } from "@webpack/common";
import type { RefObject } from "react";

import { on } from "./gate";
import { usePickerSettled } from "./picker";

const ProfileEffect = findComponentByCodeLazy("useOpacityOnHover:e.useOpacityOnHover");
const useHoverOrFocus: (ref: RefObject<HTMLElement | null>) => { isHoveringOrFocusing: boolean; } =
    findByCodeLazy("isFocusing:", "isHoveringOrFocusing:", '"focusin"');

interface EffectTileProps {
    skuId: string;
    tile: RefObject<HTMLElement | null>;
    className: string;
    src: string;
    alt: string;
}

export function EffectTile({ skuId, tile, className, src, alt }: EffectTileProps) {
    const { isHoveringOrFocusing } = useHoverOrFocus(tile);
    const settled = usePickerSettled();
    const animate = isHoveringOrFocusing && settled && on();
    const [ready, setReady] = useState(false);
    const player = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setReady(false);
        const node = player.current;
        if (!animate || !node) return;
        const onLoad = () => setReady(true);
        node.addEventListener("load", onLoad, true);
        return () => node.removeEventListener("load", onLoad, true);
    }, [animate]);

    return (
        <>
            {!ready && <img className={className} src={src} alt={alt} />}
            {animate && (
                <div ref={player} className={className}>
                    <ErrorBoundary noop>
                        <ProfileEffect skuId={skuId} />
                    </ErrorBoundary>
                </div>
            )}
        </>
    );
}
