/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";

import type { GuildInfo } from "./data";

export const cl = classNameFactory("vc-emoji-manager-");

export function GuildIcon({ guild, size = 40 }: { guild: GuildInfo; size?: number; }) {
    if (guild.icon) return <img className={cl("guild-icon")} src={guild.icon} alt="" style={{ width: size, height: size, borderRadius: size * 0.3 }} />;
    const initials = guild.name.split(/\s+/).map(word => word[0]).join("").slice(0, 3);
    return <span className={cl("guild-icon", "guild-initials")} style={{ width: size, height: size, borderRadius: size * 0.3, fontSize: size * 0.3 }}>{initials}</span>;
}
