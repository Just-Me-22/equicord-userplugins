/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const KEYFRAMES = ["gummy-squish_", "toon-animation_", "prism-scroll_", "pop-animation-main_", "pop-animation-shadow_", "neon-flicker-animation_"] as const;

type Key = typeof KEYFRAMES[number];

const EASE = "cubic-bezier(.44,.29,.48,1)";
const ROW = 'li[class*="messageListItem"][class*="messageListItem"] [class*="animated_"][class*="loop_"]';

let style: HTMLStyleElement | null = null;

function keyframeNames(): Partial<Record<Key, string>> {
    const out: Partial<Record<Key, string>> = {};
    for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        for (const rule of rules)
            if (rule instanceof CSSKeyframesRule)
                for (const key of KEYFRAMES) if (rule.name.startsWith(key)) out[key] = rule.name;
    }
    return out;
}

function css(n: Partial<Record<Key, string>>) {
    const rules: string[] = [];
    if (n["gummy-squish_"]) rules.push(`${ROW} span[class*="gummyLetter_"][class*="gummyLetter_"] { animation: ${n["gummy-squish_"]} 4s ${EASE} calc(var(--custom-letter-index, 0) * 50ms) infinite normal forwards !important; }`);
    if (n["toon-animation_"]) rules.push(`${ROW} span[class*="innerContainer_"][class*="toon_"]::before { animation: ${n["toon-animation_"]} 4s ${EASE} infinite normal forwards !important; }`);
    if (n["prism-scroll_"]) rules.push(`${ROW} span[class*="innerContainer_"][class*="prism_"] { animation: ${n["prism-scroll_"]} 2s linear infinite normal forwards !important; }`);
    if (n["pop-animation-main_"]) rules.push(`${ROW} span[class*="innerContainer_"][class*="pop_"] { animation: ${n["pop-animation-main_"]} 4s ${EASE} infinite normal forwards !important; }`);
    if (n["pop-animation-shadow_"]) rules.push(`${ROW} span[class*="innerContainer_"][class*="pop_"]::before { animation: ${n["pop-animation-shadow_"]} 4s ${EASE} infinite normal forwards !important; }`);
    if (n["neon-flicker-animation_"]) rules.push(`${ROW} span[class*="innerContainer_"][class*="neon_"] { animation: ${n["neon-flicker-animation_"]} 4s cubic-bezier(.24,.31,.36,.93) infinite normal forwards !important; }`);
    return `@media (prefers-reduced-motion: no-preference) {\n${rules.join("\n")}\n}`;
}

export function startNameMotion() {
    const names = keyframeNames();
    if (!Object.keys(names).length) return;
    style = document.createElement("style");
    style.id = "vc-nss-name-motion";
    style.textContent = css(names);
    document.head.appendChild(style);
}

export function stopNameMotion() {
    style?.remove();
    style = null;
}
