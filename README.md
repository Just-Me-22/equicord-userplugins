# Equicord userplugins

My plugins for an Equicord source build. They belong in `src/userplugins` of an
Equicord checkout, which the Equicord repo itself gitignores.

Nine plugins are tracked here directly. Eight others have their own repos and are
ignored by this one, so nothing lives in two places at once.

## On a new machine

```sh
git clone https://github.com/Equicord/Equicord.git
cd Equicord/src
git clone <this repo> userplugins
./userplugins/setup.sh
```

Then build Equicord from its root with `pnpm build`.

`setup.sh` clones the eight separate plugins into place, and pulls them if they
are already there.
