/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { ChannelSectionStore } from "@webpack/common";

interface Sections {
    MEMBERS: unknown;
    SIDEBAR_CHAT: unknown;
}

export default definePlugin({
    name: "MemberListWithThreads",
    description: "Keeps the member list on screen while a thread is open in the sidebar, instead of Discord showing one or the other",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    patches: [
        {
            find: "Missing channel in Channel.renderSidebar",
            replacement: {
                match: /else if\((\i)===(\i\.\i)\.MEMBERS\)/,
                replace: "else if($self.showMembers($1,$2))"
            }
        }
    ],

    showMembers(section: unknown, sections: Sections) {
        if (section === sections.MEMBERS) return true;
        if (section !== sections.SIDEBAR_CHAT) return false;

        return (ChannelSectionStore as any).getState().isMembersOpen === true;
    }
});
