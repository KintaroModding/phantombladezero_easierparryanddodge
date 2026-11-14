# Easier Parry and Dodge

Wider perfect deflect and perfect dodge windows (x1.5 by default, up to x3 or Always), with optional extras: no build-up or elemental damage on a guard, slow motion before blue, red or black attacks, auto guard. A PBZModLoader mod; settings in a text file in its folder, or on its Mods Menu page, live in game.

A [PBZModLoader](https://github.com/KintaroModding/phantombladezero_pbzmodloader) mod for Phantom Blade Zero (Unreal Engine
5.7), made with game version `CL-302256_JKS-17280` and PBZModLoader 2.1.0, tested in game with PBZModLoader 2.1.0 and
Mods Menu 0.9.1 (1.1, 2026-11-13). This README is for developers.
What the mod does, how to install it and its compatibility are in [openmods.md](openmods.md), the mod page on
[openmods](https://openmods.nexus).

## How it works

The game runs much of its logic in JavaScript (Puerts). PBZModLoader loads every folder in
`ProjectPBZ/PBZModLoader/mods/` that has a `main.js`, through the game's own module system, after the game's
`MainStart`; `require("ue")`, `require("puerts")` and `require("Library/TsHelper")` are the game's modules, and
`puerts.argv.getByName("GameInstance")` gives the game instance. Before a reload (Alt+F5) the loader awaits the mod's
`stop()`, which must give back everything the mod changed.

The logic is the author's earlier Mods Menu script 1.8.0, unchanged except where a comment says "1.0 (port)". A poll every
500 ms (and 16 ms timers while a frame, a slowdown or an auto guard hold is live):

- **Deflect window:** the loaded difficulty configs `GlobalConfig_Combat_*` (`UE.Object.Find`, never loaded by the mod):
  "Deflect Perfect Window Frames" and "... On Break" times `Deflect`, from the value found (the game's, or another
  mod's), never from the mod's own last write, at most 60 frames. `BP_PlayerDeflectPassive` reads them on each guard.
- **Dodge window:** the duration of `GE_PerfectDash` in its class default object (0.15 s; `Dodge` times it, at most 1 s).
- **Always:** `Deflect=Always` keeps the game's own debug effect `GE_PerfectDeflect` on the player (its tag makes every
  guarded hit perfect); `Dodge=Always` keeps the perfect dodge state for the whole dodge.
- **RepeatGuard:** "Deflect Quickclick Punish Cooldown" on the same configs (0.4 s), never longer than found.
- **NoBuildUpOnGuard, NoElementalDamageOnGuard:** the normal-block damage calculators' multipliers, and a watch on
  build-up after a guarded hit (gameplay events `...Deflect.Frame.Deflect.Defender`, `...Deflect.Defender`).
- **Slow*:** the game's own slow-motion service (`SlomoWorldSubsystem.ApplySlomo` with the key
  `EasierParryAndDodge.Slow`) from an attack's warning frame to just past its hit.
- **AutoGuard:** on a blockable attack's frame, presses and holds guard through the guard actions' input injection.
- **FistGuard:** the Iron Gauntlets' Fist Guard perfect window in its ability timelines.
- **1.1, Phantom Tuner's rows** (the user, 2026-11-13): `DeflectFrames` and `DeflectFramesOnBreak` write an exact
  count into the two frame fields (over `Deflect`, not over `Always`). `ParryPerfect`, `ParryNear`, `ParryFail` and
  `DeflectLead` scale fields of action objects in the enemies' attack timelines: `LGAAction_CheckParry`
  (`PerfectWindow`; `PrePerfectWindow` and `PostPerfectWindow`; `FailWindow`) and the `PreHitPointDuration` of
  `LGAAction_DurationBulletWithDeflectBase` and its children. Puerts has no FindAllOf, so `keepActions` looks every
  2 s while one of these rows is on: the enemies (`GetAllActorsOfClass` of `PBZCharacter_NPC`), each new ability
  system's abilities (`ActivatableAbilities.Items`: the ability and its instances) and their `Timelines`, and the
  running timeline tasks (`KnownTasks`); each timeline once while it is the same object. Values are scaled from
  the value found, like the deflect window; Off and `stop()` write it back, and then the objects are forgotten.

State that must survive a reload (what the mod wrote and the values it found) is on `globalThis.__easierParryAndDodge`,
so a second copy never scales twice.

The port (1.0):

- **Settings file:** next to `main.js`, or with Mods Menu's page the file the page saves (below). The source read
  its file once before registering its page, so the page could show the live values; with Mods Menu that first read
  now follows the registration, since the page's file is known only then.
- **stop():** the settings go to the game's own (Off, Game), each keep function writes the values it found back
  (as for a change in the file), the main poll stops, the listeners end, and the slowdown and the auto guard hold are
  ended (each keeps its own timer only when its end threw, so it tries again).
- **Names:** the state key, the slow-motion key and the log say "Easier Parry and Dodge", so the earlier Mods Menu
  script, if still installed, never shares them.

`tests/test_mod.js` runs the script in Node.js against a small stand-in game (42 checks).

- **Settings file:** `phantombladezero_easierparryanddodge.txt` next to `main.js` (`__dirname`, the mod's folder as a full path), read every
  2 s with `EasyCsv.LoadStringFromLocalFile` and written with the defaults when missing. The shipped file is exactly the
  script's default text (`tests/test_mod.js` checks it).
- **Mods Menu, optional:** PBZModLoader starts its mods after Mods Menu's, so a running Mods Menu (0.9.0 or later) has
  its registry object in `globalThis.PBZModsMenu` by then. Only when it has the features `settingsPath` and
  `store.saved`, the mod pushes its page (id `phantombladezero_easierparryanddodge`, `store: "saved"`) and reads the file the page saves
  (`PBZModsMenu.settingsPath(id)`, in Mods Menu's Saved folder): a registered page cannot save anywhere else.
- **Log:** `console.log` lines that start with `[PBZMOD]` and the game's warnings reach `ProjectPBZ/PBZModLoader/loader.log`.

## Check and deploy

Requirements: Windows PowerShell 5.1 and [Node.js](https://nodejs.org/) (for `node --check` and the offline test).

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1             # node --check, tests\test_mod.js
powershell -ExecutionPolicy Bypass -File .\build.ps1 -Deploy     # the checks, then deploy.ps1
powershell -ExecutionPolicy Bypass -File .\deploy.ps1            # copy src\phantombladezero_easierparryanddodge to the game
```

`deploy.ps1` mirrors `src\phantombladezero_easierparryanddodge\` to `<game folder>\ProjectPBZ\PBZModLoader\mods\phantombladezero_easierparryanddodge\`. The
settings file that is already there is the tester's and stays; `-ResetConfig` copies the shipped one. The game folder
comes from `gameDir` in `_tools\gamedata\phantombladezero\game.json`, else `$env:UE5_GAMES_DIR\PBZ`; `-GameDir` or
`-ModsDir` override it. It stops when PBZModLoader is not installed (its start file
`ProjectPBZ\Content\JavaScript\PBZModLoader\bootstrap.js` is missing).

The GitHub release zip holds the mod folder at `ProjectPBZ/PBZModLoader/mods/phantombladezero_easierparryanddodge/`, so players unpack it
into the game folder.

Versioning: every change raises the second number in `mod.json` and `main.js` (1.0 -> 1.1): `python scripts\bump_version.py`.

## Project layout

```
src/phantombladezero_easierparryanddodge/   The mod folder: main.js and the shipped settings file
tests/test_mod.js     Offline test of main.js (Node.js, stand-ins for the game)
docs/                 Cover and screenshots
scripts/              bump_version.py, check_openmods.py, publish.ps1
build.ps1, deploy.ps1 Checks; copy into the game
mod.json              Name, version, game, kind pbzmodloader, modsPath
```

## License

MIT, see [LICENSE](LICENSE).
