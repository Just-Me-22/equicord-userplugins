/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { Channel, Message } from "@vencord/discord-types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { createRoot, MessageStore, NavigationRouter, PermissionsBits, PermissionStore, ReadStateStore, ThemeStore, useEffect, useLayoutEffect, useRef, useState, useStateFromStores } from "@webpack/common";
import type { ComponentType, CSSProperties, JSX, MouseEvent as ReactMouseEvent } from "react";

const ChannelMessage = findComponentByCodeLazy("isFirstMessageInForumPost", "trackAnnouncementViews") as ComponentType<any>;
const MessageActions = findByPropsLazy("fetchMessages", "sendMessage");
const MessageDisplayCompact = getUserSettingLazy("textAndImages", "messageDisplayCompact")!;

const SIDEBAR = '[class*="sidebarList"]';
const LAYER = '[class*="layerContainer"], [role="menu"], [role="dialog"]';
const NO_JUMP = "a, button, [role='button'], video, audio, [class*='spoiler']";
const EDGE = 8;
const LINE = 60;
const CLOSE_GRACE = 200;

const settings = definePluginSettings({
    messageCount: {
        type: OptionType.SLIDER,
        description: "How many recent messages the preview loads",
        markers: [1, 5, 10, 15, 20, 25, 30, 40, 50],
        default: 10,
        stickToMarkers: false
    },
    hoverDelay: {
        type: OptionType.SLIDER,
        description: "How long to rest on a channel before the preview opens (milliseconds)",
        markers: [0, 100, 250, 500, 750, 1000, 1500, 2000],
        default: 450,
        stickToMarkers: false
    },
    instantKey: {
        type: OptionType.SELECT,
        description: "The key held while hovering",
        options: [
            { label: "Shift", value: "shift", default: true },
            { label: "Ctrl", value: "ctrl" },
            { label: "Alt", value: "alt" },
            { label: "Off", value: "none" }
        ]
    },
    requireKey: {
        type: OptionType.BOOLEAN,
        description: "Only open while that key is held. Off means hovering alone opens it, and holding the key skips the delay",
        default: false
    },
    scrollbar: {
        type: OptionType.SELECT,
        description: "Scrollbar in the preview. Wide gives a bigger target if you have no scroll wheel",
        options: [
            { label: "Thin", value: "thin", default: true },
            { label: "Wide", value: "wide" }
        ]
    },
    maxHeight: {
        type: OptionType.SLIDER,
        description: "How tall the preview can grow before it starts scrolling (pixels)",
        markers: [200, 300, 400, 500, 600, 700, 800, 900],
        default: 560,
        stickToMarkers: false
    },
    width: {
        type: OptionType.SLIDER,
        description: "Preview width (pixels)",
        markers: [300, 400, 500, 600, 700, 800],
        default: 560,
        stickToMarkers: false
    },
    messageGap: {
        type: OptionType.SLIDER,
        description: "Extra space between messages (pixels)",
        markers: [0, 4, 8, 12, 16, 24, 32, 40],
        default: 4,
        stickToMarkers: false
    },
    animation: {
        type: OptionType.SELECT,
        description: "How the preview appears",
        options: [
            { label: "Fade", value: "fade", default: true },
            { label: "Pop", value: "pop" },
            { label: "Slide", value: "slide" },
            { label: "None", value: "none" }
        ]
    },
    display: {
        type: OptionType.SELECT,
        description: "Display style",
        options: [
            { label: "Same as chat", value: "auto", default: true },
            { label: "Compact", value: "compact" },
            { label: "Cozy", value: "cozy" }
        ]
    },
    clickToJump: {
        type: OptionType.BOOLEAN,
        description: "Click a message in the preview to open the channel at it",
        default: true
    },
    inDms: {
        type: OptionType.BOOLEAN,
        description: "Preview direct messages and group chats",
        default: true
    },
    inChannels: {
        type: OptionType.BOOLEAN,
        description: "Preview server channels",
        default: true
    }
});

interface Target {
    channel: Channel;
    row: DOMRect;
    rail: DOMRect;
}

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let target: Target | null = null;
let scrollerEl: HTMLDivElement | null = null;
let hovering = false;
let openTimer: number | undefined;
let closeTimer: number | undefined;

const listeners = new Set<() => void>();
const requested = new Set<string>();

function setTarget(next: Target | null) {
    if (!target && !next) return;
    target = next;
    for (const notify of listeners) notify();
}

function cancelOpen() {
    clearTimeout(openTimer);
    openTimer = undefined;
}

function cancelClose() {
    clearTimeout(closeTimer);
    closeTimer = undefined;
}

function scheduleClose() {
    cancelOpen();
    if (!target || closeTimer) return;
    closeTimer = window.setTimeout(() => {
        closeTimer = undefined;
        setTarget(null);
    }, CLOSE_GRACE);
}

function closeNow() {
    cancelOpen();
    cancelClose();
    hovering = false;
    setTarget(null);
}

function modifierHeld(e: ReactMouseEvent) {
    switch (settings.store.instantKey) {
        case "shift": return e.shiftKey;
        case "ctrl": return e.ctrlKey;
        case "alt": return e.altKey;
        default: return false;
    }
}

function useMessages(channelId: string, limit: number) {
    const messages = useStateFromStores(
        [MessageStore],
        () => MessageStore.getMessages(channelId)?._array as Message[] | undefined
    );

    const [failed, setFailed] = useState<string | null>(null);

    useEffect(() => {
        if ((messages?.length ?? 0) >= limit || requested.has(channelId)) return;
        requested.add(channelId);

        MessageActions.fetchMessages({ channelId, limit })
            .catch((err: any) => setFailed(`${err?.status ?? ""} ${err?.body?.message ?? err?.message ?? err}`.trim()))
            .finally(() => requested.delete(channelId));
    }, [channelId, limit]);

    return { messages, failed };
}

function useTarget() {
    const [value, setValue] = useState(target);

    useEffect(() => {
        const notify = () => setValue(target);
        listeners.add(notify);
        return () => void listeners.delete(notify);
    }, []);

    return value;
}

function jump(e: ReactMouseEvent, channel: Channel, messageId: string) {
    if (e.defaultPrevented || (e.target as HTMLElement).closest(NO_JUMP)) return;
    if (window.getSelection()?.toString()) return;

    closeNow();
    NavigationRouter.transitionTo(`/channels/${channel.guild_id ?? "@me"}/${channel.id}/${messageId}`);
}

function onPanelEnter() {
    hovering = true;
    cancelClose();
}

function onPanelLeave(e: ReactMouseEvent) {
    if ((e.relatedTarget as HTMLElement)?.closest?.(LAYER)) return;
    hovering = false;
    scheduleClose();
}

function Preview({ channel, row, rail }: Target) {
    const { messageCount, maxHeight, width, display, messageGap, animation, clickToJump, scrollbar } =
        settings.use(["messageCount", "maxHeight", "width", "display", "messageGap", "animation", "clickToJump", "scrollbar"]);

    const count = Math.round(messageCount);
    const { messages, failed } = useMessages(channel.id, count);
    const firstUnread = useStateFromStores([ReadStateStore], () => ReadStateStore.getOldestUnreadMessageId(channel.id));
    const theme = useStateFromStores([ThemeStore], () => ThemeStore.theme);

    const rawCompact = MessageDisplayCompact.useSetting();
    const compact = display === "compact" ? true : display === "cozy" ? false : rawCompact;

    const panel = useRef<HTMLDivElement>(null);
    const scroller = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ left: number; top: number; } | null>(null);

    const shown = messages?.slice(-count) ?? [];

    useLayoutEffect(() => {
        const el = panel.current;
        if (!el) return;

        const { offsetWidth: w, offsetHeight: h } = el;
        const right = rail.right + EDGE;
        const left = right + w > window.innerWidth - EDGE ? rail.left - w - EDGE : right;

        setPos({
            left: Math.max(EDGE, left),
            top: Math.max(EDGE, Math.min(row.top, window.innerHeight - h - EDGE))
        });
    }, [row, rail, shown.length, maxHeight, width]);

    useLayoutEffect(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [shown.length]);

    const classes = ["chp-panel", `chp-bar-${scrollbar}`, theme === "light" ? "theme-light" : "theme-dark"];
    if (theme !== "light" && theme !== "dark") classes.push(`theme-${theme}`);
    if (pos && animation !== "none") classes.push(`chp-anim-${animation}`);

    return (
        <div
            ref={panel}
            className={classes.join(" ")}
            onMouseEnter={onPanelEnter}
            onMouseLeave={onPanelLeave}
            style={{
                width,
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                visibility: pos ? "visible" : "hidden",
                "--chp-gap": `${messageGap}px`
            } as CSSProperties}
        >
            <div className="chp-header">{channel.name || "Direct Message"}</div>
            <div
                ref={el => { scroller.current = el; scrollerEl = el; }}
                className="chp-scroller"
                style={{ maxHeight }}
            >
                {shown.length === 0
                    ? <div className="chp-empty">{failed ? `Could not load messages: ${failed}` : "No messages yet"}</div>
                    : shown.flatMap(message => {
                        const rows: JSX.Element[] = [];

                        if (message.id === firstUnread)
                            rows.push(<div key={`unread-${message.id}`} className="chp-unread" />);

                        rows.push(
                            <div
                                key={message.id}
                                className={clickToJump ? "chp-message chp-jump" : "chp-message"}
                                onClick={clickToJump ? e => jump(e, channel, message.id) : undefined}
                            >
                                <ChannelMessage
                                    id={`chp-${channel.id}-${message.id}`}
                                    message={message}
                                    channel={channel}
                                    subscribeToComponentDispatch={false}
                                    compact={compact}
                                />
                            </div>
                        );

                        return rows;
                    })}
            </div>
        </div>
    );
}

function PreviewHost() {
    const current = useTarget();
    if (!current) return null;

    return (
        <ErrorBoundary noop>
            <Preview key={current.channel.id} {...current} />
        </ErrorBoundary>
    );
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") return closeNow();
    if (!target || !scrollerEl || !hovering || e.ctrlKey || e.altKey || e.metaKey) return;

    const { scrollTop, clientHeight, scrollHeight } = scrollerEl;
    let next: number;

    switch (e.key) {
        case "ArrowUp": next = scrollTop - LINE; break;
        case "ArrowDown": next = scrollTop + LINE; break;
        case "PageUp": next = scrollTop - clientHeight * 0.9; break;
        case "PageDown": next = scrollTop + clientHeight * 0.9; break;
        case "Home": next = 0; break;
        case "End": next = scrollHeight; break;
        default: return;
    }

    scrollerEl.scrollTop = next;
    e.preventDefault();
}

function onOutside(e: Event) {
    if (container?.contains(e.target as Node)) return;
    closeNow();
}

export default definePlugin({
    name: "ChannelHoverPreview",
    description: "Hovering a DM or server channel in the sidebar opens a scrollable window with its recent messages.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    tags: ["Chat", "Utility"],
    settings,

    patches: [
        {
            find: "shouldShowThreadsPopout",
            replacement: {
                match: /(onMouseEnter:\i\|\|\i\?this\.handleMouseEnter:void 0,)/,
                replace: "$1onMouseOver:e=>$self.onRowOver(e,this?.props?.channel),onMouseOut:e=>$self.onRowOut(e),"
            }
        },
        {
            find: "PrivateChannel.renderAvatar: Invalid prop configuration - no user or channel",
            replacement: {
                match: /(innerRef:\i,)(?=to:\i\.\i\.CHANNEL\(\i\.\i,(\i)\.id\))/,
                replace: "$1onMouseOver:e=>$self.onRowOver(e,$2),onMouseOut:e=>$self.onRowOut(e),"
            }
        }
    ],

    onRowOver(e: ReactMouseEvent, channel?: Channel) {
        if (!channel) return;
        if (channel.id === target?.channel.id) return cancelClose();
        if (!(channel.isPrivate() ? settings.store.inDms : settings.store.inChannels)) return;
        if (!channel.isPrivate() && !PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)) return;

        const held = modifierHeld(e);
        if (settings.store.requireKey && settings.store.instantKey !== "none" && !held) return;

        const row = e.currentTarget as HTMLElement;
        cancelClose();
        cancelOpen();

        const open = () => {
            openTimer = undefined;
            setTarget({
                channel,
                row: row.getBoundingClientRect(),
                rail: (row.closest(SIDEBAR) ?? row).getBoundingClientRect()
            });
        };

        if (held) return open();

        openTimer = window.setTimeout(open, settings.store.hoverDelay);
    },

    onRowOut(e: ReactMouseEvent) {
        const to = e.relatedTarget as Node | null;
        if (to && e.currentTarget.contains(to)) return;
        scheduleClose();
    },

    start() {
        container = document.createElement("div");
        container.id = "chp-container";
        (document.getElementById("app-mount") ?? document.body).appendChild(container);

        root = createRoot(container);
        root.render(<PreviewHost />);

        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("click", onOutside, true);
        window.addEventListener("scroll", onOutside, true);
        window.addEventListener("blur", closeNow);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("click", onOutside, true);
        window.removeEventListener("scroll", onOutside, true);
        window.removeEventListener("blur", closeNow);

        cancelOpen();
        cancelClose();
        requested.clear();
        target = null;
        scrollerEl = null;
        hovering = false;

        root?.unmount();
        root = null;
        container?.remove();
        container = null;
    }
});
