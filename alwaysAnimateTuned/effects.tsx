/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { findComponentByCodeLazy } from "@webpack";
import { useEffect, useRef, useState } from "@webpack/common";

import { on } from "./gate";
import { usePickerSettled } from "./picker";

const ProfileEffect = findComponentByCodeLazy("useOpacityOnHover:e.useOpacityOnHover");

interface EffectTileProps {
    skuId: string;
    className: string;
    src: string;
    alt: string;
}

export function EffectTile({ skuId, className, src, alt }: EffectTileProps) {
    const animate = usePickerSettled() && on();
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
