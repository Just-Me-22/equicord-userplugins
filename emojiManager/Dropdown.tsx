/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useEffect, useRef, useState } from "@webpack/common";

import type { GuildInfo } from "./data";
import { cl, GuildIcon } from "./ui";

export interface Option {
    id: string;
    label: string;
    guild?: GuildInfo;
    detail?: string;
    tone?: "ok" | "warn" | "muted";
    disabled?: boolean;
}

export function Dropdown({ label, value, options, disabled, onPick, wide }: {
    label: string;
    value?: string | null;
    options: Option[];
    disabled?: boolean;
    onPick(id: string): void;
    wide?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const current = options.find(option => option.id === value);

    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setOpen(false);
        };
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", escape, true);
        return () => {
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", escape, true);
        };
    }, [open]);

    return (
        <div className={cl("dropdown", { "dropdown-wide": wide })} ref={rootRef}>
            <button
                className={cl("dropdown-button", { "dropdown-open": open })}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                {current?.guild && <GuildIcon guild={current.guild} size={20} />}
                <span className={cl("dropdown-label")}>{current?.label ?? label}</span>
                <svg className={cl("dropdown-chevron")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                </svg>
            </button>

            {open && (
                <div className={cl("dropdown-menu")} role="listbox">
                    {options.map(option => (
                        <button
                            key={option.id}
                            role="option"
                            aria-selected={option.id === value}
                            className={cl("dropdown-item", { "dropdown-item-selected": option.id === value })}
                            disabled={option.disabled}
                            onClick={() => {
                                setOpen(false);
                                onPick(option.id);
                            }}
                        >
                            {option.guild && <GuildIcon guild={option.guild} size={24} />}
                            <span className={cl("dropdown-item-text")}>
                                <span className={cl("dropdown-item-label")}>{option.label}</span>
                                {option.detail && <span className={cl("dropdown-item-detail", option.tone && `detail-${option.tone}`)}>{option.detail}</span>}
                            </span>
                        </button>
                    ))}
                    {!options.length && <div className={cl("dropdown-empty")}>Nowhere to put them</div>}
                </div>
            )}
        </div>
    );
}
