/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findComponentByCodeLazy, findStoreLazy } from "@webpack";
import { GuildStore, UserStore, useStateFromStores } from "@webpack/common";
import type { ReactNode } from "react";

export const UserProfileSettingsStore = findStoreLazy("UserProfileSettingsStore");
export const CategoryStore = findStoreLazy("CollectiblesCategoryStore");
export const PurchaseStore = findStoreLazy("CollectiblesPurchaseStore");

const ProfilePreview = findComponentByCodeLazy("pendingLegacyUsernameDisabled:", "hideBioSection:");

export type PreviewView = "popout" | "compact" | "message";

export interface PreviewProps {
    guildId?: string | null;
    view?: PreviewView;
    restart?: number;
    overrides?: Record<string, unknown>;
}

export function usePending(guildId?: string | null): Record<string, any> {
    return useStateFromStores([UserProfileSettingsStore], () => UserProfileSettingsStore.getPendingChanges?.(guildId ?? void 0) ?? {});
}

export function RealPreview({ guildId, view = "popout", restart = 0, overrides }: PreviewProps) {
    const pending = usePending(guildId);
    const { pendingAvatar, ...changes } = pending;
    return (
        <ProfilePreview
            {...changes}
            {...overrides}
            user={UserStore.getCurrentUser()}
            guild={guildId ? GuildStore.getGuild(guildId) : null}
            canUsePremiumCustomization
            disabledInputs
            hideCustomStatus
            hideBioSection={view === "compact"}
            hideMessageInput={view !== "message"}
            profileEffectRestartKey={restart}
        />
    );
}

export const plateRef: { current: ((props: { nameplate: unknown; user: unknown; showPlaceholderUser: boolean; isHighlighted: boolean; }) => ReactNode) | null; } = { current: null };
