/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ReactNode } from "react";

function Icon({ children, size = 18 }: { children: ReactNode; size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {children}
        </svg>
    );
}

export const CropIcon = () => (
    <Icon>
        <path d="M6 2v14a2 2 0 0 0 2 2h14" />
        <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </Icon>
);

export const PenIcon = () => (
    <Icon>
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
        <path d="m15 5 4 4" />
    </Icon>
);

export const UndoIcon = () => (
    <Icon>
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
);

export const ResetIcon = () => (
    <Icon>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
    </Icon>
);

export const CloseIcon = () => (
    <Icon size={12}>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
    </Icon>
);

export const BackIcon = () => (
    <Icon size={16}>
        <path d="m15 18-6-6 6-6" />
    </Icon>
);

export const TextIcon = () => (
    <Icon>
        <path d="M4 7V5h16v2" />
        <path d="M12 5v14" />
        <path d="M9 19h6" />
    </Icon>
);

export const AdjustIcon = () => (
    <Icon>
        <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="10" cy="12" r="2" />
        <circle cx="18" cy="18" r="2" />
    </Icon>
);

export const PlayIcon = () => (
    <Icon size={16}>
        <path d="M7 4v16l13-8z" fill="currentColor" />
    </Icon>
);

export const PauseIcon = () => (
    <Icon size={16}>
        <path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor" />
    </Icon>
);

export const CameraIcon = () => (
    <Icon size={16}>
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
    </Icon>
);

export const EyeIcon = () => (
    <Icon size={16}>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
    </Icon>
);

export const SpoilerIcon = () => (
    <Icon size={16}>
        <path d="M3 3l18 18" />
        <path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    </Icon>
);

export const SoundIcon = ({ off }: { off: boolean; }) => (
    <Icon size={16}>
        <path d="M4 9v6h4l5 4V5L8 9z" />
        {off ? <path d="m17 9 4 6M21 9l-4 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
    </Icon>
);

export const TrashIcon = () => (
    <Icon size={16}>
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Icon>
);
