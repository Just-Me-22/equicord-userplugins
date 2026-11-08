/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

interface Style { label: string; upper?: number; lower?: number; digit?: number; table?: Record<string, string>; holes?: Record<string, string>; }

const SMALL_CAPS = "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ";

export const FANCY: Style[] = [
    { label: "Bold", upper: 0x1D400, lower: 0x1D41A, digit: 0x1D7CE },
    { label: "Italic", upper: 0x1D434, lower: 0x1D44E, holes: { h: "ℎ" } },
    { label: "Bold italic", upper: 0x1D468, lower: 0x1D482 },
    { label: "Script", upper: 0x1D49C, lower: 0x1D4B6, holes: { B: "ℬ", E: "ℰ", F: "ℱ", H: "ℋ", I: "ℐ", L: "ℒ", M: "ℳ", R: "ℛ", e: "ℯ", g: "ℊ", o: "ℴ" } },
    { label: "Bold script", upper: 0x1D4D0, lower: 0x1D4EA },
    { label: "Fraktur", upper: 0x1D504, lower: 0x1D51E, holes: { C: "ℭ", H: "ℌ", I: "ℑ", R: "ℜ", Z: "ℨ" } },
    { label: "Bold fraktur", upper: 0x1D56C, lower: 0x1D586 },
    { label: "Double struck", upper: 0x1D538, lower: 0x1D552, digit: 0x1D7D8, holes: { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" } },
    { label: "Sans bold", upper: 0x1D5D4, lower: 0x1D5EE, digit: 0x1D7EC },
    { label: "Sans italic", upper: 0x1D608, lower: 0x1D622 },
    { label: "Monospace", upper: 0x1D670, lower: 0x1D68A, digit: 0x1D7F6 },
    { label: "Small caps", table: Object.fromEntries([..."abcdefghijklmnopqrstuvwxyz"].map((c, i) => [c, SMALL_CAPS[i]])) },
    { label: "Circled", upper: 0x24B6, lower: 0x24D0 },
    { label: "Wide", upper: 0xFF21, lower: 0xFF41, digit: 0xFF10 }
];

export function fancy(text: string, style: Style): string {
    let out = "";
    for (const ch of text) {
        if (style.holes?.[ch]) { out += style.holes[ch]; continue; }
        if (style.table) { out += style.table[ch.toLowerCase()] ?? ch; continue; }
        const code = ch.charCodeAt(0);
        if (code >= 65 && code <= 90 && style.upper) out += String.fromCodePoint(style.upper + code - 65);
        else if (code >= 97 && code <= 122 && style.lower) out += String.fromCodePoint(style.lower + code - 97);
        else if (code >= 48 && code <= 57 && style.digit) out += String.fromCodePoint(style.digit + code - 48);
        else if (ch === " " && style.label === "Wide") out += "　";
        else out += ch;
    }
    return out;
}

export const DIVIDERS = [
    "˚ ༘ ♡ ⋆｡˚",
    "⋆｡°✩",
    "✧･ﾟ: *✧･ﾟ:*",
    "⊹ ࣪ ˖",
    "─────── ⋆⋅☆⋅⋆ ───────",
    "꒰ ♡ ꒱",
    "・‥…━━━☆",
    "‿︵‿︵‿︵‿︵",
    "♡ ⁺ ˚ ⋆ ˖ ࣪",
    "𓆩♡𓆪",
    "ପ(๑•ᴗ•๑)ଓ ♡",
    "╰┈➤",
    "⋆˚꩜｡",
    "☾ ⋆*･ﾟ:⋆*･ﾟ",
    "✦ ✧ ✦",
    "ʚ ♡ ɞ",
    "⌒⌒⌒⌒⌒",
    "◦•●◉✿ ✿◉●•◦",
    "˗ˏˋ ★ ˎˊ˗",
    "⋆ ˚｡⋆୨୧˚ ˚୨୧⋆｡˚ ⋆",
    "₊˚ʚ ᗢ₊˚✧ ﾟ.",
    "✿ ❀ ✿ ❀",
    "( ˘ ³˘)♥",
    "≽^•⩊•^≼"
];

export const BOXES: Record<string, [string, string, string, string, string, string]> = {
    Square: ["┌", "─", "┐", "│", "└", "┘"],
    Rounded: ["╭", "─", "╮", "│", "╰", "╯"],
    Double: ["╔", "═", "╗", "║", "╚", "╝"],
    Heavy: ["┏", "━", "┓", "┃", "┗", "┛"],
    Dashed: ["┌", "┄", "┐", "┆", "└", "┘"]
};

const HAIR = " ";

export function buildBox(lines: string[], style: string, font: string): string {
    const [tl, h, tr, v, bl, br] = BOXES[style] ?? BOXES.Square;
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = font;
    const w = (s: string) => ctx.measureText(s).width;
    const inner = Math.max(0, ...lines.map(w));
    const side = w(`${v} `) + w(` ${v}`);
    const k = Math.max(1, Math.round((inner + side - w(tl) - w(tr)) / w(h)));
    const target = w(tl) + k * w(h) + w(tr) - side;
    const space = w(" "), hair = w(HAIR) || 1;
    const pad = (line: string) => {
        let rest = Math.max(0, target - w(line));
        const spaces = Math.floor(rest / space);
        rest -= spaces * space;
        return line + " ".repeat(spaces) + HAIR.repeat(Math.round(rest / hair));
    };
    return [tl + h.repeat(k) + tr, ...lines.map(l => `${v} ${pad(l)} ${v}`), bl + h.repeat(k) + br].join("\n");
}
