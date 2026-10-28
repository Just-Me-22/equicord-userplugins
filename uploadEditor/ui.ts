/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { React, useLayoutEffect, useState } from "@webpack/common";

export const cl = classNameFactory("vc-upload-editor-");

export function useSize(ref: React.RefObject<HTMLElement | null>) {
    const [size, setSize] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;

        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setSize(prev => prev.width === width && prev.height === height ? prev : { width, height });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return size;
}
