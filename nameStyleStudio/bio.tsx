/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { copyToClipboard } from "@utils/clipboard";
import { classes } from "@utils/misc";
import { findByCodeLazy } from "@webpack";
import { Modal, openModal, useMemo, useRef, UserProfileStore, UserStore, useState } from "@webpack/common";

import { BOXES, buildBox, DIVIDERS, FANCY,fancy } from "./fancy";
import { RealPreview, usePending } from "./preview";
import { Segmented, useFrame } from "./ui";

const setPending = findByCodeLazy('type:"USER_PROFILE_SETTINGS_SET_PENDING_CHANGES"', '"themeColors"in');

type Tab = "dividers" | "box" | "letters";

const TABS: Record<Tab, string> = { dividers: "Dividers", box: "Box builder", letters: "Fancy letters" };

const memory = { tab: "dividers" as Tab, style: "Square", lines: "My Cute Husky ♡\n" };

const FORMATS: { label: string; title: string; before: string; after?: string; line?: boolean; }[] = [
    { label: "B", title: "Bold", before: "**" },
    { label: "I", title: "Italic", before: "*" },
    { label: "U", title: "Underline", before: "__" },
    { label: "S", title: "Strikethrough", before: "~~" },
    { label: "||", title: "Spoiler", before: "||" },
    { label: "</>", title: "Inline code", before: "`" },
    { label: "H1", title: "Big heading", before: "# ", line: true },
    { label: "H2", title: "Heading", before: "## ", line: true },
    { label: "-#", title: "Small grey text", before: "-# ", line: true },
    { label: ">", title: "Quote", before: "> ", line: true }
];

function savedBio(guildId?: string | null): string {
    const user = UserStore.getCurrentUser() as { id: string; } | undefined;
    if (!user) return "";
    const guildBio = guildId ? (UserProfileStore as any).getGuildMemberProfile?.(user.id, guildId)?.bio : null;
    return guildBio ?? (UserProfileStore.getUserProfile(user.id) as any)?.bio ?? "";
}

function bioLimit(): number {
    const sizes = [...document.querySelectorAll<HTMLTextAreaElement>('[role="dialog"] textarea[maxlength]')].map(t => t.maxLength).filter(n => n >= 190);
    return sizes.length ? Math.max(...sizes) : 190;
}

const bodyFont = () => `400 14px ${getComputedStyle(document.body).fontFamily}`;

function BioStudio({ guildId }: { guildId?: string | null; }) {
    const pending = usePending(guildId);
    const [text, setText] = useState<string>(() => typeof pending.pendingBio === "string" ? pending.pendingBio : savedBio(guildId));
    const [tab, setTab] = useState<Tab>(memory.tab);
    const [style, setStyle] = useState(memory.style);
    const [lines, setLines] = useState(memory.lines);
    const [word, setWord] = useState("Angeltastic");
    const [note, setNote] = useState<string | null>(null);
    const area = useRef<HTMLTextAreaElement>(null);
    const limit = useMemo(bioLimit, []);
    const write = useFrame((t: string) => setPending({ guildId: guildId ?? void 0, bio: t }));

    function update(next: string, caret?: number) {
        setText(next);
        write(next);
        if (caret == null) return;
        requestAnimationFrame(() => {
            area.current?.focus();
            area.current?.setSelectionRange(caret, caret);
        });
    }

    function insert(snippet: string) {
        const el = area.current;
        const s = el?.selectionStart ?? text.length;
        const e = el?.selectionEnd ?? text.length;
        update(text.slice(0, s) + snippet + text.slice(e), s + snippet.length);
    }

    function format(f: typeof FORMATS[number]) {
        const el = area.current;
        const s = el?.selectionStart ?? text.length;
        const e = el?.selectionEnd ?? text.length;
        if (f.line) {
            const start = text.lastIndexOf("\n", s - 1) + 1;
            update(text.slice(0, start) + f.before + text.slice(start), e + f.before.length);
            return;
        }
        const after = f.after ?? f.before;
        update(text.slice(0, s) + f.before + text.slice(s, e) + after + text.slice(e), s === e ? s + f.before.length : e + f.before.length + after.length);
    }

    const box = useMemo(() => {
        const rows = lines.split("\n").map(l => l.trimEnd()).filter((l, i, all) => l.length || i < all.length - 1);
        return rows.length ? buildBox(rows, style, bodyFont()) : "";
    }, [lines, style]);

    const over = text.length > limit;

    return (
        <div className="vc-nss-body vc-bio">
            <div className="vc-bio-bar" role="toolbar" aria-label="Formatting">
                {FORMATS.map(f => (
                    <button key={f.label} className="vc-bio-fmt" title={f.title} aria-label={f.title} onMouseDown={e => e.preventDefault()} onClick={() => format(f)}>{f.label}</button>
                ))}
            </div>
            <textarea
                ref={area}
                className="vc-bio-area"
                value={text}
                spellCheck={false}
                aria-label="Your bio"
                onChange={e => update(e.currentTarget.value)}
            />
            <div className="vc-nss-row">
                <span className={classes("vc-nss-muted", over && "vc-bio-over")}>{text.length} / {limit}{over ? ", Discord won't save this until it's shorter" : ""}</span>
            </div>

            <Segmented value={tab} options={TABS} onChange={t => setTab(memory.tab = t)} label="Bio tools" />

            <div key={tab} className="vc-nss-panel">
                {tab === "dividers" && (
                    <div className="vc-bio-dividers">
                        {DIVIDERS.map(d => <button key={d} className="vc-bio-divider" title="Insert at the cursor" onClick={() => insert(d)}>{d}</button>)}
                    </div>
                )}

                {tab === "box" && (
                    <>
                        <span className="vc-nss-muted">One line per row. The right edge is measured in Discord's font so it lines up.</span>
                        <textarea className="vc-bio-lines" value={lines} spellCheck={false} aria-label="Box text" onChange={e => setLines(memory.lines = e.currentTarget.value)} />
                        <div className="vc-nss-chips" role="radiogroup" aria-label="Box style">
                            {Object.keys(BOXES).map(k => (
                                <button key={k} role="radio" aria-checked={style === k} className={classes("vc-nss-chip", style === k && "vc-nss-chip-on")} onClick={() => setStyle(memory.style = k)}>{k}</button>
                            ))}
                        </div>
                        {box && <pre className="vc-bio-boxpreview">{box}</pre>}
                        <div className="vc-nss-row">
                            <button className="vc-nss-chip" disabled={!box} onClick={() => insert(box)}>Insert box</button>
                            <button className="vc-nss-chip" disabled={!box} onClick={async () => { await copyToClipboard(box); setNote("Box copied."); }}>Copy</button>
                        </div>
                    </>
                )}

                {tab === "letters" && (
                    <>
                        <input className="vc-nss-hex vc-bio-word" value={word} spellCheck={false} aria-label="Text to convert" onChange={e => setWord(e.currentTarget.value)} />
                        <div className="vc-bio-fancy">
                            {FANCY.map(f => {
                                const out = fancy(word, f);
                                return (
                                    <div key={f.label} className="vc-bio-fancy-row">
                                        <span className="vc-bio-fancy-text" title={f.label}>{out}</span>
                                        <button className="vc-nss-chip" onClick={() => insert(out)}>Insert</button>
                                        <button className="vc-nss-chip" onClick={async () => { await copyToClipboard(out); setNote(`${f.label} copied.`); }}>Copy</button>
                                    </div>
                                );
                            })}
                        </div>
                        <span className="vc-nss-muted">These work anywhere in your bio. In a display name they skip your name style font and show in a plain fallback font.</span>
                    </>
                )}
                {note && <span className="vc-nss-muted">{note}</span>}
            </div>
        </div>
    );
}

export function openBioStudio(guildId?: string | null) {
    openModal(modal => (
        <Modal
            {...modal}
            size="lg"
            title="Bio studio"
            actions={[{ text: "Done", variant: "primary", onClick: modal.onClose }]}
        >
            <div className="vc-nts-modal">
                <ErrorBoundary noop>
                    <div className="vc-nts-modal-tools">
                        <BioStudio guildId={guildId} />
                    </div>
                </ErrorBoundary>
                <ErrorBoundary noop>
                    <div className="vc-nts-modal-preview">
                        <div className="vc-nts-stagebox theme-dark" aria-label="Your profile with this bio">
                            <RealPreview guildId={guildId} />
                        </div>
                    </div>
                </ErrorBoundary>
            </div>
        </Modal>
    ));
}
