/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Button } from "@components/Button";
import definePlugin from "@utils/types";
import { Guild } from "@vencord/discord-types";
import { Menu, openModal } from "@webpack/common";

import { Manager } from "./Manager";
import { stopQueue } from "./queue";

const open = (initialGuild?: string) => openModal(props => <Manager modalProps={props} initialGuild={initialGuild} />);

const guildContext: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild) return;
    children.push(<Menu.MenuItem id="vc-emoji-manager" label="Manage emoji and stickers" action={() => open(guild.id)} />);
};

export default definePlugin({
    name: "EmojiManager",
    description: "One window for the emoji and stickers of all your servers: select many, drag them onto another server to move or copy, and put back anything you moved or deleted.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    tags: ["Emotes", "Servers"],

    settingsAboutComponent: () => <Button onClick={() => open()}>Open</Button>,

    contextMenus: {
        "guild-context": guildContext
    },

    toolboxActions: {
        "Emoji and stickers": () => open()
    },

    stop() {
        stopQueue();
    }
});
