/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { findByCodeLazy } from "@webpack";
import { Modal, openModal, useMemo, UserStore, useState } from "@webpack/common";

import { CategoryStore, plateRef, PurchaseStore, RealPreview } from "./preview";

type Slot = "decoration" | "effect" | "frame" | "nameplate";

const TYPES: Record<Slot, number> = { decoration: 0, effect: 1, nameplate: 2, frame: 3 };
const LABELS: Record<Slot, string> = { decoration: "Decoration", effect: "Profile effect", frame: "Profile frame", nameplate: "Nameplate" };
const CDN = "https://cdn.discordapp.com";
const KEYS: Record<Slot, string> = { decoration: "avatarDecoration", effect: "profileEffect", frame: "profileFrame", nameplate: "nameplate" };

const setPending = findByCodeLazy('type:"USER_PROFILE_SETTINGS_SET_PENDING_CHANGES"', '"themeColors"in');

interface Entry { skuId: string; name: string; owned: boolean; item: any; }

type Pick = Entry | "none" | null;

function catalogue(type: number): Entry[] {
    const out = new Map<string, Entry>();
    for (const purchase of (PurchaseStore.purchases as Map<string, any> | undefined)?.values() ?? []) {
        const item = purchase.items?.find((i: any) => i.type === type);
        if (item) out.set(purchase.skuId, { skuId: purchase.skuId, name: purchase.name ?? item.label ?? "Owned item", owned: true, item });
    }
    for (const product of (CategoryStore.products as Map<string, any> | undefined)?.values() ?? []) {
        if (out.has(product.skuId)) continue;
        const item = product.items?.find((i: any) => i.type === type);
        if (item) out.set(product.skuId, { skuId: product.skuId, name: product.name ?? item.label ?? "Shop item", owned: false, item });
    }
    return [...out.values()];
}

function thumbOf(slot: Slot, e: Entry): string | undefined {
    if (slot === "decoration" && e.item.asset) return `${CDN}/avatar-decoration-presets/${e.item.asset}.png?size=64&passthrough=false`;
    if (slot === "effect") return e.item.thumbnailPreviewSrc;
    if (slot === "nameplate" && e.item.asset) return `${CDN}/assets/collectibles/${e.item.asset}static.png`;
    return void 0;
}

function SlotPicker({ slot, pick, onPick }: { slot: Slot; pick: Pick; onPick(p: Pick): void; }) {
    const [query, setQuery] = useState("");
    const [ownedOnly, setOwnedOnly] = useState(false);
    const all = useMemo(() => catalogue(TYPES[slot]), [slot]);
    const q = query.trim().toLowerCase();
    const list = all
        .filter(e => (!ownedOnly || e.owned) && (!q || e.name.toLowerCase().includes(q)))
        .sort((a, b) => Number(b.owned) - Number(a.owned))
        .slice(0, 48);
    const current = pick === "none" ? "None" : pick ? pick.name : "What you're wearing";

    return (
        <div className="vc-try-slot">
            <div className="vc-try-head">
                <span className="vc-try-label">{LABELS[slot]}</span>
                <span className="vc-nss-muted vc-try-current">{current}</span>
                <button className={classes("vc-nss-chip", pick === "none" && "vc-nss-chip-on")} onClick={() => onPick(pick === "none" ? null : "none")}>None</button>
                {pick !== null && <button className="vc-nss-chip" onClick={() => onPick(null)}>Reset</button>}
            </div>
            <div className="vc-try-filter">
                <input className="vc-nss-hex vc-try-search" value={query} placeholder={`Search ${all.length} ${LABELS[slot].toLowerCase()}s`} spellCheck={false} aria-label={`Search ${LABELS[slot]}`} onChange={e => setQuery(e.currentTarget.value)} />
                <button className={classes("vc-nss-chip", ownedOnly && "vc-nss-chip-on")} aria-pressed={ownedOnly} onClick={() => setOwnedOnly(!ownedOnly)}>Owned</button>
            </div>
            <div className="vc-try-strip" role="listbox" aria-label={LABELS[slot]}>
                {list.length === 0 && <span className="vc-nss-muted">Nothing found. The shop list fills in after you open the shop once.</span>}
                {list.map(e => {
                    const src = thumbOf(slot, e);
                    const on = pick !== "none" && pick?.skuId === e.skuId;
                    return (
                        <button key={e.skuId} role="option" aria-selected={on} title={`${e.name}${e.owned ? "" : " (shop)"}`} className={classes("vc-try-item", on && "vc-try-on", slot === "nameplate" && "vc-try-wide")} onClick={() => onPick(on ? null : e)}>
                            {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <span className="vc-try-name">{e.name}</span>}
                            {!e.owned && <span className="vc-try-shop" aria-hidden="true" />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function Rack({ guildId }: { guildId?: string | null; }) {
    const [picks, setPicks] = useState<Record<Slot, Pick>>({ decoration: null, effect: null, frame: null, nameplate: null });
    const set = (slot: Slot) => (p: Pick) => setPicks(prev => ({ ...prev, [slot]: p }));

    const overrides: Record<string, unknown> = {};
    const value = (p: Pick, map: (e: Entry) => unknown) => p === "none" ? null : p ? map(p) : void 0;
    if (picks.decoration) overrides.pendingAvatarDecoration = value(picks.decoration, e => e.item);
    if (picks.effect) overrides.pendingProfileEffect = value(picks.effect, e => e.item);
    if (picks.frame) overrides.pendingProfileFrame = value(picks.frame, e => ({ skuId: e.skuId, type: TYPES.frame }));

    const plate = picks.nameplate && picks.nameplate !== "none" ? picks.nameplate.item : null;
    const Plate = plateRef.current;
    const shopCount = Object.values(picks).filter(p => p && p !== "none" && !p.owned).length;
    const wearable = (Object.keys(picks) as Slot[]).filter(s => picks[s] === "none" || (picks[s] as Entry | null)?.owned);
    const [worn, setWorn] = useState(false);

    function wear() {
        const change: Record<string, unknown> = { guildId: guildId ?? void 0 };
        for (const slot of wearable) {
            const p = picks[slot];
            change[KEYS[slot]] = p === "none" ? null : slot === "frame" ? { skuId: (p as Entry).skuId, type: TYPES.frame } : (p as Entry).item;
        }
        setPending(change);
        setWorn(true);
    }

    return (
        <div className="vc-nts-modal">
            <div className="vc-nts-modal-tools vc-try">
                {(["decoration", "effect", "frame", "nameplate"] as Slot[]).map(slot => <SlotPicker key={slot} slot={slot} pick={picks[slot]} onPick={set(slot)} />)}
                <div className="vc-nss-row">
                    <button className="vc-nss-chip" disabled={!wearable.length} onClick={wear}>Wear what I own</button>
                    {worn && <span className="vc-nss-muted">Done. Save in the editor to keep it.</span>}
                </div>
                <span className="vc-nss-muted">
                    Picking only changes this preview. {shopCount ? `${shopCount} of these ${shopCount === 1 ? "is" : "are"} from the shop. ` : ""}"Wear what I own" puts your owned picks into the editor; shop items stay preview only.
                </span>
            </div>
            <div className="vc-nts-modal-preview">
                <div className="vc-nts-stagebox theme-dark" aria-label="Your profile wearing these">
                    <ErrorBoundary noop>
                        <RealPreview guildId={guildId} overrides={overrides} />
                    </ErrorBoundary>
                </div>
                {picks.nameplate && picks.nameplate !== "none" && (
                    <div className="vc-try-plate">
                        {Plate
                            ? <ErrorBoundary noop><Plate nameplate={plate} user={UserStore.getCurrentUser()} showPlaceholderUser={false} isHighlighted /></ErrorBoundary>
                            : <span className="vc-nss-muted">Open the nameplate picker once and nameplates will preview here.</span>}
                    </div>
                )}
            </div>
        </div>
    );
}

export function openTryOn(guildId?: string | null) {
    openModal(modal => (
        <Modal
            {...modal}
            size="lg"
            title="Try-on rack"
            actions={[{ text: "Done", variant: "primary", onClick: modal.onClose }]}
        >
            <ErrorBoundary noop>
                <Rack guildId={guildId} />
            </ErrorBoundary>
        </Modal>
    ));
}
