/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";
import "./pickers.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import type { ReactNode } from "react";

import { renderSection } from "./editor";
import { decorationGallery, effectGallery, frameGallery, nameplateGallery } from "./galleries";
import { startPickers, stopPickers } from "./pickers";
import { settings } from "./settings";
import { Studio, StudioProps } from "./Studio";
import { ThemeStudioLauncher, ThemeStudioProps } from "./ThemeStudio";

const GRADIENT = 2;

export default definePlugin({
    name: "NameStyleStudio",
    description: "Adds palette tools to the profile editor: colours from your avatar, banner, decoration, nameplate or name style, harmonies, a gradient editor, fine-tune sliders, a readability check, and a picker with hex and eyedropper on every slot, for both the Display Name Style editor and your profile theme",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    settings,

    patches: [
        {
            find: 'location:"UserNameWithEffects"',
            predicate: () => settings.store.movingGradient,
            replacement: [
                {
                    match: /(function\((\i),(\i)\)\{var \i,\i,\i;let\{shouldWrap:\i=!1,fontOpacity:\i=1,nameLength:(\i)=0\}[^]+?return\{\.\.\.\i,)(?="--custom-display-name-styles-wrap")/,
                    replace: "$1...$self.gradientPrism($2,$3,$4),"
                },
                {
                    match: /case (\i\.\i)\.GRADIENT:(case \1\.GLOW:return \i\.\i;)(case \1\.PRISM:)/,
                    replace: "$2case $1.GRADIENT:$3"
                }
            ]
        },
        {
            find: '"ProfileEffectModal"',
            replacement: [
                {
                    match: /(?<=let\{user:\i,guild:\i,pendingProfileEffect:\i,selectedProfileEffectRef:\i,onSelect:\i,onOpenShop:\i\}=(\i),(\i)=\i\(\),[^;]{0,120};)return(?=\(0,\i\.jsx\)\("section")/,
                    replace: "return $self.effectGallery({props:$1,sections:$2},"
                },
                {
                    match: /getItemHeight:(\i),removeEdgeItemGutters:!0\}\)\}\)(?=\};var)/,
                    replace: "getItemHeight:$1,removeEdgeItemGutters:!0})}))"
                }
            ]
        },
        {
            find: '"ProfileFrameModal"',
            replacement: [
                {
                    match: /(\(0,\i\.jsx\)\((\i\.\i),\{frame:\i\}\)[^]+?let\{user:\i,guild:\i,pendingProfileFrame:\i,selectedProfileFrameRef:\i,onSelect:\i,onOpenShop:\i\}=(\i),(\i)=\i\(\),[^;]{0,120};)return(?=\(0,\i\.jsx\)\("section")/,
                    replace: "$1return $self.frameGallery({props:$3,sections:$4,Frame:$2},"
                },
                {
                    match: /getItemHeight:(\i),removeEdgeItemGutters:!0\}\)\}\)(?=\};var)/,
                    replace: "getItemHeight:$1,removeEdgeItemGutters:!0})}))"
                }
            ]
        },
        {
            find: '"NameplateModal"',
            replacement: [
                {
                    match: /(\(0,\i\.jsx\)\((\i\.\i),\{nameplate:\i,user:\i,showPlaceholderUser:!0[^]+?let\{currentUser:\i,selectedNameplate:\i,guildId:\i,onSelect:\i,onOpenShop:\i\}=(\i),\i=[^,]+,(\i)=\i\(\);)return(?=\(0,\i\.jsx\)\(\i\.\i,\{className:\i\.pf)/,
                    replace: "$1return $self.nameplateGallery({props:$3,sections:$4,Plate:$2},"
                },
                {
                    match: /(\},\i\.section\)\)\}\))(?=\};var)/,
                    replace: "$1)"
                }
            ]
        },
        {
            find: '"AvatarDecorationModal"',
            replacement: [
                {
                    match: /(?<=let\{user:\i,guild:\i,pendingAvatarDecoration:\i,selectedAvatarDecorationRef:\i,onSelect:\i,onOpenShop:\i\}=(\i),(\i)=\i\(\),(\i)=[^;]{0,60};)return(?=\(0,\i\.jsx\)\(\i\.\i,\{fade:!0)/,
                    replace: "return $self.decorationGallery({props:$1,sections:$2,canUse:$3},"
                },
                {
                    match: /getItemHeight:(\i)\}\)(?=\};var)/,
                    replace: "getItemHeight:$1}))"
                }
            ]
        },
        {
            find: '"display-name-styles-solid-color-picker"',
            replacement: [
                {
                    match: /(\i)===\i\.\i\.GUMMY\?\(0,\i\.jsx\)\(\i,\{selectedColors:(\i),setSelectedColors:(\i),colorOptions:(\i),[^]+?\}\):(\i)>1\?[^]+?defaultColor:(\i),[^]+?selectedEffectId:\i\}\)(?=\]\}\))/,
                    replace: "$self.renderStudio({effectId:$1,colors:$2,setColors:$3,presets:$4?.map(o=>o.colors),defaultColor:$6,count:$5,fontId:arguments[0].vcFontId,name:arguments[0].vcName,setFont:arguments[0].vcSetFont,setEffect:arguments[0].vcSetEffect},$&)"
                },
                {
                    match: /(\(0,\i\.jsx\)\(\i,\{selectedFontId:(\i),setSelectedFontId:(\i),displayName:(\i),[^]{0,300}?setSelectedEffectId:(\i),[^]{0,200}?\(0,\i\.jsx\)\(\i,\{selectedColors:\i,setSelectedColors:\i,selectedEffectId:\i,)/,
                    replace: "$1vcFontId:$2,vcSetFont:$3,vcName:$4,vcSetEffect:$5,"
                }
            ]
        },
        {
            find: "currentProfileThemeColors:",
            replacement: {
                match: /(guildId:(\i),disabled:\i=!1\}=\i[^]{0,200}?currentProfileThemeColors:[^]+?return )null==(\i)\|\|null==(\i)\?null:(\(0,\i\.jsx\)\(\i,\{fieldA11yLabel:[^]{0,600}?deleteButton:\i\}\))/,
                replace: "$1null==$3||null==$4?null:$self.withThemeStudio($5,{guildId:$2,primary:$3,secondary:$4})"
            }
        },
        {
            find: "currentProfileThemeColors:",
            replacement: {
                match: /(\{heading:(\i),[^}]{0,80}\}=\i;return)(\(0,\i\.jsxs\)\("div",\{className:\i\.Os,[^]{0,600}?\]\}\),\i\]\}\))/,
                replace: "$1 $self.renderSection(arguments[0],$3)"
            }
        }
    ],

    start: startPickers,
    stop: stopPickers,

    decorationGallery,
    effectGallery,
    frameGallery,
    nameplateGallery,

    gradientPrism(effectId: number, colors: string[] | undefined, nameLength: number) {
        if (effectId !== GRADIENT || !colors?.length) return {};
        return {
            "--custom-display-name-styles-prism-stops": Array.from({ length: colors.length + 1 }, (_, i) => `${colors[i % colors.length]} ${(100 * i / colors.length).toFixed(3)}%`).join(", "),
            "--custom-display-name-styles-prism-cycle": `max(${nameLength}ch, 38px)`
        };
    },

    renderStudio(props: StudioProps, original: ReactNode) {
        return (
            <ErrorBoundary fallback={() => original as any}>
                <Studio {...props} />
            </ErrorBoundary>
        );
    },

    renderSection(props: { heading: unknown; }, el: ReactNode) {
        return (
            <ErrorBoundary fallback={() => el as any}>
                {renderSection(props, el)}
            </ErrorBoundary>
        );
    },

    withThemeStudio(field: ReactNode, props: ThemeStudioProps) {
        return (
            <>
                {field}
                <ErrorBoundary noop>
                    <ThemeStudioLauncher {...props} />
                </ErrorBoundary>
            </>
        );
    }
});
