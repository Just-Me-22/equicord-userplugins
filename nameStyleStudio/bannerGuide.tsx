/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Modal, openModal, useEffect, useState } from "@webpack/common";

import { toHex } from "./color";
import { bannerImage, themeColorsNow } from "./sources";

const FRAMES = [
    { id: "popout", label: "Popout", w: 300, h: 120, avatar: 80, x: 16 },
    { id: "full", label: "Full profile", w: 600, h: 212, avatar: 120, x: 24 },
    { id: "mobile", label: "Mobile", w: 390, h: 156, avatar: 88, x: 16 }
];

const NARROWEST = Math.min(...FRAMES.map(f => f.w / f.h));

const EXPORT_W = 680;
const EXPORT_H = 240;

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not load your banner"));
        img.src = src;
    });
}

async function exportFaded(src: string | undefined, fill: number, fade: number): Promise<Blob | null> {
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_W;
    canvas.height = EXPORT_H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = toHex(fill);
    ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);
    if (src) {
        const img = await loadImage(src);
        const scale = Math.max(EXPORT_W / img.naturalWidth, EXPORT_H / img.naturalHeight);
        const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
        ctx.drawImage(img, (EXPORT_W - w) / 2, (EXPORT_H - h) / 2, w, h);
    }
    if (fade > 0) {
        const g = ctx.createLinearGradient(0, EXPORT_H * (1 - fade), 0, EXPORT_H);
        g.addColorStop(0, `${toHex(fill)}00`);
        g.addColorStop(1, toHex(fill));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);
    }
    return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

function Guide({ guildId }: { guildId?: string | null; }) {
    const [src, setSrc] = useState<string | undefined | null>(null);
    const [fade, setFade] = useState(0);
    const [guides, setGuides] = useState(true);
    const [note, setNote] = useState<string | null>(null);
    const fill = themeColorsNow(guildId)[0] ?? 0x1e1f22;

    useEffect(() => { bannerImage(guildId).then(setSrc, () => setSrc(void 0)); }, []);

    const animated = !!src && (/\.gif(\?|$)/i.test(src) || /\/a_[0-9a-f]+/.test(src));
    const overlay = fade > 0 ? `linear-gradient(to bottom, ${toHex(fill)}00 ${Math.round((1 - fade) * 100)}%, ${toHex(fill)} 100%)` : "";
    const background = [overlay, src ? `url("${src}") center / cover no-repeat` : ""].filter(Boolean).join(", ") || toHex(fill);

    async function download() {
        setNote(null);
        try {
            const blob = await exportFaded(src ?? void 0, fill, fade);
            if (!blob) return setNote("Could not create the image.");
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "banner-faded.png";
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            setNote("Saved banner-faded.png. Upload it as your banner in the editor.");
        } catch (e) {
            setNote(String((e as Error).message ?? e));
        }
    }

    return (
        <div className="vc-bg">
            {src === null && <span className="vc-nss-muted">Reading your banner…</span>}
            {src === void 0 && <span className="vc-nss-muted">You have no banner image, so this shows your theme colour.</span>}
            <div className="vc-bg-frames">
                {FRAMES.map(f => (
                    <figure key={f.id} className="vc-bg-frame" style={{ ["--vc-bg-ratio" as string]: `${f.w} / ${f.h}` }}>
                        <div className="vc-bg-shot" style={{ background }}>
                            {guides && (
                                <span
                                    className="vc-bg-avatar"
                                    style={{ width: `${f.avatar / f.w * 100}%`, left: `${f.x / f.w * 100}%`, top: `calc(100% - ${f.avatar / 2 / f.h * 100}%)` }}
                                    aria-hidden="true"
                                />
                            )}
                            {guides && <span className="vc-bg-safe" style={{ width: `${Math.min(1, NARROWEST / (f.w / f.h)) * 100}%` }} aria-hidden="true" />}
                        </div>
                        <figcaption className="vc-nss-muted">{f.label} · about {f.w}×{f.h}</figcaption>
                    </figure>
                ))}
            </div>
            <label className="vc-nss-row vc-nts-tune">
                <span className="vc-nss-muted vc-nss-label">Fade</span>
                <span className="vc-nts-track" style={{ background: `linear-gradient(to right, transparent, ${toHex(fill)})` }}>
                    <input type="range" min={0} max={0.8} step={0.01} value={fade} aria-label="Fade into your theme colour" onChange={e => setFade(Number(e.currentTarget.value))} />
                </span>
                <span className="vc-nss-muted vc-nss-value">{Math.round(fade / 0.8 * 100)}%</span>
            </label>
            <div className="vc-nss-row">
                <button className={`vc-nss-chip${guides ? " vc-nss-chip-on" : ""}`} aria-pressed={guides} onClick={() => setGuides(!guides)}>Avatar and safe area</button>
                <button className="vc-nss-chip" disabled={src === null} onClick={download}>Save faded banner</button>
            </div>
            <span className="vc-nss-muted">
                The dashed box is the area every view shows, so keep faces and text inside it. The circle is where your avatar covers the banner.
                {animated ? " Your banner is animated, so the saved file will be a still image." : ""}
            </span>
            {note && <span className="vc-nss-muted">{note}</span>}
        </div>
    );
}

export function openBannerGuide(guildId?: string | null) {
    openModal(modal => (
        <Modal
            {...modal}
            size="md"
            title="Banner crop guide"
            actions={[{ text: "Done", variant: "primary", onClick: modal.onClose }]}
        >
            <ErrorBoundary noop>
                <Guide guildId={guildId} />
            </ErrorBoundary>
        </Modal>
    ));
}
