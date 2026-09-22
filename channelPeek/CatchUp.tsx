/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { Channel } from "@vencord/discord-types";
import {
    Button, ChannelStore, GuildStore, Modal, NavigationRouter, openModal, ReadStateStore,
    ReadStateUtils, Text, useState
} from "@webpack/common";

import { plainText } from "./describe";
import { ageOf } from "./format";
import { lastMessageOf } from "./gateway";

const cl = classNameFactory("vc-channel-peek-");

interface Row {
    channel: Channel;
    guild: string;
    mentions: number;
    at: number;
    text: string;
}

function unreadRows(): Row[] {
    const rows: Row[] = [];

    for (const state of ReadStateStore.getAllReadStates(false)) {
        const { channelId } = state;
        if (!ReadStateStore.hasUnread(channelId)) continue;

        const channel = ChannelStore.getChannel(channelId);
        if (!channel?.guild_id) continue;

        const message = lastMessageOf(channel);
        const text = message ? plainText(message) : "";
        if (!text) continue;

        rows.push({
            channel,
            guild: GuildStore.getGuild(channel.guild_id)?.name ?? "Unknown",
            mentions: ReadStateStore.getMentionCount(channelId),
            at: message?.timestamp ? new Date(message.timestamp as any).getTime() : 0,
            text
        });
    }

    return rows.sort((a, b) =>
        (b.mentions > 0 ? 1 : 0) - (a.mentions > 0 ? 1 : 0) || b.at - a.at);
}

function CatchUpModal(props: any) {
    const [rows, setRows] = useState(unreadRows);

    const drop = (channelId: string) => setRows(current => current.filter(row => row.channel.id !== channelId));

    return <Modal {...props} size="large" title={`Catch up (${rows.length})`}>
        <div className={cl("catchup-tools")}>
            <Button
                size={Button.Sizes.SMALL}
                color={Button.Colors.PRIMARY}
                disabled={!rows.length}
                onClick={() => {
                    rows.forEach(row => ReadStateUtils.ackChannel(row.channel));
                    setRows([]);
                }}
            >
                Mark all read
            </Button>
        </div>

        <div className={cl("catchup-list")}>
            {rows.length === 0 && <Text variant="text-sm/normal">Nothing unread.</Text>}
            {rows.map(row => <div className={cl("catchup-row")} key={row.channel.id}>
                <button
                    className={cl("catchup-open")}
                    onClick={() => {
                        props.onClose();
                        NavigationRouter.transitionTo(`/channels/${row.channel.guild_id}/${row.channel.id}`);
                    }}
                >
                    <span className={cl("catchup-where")}>
                        <span className={cl("catchup-guild")}>{row.guild}</span>
                        <span className={classes(cl("catchup-channel"), row.mentions > 0 ? cl("catchup-mention") : undefined)}>
                            #{row.channel.name}
                        </span>
                        {row.mentions > 0 && <span className={cl("count")}>{row.mentions}</span>}
                        {row.at > 0 && <span className={cl("age")}>{ageOf(row.at)}</span>}
                    </span>
                    <span className={cl("catchup-text")}>{row.text}</span>
                </button>
                <button
                    className={cl("catchup-ack")}
                    aria-label="Mark as read"
                    onClick={() => {
                        ReadStateUtils.ackChannel(row.channel);
                        drop(row.channel.id);
                    }}
                >
                    <svg width={14} height={14} viewBox="0 0 24 24">
                        <path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
                    </svg>
                </button>
            </div>)}
        </div>
    </Modal>;
}

export function openCatchUp() {
    openModal(props => <CatchUpModal {...props} />);
}
