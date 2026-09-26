#!/usr/bin/env bash
# Clones the plugins that live in their own repos into this folder.
# The rest are tracked here directly.
set -e

repos="
alwaysShowDMNameplates https://github.com/Just-Me-22/AlwaysShowDMNameplates.git
betterImageEditor      https://github.com/Just-Me-22/BetterImageEditor.git
collectibleShelf       https://github.com/Just-Me-22/CollectibleShelf.git
probeDeck              https://github.com/Just-Me-22/ProbeDeck.git
profileSets            https://github.com/Just-Me-22/ProfileSets.git
serverSafety           https://github.com/Just-Me-22/ServerSafety.git
sidebarResizeLimits    https://github.com/Just-Me-22/SidebarResizeLimits.git
userPanelServerProfile https://github.com/Just-Me-22/UserPanelServerProfile.git
workbench              https://github.com/Just-Me-22/Workbench.git
"

cd "$(dirname "$0")"
echo "$repos" | while read -r dir url; do
    [ -z "$dir" ] && continue
    if [ -d "$dir/.git" ]; then
        echo "$dir already here, pulling"
        git -C "$dir" pull --ff-only
    else
        git clone "$url" "$dir"
    fi
done
