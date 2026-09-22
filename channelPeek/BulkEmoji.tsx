/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyToClipboard, readClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { Channel } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { Button, ChannelStore, GuildChannelStore, Modal, openModal, SelectedGuildStore, Text, useState } from "@webpack/common";

import { openEmojiPicker } from "./ChannelIcon";
import { getOverrides, resolveEmoji, setOverride, tintFor } from "./emoji";
import { OverrideMap, settings } from "./settings";

const cl = classNameFactory("vc-channel-peek-");

const PREVIEWABLE = [ChannelType.GUILD_TEXT, ChannelType.GUILD_ANNOUNCEMENT, ChannelType.GUILD_FORUM];

function guildChannels(guildId: string): Channel[] {
    const groups = GuildChannelStore.getChannels(guildId);
    if (!groups) return [];

    return (groups.SELECTABLE ?? [])
        .map((entry: any) => ChannelStore.getChannel(entry.channel.id))
        .filter((channel: Channel | undefined): channel is Channel => Boolean(channel) && PREVIEWABLE.includes(channel!.type));
}

function Row({ channel }: { channel: Channel; }) {
    settings.use(["iconOverrides", "iconFallback", "autoEmoji"]);

    const resolved = resolveEmoji(channel);
    const set = Boolean(getOverrides()[channel.id]);

    return <div className={cl("bulk-row")}>
        <button
            className={cl("bulk-emoji")}
            style={resolved ? { background: tintFor(resolved.emoji) } : undefined}
            onClick={() => openEmojiPicker(channel)}
        >
            {resolved?.custom?.id
                ? <img className={cl("icon-custom")} src={`https://cdn.discordapp.com/emojis/${resolved.custom.id}.webp?size=32`} alt={resolved.emoji} />
                : <span className={cl("glyph")}>{resolved?.emoji ?? "#"}</span>}
        </button>
        <span className={cl("bulk-name")}>{channel.name}</span>
        {set && <button className={cl("bulk-reset")} onClick={() => setOverride(channel.id, null)}>Reset</button>}
    </div>;
}

function BulkModal(props: any) {
    const guildId = SelectedGuildStore.getGuildId();
    const [status, setStatus] = useState("");
    const channels = guildId ? guildChannels(guildId) : [];

    const importFromClipboard = async () => {
        const text = await readClipboard();
        try {
            const parsed = JSON.parse(text) as OverrideMap;
            const entries = Object.entries(parsed).filter(([id, value]) => /^\d+$/.test(id) && typeof value === "string");
            if (!entries.length) return setStatus("Nothing usable in the clipboard.");

            settings.store.iconOverrides = { ...getOverrides(), ...Object.fromEntries(entries) };
            setStatus(`Imported ${entries.length}.`);
        } catch {
            setStatus("That is not valid JSON.");
        }
    };

    return <Modal {...props} size="md" title="Channel Emoji">
        <div className={cl("bulk-tools")}>
            <Button size={Button.Sizes.SMALL} onClick={() => {
                copyToClipboard(JSON.stringify(getOverrides(), null, 2));
                setStatus("Copied to the clipboard.");
            }}>Export</Button>
            <Button size={Button.Sizes.SMALL} onClick={importFromClipboard}>Import</Button>
            {status && <Text variant="text-xs/normal">{status}</Text>}
        </div>
        <div className={cl("bulk-list")}>
            {channels.length
                ? channels.map(channel => <Row channel={channel} key={channel.id} />)
                : <Text variant="text-sm/normal">Open a server to list its channels.</Text>}
        </div>
    </Modal>;
}

export function openBulkEmoji() {
    openModal(props => <BulkModal {...props} />);
}
