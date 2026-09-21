/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { PluginNative } from "@utils/types";
import { patches } from "@webpack/patcher";

const Native = VencordNative.pluginHelpers.HealthCheck as PluginNative<typeof import("./native")>;

const DELAY = 25_000;

const logger = new Logger("HealthCheck");

async function guard<T>(step: string, fn: () => T | Promise<T>) {
    try {
        return await fn();
    } catch (err) {
        logger.error(step, err);
        return { error: `${step}: ${String(err)}` } as T;
    }
}

// patches is a live queue: an entry leaves it once a factory matching its find is
// processed, so what remains never resolved. all:true patches never leave.
function patchHealth() {
    return {
        patchCount: patches.length,
        queued: patches
            .filter(p => !p.all)
            .map(p => `${p.plugin} :: ${String(p.find)}`)
            .sort()
    };
}

const PSEUDO_ELEMENT = /::[\w-]+(?:\([^)]*\))?/g;
const STATE_PSEUDO = /:(?:focus-visible|focus-within|focus|hover|active|any-link|link|visited|target|checked|indeterminate|disabled|enabled|placeholder-shown|autofill|popover-open|open|modal|fullscreen|user-valid|user-invalid|valid|invalid|required|optional|read-only|read-write|default|in-range|out-of-range)(?![\w-])/g;
const EMPTY_FUNCTIONAL = /:(?:not|is|where|has)\(\s*\)/g;
const LEADING_COMMA = /\(\s*,+/g;
const TRAILING_COMMA = /,+\s*\)/g;
const REPEATED_COMMA = /,(?:\s*,)+/g;

function splitSelectorList(selectorText: string) {
    const parts: string[] = [];
    let depth = 0;
    let quote = "";
    let start = 0;

    for (let i = 0; i < selectorText.length; i++) {
        const char = selectorText[i];

        if (quote) {
            if (char === "\\") i++;
            else if (char === quote) quote = "";
        } else if (char === "\"" || char === "'") {
            quote = char;
        } else if (char === "(" || char === "[") {
            depth++;
        } else if (char === ")" || char === "]") {
            depth--;
        } else if (char === "," && depth === 0) {
            parts.push(selectorText.slice(start, i));
            start = i + 1;
        }
    }

    parts.push(selectorText.slice(start));
    return parts;
}

function structuralForm(part: string) {
    let selector = part.trim().replace(PSEUDO_ELEMENT, "").replace(STATE_PSEUDO, "");
    let previous: string;

    do {
        previous = selector;
        selector = selector
            .replace(LEADING_COMMA, "(")
            .replace(TRAILING_COMMA, ")")
            .replace(REPEATED_COMMA, ",")
            .replace(EMPTY_FUNCTIONAL, "");
    } while (selector !== previous);

    return selector.trim();
}

function deadSelectors(sheet: CSSStyleSheet) {
    const dead: string[] = [];
    const seen = new Set<string>();

    const walk = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule) {
                for (const part of splitSelectorList(rule.selectorText)) {
                    const selector = structuralForm(part);
                    if (!selector || seen.has(selector)) continue;
                    seen.add(selector);
                    try {
                        if (!document.querySelector(selector)) dead.push(selector);
                    } catch {
                        dead.push(`INVALID ${selector}`);
                    }
                }
            } else if ("cssRules" in rule) {
                walk((rule as CSSGroupingRule).cssRules);
            }
        }
    };

    walk(sheet.cssRules);
    return { tested: seen.size, dead };
}

const IMPORT_RULE = /@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?[^;]*;/g;

type ImportStatus = { url: string; bytes?: number; error?: string; };

// replaceSync discards @import, so imported sheets are fetched and inlined ahead of the
// theme's own text. A sheet that fails to load drops out of the tested set rather than
// counting as dead: check imports[].error before trusting a run.
async function inlineImports(css: string, seen: Set<string>, out: ImportStatus[]) {
    let text = "";

    for (const [, url] of css.matchAll(IMPORT_RULE)) {
        if (seen.has(url)) continue;
        seen.add(url);

        if (!/^https?:\/\//i.test(url)) {
            out.push({ url, error: "not http(s)" });
            continue;
        }

        const { css: imported, error } = await Native.fetchSheet(url);
        if (imported == null) {
            out.push({ url, error: error ?? "no body" });
            continue;
        }

        out.push({ url, bytes: imported.length });
        text += await inlineImports(imported, seen, out) + imported;
    }

    return text;
}

async function themeHealth() {
    const out: Record<string, unknown> = {};

    for (const name of Settings.enabledThemes ?? []) {
        out[name] = await guard(`theme ${name}`, async () => {
            const css = await Native.readTheme(name);
            if (css == null) return { error: "could not read file" };

            const imports: ImportStatus[] = [];
            const imported = await inlineImports(css, new Set(), imports);

            const sheet = new CSSStyleSheet();
            sheet.replaceSync(imported + css);
            return { rules: sheet.cssRules.length, imports, ...deadSelectors(sheet) };
        });
    }

    return out;
}

async function report() {
    const env = (window as any).GLOBAL_ENV ?? {};

    return {
        at: new Date().toISOString(),
        channel: env.RELEASE_CHANNEL ?? "unknown",
        build: (window as any).DiscordNative?.app?.getBuildNumber?.() ?? null,
        route: location.hostname,
        enabledThemes: Settings.enabledThemes ?? null,
        patches: await guard("patches", patchHealth),
        themes: await guard("themes", themeHealth)
    };
}

export default definePlugin({
    name: "HealthCheck",
    description: "Writes a startup health snapshot (patch coverage, theme selectors that match nothing, client build) to equicord-health.jsonl for the daily regression check.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    start() {
        setTimeout(async () => {
            try {
                const path = await Native.appendReport(JSON.stringify(await report()));
                logger.info("snapshot appended to", path);
            } catch (err) {
                logger.error("could not write snapshot", err);
            }
        }, DELAY);
    }
});
