/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

const PCT_VAR = "--led-cycle";
const LABEL_VAR = "--led-cycle-label";

let timer: number | undefined;

function clearVars() {
    document.body.style.removeProperty(PCT_VAR);
    document.body.style.removeProperty(LABEL_VAR);
}

function update() {
    const strongs = document.querySelector('[class*="billingInformation_"]')?.querySelectorAll("strong");
    if (!strongs || strongs.length < 2) {
        clearVars();
        return;
    }
    const renewText = strongs[0].textContent ?? "";
    const renews = new Date(renewText);
    if (isNaN(renews.getTime())) return;
    const start = new Date(renews);
    start.setMonth(start.getMonth() - 1);
    const now = Date.now();
    const pct = Math.min(100, Math.max(0, 100 * (now - start.getTime()) / (renews.getTime() - start.getTime())));
    const days = Math.max(0, Math.ceil((renews.getTime() - now) / 86_400_000));
    document.body.style.setProperty(PCT_VAR, `${pct.toFixed(1)}%`);
    document.body.style.setProperty(LABEL_VAR, JSON.stringify(`${days} days → ${strongs[1].textContent} · renews ${renewText}`));
}

export default definePlugin({
    name: "LedgerCycleMeter",
    description: "Reads the renewal date and amount off the Subscriptions page and feeds them to the Ledger theme's billing cycle bar as --led-cycle and --led-cycle-label",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    start() {
        timer = window.setInterval(update, 1000);
        update();
    },

    stop() {
        window.clearInterval(timer);
        timer = undefined;
        clearVars();
    }
});
