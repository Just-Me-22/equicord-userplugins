/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Channel } from "@vencord/discord-types";
import { createRoot, IconUtils, NavigationRouter, useEffect, useRef, UserStore, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

import { ageOf } from "./format";
import { Line, linesBefore } from "./recent";

const cl = classNameFactory("vc-channel-peek-");

const OPEN_AFTER = 600;
const CLOSE_AFTER = 180;

let host: HTMLElement | null = null;
let root: Root | null = null;
let openTimer = 0;
let closeTimer = 0;
let showing: string | null = null;

function render(node: React.ReactNode) {
    if (!host?.isConnected) {
        host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
    }
    root!.render(node);
}

function hide() {
    clearTimeout(openTimer);
    showing = null;
    root?.render(null);
}

export function destroyHoverCard() {
    hide();
    clearTimeout(closeTimer);
    root?.unmount();
    host?.remove();
    root = null;
    host = null;
}

const stayOpen = () => clearTimeout(closeTimer);
const leave = () => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = window.setTimeout(hide, CLOSE_AFTER);
};

function Card({ channel, at }: { channel: Channel; at: DOMRect; }) {
    const [lines, setLines] = useState<Line[] | null>(null);
    const [more, setMore] = useState(true);
    const loading = useRef(false);
    const box = useRef<HTMLDivElement>(null);

    useEffect(() => {
        linesBefore(channel.id, undefined, 3).then(setLines, () => setLines([]));
    }, [channel.id]);

    const older = async () => {
        if (loading.current || !more || !lines?.length) return;
        loading.current = true;
        try {
            const next = await linesBefore(channel.id, lines[0].id, 5);
            if (!next.length) setMore(false);
            setLines(now => [...next.filter(one => !now?.some(old => old.id === one.id)), ...(now ?? [])]);
        } finally {
            loading.current = false;
        }
    };

    const onWheel = (e: React.WheelEvent) => {
        const node = box.current;
        if (e.deltaY < 0 && node && node.scrollTop <= 0) older();
    };

    const top = Math.min(at.bottom + 4, window.innerHeight - 260);

    return (
        <div
            className={cl("card")}
            style={{ left: at.left, top, width: Math.max(260, at.width) }}
            onMouseEnter={stayOpen}
            onMouseLeave={leave}
        >
            <div ref={box} className={cl("card-lines")} onWheel={onWheel}>
                {more && lines && lines.length > 0 && <div className={cl("card-hint")}>scroll up for older</div>}
                {!lines && <div className={cl("card-hint")}>loading</div>}
                {lines?.length === 0 && <div className={cl("card-hint")}>nothing to show</div>}
                {lines?.map(line => {
                    const user = UserStore.getUser(line.authorId);
                    return (
                        <button
                            key={line.id}
                            type="button"
                            className={cl("card-line", { "card-bot": line.bot })}
                            onClick={() => { hide(); NavigationRouter.transitionTo(`/channels/${channel.guild_id}/${channel.id}/${line.id}`); }}
                        >
                            {user && <img className={cl("card-avatar")} src={IconUtils.getUserAvatarURL(user, false, 32)} alt="" />}
                            <span className={cl("card-body")}>
                                <span className={cl("card-head")}>
                                    <span className={cl("card-name")}>{line.name}</span>
                                    <span className={cl("age")}>{ageOf(line.at)}</span>
                                </span>
                                <span className={cl("card-text")}>{line.content || "…"}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function hoverHandlers(channel: Channel) {
    return {
        onMouseEnter(e: React.MouseEvent<HTMLElement>) {
            stayOpen();
            if (showing === channel.id) return;
            const row = (e.currentTarget.closest("li") ?? e.currentTarget) as HTMLElement;
            clearTimeout(openTimer);
            openTimer = window.setTimeout(() => {
                if (!row.isConnected) return;
                showing = channel.id;
                render(<Card key={channel.id} channel={channel} at={row.getBoundingClientRect()} />);
            }, OPEN_AFTER);
        },
        onMouseLeave: leave
    };
}
