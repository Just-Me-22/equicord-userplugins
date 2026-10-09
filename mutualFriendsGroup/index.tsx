/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { ChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { ChannelMemberStore, SelectedGuildStore, useStateFromStores } from "@webpack/common";
import type { SVGProps } from "react";

interface GroupRow {
    type: "GROUP";
    key: string;
    id: string;
    title: string;
    count: number;
}

interface Group extends GroupRow {
    index: number;
    onlineCount?: number;
}

interface MemberRow {
    type: "MEMBER";
    user: User;
    status: string;
}

type Row = GroupRow | MemberRow;

interface MemberView {
    rows: Row[];
    groups: Group[];
}

interface MemberList extends MemberView {
    version: number;
}

interface ProfileFetch {
    userProfile: { user: { id: string; }; mutual_friends?: unknown[]; mutual_friends_count?: number; };
}

interface MutualFriendsFetch {
    userId: string;
    mutualFriends: unknown[];
}

const STORE_KEY = "MutualFriendsGroup_counts";
const SETTING_KEYS: "mutualGroup"[] = ["mutualGroup"];
const GROUP_ID = "vc-mutual-friends";

let counts = new Map<string, number>();
let cache = new WeakMap<MemberList, { version: number; view: MemberView; }>();

const settings = definePluginSettings({
    mutualGroup: {
        type: OptionType.BOOLEAN,
        description: "Move members you share friends with into a Mutual friends group at the top of the member list.",
        default: false,
        onChange: refreshList
    }
});

function GroupIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
            <circle cx="8" cy="7.5" r="3.4" />
            <path d="M1.5 19.5c0-3.5 2.8-5.8 6.5-5.8s6.5 2.3 6.5 5.8v.5h-13z" />
            <rect x="16" y="5.5" width="6.5" height="2.2" rx="1.1" />
            <rect x="16" y="10.5" width="5" height="2.2" rx="1.1" />
            <rect x="16" y="15.5" width="3.4" height="2.2" rx="1.1" />
        </svg>
    );
}

const GroupButton = ErrorBoundary.wrap(() => {
    const { mutualGroup } = settings.use(SETTING_KEYS);
    const inGuild = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId() != null);

    if (!inGuild) return null;

    return (
        <ChannelToolbarButton
            icon={GroupIcon}
            tooltip={mutualGroup ? "Hide the mutual friends group" : "Show a mutual friends group"}
            selected={mutualGroup}
            onClick={() => { settings.store.mutualGroup = !mutualGroup; }}
        />
    );
}, { noop: true });

function refreshList() {
    cache = new WeakMap();
    ChannelMemberStore.emitChange();
}

function saveCount(userId: string, count: number) {
    counts.set(userId, count);
    void DataStore.set(STORE_KEY, counts);
    if (settings.store.mutualGroup) refreshList();
}

function withMutualGroup({ rows, groups }: MemberView): MemberView {
    const moved = new Set<number>();
    const picked: { row: MemberRow; mutual: number; }[] = [];

    rows.forEach((row, i) => {
        if (row.type !== "MEMBER") return;
        const mutual = counts.get(row.user.id) ?? 0;
        if (mutual === 0) return;
        moved.add(i);
        picked.push({ row, mutual });
    });

    if (!picked.length) return { rows, groups };

    picked.sort((a, b) => b.mutual - a.mutual);

    const header: Group = {
        type: "GROUP",
        key: GROUP_ID,
        id: GROUP_ID,
        title: "Mutual friends",
        count: picked.length,
        onlineCount: picked.filter(({ row }) => row.status !== "offline").length,
        index: 0
    };
    const newGroups = [header];
    const newRows: Row[] = [header, ...picked.map(({ row }) => row)];
    let pos = newRows.length;

    for (const group of groups) {
        const start = pos++;

        for (let i = group.index + 1; i <= group.index + group.count; i++) {
            if (moved.has(i)) continue;
            if (i in rows) newRows[pos] = rows[i];
            pos++;
        }

        const count = pos - start - 1;
        newGroups.push({ ...group, count, index: start });

        const oldHeader = rows[group.index];
        if (oldHeader?.type === "GROUP") newRows[start] = { ...oldHeader, count };
    }

    newRows.length = pos;
    return { rows: newRows, groups: newGroups };
}

export default definePlugin({
    name: "MutualFriendsGroup",
    description: "Moves members you share friends with into a group at the top of the member list.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    dependencies: ["HeaderBarAPI"],
    settings,

    patches: [
        {
            find: 'displayName="ChannelMemberStore"',
            replacement: [
                {
                    match: /groups:(\i)\.groups,rows:\1\.rows(?=,version:\1\.version)/,
                    replace: "...$self.view($1)"
                },
                {
                    match: /getRows\((\i),(\i)\)\{return (\i\.get\(\i,\i\(\i\)\))\.rows\}/,
                    replace: "getRows($1,$2){return $self.view($3).rows}"
                }
            ]
        }
    ],

    headerBarButton: {
        icon: GroupIcon,
        location: "channeltoolbar",
        render: () => <GroupButton />
    },

    flux: {
        USER_PROFILE_FETCH_SUCCESS({ userProfile }: ProfileFetch) {
            const count = userProfile.mutual_friends?.length ?? userProfile.mutual_friends_count;
            if (count != null) saveCount(userProfile.user.id, count);
        },
        MUTUAL_FRIENDS_FETCH_SUCCESS({ userId, mutualFriends }: MutualFriendsFetch) {
            saveCount(userId, mutualFriends.length);
        }
    },

    async start() {
        const stored = await DataStore.get<Map<string, number>>(STORE_KEY);
        counts = new Map([...stored ?? [], ...counts]);
        refreshList();
    },

    view(list: MemberList): MemberView {
        if (!settings.store.mutualGroup) return { rows: list.rows, groups: list.groups };

        const hit = cache.get(list);
        if (hit?.version === list.version) return hit.view;

        const view = withMutualGroup(list);
        cache.set(list, { version: list.version, view });
        return view;
    }
});
