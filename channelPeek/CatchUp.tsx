/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Channel } from "@vencord/discord-types";
import {
    Button, ChannelStore, GuildStore, Modal, NavigationRouter, openModal, ReadStateStore,
    ReadStateUtils, Text, useState
} from "@webpack/common";

import { busiest } from "./activity";
import { plainText } from "./describe";
import { ageOf } from "./format";
import { lastMessageOf } from "./gateway";
import { Later, settings } from "./settings";

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

function byServer(rows: Row[]) {
    const servers = new Map<string, Row[]>();
    for (const row of rows) {
        const list = servers.get(row.channel.guild_id);
        if (list) list.push(row);
        else servers.set(row.channel.guild_id, [row]);
    }
    return [...servers];
}

type Tab = "unread" | "day" | "later";

function DayList({ close }: { close: () => void; }) {
    const rows = busiest()
        .map(one => ({ ...one, channel: ChannelStore.getChannel(one.channelId) }))
        .filter(one => one.channel?.guild_id)
        .slice(0, 40);

    if (!rows.length) return <Text variant="text-sm/normal">Nothing counted yet. This fills in as messages arrive.</Text>;

    return <div className={cl("catchup-list")}>
        {rows.map(({ channel, total }) => {
            const message = lastMessageOf(channel!);
            return <button
                key={channel!.id}
                className={cl("catchup-open", "catchup-row-solo")}
                onClick={() => {
                    close();
                    NavigationRouter.transitionTo(`/channels/${channel!.guild_id}/${channel!.id}`);
                }}
            >
                <span className={cl("catchup-where")}>
                    <span className={cl("catchup-channel")}>#{channel!.name}</span>
                    <span className={cl("catchup-server-inline")}>{GuildStore.getGuild(channel!.guild_id)?.name}</span>
                    <span className={cl("count")}>{total}</span>
                </span>
                <span className={cl("catchup-text")}>{message ? `last: ${plainText(message)}` : `${total} messages`}</span>
            </button>;
        })}
    </div>;
}

function LaterList({ close }: { close: () => void; }) {
    const [list, setList] = useState(() => settings.store.later as Later[]);
    const drop = (messageId: string) => {
        const next = list.filter(one => one.messageId !== messageId).map(one => ({ ...one }));
        settings.store.later = next;
        setList(next);
    };

    if (!list.length) return <Text variant="text-sm/normal">Nothing saved. Hover a preview and press the bookmark.</Text>;

    return <div className={cl("catchup-list")}>
        {list.map(one => {
            const channel = ChannelStore.getChannel(one.channelId);
            return <div className={cl("catchup-row")} key={one.messageId}>
                <button
                    className={cl("catchup-open")}
                    onClick={() => {
                        close();
                        NavigationRouter.transitionTo(`/channels/${one.guildId}/${one.channelId}/${one.messageId}`);
                    }}
                >
                    <span className={cl("catchup-where")}>
                        <span className={cl("catchup-channel")}>#{channel?.name ?? "deleted channel"}</span>
                        {one.name && <span className={cl("catchup-server-inline")}>{one.name}</span>}
                        <span className={cl("age")}>{ageOf(one.at)}</span>
                    </span>
                    <span className={cl("catchup-text")}>{one.text}</span>
                </button>
                <button className={cl("catchup-ack")} aria-label="Remove" onClick={() => drop(one.messageId)}>
                    <svg width={14} height={14} viewBox="0 0 24 24">
                        <path fill="currentColor" d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z" />
                    </svg>
                </button>
            </div>;
        })}
    </div>;
}

function CatchUpModal(props: any) {
    const [rows, setRows] = useState(unreadRows);
    const [tab, setTab] = useState<Tab>("unread");

    const drop = (channelId: string) => setRows(current => current.filter(row => row.channel.id !== channelId));

    const tabs: { id: Tab; label: string; }[] = [
        { id: "unread", label: `Unread ${rows.length}` },
        { id: "day", label: "Last 24 hours" },
        { id: "later", label: `Later ${(settings.store.later as Later[]).length}` }
    ];

    return <Modal {...props} size="large" title="Catch up">
        <div className={cl("catchup-tabs")} role="tablist">
            {tabs.map(one => <button
                key={one.id}
                role="tab"
                aria-selected={tab === one.id}
                className={cl("catchup-tab")}
                onClick={() => setTab(one.id)}
            >
                {one.label}
            </button>)}
        </div>

        {tab === "day" && <DayList close={props.onClose} />}
        {tab === "later" && <LaterList close={props.onClose} />}

        {tab === "unread" && <><div className={cl("catchup-tools")}>
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
            {byServer(rows).map(([guildId, list]) => <section className={cl("catchup-server")} key={guildId}>
                <Text variant="text-xs/semibold" color="text-muted" className={cl("catchup-server-name")}>{list[0].guild}</Text>
                {list.map(row => <div className={cl("catchup-row")} key={row.channel.id}>
                    <button
                        className={cl("catchup-open")}
                        onClick={() => {
                            props.onClose();
                            NavigationRouter.transitionTo(`/channels/${row.channel.guild_id}/${row.channel.id}`);
                        }}
                    >
                        <span className={cl("catchup-where")}>
                            <span className={cl("catchup-channel")}>#{row.channel.name}</span>
                            {row.mentions > 0 && <span className={cl("count", "count-mention")}>{row.mentions}</span>}
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
            </section>)}
        </div></>}
    </Modal>;
}

export function openCatchUp() {
    openModal(props => <CatchUpModal {...props} />);
}
