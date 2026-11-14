"use strict";
// Easier Parry and Dodge 1.0 for Phantom Blade Zero: a PBZModLoader mod
// (ProjectPBZ/PBZModLoader/mods/phantombladezero_easierparryanddodge/).
//
// The logic is the author's earlier Mods Menu script 1.8.0, unchanged except where a comment says "1.0 (port)"; its own
// version notes (1.2.0 to 1.8.0) stay in the comments. The port to PBZModLoader, which loads this file after the game's
// MainStart:
// - Settings: phantombladezero_easierparryanddodge.txt in this mod's folder (__dirname), read every 2 s and written with
//   the defaults when missing. With Mods Menu (0.9.0 or later) running, the mod adds its page there and reads the file
//   that the page saves instead (pbzPerfectDefensePath): a registered page cannot save anywhere else.
// - stop() (PBZModLoader's Alt+F5 reload) gives back what the mod changed: the deflect windows and the anti-mash cooldown
//   on the config objects, the perfect dodge length, the guard damage multipliers, the Iron Gauntlets' Fist Guard window
//   and the Always effect, then ends its timers, listeners, slowdown and auto guard hold. A copy that starts later takes
//   over from the state on globalThis (the source's own second-load handling), so nothing is scaled twice.
// - Log: a [PBZMOD] start and stop line for loader.log; warnings start with [Easier Parry and Dodge].
// 1.1 (the user, 2026-11-13): the deflect and parry rows Phantom Tuner dropped: exact perfect deflect frames
// (DeflectFrames, DeflectFramesOnBreak), the timed-parry windows (ParryPerfect, ParryNear, ParryFail) and the deflect
// lead (DeflectLead); see keepActions. Every such place is marked "1.1".
const PBZ_PD_VERSION = "1.1";
const PBZ_PD_ID = "phantombladezero_easierparryanddodge"; // the mod folder's name and Mods Menu's page id
let __pbzStandaloneReady = false;
let pbzPerfectDefenseStop = undefined; // 1.0 (port): set by the closure below once it started
const __pbzRuntime = require("ue"), __pbzHost = require("puerts");
if (!__pbzHost.argv || !__pbzHost.argv.getByName("GameInstance") || !__pbzRuntime.KismetSystemLibrary || typeof __pbzRuntime.KismetSystemLibrary.ConvertToAbsolutePath !== "function") throw new Error("Easier Parry and Dodge: runtime APIs of the game are missing");
// 1.0 (port): Mods Menu is optional. PBZModLoader starts its mods after Mods Menu's, so a running Mods Menu (0.9.0 or
// later, with settingsPath and store "saved") has its registry in globalThis.PBZModsMenu by now: the page goes there, and
// the file it saves is the one this mod reads. Without it nothing is pushed: an array left for a Mods Menu that starts
// later would give a page that saves another file than the one this mod reads.
const pbzPerfectDefenseMenu = { on: false };
function pbzPerfectDefenseMenuWanted() {
    const mm = globalThis.PBZModsMenu;
    return !!(mm && typeof mm === "object" && !Array.isArray(mm) && typeof mm.push === "function"
        && typeof mm.settingsPath === "function" && mm.api && typeof mm.api.has === "function"
        && mm.api.has("settingsPath") && mm.api.has("store.saved"));
}
function pbzPerfectDefensePush(page) {
    try {
        globalThis.PBZModsMenu.push(page);
        pbzPerfectDefenseMenu.on = typeof globalThis.PBZModsMenu.settingsPath(PBZ_PD_ID) === "string";
    }
    catch (e) {
        console.warn(`[Easier Parry and Dodge] no Mods Menu page: ${e}`);
    }
}
// 1.0 (port): the settings file: the one Mods Menu's page saves, else `file` next to this main.js (__dirname is the
// mod's folder, a full path, as PBZModLoader loads the mod).
function pbzPerfectDefensePath(file) {
    if (pbzPerfectDefenseMenu.on) {
        const path = globalThis.PBZModsMenu.settingsPath(PBZ_PD_ID);
        if (typeof path === "string" && path)
            return path;
    }
    return __pbzRuntime.KismetSystemLibrary.ConvertToAbsolutePath(String(__dirname).replace(/[\\/]+$/, "") + "/" + file);
}
// Easier Parry and Dodge: begin. Wider perfect deflect and perfect dodge windows, or every guard and dodge perfect.
// Deflect: BP_PlayerDeflectPassive "Give Perfect Window" opens the perfect window on each guard press from the current
// difficulty's GlobalConfig_Combat_* "Deflect Perfect Window Frames" (or "... On Break" while the player is broken), read
// live through PDA_GlobalConfig_Combined "Get Deflect Perfect Window Frames", at the game's 30 logic frames a second.
// We multiply those two ints on the loaded config objects in memory. No asset is replaced, so data paks that edit the same
// assets still load, and their values are what we multiply.
// Dodge: BP_PlayerDodge_Base puts GE_PerfectDash (0.15 s, grants CharacterState.Stand.Invulnerable.Dodge.Perfect) on the
// player as every dodge starts and removes it when the dodge ends. We scale that effect's duration in its class default
// object, which every new dodge is built from.
// Deflect=Always: the game's own debug effect GE_PerfectDeflect stays on the player. Its tag
// CharacterState.EditorDebug.Deflect.AlwaysPerfect makes BP_StanceAction_Base_Player "Get Deflect Result" return
// Deflect.Result.Perfect before any timing check. Dodge=Always: the perfect dodge state lasts the whole dodge.
// Slow-motion perfect dodge (Hun.PerfectDodge, the counter dodge for red attacks): stock starts it only when dodge is
// pressed while an enemy's dodge frame is live (BP_PlayerPerfectDodge_Base K2_CanActivateAbility asks the DeflectComponent
// for GetNearestValidReceivedFrame). A dodge pressed just before the frame arrives is a plain dash. While a dodge frame is
// live and the player's dash is still in its perfect state (GE_PerfectDash above, so Dodge x1.5/x2/x3 widen this too, and
// Dodge=Always covers the whole dash; Dodge=Off never asks), we ask the input component for Hun.PerfectDodge, the same call the game's own
// assist accessory makes (BP_PerfectDodgePassive "Try Auto Dodge"). The ability still runs its own checks.
// Settings (1.0 (port): see the head), Deflect= and Dodge= each Off (1, the game's own timing), 1.5, 2, 3 or Always, read
// every 2 s and written with the defaults when missing. The 1.2.0 keys still work: Window= sets both, AlwaysPerfect=On makes
// both Always, and a 1.2.0 file gets Deflect= and Dodge= lines with the values they stood for. The optional Mods Menu edits
// the same file and calls onChange, which makes the next poll read it at once.
// RepeatGuard= (1.4.0): the anti-mash cooldown, "Deflect Quickclick Punish Cooldown" on the same configs (stock 0.4 s): Game,
// a shorter time, or Off. NoBuildUpOnGuard=On (1.4.0): build-up a guarded or deflected hit adds is set back (keepBuildUp), and since 1.4.1 a status it
// sets off is taken off (takeOffStatus). NoElementalDamageOnGuard=On (1.5.2): a hit blocked without a perfect deflect deals
// no elemental damage (keepGuardDamage); with NoBuildUpOnGuard=On the same route stops its build-up before it lands.
// SlowBlue=, SlowRed=, SlowBlack= and SlowSpeed= (1.6.0): the world runs slower from an enemy attack's warning frame to just
// past its hit, through the game's own slow-motion service (slowFor); the player still guards or dodges by hand.
// SlowLength= (1.7.0): the real-time cap of one slowdown, 0.5 to 3 s (1.5, the 1.6.0 cap, by default; hand edits 0.3 to 5).
// SlowStart= (1.7.1): Hit (the default, the 1.7.0 timing) or Warning: every slowdown starts at once, and black (power)
// attacks start when the game sends the enemy its black warning event (listenForWarnings), not at the later frame.
// AutoGuard=On (1.8.0): on a blockable attack's frame the mod presses and holds guard for the player, through the same two
// input actions the guard button drives (autoFrame). FistGuard=Deflect (1.8.0): the Iron Gauntlets' Fist Guard perfect
// window, which its own ability timelines hold, follows the Perfect Deflect multiplier (keepFistGuard).
// A window change scales from the values we found (stock, or another mod's), never from our own last write.
// Runs once per load (1.0 (port): PBZModLoader loads it after MainStart). Everything lives in this closure, so no stock
// name is touched.
(function pbzPerfectDefense() {
    const PBZ_PD_FILE = "phantombladezero_easierparryanddodge.txt"; // 1.0 (port): in this mod's folder, or Mods Menu's
    const PBZ_PD_DEFAULT_WINDOW = 1.5; // window multiplier for deflect and dodge, 1 (stock) to 3
    const PBZ_PD_ALWAYS = "Always"; // Deflect=Always: every guarded hit perfect; Dodge=Always: every dodge perfect throughout
    const PBZ_PD_READ_MS = 2000;
    const PBZ_PD_DEFAULT_TEXT = ["; Easier Parry and Dodge settings. Change a value and save; the game picks it up within 2 seconds.",
        "; Deflect and Dodge: Off (the game's own timing), 1.25, 1.5, 2 or 3 (how much wider the perfect window is), or Always.",
        "; Deflect=Always makes every guarded hit a perfect deflect. Dodge=Always keeps every dodge perfect for its whole length.",
        "; DeflectFrames, DeflectFramesOnBreak: Game, or an exact perfect deflect window in frames, 1 to 60 (the game counts 30 a second; Normal: 8, and 12 while you are broken). It wins over Deflect, not over Always.",
        "; DeflectLead: Off, 1.25, 1.5, 2 or 3: how long before an enemy hit lands you can already deflect it.",
        "; ParryPerfect, ParryNear, ParryFail: Off, 1.25, 1.5, 2 or 3: timed-parry prompts (attacks with a parry cue): the perfect window, the near windows around it, the fail window.",
        "; RepeatGuard: Game (the game's own time, 0.4 s in the base game), 0.3, 0.2, 0.1 or Off. A guard press sooner than this after the last one gets a smaller perfect window.",
        "; NoBuildUpOnGuard=On: hits you guard or deflect add no status build-up (fire, lightning, poison, frost, bleed), and a burn, freeze, poison, bleed or shock they set off is taken off at once.",
        "; NoElementalDamageOnGuard=On: a hit you block without a perfect deflect deals no fire, ice, lightning, poison, blood or chaos damage.",
        "; SlowBlue, SlowRed, SlowBlack=On: the world slows down when a blue, red or black (power) attack is about to hit you, until just after the hit. You still guard or dodge yourself.",
        "; SlowSpeed: 0.5, 0.4 or 0.3, how fast the world runs while it is slowed.",
        "; SlowLength: 0.5, 1, 1.5, 2 or 3, the longest one slowdown lasts in real seconds. A long one starts earlier; a short one can end before the hit.",
        "; SlowStart: Hit or Warning. Warning slows as soon as the game signals the attack (black: when the glow shows) instead of just before the hit.",
        "; AutoGuard=On: the mod presses and holds guard for you just before an attack you can block hits you. Red attacks, grabs and attacks with no warning are left to you.",
        "; FistGuard: Game (the Iron Gauntlets' own timing) or Deflect (their Fist Guard perfect window gets wider by the Deflect setting).",
        "Deflect=1.5", "Dodge=1.5", "DeflectFrames=Game", "DeflectFramesOnBreak=Game", "DeflectLead=Off",
        "ParryPerfect=Off", "ParryNear=Off", "ParryFail=Off", "RepeatGuard=Game", "NoBuildUpOnGuard=Off", "NoElementalDamageOnGuard=Off",
        "SlowBlue=Off", "SlowRed=Off", "SlowBlack=Off", "SlowSpeed=0.5", "SlowLength=1.5", "SlowStart=Hit", "AutoGuard=Off", "FistGuard=Game", ""].join("\r\n");
    const PBZ_PD_COOLDOWN = "Deflect Quickclick Punish Cooldown"; // s; BP_PlayerDeflectPassive "Give Perfect Window" shrinks a press this soon after the last
    const PBZ_PD_GUARD_FRAME_EVENT = "GameplayEvent.Ability.Action.Deflect.Frame.Deflect.Defender"; // a blockable attack's frame reached the player
    const PBZ_PD_GUARDED_EVENT = "GameplayEvent.Ability.Action.Deflect.Defender"; // .Perfect, .Normal: the player guarded a hit
    // UBasicAttributeSet build-up attributes; each has a GE_MA_<name>_1_Override row in DT_AttributeModEffects
    const PBZ_PD_BUILDUPS = ["Ignite", "Poison", "Frost", "Thunder", "Electrified", "Bleed", "BloodBurst", "Water"].map((n) => n + "_Accumulation");
    // The status effects GA_CommonUtilitiesPassive puts on the player (its Inflictions map, IgnitEffectClass, IgnitTickClass,
    // PoisonInflictionPhases, BleedEffectClass, ThunderEffectClass, WaterEffectClass) and the build-up behind each. The game
    // applies one inside the damage call that fills its bar, before any JS poll can put the build-up back, so a status a
    // guarded hit sets off is taken off instead. Only these classes: resistances (GE_*_Resistance_Player, which GE_Frost and
    // GE_Electrified add on landing), weapon, accessory and talent effects are never listed, so never removed. Poison's damage
    // ticks (GE_Poison_Dot_PhaseN) end with their phase tag by their own removal rule. Instant effects (GE_BleedBurst,
    // GE_Electrified_Instant) have hit by then and cannot be taken back. GE_Electrified_VFX is the 3 s shock look GE_Electrified
    // adds on landing; it goes with the shock so the player does not see a shock that is no longer there. GE_Frost's thaw cue
    // (GE_Frost_Out) plays only when the freeze runs out, so a freeze taken off ends without it.
    const PBZ_PD_INFLICTION = (n) => "/PBZCombatAsset/Prototypes/GameplayEffects/Inflictions/" + n + "." + n + "_C";
    const PBZ_PD_STATUSES = [["Ignite_Accumulation", ["GE_Ignite", "GE_Ignite_Dot"]], ["Frost_Accumulation", ["GE_Frost"]],
        ["Poison_Accumulation", ["GE_Poison_Phase0", "GE_Poison_Phase1", "GE_Poison_Phase2", "GE_Poison_Phase3"]],
        ["Bleed_Accumulation", ["GE_BleedSmall"]], ["Electrified_Accumulation", ["GE_Electrified", "GE_Electrified_VFX"]], ["Thunder_Accumulation", ["GE_Thunder"]]]
        .map(([attr, ges]) => ({ attr, ge: ges.map(PBZ_PD_INFLICTION) }))
        .concat([{ attr: "Water_Accumulation", ge: ["/Script/PBZCombatAsset.GE_Water"] }]);
    // A hit the player blocks without a perfect deflect is priced by these DamageCalculator_PBZDeflect assets (GlobalConfig_Mechanic
    // "Player Normal Deflect", "... Normal Power Deflect" and "... Normal Deflect Projectile" Damage Calculator). Their
    // AttackMultipliers set PhysicalDamage and AngerDamage to 0 but every elemental damage and build-up to 1, so a normal block
    // stops the blade and lets the fire through; the perfect-deflect ones set all of them to 0. [confirmed in cooked data]
    const PBZ_PD_GUARD_CALCS = ["NormalDeflect_Player", "NormalPowerDeflect_Player", "NormalDeflect_ProjectilePlayer"]
        .map((n) => "/PBZCombatAsset/Config/DamageCalculator/DamageCalculator_PBZ" + n + ".DamageCalculator_PBZ" + n);
    const PBZ_PD_ELEMENT_TAGS = ["Fire", "Ice", "Lightning", "Toxin", "Blood", "Chaos"].map((n) => "Damage.Attack.Target." + n + "Damage");
    const PBZ_PD_BUILDUP_TAGS = ["Ignite", "Poison", "Frost", "Bleed"].map((n) => "Damage.Attack.Target." + n + "Accumulation");
    const PBZ_PD_GUARD_WATCH_S = 1.5; // game seconds of build-up snapshots after a blockable frame arrives (leads are 0.2 to 1.04 s)
    const PBZ_PD_HOLD_S = 0.15; // game seconds either side of a frame's hit time in which a rise waits for the guard result
    const PBZ_PD_GUARDED_S = 0.5; // game seconds after a guarded hit in which a rise in build-up is put back
    const PBZ_PD_ALWAYS_DODGE_S = 1; // longer than a dodge; the dodge removes the effect itself when it ends
    const PBZ_PD_MAX_FRAMES = 60; // 2 s; a ceiling in case a value is ever scaled twice
    const PBZ_PD_POLL_MS = 500;
    const PBZ_PD_ACTION_SCAN_MS = 2000; // 1.1: between looks for enemies and their attack timelines while a parry or lead row is on
    const PBZ_PD_ACTION_MAX_NPCS = 64; // 1.1: enemies looked at in one scan
    const PBZ_PD_DIFFICULTIES = ["Easy", "Handicapped", "Normal", "Hard", "Nightmare"];
    const PBZ_PD_FIELDS = ["Deflect Perfect Window Frames", "Deflect Perfect Window Frames On Break"];
    const PBZ_PD_DASH_GE = "/PBZDeflectSystem/GameplayEffects/GE_PerfectDash.GE_PerfectDash_C";
    const PBZ_PD_DEFLECT_GE = "/Game/PBZContent/UI/Help/GE_PerfectDeflect.GE_PerfectDeflect_C";
    const PBZ_PD_ALWAYS_TAG = "CharacterState.EditorDebug.Deflect.AlwaysPerfect";
    const PBZ_PD_GAME_SWITCH = "pbz.ForcePerfectDeflect"; // the game's own debug cvar for the same effect (RenewalPlayer.js)
    const PBZ_PD_FRAME_EVENT = "GameplayEvent.Ability.Action.Deflect.Frame.Dodge.Defender"; // an enemy's dodge frame reached the player
    const PBZ_PD_PERFECT_TAG = "CharacterState.Stand.Invulnerable.Dodge.Perfect"; // granted by GE_PerfectDash
    const PBZ_PD_SLOWMO_TAG = "Ability.Action.Hun.PerfectDodge";
    const PBZ_PD_DODGE_INPUT = "/PBZDeflectSystem/Input/IA_Dodge.IA_Dodge";
    const PBZ_PD_SLOWMO_PRIORITY = -5; // what BP_PerfectDodgePassive "Try Auto Dodge" passes for the same call
    const PBZ_PD_FRAME_POLL_MS = 16;
    const PBZ_PD_FRAME_WATCH_S = 3; // game seconds; a frame lasts well under this, and the watch stops once no frame is live
    const PBZ_PD_SLOW_ID = "EasierParryAndDodge.Slow"; // our own key in the game's slow-motion service (1.0 (port): own name)
    const PBZ_PD_SLOW_TYPES = { 2: "blue", 3: "red", 4: "black" }; // DeflectBulletType / DeflectType: BlueEye, RedEye, PowerAttack
    const PBZ_PD_SLOW_AFTER_S = 0.15; // game seconds past the hit, so a press right at the hit is still slowed
    const PBZ_PD_SLOW_REAL_MS = 1500; // default real-time cap of one slowdown (SlowLength=1.5; frame leads are 0.2 to 1.04 game s)
    const PBZ_PD_PROBE_REAL_MS = 2000; // real-time cap of a debug probe slowdown
    const PBZ_PD_PROBE_GAME_S = 1; // debug probe A: 60 frames at 60 a second of game time
    const PBZ_PD_DODGED_EVENT = "GameplayEvent.Actor.HitDodge.Target"; // .Perfect too: an attack on the player met its dodge
    const PBZ_PD_PERFECT_DODGE_EVENT = "GameplayEvent.Ability.Action.PerfectDodge.Defender"; // the game's own slow-motion dodge
    // SlowStart=Warning (1.7.1): the player's hatred component sends the player these with Target = the enemy that starts or
    // stops hating the player; GAAction_PowerAttackParticle_C (the black warning) sends its own enemy the cue event with
    // OptionalObject = the cue action, for hostile enemies only (evidence/warning-cue-kismet-26367565.txt) [offline]
    const PBZ_PD_HATRED_ADDED = "GameplayEvent.HatredListUpdate.Added";
    const PBZ_PD_HATRED_REMOVED = "GameplayEvent.HatredListUpdate.Removed";
    const PBZ_PD_CUE_EVENT = "GameplayEvent.Character.CustomStencil.Set";
    const PBZ_PD_CUE_CLASS = "GAAction_PowerAttackParticle_C";
    const PBZ_PD_WARN_MAX = 24; // enemies listened to at once
    const PBZ_PD_WARN_FAR_CM = 1500; // past 700 cm the game itself fades the glow of an attack not aimed at the player
    const PBZ_PD_CUE_SAME_S = 1; // a black frame from the cue's enemy whose hit is this close to the predicted one is that attack
    // AutoGuard (1.8.0). The guard button is two actions (IMC_Deflect, cooked): IA_Deflect on press, which BP_PlayerDeflectPassive
    // answers with Give Perfect Window and Activate Stance Ability, and IA_Stance while held, which adds
    // CharacterState.AbilityState.Stance.HoldingStanceKey and on release sends Deflect.Player.KeyUp
    // (evidence/BP_PlayerDeflectPassive.kismet.txt) [offline]. The mod injects the same two: one frame of IA_Deflect, IA_Stance held.
    const PBZ_PD_PRESS_INPUT = "/PBZDeflectSystem/Input/IA_Deflect.IA_Deflect";
    const PBZ_PD_HOLD_INPUT = "/PBZDeflectSystem/Input/IA_Stance.IA_Stance";
    const PBZ_PD_AUTO_TYPES = [1, 2, 4]; // DeflectBulletType Normal, BlueEye, PowerAttack; never CantDeflect, RedEye or HoldDeflect
    const PBZ_PD_AUTO_PRESS_S = 0.12; // game seconds before the hit the press lands, well inside the stock 8-frame (0.267 s) perfect window
    const PBZ_PD_AUTO_MIN_LEAD_S = 0.05; // a frame closer to its hit than this is left alone
    const PBZ_PD_AUTO_AFTER_S = 0.2; // the hold lasts this long past the last hit it covers
    const PBZ_PD_AUTO_REPRESS_S = 0.4; // the stock anti-mash cooldown: a second press inside a hold only after this, so it is never punished
    // FistGuard (1.8.0): GA_TieKuangQuanTao_GuardPoint parries through two GAA_DeflectFrame actions on each of these timelines,
    // perfect first, block after it (26367565 cooked: Main 0-0.3952 then 0.3904-0.6895 s, Main_Switch 0-0.2711 then
    // 0.2689-0.4795 s, evidence/fist-guard-windows-26367565.txt). The timelines are subobjects of the generated class.
    const PBZ_PD_FIST_GA = "/PBZCombatAsset/ActorData/Players/Hun/Abilities/ShachiAbility/TieKuangQuanTao/GA_TieKuangQuanTao_GuardPoint.GA_TieKuangQuanTao_GuardPoint_C";
    const PBZ_PD_FIST_TIMELINES = ["Main", "Main_Switch"];
    const PBZ_PD_FIST_FRAME = "GAA_DeflectFrame_C";
    const PBZ_PD_FIST_TAIL_S = 0.05; // the block action keeps at least this much after the wider perfect one
    // player states that end (or skip) a slowdown; the dodge input check in slowBlocked covers QTE input modes
    const PBZ_PD_SLOW_STOP_TAGS = [["CharacterState.Dead", "death"], ["CharacterState.InLevelSequence", "cutscene"], ["CharacterState.Native.Sequence", "cutscene"],
        ["Ability.Action.Execution", "qte"], ["Ability.Executed", "qte"], ["CharacterState.HitReact.State.Executing", "qte"], [PBZ_PD_SLOWMO_TAG, "perfect dodge"]];
    const pbzLog = (message) => { }; // the debug build swaps this line for a file logger; message() only runs there
    let timer = undefined;
    try {
        const UE = require("ue");
        const puerts = require("puerts");
        const gameInstance = puerts.argv.getByName("GameInstance");
        if (!gameInstance) {
            pbzLog(() => "not started: no GameInstance");
            return;
        }
        // What we last wrote and the value we scaled it from, per config field and for the dodge effect. It sits on
        // globalThis, so a second load of this module in the same JS environment sees our own values and does not multiply
        // them again.
        // shortcut: a full JS environment restart inside one process would forget it and scale once more (frames capped by
        // PBZ_PD_MAX_FRAMES); nothing shows the game does that. The debug log prints "started" on every load if it does.
        // 1.0 (port): its own name, so the earlier Mods Menu script, if still installed, never shares it
        const state = globalThis.__easierParryAndDodge = globalThis.__easierParryAndDodge || { wrote: {}, base: {} };
        state.stuck = state.stuck || {}; // guard damage keys whose write did not hold
        const close = (a, b) => typeof a == "number" && typeof b == "number" && Math.abs(a - b) < 0.0001;
        const KSL = UE.KismetSystemLibrary;
        const settings = { deflect: PBZ_PD_DEFAULT_WINDOW, dodge: PBZ_PD_DEFAULT_WINDOW, repeat: "Game", noBuildUp: false, noElement: false,
            slow: { blue: false, red: false, black: false }, slowSpeed: 0.5, slowLength: PBZ_PD_SLOW_REAL_MS / 1000, slowStart: "hit", probe: "",
            autoGuard: false, fistGuard: "game",
            frames: undefined, framesBreak: undefined, lead: 1, parryPerfect: 1, parryNear: 1, parryFail: 1 }; // 1.1
        // true only in the debug build, whose pbzLog runs its message: the slow probe below is debug only
        let debugBuild = false;
        pbzLog(() => (debugBuild = true, "debug build: SlowProbe= in the settings file runs the slow probe"));
        const yes = (s) => ({ on: true, true: true, yes: true, 1: true })[s.toLowerCase()] === true;
        let path = undefined, readAt = -Infinity, made = false;
        const show = (v) => (v === PBZ_PD_ALWAYS ? "always" : "x" + v);
        // a Deflect=, Dodge= or Window= value: Always, Off (1) or a multiplier clamped to 1..3; undefined when unreadable
        function level(raw) {
            const s = raw.toLowerCase();
            if (s == "always")
                return PBZ_PD_ALWAYS;
            if (s == "off")
                return 1;
            const n = Number(s.replace(",", ".").replace(/^x/, ""));
            return s && Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : undefined;
        }
        // The settings file (1.0 (port): pbzPerfectDefensePath), read the way the Mods Menu reads it: the key in any case, its first line wins, and
        // ; or # starts a comment. Anything unreadable falls back to the default; a missing file is created with the defaults.
        function readSettings() {
            if (Math.abs(Date.now() - readAt) < PBZ_PD_READ_MS)
                return;
            readAt = Date.now();
            try {
                if (path === undefined)
                    path = pbzPerfectDefensePath(PBZ_PD_FILE); // 1.0 (port)
                let text = "";
                if (UE.BlueprintPathsLibrary.FileExists(path)) { // check first: EasyCsv logs an error for a missing file
                    const out = puerts.$ref("");
                    if (!UE.EasyCsv.LoadStringFromLocalFile(path, out))
                        return; // locked mid-save, or 10 characters or fewer: keep what we have
                    text = String(puerts.$unref(out)).replace(/^\uFEFF/, "");
                }
                else if (!made) {
                    made = true; // once a session, and never over an existing file
                    UE.EasyCsv.SaveStringToFileWithFullPath(PBZ_PD_DEFAULT_TEXT, path);
                }
                const lines = text.split(/\r?\n/);
                const keyRe = (key) => new RegExp("^[ \\t]*" + key + "[ \\t]*=[ \\t]*([^;#\\r\\n]*?)[ \\t]*(?:[;#][^\\r\\n]*)?$", "i");
                const has = (key) => lines.some((line) => keyRe(key).test(line));
                const get = (key) => {
                    const re = keyRe(key);
                    for (const line of lines) {
                        const m = re.exec(line);
                        if (m)
                            return m[1];
                    }
                    return "";
                };
                // the 1.2.0 keys stand for both: AlwaysPerfect=On for Always, else Window= clamped to 1.5..3 as 1.2.0 read it
                const w = level(get("Window"));
                const alias = yes(get("AlwaysPerfect")) ? PBZ_PD_ALWAYS
                    : typeof w == "number" ? Math.max(1.5, w) : PBZ_PD_DEFAULT_WINDOW;
                const deflect = level(get("Deflect")) ?? alias;
                const dodge = level(get("Dodge")) ?? alias;
                if (deflect !== settings.deflect || dodge !== settings.dodge)
                    pbzLog(() => "settings: deflect " + show(settings.deflect) + " -> " + show(deflect) + ", dodge " + show(settings.dodge) + " -> " + show(dodge));
                settings.deflect = deflect;
                settings.dodge = dodge;
                // 1.1: an exact frame count (Game, Off or unreadable: none), and the multipliers (Off or unreadable: 1; Always
                // is no multiplier for these rows)
                const exact = (raw) => {
                    const s = raw.toLowerCase(), n = Math.round(Number(s.replace(",", ".")));
                    return !s || s == "game" || s == "off" || !Number.isFinite(n) ? undefined : Math.min(PBZ_PD_MAX_FRAMES, Math.max(1, n));
                };
                const times = (raw) => {
                    const v = level(raw);
                    return typeof v == "number" ? v : 1;
                };
                const rows = { frames: exact(get("DeflectFrames")), framesBreak: exact(get("DeflectFramesOnBreak")), lead: times(get("DeflectLead")),
                    parryPerfect: times(get("ParryPerfect")), parryNear: times(get("ParryNear")), parryFail: times(get("ParryFail")) };
                if (Object.keys(rows).some((k) => rows[k] !== settings[k]))
                    pbzLog(() => "settings: frames, lead, parry " + JSON.stringify(rows));
                Object.assign(settings, rows);
                // RepeatGuard: Game (whatever the config holds), Off (0) or seconds from 0 (keepRepeatGuard caps it at the base); unreadable is Game
                const r = get("RepeatGuard").toLowerCase(), rn = Number(r.replace(",", ".").replace(/\s*s$/, ""));
                const repeat = r == "off" ? 0 : r && Number.isFinite(rn) ? Math.max(0, rn) : "Game";
                const noBuildUp = yes(get("NoBuildUpOnGuard"));
                if (repeat !== settings.repeat || noBuildUp !== settings.noBuildUp)
                    pbzLog(() => "settings: repeat guard " + settings.repeat + " -> " + repeat + ", no build-up on guard " + settings.noBuildUp + " -> " + noBuildUp);
                settings.repeat = repeat;
                settings.noBuildUp = noBuildUp;
                const noElement = yes(get("NoElementalDamageOnGuard"));
                if (noElement !== settings.noElement)
                    pbzLog(() => "settings: no elemental damage on guard " + settings.noElement + " -> " + noElement);
                settings.noElement = noElement;
                const slow = { blue: yes(get("SlowBlue")), red: yes(get("SlowRed")), black: yes(get("SlowBlack")) };
                const sp = get("SlowSpeed"), spn = Number(sp.replace(",", ".").replace(/^x/i, ""));
                const slowSpeed = sp && Number.isFinite(spn) ? Math.min(0.9, Math.max(0.1, spn)) : 0.5;
                if (JSON.stringify(slow) !== JSON.stringify(settings.slow) || slowSpeed !== settings.slowSpeed)
                    pbzLog(() => "settings: slow " + JSON.stringify(settings.slow) + " x" + settings.slowSpeed + " -> " + JSON.stringify(slow) + " x" + slowSpeed);
                settings.slow = slow;
                settings.slowSpeed = slowSpeed;
                // SlowLength: real seconds, clamped to 0.3..5; unreadable or missing is 1.5 (the 1.6.0 cap)
                const sl = get("SlowLength"), sln = Number(sl.replace(",", ".").replace(/\s*s$/i, ""));
                const slowLength = sl && Number.isFinite(sln) ? Math.min(5, Math.max(0.3, sln)) : PBZ_PD_SLOW_REAL_MS / 1000;
                if (slowLength !== settings.slowLength) {
                    pbzLog(() => "settings: slow length " + settings.slowLength + " -> " + slowLength + " s");
                    settings.slowLength = slowLength;
                    if (state.slow || state.slowWait)
                        stopSlow("settings changed"); // a running or waiting slowdown was sized with the old length
                }
                // SlowStart (1.7.1): Warning in any case, anything else (unreadable, missing) is Hit, the 1.7.0 timing
                const slowStart = get("SlowStart").toLowerCase() == "warning" ? "warning" : "hit";
                if (slowStart !== settings.slowStart) {
                    pbzLog(() => "settings: slow start " + settings.slowStart + " -> " + slowStart);
                    settings.slowStart = slowStart;
                    if (state.slow || state.slowWait)
                        stopSlow("settings changed"); // a running or waiting slowdown was timed by the old rule
                }
                // AutoGuard (1.8.0): On in any case of the usual words, anything else Off; a hold running when it goes Off
                // is let go on the next 16 ms tick (autoTick)
                const autoGuard = yes(get("AutoGuard"));
                if (autoGuard !== settings.autoGuard)
                    pbzLog(() => "settings: auto guard " + settings.autoGuard + " -> " + autoGuard);
                settings.autoGuard = autoGuard;
                // FistGuard (1.8.0): Deflect in any case, anything else (unreadable, missing) is Game, the game's own timing
                const fistGuard = get("FistGuard").toLowerCase() == "deflect" ? "deflect" : "game";
                if (fistGuard !== settings.fistGuard)
                    pbzLog(() => "settings: fist guard " + settings.fistGuard + " -> " + fistGuard);
                settings.fistGuard = fistGuard;
                if (debugBuild)
                    state.debugText = text; // the debug-only bench probes read their own keys from it
                const probe = get("SlowProbe").toLowerCase(); // used only by the debug build (tick)
                settings.probe = probe && !["off", "0", "no", "false"].includes(probe) ? probe : "";
                // A 1.2.0 file: write the values its keys stand for as Deflect= and Dodge=, so the Mods Menu rows show what
                // the mod does, and turn the old lines into comments, so a later edit of them can't look ignored. A Deflect= or
                // Dodge= line that can't be read ran on the old keys too, so its first line gets the value. Every other line and
                // line end stays as it was. Once a session (state survives a second load of this module).
                const old = ["Window", "AlwaysPerfect"].filter(has);
                const value = { Deflect: deflect, Dodge: dodge };
                const fill = ["Deflect", "Dodge"].filter((key) => level(get(key)) === undefined); // missing or unreadable
                if (!state.migrated && old.length && fill.length) {
                    state.migrated = true;
                    const parts = text.split(/(\r?\n)/); // line, line end, line, ...
                    const done = new Set();
                    for (let i = 0; i < parts.length; i += 2) {
                        const key = old.find((k) => keyRe(k).test(parts[i])) || fill.find((k) => !done.has(k) && keyRe(k).test(parts[i]));
                        if (old.includes(key))
                            parts[i] = "; " + parts[i].trim() + " (1.2.0 setting, now Deflect= and Dodge=)";
                        else if (key) {
                            parts[i] = key + "=" + value[key];
                            done.add(key);
                        }
                    }
                    const eol = /\r\n/.test(text) ? "\r\n" : "\n";
                    let out = parts.join("");
                    if (out && !out.endsWith("\n"))
                        out += eol;
                    out += fill.filter((key) => !done.has(key)).map((key) => key + "=" + value[key] + eol).join("");
                    const ok = UE.EasyCsv.SaveStringToFileWithFullPath(out, path);
                    pbzLog(() => "settings file moved to Deflect=" + deflect + " Dodge=" + dodge + (ok === false ? ": write failed" : ""));
                }
            }
            catch (e) {
                pbzLog(() => "settings read threw, keeping deflect " + show(settings.deflect) + ", dodge " + show(settings.dodge) + ": " + e);
            }
        }
        // 1.0 (port): with Mods Menu's page the mod reads the file the page saves, known only once the page is
        // registered, so then the first read follows the registration; without it, the first read comes here, before
        // the registration, so a key the file leaves out shows the value the mod runs with.
        const menuWanted = pbzPerfectDefenseMenuWanted();
        if (!menuWanted)
            readSettings();
        const levels = [{ value: "Off", label: "Off" }, { value: "1.25", label: "x1.25" }, { value: "1.5", label: "x1.5" }, { value: "2", label: "x2" }, { value: "3", label: "x3" },
            { value: PBZ_PD_ALWAYS, label: "Always" }];
        if (menuWanted) pbzPerfectDefensePush({ id: PBZ_PD_ID, version: PBZ_PD_VERSION, file: PBZ_PD_FILE, store: "saved",
            title: { en: "Easier Parry and Dodge", "zh-Hans": "更容易的完美格挡与闪避", "zh-Hant": "更容易的完美格擋與閃避" }, settings: [
            { key: "Deflect", type: "choice", default: "1.5", missing: String(settings.deflect), options: levels,
                label: { en: "Perfect Deflect", "zh-Hans": "完美格挡", "zh-Hant": "完美格擋" },
                help: { en: "How much wider the perfect deflect window is. It opens when you press guard, so a wider one catches presses that come early. Off: the game's own timing. Always: every hit you guard or deflect is perfect.",
                    "zh-Hans": "完美格挡判定窗口放宽的倍数。窗口在按下格挡时打开，放宽后按得早一些也算完美。Off：游戏原有判定。Always：你格挡的每一击都是完美格挡。",
                    "zh-Hant": "完美格擋判定窗口放寬的倍數。窗口在按下格擋時打開，放寬後按得早一些也算完美。Off：遊戲原有判定。Always：你格擋的每一擊都是完美格擋。" } },
            { key: "Dodge", type: "choice", default: "1.5", missing: String(settings.dodge), options: levels,
                label: { en: "Perfect Dodge", "zh-Hans": "完美闪避", "zh-Hant": "完美閃避" },
                help: { en: "How long a dodge stays perfect, and how early a dodge can still become the slow-motion dodge on a red attack. Off: the game's own timing. Always: the whole dodge stays perfect.",
                    "zh-Hans": "闪避保持完美状态的时长，以及面对红色攻击时多早闪避仍能变成慢动作闪避。Off：游戏原有判定。Always：整个闪避都保持完美。",
                    "zh-Hant": "閃避保持完美狀態的時長，以及面對紅色攻擊時多早閃避仍能變成慢動作閃避。Off：遊戲原有判定。Always：整個閃避都保持完美。" } },
            // 1.1: Phantom Tuner's rows
            { key: "DeflectFrames", type: "choice", default: "Game", missing: settings.frames === undefined ? "Game" : String(settings.frames),
                options: [{ value: "Game", label: { en: "Use Perfect Deflect", "zh-Hans": "按完美格挡设定", "zh-Hant": "按完美格擋設定" } },
                    ...[4, 6, 8, 10, 12, 16, 20, 30].map((n) => ({ value: String(n), label: { en: n + " frames", "zh-Hans": n + " 帧", "zh-Hant": n + " 幀" } }))],
                label: { en: "Perfect Deflect Frames", "zh-Hans": "完美格挡帧数", "zh-Hant": "完美格擋幀數" },
                help: { en: "An exact perfect deflect window in frames (30 a second; the game: 8 on Normal, 10 on Easy). It wins over Perfect Deflect, not over Always.",
                    "zh-Hans": "以帧为单位的精确完美格挡窗口（每秒 30 帧；游戏原值：普通 8，简单 10）。它优先于完美格挡倍数，但不优先于始终完美。",
                    "zh-Hant": "以幀為單位的精確完美格擋窗口（每秒 30 幀；遊戲原值：普通 8，簡單 10）。它優先於完美格擋倍數，但不優先於始終完美。" } },
            { key: "DeflectFramesOnBreak", type: "choice", default: "Game", missing: settings.framesBreak === undefined ? "Game" : String(settings.framesBreak),
                options: [{ value: "Game", label: { en: "Use Perfect Deflect", "zh-Hans": "按完美格挡设定", "zh-Hant": "按完美格擋設定" } },
                    ...[4, 6, 8, 10, 12, 16, 20, 30].map((n) => ({ value: String(n), label: { en: n + " frames", "zh-Hans": n + " 帧", "zh-Hant": n + " 幀" } }))],
                label: { en: "Perfect Deflect Frames While Broken", "zh-Hans": "破防时完美格挡帧数", "zh-Hant": "破防時完美格擋幀數" },
                help: { en: "The same while you are broken (the game: 12 on Normal).",
                    "zh-Hans": "破防时的同一设定（游戏原值：普通 12）。", "zh-Hant": "破防時的同一設定（遊戲原值：普通 12）。" } },
            { key: "DeflectLead", type: "choice", default: "Off", missing: String(settings.lead == 1 ? "Off" : settings.lead), options: levels.filter((o) => o.value !== PBZ_PD_ALWAYS),
                label: { en: "Deflect Lead", "zh-Hans": "提前格挡时间", "zh-Hant": "提前格擋時間" },
                help: { en: "How long before an enemy hit lands you can already deflect it, times this. Enemies get it once the mod has seen them; an attack first met mid-swing gets it from its next use.",
                    "zh-Hans": "敌人攻击命中前多久就能格挡，乘以此倍数。模组看到敌人后生效；初次遇到时已在挥动中的攻击，从下一次起生效。",
                    "zh-Hant": "敵人攻擊命中前多久就能格擋，乘以此倍數。模組看到敵人後生效；初次遇到時已在揮動中的攻擊，從下一次起生效。" } },
            { key: "ParryPerfect", type: "choice", default: "Off", missing: String(settings.parryPerfect == 1 ? "Off" : settings.parryPerfect), options: levels.filter((o) => o.value !== PBZ_PD_ALWAYS),
                label: { en: "Timed Parry: Perfect Window", "zh-Hans": "时机格挡：完美窗口", "zh-Hant": "時機格擋：完美窗口" },
                help: { en: "Attacks with a parry cue: the window in which your press is perfect, times this.",
                    "zh-Hans": "带格挡提示的攻击：按键判定为完美的窗口，乘以此倍数。", "zh-Hant": "帶格擋提示的攻擊：按鍵判定為完美的窗口，乘以此倍數。" } },
            { key: "ParryNear", type: "choice", default: "Off", missing: String(settings.parryNear == 1 ? "Off" : settings.parryNear), options: levels.filter((o) => o.value !== PBZ_PD_ALWAYS),
                label: { en: "Timed Parry: Near Windows", "zh-Hans": "时机格挡：边缘窗口", "zh-Hant": "時機格擋：邊緣窗口" },
                help: { en: "Attacks with a parry cue: the near windows just before and after the perfect one, times this.",
                    "zh-Hans": "带格挡提示的攻击：完美窗口前后的边缘窗口，乘以此倍数。", "zh-Hant": "帶格擋提示的攻擊：完美窗口前後的邊緣窗口，乘以此倍數。" } },
            { key: "ParryFail", type: "choice", default: "Off", missing: String(settings.parryFail == 1 ? "Off" : settings.parryFail), options: levels.filter((o) => o.value !== PBZ_PD_ALWAYS),
                label: { en: "Timed Parry: Fail Window", "zh-Hans": "时机格挡：失败窗口", "zh-Hant": "時機格擋：失敗窗口" },
                help: { en: "Attacks with a parry cue: the fail window, times this.",
                    "zh-Hans": "带格挡提示的攻击：失败窗口，乘以此倍数。", "zh-Hant": "帶格擋提示的攻擊：失敗窗口，乘以此倍數。" } },
            { key: "RepeatGuard", type: "choice", default: "Game",
                options: [{ value: "Game", label: { en: "Game default", "zh-Hans": "游戏默认", "zh-Hant": "遊戲預設" } },
                    { value: "0.3", label: "0.3 s" }, { value: "0.2", label: "0.2 s" }, { value: "0.1", label: "0.1 s" }, { value: "Off", label: "Off" }],
                label: { en: "Repeated Guard Penalty", "zh-Hans": "连续格挡惩罚间隔", "zh-Hant": "連續格擋懲罰間隔" },
                help: { en: "A guard press this soon after the last one gets a smaller perfect window (the game's anti-mash rule, 0.4 s in the base game). Shorter lets you guard again sooner without the penalty. Off: no penalty. Game default keeps the base game's time, or another mod's.",
                    "zh-Hans": "距上次按格挡不到这个时间再按，完美窗口会缩小（游戏的防连按规则，原版为 0.4 秒）。设得更短，就能更快再次格挡而不受惩罚。Off：没有惩罚。游戏默认：保留原版时间，或其他模组设定的时间。",
                    "zh-Hant": "距上次按格擋不到這個時間再按，完美窗口會縮小（遊戲的防連按規則，原版為 0.4 秒）。設得更短，就能更快再次格擋而不受懲罰。Off：沒有懲罰。遊戲預設：保留原版時間，或其他模組設定的時間。" } },
            { key: "NoBuildUpOnGuard", type: "toggle", default: false,
                label: { en: "No Status Build-Up on Guard", "zh-Hans": "格挡不累积异常状态", "zh-Hant": "格擋不累積異常狀態" },
                help: { en: "On: the fire, lightning, poison, frost or bleed build-up a hit you guard or deflect adds is taken back, and a burn, freeze, poison, bleed or shock it sets off is taken off at once. Any build-up or status in the half second after a guarded hit is taken back too, even from another enemy. A blood burst, or the first jolt of a shock, hits before it can be taken back. Off: the game's own rule.",
                    "zh-Hans": "On：你格挡或完美格挡的攻击所累积的火、雷、毒、冰、流血等异常值会被撤回，它引发的燃烧、冰冻、中毒、流血或感电会立即解除。格挡后半秒内的任何累积或异常也会撤回，即使来自其他敌人。血爆和感电的第一下冲击会在撤回前生效。Off：游戏原有规则。",
                    "zh-Hant": "On：你格擋或完美格擋的攻擊所累積的火、雷、毒、冰、流血等異常值會被撤回，它引發的燃燒、冰凍、中毒、流血或感電會立即解除。格擋後半秒內的任何累積或異常也會撤回，即使來自其他敵人。血爆和感電的第一下衝擊會在撤回前生效。Off：遊戲原有規則。" } },
            { key: "NoElementalDamageOnGuard", type: "toggle", default: false,
                label: { en: "No Elemental Damage on Guard", "zh-Hans": "格挡不受元素伤害", "zh-Hant": "格擋不受元素傷害" },
                help: { en: "On: a hit you block without a perfect deflect deals no fire, ice, lightning, poison, blood or chaos damage, the way a block already stops its physical damage. A perfect deflect already stops both. Hits you don't block are unchanged. Off: the game's own rule.",
                    "zh-Hans": "On：普通格挡（非完美格挡）挡住的攻击不再造成火、冰、雷、毒、血或混沌伤害，就像格挡本来就挡住物理伤害一样。完美格挡本来就两者都挡。没有格挡的攻击不变。Off：游戏原有规则。",
                    "zh-Hant": "On：普通格擋（非完美格擋）擋住的攻擊不再造成火、冰、雷、毒、血或混沌傷害，就像格擋本來就擋住物理傷害一樣。完美格擋本來就兩者都擋。沒有格擋的攻擊不變。Off：遊戲原有規則。" } },
            ...[["SlowBlue", { en: "Slow Time on Blue Attacks", "zh-Hans": "蓝光攻击时放慢时间", "zh-Hant": "藍光攻擊時放慢時間" },
                { en: "blue", "zh-Hans": "蓝光", "zh-Hant": "藍光" }, { en: "guard", "zh-Hans": "格挡", "zh-Hant": "格擋" }],
            ["SlowRed", { en: "Slow Time on Red Attacks", "zh-Hans": "红光攻击时放慢时间", "zh-Hant": "紅光攻擊時放慢時間" },
                { en: "red", "zh-Hans": "红光", "zh-Hant": "紅光" }, { en: "dodge", "zh-Hans": "闪避", "zh-Hant": "閃避" }],
            ["SlowBlack", { en: "Slow Time on Black (Power) Attacks", "zh-Hans": "黑光（强力）攻击时放慢时间", "zh-Hant": "黑光（強力）攻擊時放慢時間" },
                { en: "black (power)", "zh-Hans": "黑光（强力）", "zh-Hant": "黑光（強力）" }, { en: "guard", "zh-Hans": "格挡", "zh-Hant": "格擋" }]]
                .map(([key, label, c, act]) => ({ key, type: "toggle", default: false, label,
                    help: { en: "On: when an enemy's " + c.en + " attack is about to hit you, the world slows for the last moment before the hit until just after it, for at most the Slow Time Length, so you have time to " + act.en + ". You still press it yourself. It ends at once when you guard a hit or dodge one, the slow-motion dodge starts, or you pause, die, or a cutscene or QTE starts. Off: the game's own speed.",
                        "zh-Hans": "On：敌人的" + c["zh-Hans"] + "攻击即将命中你时，世界会在命中前的最后一刻放慢，直到命中后片刻（最长为「放慢时间长度」），让你有更多时间" + act["zh-Hans"] + "。仍需你自己按键。你格挡或闪避了攻击、慢动作闪避开始，或暂停、死亡、进入过场动画、QTE 时立即恢复。Off：游戏原速。",
                        "zh-Hant": "On：敵人的" + c["zh-Hant"] + "攻擊即將命中你時，世界會在命中前的最後一刻放慢，直到命中後片刻（最長為「放慢時間長度」），讓你有更多時間" + act["zh-Hant"] + "。仍需你自己按鍵。你格擋或閃避了攻擊、慢動作閃避開始，或暫停、死亡、進入過場動畫、QTE 時立即恢復。Off：遊戲原速。" } })),
            { key: "SlowSpeed", type: "choice", default: "0.5", options: [{ value: "0.5", label: "x0.5" }, { value: "0.4", label: "x0.4" }, { value: "0.3", label: "x0.3" }],
                label: { en: "Slow Time Speed", "zh-Hans": "放慢时间速度", "zh-Hant": "放慢時間速度" },
                help: { en: "How fast the world runs while one of the Slow Time rows above slows it: x0.5 is half speed, x0.3 is slowest.",
                    "zh-Hans": "上面的放慢时间选项生效时世界的速度：x0.5 为一半速度，x0.3 最慢。",
                    "zh-Hant": "上面的放慢時間選項生效時世界的速度：x0.5 為一半速度，x0.3 最慢。" } },
            { key: "SlowLength", type: "choice", default: "1.5", options: ["0.5", "1", "1.5", "2", "3"].map((value) => ({ value, label: value + " s" })),
                label: { en: "Slow Time Length", "zh-Hans": "放慢时间长度", "zh-Hant": "放慢時間長度" },
                help: { en: "The longest one slowdown lasts, in real seconds. A longer one starts earlier before the hit; a short one covers less, and can end before the hit lands. 1.5 is the length before this setting existed.",
                    "zh-Hans": "一次放慢最长持续的现实时间（秒）。越长，放慢在命中前开始得越早；越短，覆盖的时间越少，可能在命中前就结束。1.5 为加入此设定之前的长度。",
                    "zh-Hant": "一次放慢最長持續的現實時間（秒）。越長，放慢在命中前開始得越早；越短，覆蓋的時間越少，可能在命中前就結束。1.5 為加入此設定之前的長度。" } },
            { key: "SlowStart", type: "choice", default: "Hit",
                options: [{ value: "Hit", label: { en: "Before the hit", "zh-Hans": "命中之前", "zh-Hant": "命中之前" } },
                    { value: "Warning", label: { en: "When the warning shows", "zh-Hans": "警示出现时", "zh-Hant": "警示出現時" } }],
                label: { en: "Slow Time Starts", "zh-Hans": "放慢时间开始时机", "zh-Hant": "放慢時間開始時機" },
                help: { en: "Before the hit: slows the last moment before the hit, as before this setting existed. When the warning shows: slows as soon as the game signals the attack. For black (power) attacks that is when the glow appears; for blue and red it is a moment after the glow. It never lasts longer than the Slow Time Length, so a short Length can end before the hit.",
                    "zh-Hans": "命中之前：在命中前的最后一刻放慢，与加入此设定之前相同。警示出现时：游戏一发出攻击信号就放慢。黑光（强力）攻击是在光芒出现时；蓝光和红光攻击是在光芒出现后片刻。放慢不会超过「放慢时间长度」，所以长度较短时可能在命中前就结束。",
                    "zh-Hant": "命中之前：在命中前的最後一刻放慢，與加入此設定之前相同。警示出現時：遊戲一發出攻擊訊號就放慢。黑光（強力）攻擊是在光芒出現時；藍光和紅光攻擊是在光芒出現後片刻。放慢不會超過「放慢時間長度」，所以長度較短時可能在命中前就結束。" } },
            { key: "AutoGuard", type: "toggle", default: false,
                label: { en: "Auto Guard", "zh-Hans": "自动格挡", "zh-Hant": "自動格擋" },
                help: { en: "On: when an attack you can block is about to hit you, the mod presses and holds guard for you just before the hit and lets go just after it. Red attacks, grabs and attacks with no warning are left to you, and it does nothing while you hold guard yourself. With Perfect Deflect on Always each one is a perfect deflect; x1.5 or more makes most of them perfect. Off: you guard yourself.",
                    "zh-Hans": "On：可格挡的攻击即将命中你时，模组会在命中前一刻替你按住格挡，命中后片刻松开。红光攻击、抓取和没有预警的攻击仍需你自己应对；你自己按住格挡时它不会动作。完美格挡设为 Always 时每次都是完美格挡；x1.5 或更高时大多数是完美格挡。Off：自己格挡。",
                    "zh-Hant": "On：可格擋的攻擊即將命中你時，模組會在命中前一刻替你按住格擋，命中後片刻鬆開。紅光攻擊、抓取和沒有預警的攻擊仍需你自己應對；你自己按住格擋時它不會動作。完美格擋設為 Always 時每次都是完美格擋；x1.5 或更高時大多數是完美格擋。Off：自己格擋。" } },
            { key: "FistGuard", type: "choice", default: "Game",
                options: [{ value: "Game", label: { en: "Game default", "zh-Hans": "游戏默认", "zh-Hant": "遊戲預設" } },
                    { value: "Deflect", label: { en: "Follow Perfect Deflect", "zh-Hans": "跟随完美格挡", "zh-Hant": "跟隨完美格擋" } }],
                label: { en: "Fist Guard (Iron Gauntlets)", "zh-Hans": "铁拳套格挡", "zh-Hant": "鐵拳套格擋" },
                help: { en: "The Iron Gauntlets' Fist Guard has its own perfect window, which Perfect Deflect does not reach by itself. Follow Perfect Deflect: that window gets as much wider as Perfect Deflect sets, up to the end of the Fist Guard's block, and Always covers its whole original block. Game default: the game's own timing.",
                    "zh-Hans": "铁拳套的格挡有自己的完美窗口，完美格挡设定本身影响不到它。跟随完美格挡：这个窗口按完美格挡的倍数放宽，最多到铁拳套格挡的结束，Always 时覆盖原本的整个格挡。游戏默认：游戏原有判定。",
                    "zh-Hant": "鐵拳套的格擋有自己的完美窗口，完美格擋設定本身影響不到它。跟隨完美格擋：這個窗口按完美格擋的倍數放寬，最多到鐵拳套格擋的結束，Always 時覆蓋原本的整個格擋。遊戲預設：遊戲原有判定。" } }],
            onChange: () => { readAt = -Infinity; } }); // the next poll reads the file
        if (menuWanted)
            readSettings(); // 1.0 (port): the first read, from the file the page saves (the mod's own without a page)
        let alwaysTag = undefined;
        let errors = 0;
        // m: the window multiplier; 1 puts stock frames back (Deflect=Always skips the timing check, so it keeps them stock)
        function scaleDeflect(m, exact = {}) { // 1.1: exact, a field -> its exact frame count
            for (const name of PBZ_PD_DIFFICULTIES) {
                // Find, not Load: only configs the game has loaded. One loaded later comes in stock and is scaled then.
                const cfg = UE.Object.Find(`/PBZCombatAsset/Config/GlobalConfig_Combat_${name}.GlobalConfig_Combat_${name}`);
                if (!cfg)
                    continue;
                for (const field of PBZ_PD_FIELDS) {
                    const key = name + "/" + field;
                    const was = cfg[field];
                    if (typeof was != "number")
                        continue;
                    // anything but our own last value is the base: stock, a reloaded asset, or another mod's edit
                    if (was !== state.wrote[key] || state.base[key] === undefined)
                        state.base[key] = was;
                    const base = state.base[key];
                    const fixed = exact[field]; // 1.1: an exact count wins (it may be shorter than the game's)
                    const want = fixed !== undefined ? fixed : Math.max(base, Math.min(PBZ_PD_MAX_FRAMES, Math.round(base * m))); // never shorter than given
                    if (want === was)
                        continue;
                    cfg[field] = want;
                    state.wrote[key] = cfg[field];
                    pbzLog(() => name + " " + field + " " + was + " -> " + cfg[field] + " frames (base " + base + " x" + m + ")");
                }
            }
        }
        // RepeatGuard: the anti-mash cooldown on the same configs, read live by "Give Perfect Window" (via PDA_GlobalConfig_Combined
        // "Get Deflect Quickclick Punish Cooldown"). Game puts the value we found back; a number is never longer than it.
        function keepRepeatGuard() {
            for (const name of PBZ_PD_DIFFICULTIES) {
                const cfg = UE.Object.Find(`/PBZCombatAsset/Config/GlobalConfig_Combat_${name}.GlobalConfig_Combat_${name}`);
                const key = name + "/" + PBZ_PD_COOLDOWN, was = cfg ? cfg[PBZ_PD_COOLDOWN] : undefined;
                if (typeof was != "number")
                    continue;
                if (!close(was, state.wrote[key]) || state.base[key] === undefined)
                    state.base[key] = was;
                const base = state.base[key];
                const want = settings.repeat === "Game" ? base : Math.min(base, settings.repeat);
                if (!close(was, want)) {
                    cfg[PBZ_PD_COOLDOWN] = want;
                    pbzLog(() => name + " " + PBZ_PD_COOLDOWN + " " + was + " -> " + cfg[PBZ_PD_COOLDOWN] + " s (base " + base + ")");
                }
                state.wrote[key] = cfg[PBZ_PD_COOLDOWN];
            }
        }
        // NoElementalDamageOnGuard and NoBuildUpOnGuard at the source: the normal-block calculators' multipliers for elemental damage
        // (and, for NoBuildUpOnGuard, build-up) go to 0 in memory, as the perfect-deflect ones already are; off puts the value we
        // found back. Only keys the asset has are changed. Anything but our own last value is the new base (stock, a reloaded
        // asset, another mod's edit). Every write is read back; a key that does not take it is logged once and left alone.
        // [unproven: that the damage call reads the map on each hit; the debug log shows the write and read-back]
        function keepGuardDamage() {
            for (const where of PBZ_PD_GUARD_CALCS) {
                const calc = UE.Object.Find(where);
                const map = calc ? calc.AttackMultipliers : undefined;
                if (!map || typeof map.GetMaxIndex != "function") {
                    if (calc && !state.stuck[where]) {
                        state.stuck[where] = true;
                        pbzLog(() => "guard damage: no AttackMultipliers map on " + where);
                    }
                    continue;
                }
                for (let i = 0, n = map.GetMaxIndex(); i < n; i++) {
                    if (!map.IsValidIndex(i))
                        continue;
                    const k = map.GetKey(i), name = String(k.TagName), key = where + "/" + name;
                    const element = PBZ_PD_ELEMENT_TAGS.includes(name);
                    if (!element && !PBZ_PD_BUILDUP_TAGS.includes(name) || state.stuck[key])
                        continue;
                    const was = map.Get(k);
                    if (typeof was != "number")
                        continue;
                    // exact compares: every value here was read from the map (or is 0), so a tolerance would only mistake a
                    // small edit by another mod for our own write
                    if (was !== state.wrote[key] || state.base[key] === undefined)
                        state.base[key] = was;
                    const base = state.base[key];
                    const want = (element ? settings.noElement : settings.noBuildUp) ? 0 : base;
                    if (was === want)
                        continue;
                    map.Add(k, want);
                    state.wrote[key] = want; // ours before the read-back, so a read that throws never makes our 0 the base
                    const now = map.Get(k);
                    if (now !== want) {
                        state.stuck[key] = true;
                        pbzLog(() => "guard damage write did not hold, left alone: " + key + " " + was + " -> " + now);
                    }
                    else
                        pbzLog(() => "guard damage " + key.split("/").slice(-2).join(" ") + " " + was + " -> " + now + " (base " + base + ")");
                }
            }
        }
        // NoBuildUpOnGuard: while a blockable attack's frame is live, keep the player's build-up values from the frame before;
        // for PBZ_PD_GUARDED_S after the game reports a guarded hit (Deflect.Defender.*), any value above them is set back,
        // through the call the game's own EnsurePlayerLifePercent.js uses for Health. A value that falls (decay) lowers the mark.
        // The same watch notes which status effects (PBZ_PD_STATUSES) are on; one that comes on in that half second is taken
        // off, its bar first set back so taking it off cannot set it off again (GE_Frost holds Frost_Accumulation at 0 while on).
        // shortcut: a hit from another enemy inside that half second is put back too; a native hook would be exact, JS can only
        // correct after the fact. A watch the guard result starts (no blockable frame in the last 1.5 s) takes its first note
        // after the hit, so a status that hit set off counts as on before it and stays [inferred: a guard result follows a
        // frame]; noting unknown classes as off would take off statuses the player already had.
        const attrs = {};
        const buildUpAttr = (name) => attrs[name] = attrs[name] || UE.PBZBlueprintFunctionLibrary.MakeAttribute(name, UE.BasicAttributeSet.StaticClass());
        const statusClasses = {};
        const statusClass = (path) => {
            if (statusClasses[path] === undefined) {
                statusClasses[path] = UE.Class.Load(path) || null;
                if (!statusClasses[path])
                    pbzLog(() => "status effect not found, left alone: " + path);
            }
            return statusClasses[path];
        };
        // One watch at a time, owned by the pawn and the game clock it started on: a new pawn, a new world (the clock
        // restarts) or the deadline passing ends it, so one pawn's mark is never written to another.
        function watchFor() {
            const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
            if (!pawn)
                return undefined;
            const path = KSL.GetPathName(pawn), t = seconds(), w = state.watch;
            if (!w || w.pawn !== path || t < w.clock)
                state.watch = { pawn: path, clock: t, until: 0, guardedUntil: 0, mark: {}, had: {}, still: 0 };
            state.watch.clock = t;
            return state.watch;
        }
        // both run with the setting off too: buildUpTick checks it first and stops, so nothing is read or written
        function onGuardFrame(data) {
            slowFor(data); // catches its own errors
            autoFrame(data); // catches its own errors; Off: returns before any read
            const w = watchFor();
            if (!w)
                return;
            w.until = Math.max(w.until, w.clock + PBZ_PD_GUARD_WATCH_S);
            // around this frame's hit a rise is held out of the mark, so build-up that lands just before the game reports
            // the guard is still put back; unguarded, the mark takes it once the hold has passed. Rises earlier in the
            // frame's lead come from other hits and go into the mark at once.
            let hit = NaN;
            try { hit = data.OptionalObject.ReceiveFrame.HitGameTime; } catch (e) { }
            hit = Number.isFinite(hit) ? Math.min(hit, w.clock + PBZ_PD_GUARD_WATCH_S) : w.clock;
            w.holdFrom = hit - PBZ_PD_HOLD_S;
            w.holdUntil = hit + PBZ_PD_HOLD_S;
            watchBuildUp();
        }
        function onGuarded(data) {
            stopSlow("deflect");
            const w = watchFor();
            if (!w)
                return;
            w.guardedUntil = w.clock + PBZ_PD_GUARDED_S;
            w.guardedBy = data && data.EventTag ? String(data.EventTag.TagName).split(".").pop() : "?";
            w.until = Math.max(w.until, w.guardedUntil);
            // debug only: a Health trend over several blocked hits is the in-game proof for NoElementalDamageOnGuard
            pbzLog(() => "guarded " + w.guardedBy + " from " + nameOf(data && data.Instigator) + ", Health " + UE.PBZBlueprintFunctionLibrary.GetAttributeFromCharacter(UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0), buildUpAttr("Health"))
                + ", no elemental damage on guard " + settings.noElement + ", no build-up on guard " + settings.noBuildUp);
            watchBuildUp();
        }
        function watchBuildUp() {
            if (!state.guardTimer)
                state.guardTimer = setInterval(buildUpTick, PBZ_PD_FRAME_POLL_MS);
            buildUpTick();
        }
        function stopBuildUpTimer() {
            if (state.guardTimer)
                clearInterval(state.guardTimer);
            state.guardTimer = undefined;
        }
        function buildUpTick() {
            let live = false;
            try {
                live = settings.noBuildUp && !!state.watch && keepBuildUp(state.watch);
            }
            catch (e) {
                pbzLog(() => "build-up watch threw: " + e);
            }
            if (live === "paused")
                stopBuildUpTimer(); // the 500 ms tick starts it again; the watch and its game-time deadline stay
            else if (!live) {
                stopBuildUpTimer();
                state.watch = undefined; // the next frame takes a fresh mark
            }
        }
        // true while the watch runs, "paused" while game time stands still (a menu), false once it is over
        function keepBuildUp(w) {
            const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
            const t = seconds();
            if (!pawn || KSL.GetPathName(pawn) !== w.pawn || t < w.clock || t > w.until)
                return false;
            w.still = t === w.lastT ? w.still + 1 : 0;
            w.lastT = t;
            if (w.still >= 30)
                return "paused"; // about half a second of frames with the clock stopped
            const guarded = t <= w.guardedUntil, hold = t >= w.holdFrom && t <= w.holdUntil, mark = w.mark, put = [];
            for (const name of PBZ_PD_BUILDUPS) {
                const attr = buildUpAttr(name), v = UE.PBZBlueprintFunctionLibrary.GetAttributeFromCharacter(pawn, attr);
                if (typeof v != "number")
                    continue;
                if (guarded && mark[name] !== undefined && v > mark[name] + 0.001) {
                    UE.AttributeUtils.ModifyCharacterAttributeValue(pawn, attr, UE.EGameplayModOp.Override, mark[name]);
                    put.push(name + " " + v + " -> " + mark[name]);
                }
                else if ((!guarded && !hold) || mark[name] === undefined || v < mark[name])
                    mark[name] = v;
            }
            if (put.length)
                pbzLog(() => "guarded hit (" + w.guardedBy + "): build-up put back, " + put.join(", "));
            const asc = UE.AbilitySystemBlueprintLibrary.GetAbilitySystemComponent(pawn);
            if (asc)
                takeOffStatus(pawn, asc, w, guarded, hold);
            return true;
        }
        // An effect counts as on before the hit by the same rule as the mark: noted while no guard or hit is near, and a
        // status that ends is noted at once, so the next one can be taken off. Any stack of a class that came on goes.
        // The freeze is noted the same way, so a freeze that was on before the hit (another source) is never ended here.
        function takeOffStatus(pawn, asc, w, guarded, hold) {
            const had = w.had;
            const canThaw = typeof pawn.IsCharacterFrozen == "function";
            const frozen = canThaw && pawn.IsCharacterFrozen();
            if ((!guarded && !hold) || had.frozen === undefined || !frozen)
                had.frozen = frozen;
            for (const s of PBZ_PD_STATUSES) {
                const landed = [];
                for (const path of s.ge) {
                    const cls = statusClass(path);
                    if (!cls)
                        continue;
                    const on = asc.GetGameplayEffectCount(cls, null, false) > 0;
                    if (guarded && on && had[path] === false)
                        landed.push(cls);
                    else if ((!guarded && !hold) || had[path] === undefined || !on)
                        had[path] = on;
                }
                if (!landed.length)
                    continue;
                UE.AttributeUtils.ModifyCharacterAttributeValue(pawn, buildUpAttr(s.attr), UE.EGameplayModOp.Override, w.mark[s.attr] ?? 0);
                for (const cls of landed)
                    asc.RemoveActiveGameplayEffectBySourceEffect(cls, null, -1); // from any source, as BP_HitreactEventListener_FreezeEnd does
                // GE_Frost's cue (GC_Frozen, GCC_FreezeCharacter) freezes the character; make sure that ends with it
                const thawed = s.attr == "Frost_Accumulation" && canThaw && had.frozen === false && pawn.IsCharacterFrozen()
                    && (pawn.FreezeCharacter(false), true);
                pbzLog(() => "guarded hit (" + w.guardedBy + "): status taken off, " + landed.map((c) => KSL.GetDisplayName(c)).join(", ")
                    + ", " + s.attr + " -> " + (w.mark[s.attr] ?? 0) + (thawed ? ", unfrozen" : ""));
            }
        }
        function scaleDodge() {
            if (state.dash === null)
                return; // gave up earlier: the dodge window stays stock
            try {
                const cls = state.dash = state.dash || UE.Class.Load(PBZ_PD_DASH_GE) || null;
                if (!cls) {
                    pbzLog(() => "GE_PerfectDash not found, dodge window stays stock");
                    return;
                }
                const cdo = UE.SGameAIFunctionLibrary.GetClassDefaultObject(cls);
                const magnitude = cdo.DurationMagnitude;
                const flat = magnitude.ScalableFloatMagnitude;
                const was = flat.Value;
                if (!close(was, state.wroteDash) || state.dashBase === undefined)
                    state.dashBase = was;
                const base = state.dashBase;
                const want = Math.max(base, settings.dodge === PBZ_PD_ALWAYS ? PBZ_PD_ALWAYS_DODGE_S : Math.min(PBZ_PD_ALWAYS_DODGE_S, base * settings.dodge));
                state.wroteDash = was;
                if (close(was, want))
                    return;
                // struct values can come back as copies, so write every level back (Movement Speed's Super Sprint pattern)
                flat.Value = want;
                magnitude.ScalableFloatMagnitude = flat;
                cdo.DurationMagnitude = magnitude;
                const now = cdo.DurationMagnitude.ScalableFloatMagnitude.Value;
                state.wroteDash = now;
                state.dashThrows = 0;
                pbzLog(() => "GE_PerfectDash duration " + was + " -> " + now + " s (base " + base + ")");
                if (!close(now, want)) {
                    state.dash = null;
                    pbzLog(() => "GE_PerfectDash write did not stick, dodge window left alone");
                }
            }
            catch (e) {
                state.dashThrows = (state.dashThrows || 0) + 1;
                if (state.dashThrows >= 10)
                    state.dash = null; // keeps failing (a patch moved the property): stop, the dodge stays stock
                pbzLog(() => "dodge window threw (" + state.dashThrows + "): " + e);
            }
        }
        function keepAlwaysPerfect() {
            if (state.deflectGE === null)
                return;
            const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
            const asc = pawn ? UE.AbilitySystemBlueprintLibrary.GetAbilitySystemComponent(pawn) : undefined;
            if (!asc)
                return;
            if (!alwaysTag) {
                alwaysTag = new UE.GameplayTag();
                alwaysTag.TagName = PBZ_PD_ALWAYS_TAG;
            }
            if (asc.HasMatchingGameplayTag(alwaysTag))
                return;
            const cls = state.deflectGE = state.deflectGE || UE.Class.Load(PBZ_PD_DEFLECT_GE) || null;
            if (!cls) {
                pbzLog(() => "GE_PerfectDeflect not found, deflects stay stock");
                return;
            }
            // the effect the game's own pbz.ForcePerfectDeflect switch puts on the player (RenewalPlayer.js
            // applyForcePerfectDeflect). Infinite, one stack at most, so a repeat apply cannot pile up.
            asc.BP_ApplyGameplayEffectToSelf(cls, 1, asc.MakeEffectContext());
            state.alwaysPawn = KSL.GetPathName(pawn);
            pbzLog(() => "GE_PerfectDeflect applied to " + UE.KismetSystemLibrary.GetDisplayName(pawn) + ", AlwaysPerfect " + asc.HasMatchingGameplayTag(alwaysTag));
        }
        // Always Perfect switched off: take back the effect we put on this pawn, and only ours. The game's own debug switch
        // puts on the same effect (and replaces ours on a new level), so while that cvar is on the effect is left to it.
        // A new pawn never had ours.
        function dropAlwaysPerfect() {
            if (!state.alwaysPawn)
                return;
            const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
            const asc = pawn ? UE.AbilitySystemBlueprintLibrary.GetAbilitySystemComponent(pawn) : undefined;
            if (!asc)
                return; // loading: try again next poll
            const ours = KSL.GetPathName(pawn) == state.alwaysPawn && !!state.deflectGE && !KSL.GetConsoleVariableIntValue(PBZ_PD_GAME_SWITCH);
            if (ours)
                asc.RemoveActiveGameplayEffectBySourceEffect(state.deflectGE, asc, -1); // as RenewalPlayer.js applyForcePerfectDeflect does
            state.alwaysPawn = undefined;
            pbzLog(() => (ours ? "GE_PerfectDeflect removed from " : "always perfect off, new pawn ") + KSL.GetDisplayName(pawn) + ", AlwaysPerfect " + (alwaysTag ? asc.HasMatchingGameplayTag(alwaysTag) : "?"));
        }
        const tags = {};
        const tag = (name) => {
            if (!tags[name]) {
                tags[name] = new UE.GameplayTag();
                tags[name].TagName = name;
            }
            return tags[name];
        };
        const seconds = () => UE.GameplayStatics.GetTimeSeconds(gameInstance);
        // debug lines only (1.8.0 capture for the Mu Xiaokui report): the ability an action belongs to, and who sent an event
        const gaOf = (o) => { try { const p = String(KSL.GetPathName(o)), m = /(GA_\w+?)(?:_C)?[.:]/.exec(p); return m ? m[1] : p.split("/").pop(); } catch (e) { return "?"; } };
        const nameOf = (o) => { try { return o ? KSL.GetDisplayName(o) : "?"; } catch (e) { return "?"; } };
        function endGuardListens() {
            for (const a of state.guardListens || [])
                try { a.EndAction(); } catch (e) { }
            state.guardListens = [];
        }
        // One set of listeners per player pawn, bound again for a new pawn or a new world (the game clock restarts).
        function listenForDodgeFrames() {
            const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
            if (!pawn)
                return;
            const path = UE.KismetSystemLibrary.GetPathName(pawn), t = seconds();
            // Auto Guard: a new pawn or world (the clock went back) starts with no cooldown, hold or not; judged on what this poll
            // saw last, not on a bind that worked, so a retried bind on the same pawn keeps it
            if (path != state.autoPawn || t < state.frameClock)
                state.autoLast = undefined;
            state.autoPawn = path;
            const same = path == state.framePawn && t >= state.frameClock;
            state.frameClock = t;
            if (same)
                return;
            if (state.frameListen)
                try { state.frameListen.EndAction(); } catch (e) { }
            state.frameListen = undefined;
            state.framePawn = undefined;
            state.frameTried = []; // frame handles count per DeflectComponent, so a new pawn can reuse them
            state.slowPath = undefined; // a new pawn or world has its own subsystem
            state.leftoverDue = true; // tick looks for our key left in this world's slow-motion map
            endGuardListens(); // the build-up watch ends itself on a new pawn or world (keepBuildUp)
            for (const [name, fn] of [[PBZ_PD_GUARD_FRAME_EVENT, onGuardFrame], [PBZ_PD_GUARDED_EVENT, onGuarded],
                [PBZ_PD_DODGED_EVENT, (d) => { pbzLog(() => "dodged from " + nameOf(d && d.Instigator)); stopSlow("dodge"); }],
                [PBZ_PD_PERFECT_DODGE_EVENT, (d) => { pbzLog(() => "dodged perfect from " + nameOf(d && d.Instigator)); stopSlow("perfect dodge"); }]]) {
                const a = UE.AbilityAsync_WaitGameplayEvent.WaitGameplayEventToActor(pawn, tag(name), false, false);
                if (!a)
                    continue;
                a.EventReceived.Add(fn);
                a.Activate();
                state.guardListens.push(a);
            }
            const listen = UE.AbilityAsync_WaitGameplayEvent.WaitGameplayEventToActor(pawn, tag(PBZ_PD_FRAME_EVENT), false, false);
            if (!listen)
                return;
            listen.EventReceived.Add((data) => { slowFor(data); watchDodgeFrames(); });
            listen.Activate();
            state.frameListen = listen;
            state.framePawn = path;
            pbzLog(() => "slow-mo dodge listening on " + UE.KismetSystemLibrary.GetDisplayName(pawn) + ", guard listeners " + state.guardListens.length);
            watchDodgeFrames(); // a frame that landed before this listener existed
        }
        // Polls only while a dodge frame is live, so a dash that is already running when the frame lands is caught too.
        function watchDodgeFrames() {
            state.frameUntil = seconds() + PBZ_PD_FRAME_WATCH_S;
            if (!state.frameTimer)
                state.frameTimer = setInterval(frameTick, PBZ_PD_FRAME_POLL_MS);
            frameTick();
        }
        function frameTick() {
            let live = false;
            try {
                live = seconds() <= state.frameUntil && slowMoDodge();
            }
            catch (e) {
                pbzLog(() => "slow-mo dodge threw: " + e);
            }
            if (!live && state.frameTimer) {
                clearInterval(state.frameTimer);
                state.frameTimer = undefined;
            }
        }
        // Returns false once no dodge frame is live. Asks for Hun.PerfectDodge once per frame, like the game's own assist.
        function slowMoDodge() {
            if (settings.dodge === 1)
                return false; // Dodge=Off: the game's own rule, a dodge pressed before the frame stays a plain dash
            const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
            const asc = pawn ? UE.AbilitySystemBlueprintLibrary.GetAbilitySystemComponent(pawn) : undefined;
            const deflect = pawn ? pawn.GetComponentByClass(UE.DeflectComponent.StaticClass()) : undefined;
            if (!asc || !deflect)
                return false;
            const out = puerts.$ref(undefined);
            const handle = deflect.GetNearestValidReceivedFrame(360, 9999, true, -1, out); // the angle and range BP_PerfectDodgePassive uses
            if (handle < 0) {
                state.frameTried = []; // every frame we asked about has ended
                return false;
            }
            if (state.frameTried.includes(handle) || !asc.HasMatchingGameplayTag(tag(PBZ_PD_PERFECT_TAG)) || asc.HasMatchingGameplayTag(tag(PBZ_PD_SLOWMO_TAG)))
                return true;
            const input = pawn.GetComponentByClass(UE.AbilityInputComponent.StaticClass());
            const dodge = state.dodgeInput = state.dodgeInput || UE.Object.Load(PBZ_PD_DODGE_INPUT);
            if (!input || !dodge)
                return true; // not ready (loading): the handle is not marked, so a later poll still asks
            state.frameTried.push(handle);
            // true means the input component accepted the request; the ability's own checks can still decline it
            const how = input.TryActivateExternalActionAbilityInterruptLowerByTag(tag(PBZ_PD_SLOWMO_TAG), dodge, PBZ_PD_SLOWMO_PRIORITY) ? "requested" : "refused";
            pbzLog(() => {
                const frame = puerts.$unref(out);
                return "slow-mo dodge for frame " + handle + " (hit in " + Math.round((frame.HitGameTime - seconds()) * 1000) + " ms" + (frame.IsHit ? ", already hit" : "") + "): " + how;
            });
            return true;
        }
        // Slow on warning (1.6.0). An enemy attack's deflect or dodge frame reaching the player (the listeners above) carries
        // its SourceAction; DeflectBulletType (DeflectType on burst actions) gives the colour, 2 BlueEye, 3 RedEye, 4 PowerAttack
        // (taken as the black attacks, not matched to the on-screen colour). A chosen colour slows the world for the last stretch
        // before the hit (as much as the real-time cap reaches, so a long warning starts late) to just past the hit, through
        // the game's own slow-motion service: SlomoWorldSubsystem.ApplySlomo(our id, speed) puts our key
        // in its map and ApplySlomo(our id, 1.0) takes it out [proven in game 2026-11-07, LESSONS]. That call has no duration,
        // so this mod ends every slowdown itself: our game-time deadline, a real-time cap (1.5 s, 2 s for the debug probe), a
        // guard result, a dodge, the game's own slow-motion dodge, pause, death, a cutscene, a QTE or execution, a new pawn or
        // world, the row going Off and a second load of this module, checked every 16 ms while one runs. An end counts once a
        // read of the map shows our key gone; until then it is tried again every tick. The windows are not touched.
        // That service is the only way this mod slows the world. If it is not reachable, or a start throws, the slow rows start
        // nothing more this session (slowOff, one log line); a slowdown already started still gets its end.
        const ueType = (name) => { try { return UE[name]; } catch (e) { return undefined; } }; // a renamed class reads as missing
        // whether our key is in the service's map (reads are live); throws when the map cannot be read
        function ourKey(sub) {
            const m = sub.RuntimeSlomoData.SlomoData;
            for (let i = 0, n = m.GetMaxIndex(); i < n; i++)
                if (m.IsValidIndex(i) && String(m.GetKey(i)) === PBZ_PD_SLOW_ID)
                    return true;
            return false;
        }
        // the service in the pawn's world, with ApplySlomo and a map we can read; throws why not
        function slomoOf(pawn) {
            const Sub = ueType("SlomoWorldSubsystem");
            const sub = Sub ? UE.SubsystemBlueprintLibrary.GetWorldSubsystem(pawn, Sub.StaticClass()) : undefined;
            if (!sub || typeof sub.ApplySlomo != "function")
                throw new Error(!Sub ? "no SlomoWorldSubsystem class" : !sub ? "no subsystem in this world" : "no ApplySlomo on the subsystem");
            ourKey(sub); // a map that cannot be read fails here, before any start
            return sub;
        }
        // the slow rows start nothing more this session, said once
        function slowOff(why) {
            state.slowDead = why;
            state.slowPath = undefined;
            pbzLog(() => "slow probe: path=none (" + why + ")");
            if (!debugBuild)
                try { console.warn("[Easier Parry and Dodge] the Slow Time rows are off for this session (" + why + ")"); } catch (e) { }
        }
        // the service, found once per pawn and game clock (a new world has a new one); undefined after slowOff
        function slowPath(pawn) {
            if (state.slowDead)
                return undefined;
            const where = KSL.GetPathName(pawn), t = seconds(), p = state.slowPath;
            if (p && p.pawn === where && t >= p.clock) {
                p.clock = t;
                return p.sub;
            }
            let sub;
            try { sub = slomoOf(pawn); }
            catch (e) { return slowOff(String(e)); }
            state.slowPath = { pawn: where, clock: t, sub };
            pbzLog(() => "slow probe: path=subsystem");
            return sub;
        }
        const slowWanted = (colour) => colour == "probe" || !!settings.slow[colour];
        // why a slowdown must not run now, or ""
        function slowBlocked(pawn) {
            if (UE.GameplayStatics.IsGamePaused(gameInstance))
                return "pause";
            const asc = UE.AbilitySystemBlueprintLibrary.GetAbilitySystemComponent(pawn);
            const stop = asc ? PBZ_PD_SLOW_STOP_TAGS.find(([name]) => asc.HasMatchingGameplayTag(tag(name))) : undefined;
            if (stop)
                return stop[1];
            const Seq = ueType("PBZLevelSequenceManager"), seq = Seq ? UE.SubsystemBlueprintLibrary.GetWorldSubsystem(pawn, Seq.StaticClass()) : undefined;
            if (seq && seq.IsInSequence())
                return "cutscene";
            // menus, cutscenes and QTEs switch to input modes without the dodge action (Animation Cancel's keysOf)
            const In = ueType("EnhancedInputLocalPlayerSubsystem"), dodge = state.dodgeInput = state.dodgeInput || UE.Object.Load(PBZ_PD_DODGE_INPUT);
            const input = In && dodge ? UE.SubsystemBlueprintLibrary.GetLocalPlayerSubsystem(UE.PBZBlueprintFunctionLibrary.GetLocalPlayer(pawn), In.StaticClass()) : undefined;
            const keys = input ? input.QueryKeysMappedToAction(dodge) : undefined;
            return keys && keys.Num() == 0 ? "qte" : "";
        }
        // debug line for every frame that reaches slowFor (pbzLog runs it only in the debug build)
        function frameLine(data) {
            try {
                const f = data.OptionalObject.ReceiveFrame, a = f.SourceAction;
                const type = a ? (typeof a.DeflectBulletType == "number" ? a.DeflectBulletType : a.DeflectType) : "?";
                const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
                let dist = "?";
                try {
                    const p = pawn.K2_GetActorLocation(), q = data.Instigator.K2_GetActorLocation();
                    dist = String(Math.round(Math.hypot(p.X - q.X, p.Y - q.Y, p.Z - q.Z)));
                }
                catch (e) { }
                const kind = /Frame\.Dodge/.test(String(data.EventTag && data.EventTag.TagName)) ? "dodge" : "guard";
                return "frame " + kind + " type=" + type + " lead=" + (f.HitGameTime - seconds()).toFixed(3) + " isHit=" + !!f.IsHit + " dist=" + dist + " src=" + (a ? gaOf(a) : "?");
            }
            catch (e) { return "frame unreadable: " + e; }
        }
        // A blockable or dodge frame: slow for its colour, unless a running or waiting slowdown already covers this hit.
        // The real cap counts from the start, so a long warning starts late: the slowdown covers the last stretch before the
        // hit and ends just past it, with the cap still to spare. Until then it waits (state.slowWait, writes nothing).
        function slowFor(data) {
            pbzLog(() => frameLine(data)); // debug only, before the rows-Off return: tells "no frame" from "frame skipped"
            if (!settings.slow.blue && !settings.slow.red && !settings.slow.black)
                return; // every row Off: nothing read
            if (state.slowDead)
                return; // the service is not reachable this session (said once by slowOff)
            try {
                const f = data.OptionalObject.ReceiveFrame, a = f.SourceAction;
                const type = a ? (typeof a.DeflectBulletType == "number" ? a.DeflectBulletType : a.DeflectType) : undefined;
                // the attacker, only for SlowStart=Warning (a black frame of an attack its cue already slowed)
                let enemy;
                if (settings.slowStart == "warning")
                    try { enemy = data.Instigator ? KSL.GetPathName(data.Instigator) : undefined; } catch (e) { }
                slowWindow(PBZ_PD_SLOW_TYPES[type], f.HitGameTime, "frame", enemy, type, () => f.IsHit);
            }
            catch (e) {
                pbzLog(() => "slow threw: " + e);
                state.slowPath = undefined;
                stopSlow("error");
            }
        }
        // One slowdown for a hit due at game time hit, from a frame (slowFor) or a black warning cue (onCue, source "cue").
        // SlowStart=Hit is the 1.7.0 rule above. SlowStart=Warning starts at once (nothing waits) and ends at hit + after or
        // when the cap's reach runs out, whichever is first. A black frame of an attack its cue already slowed starts nothing
        // more: it re-times the running slowdown to the frame's hit, or is skipped once that slowdown has ended.
        // isHit: a function, so a frame's IsHit is read only past the colour and row checks, as 1.7.0 read it
        function slowWindow(colour, hit, source, enemy, type, isHit) {
            const cueLine = source == "cue" ? " (cue)" : "";
            try {
                const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
                const m = settings.slowSpeed, realMs = settings.slowLength * 1000, reach = realMs / 1000 * m; // game time the real cap can cover
                const after = Math.min(PBZ_PD_SLOW_AFTER_S, reach / 3); // a hand-edited x0.1 or x0.2 keeps the hit inside the window
                const warn = settings.slowStart == "warning";
                const now = seconds(), lead = hit - now, until = warn ? Math.min(hit + after, now + reach) : hit + after, startAt = warn ? now : until - (reach - after);
                const s = state.slow, w = state.slowWait, where = pawn ? KSL.GetPathName(pawn) : undefined;
                // a stop rule seen here (pause, death, cutscene, QTE, the slow-motion dodge) also ends a running or waiting one
                const blocked = colour && slowWanted(colour) && pawn ? slowBlocked(pawn) : "";
                if (blocked)
                    stopSlow(blocked);
                let why = !colour ? "type " + type : !slowWanted(colour) ? "off" : isHit && isHit() ? "already hit" : !(lead > 0) ? "late"
                    : !pawn ? "no pawn" : blocked;
                const cue = warn && !why && source == "frame" && colour == "black" ? sameCue(enemy, hit, now) : undefined;
                if (cue)
                    return cueFrame(cue, hit, now, after);
                why = why || (s && s.until >= until && s.pawn === where ? "covered by the running slowdown"
                    : w && w.startAt <= startAt && w.until >= until && w.pawn === where ? "covered by the waiting slowdown" : "");
                if (why)
                    return pbzLog(() => "slow skip " + (colour ? colour + " " : "") + why + cueLine);
                const sub = slowPath(pawn);
                if (!sub)
                    return;
                if (startAt > now) {
                    cancelWait("replaced");
                    state.slowWait = { colour, pawn: where, clock: now, still: 0, hit, until, startAt, m, realMs };
                    watchSlow();
                    return pbzLog(() => "slow wait " + colour + " lead=" + lead.toFixed(3) + " start in " + (startAt - now).toFixed(3));
                }
                // a waiting start that ends later stays, and replaces this one at its start (one queued at another speed may not)
                if (w && w.until <= until)
                    cancelWait("replaced");
                startNow(pawn, sub, colour, lead, until, m, realMs, source == "cue" ? { enemy, hit, at: now, reachEnd: now + reach < hit + after } : undefined);
            }
            catch (e) {
                pbzLog(() => "slow threw: " + e + cueLine);
                state.slowPath = undefined;
                stopSlow("error");
            }
        }
        // the cue start this black frame belongs to (same enemy, hit within 1 s of the predicted one), or undefined. One
        // record per enemy (its latest cue start); a record is forgotten once game time passes its hit + 1 s or the clock
        // runs backwards (a new world)
        function sameCue(enemy, hit, now) {
            const cues = state.cues || new Map();
            for (const [k, c] of cues)
                if (now > c.hit + PBZ_PD_CUE_SAME_S || now < c.at)
                    cues.delete(k);
            const c = enemy === undefined ? undefined : cues.get(enemy);
            return c && Math.abs(hit - c.hit) <= PBZ_PD_CUE_SAME_S ? c : undefined;
        }
        // the frame of an attack its cue slowed: re-time the running slowdown (the real cap from the cue start still bounds
        // it), or skip once it has ended
        function cueFrame(c, hit, now, after) {
            const s = state.slow;
            if (s && s.cue === c && !s.ending) {
                s.until = hit + after;
                c.reachEnd = false; // the game deadline is now the hit's; only the real cap means the length ran out
                return pbzLog(() => "slow hit black " + (c.hit - now).toFixed(3) + " -> " + (hit - now).toFixed(3) + " (cue)");
            }
            pbzLog(() => "slow skip black " + (c.ended || "ended by map load"));
        }
        // SlowStart=Warning with SlowBlack On (1.7.1): two listeners on the player for the enemies that start or stop hating
        // the player, and one per such enemy for its black warning cue. Nothing is polled or replaced; with the gate false
        // this returns before it builds a tag. Bound again with the frame listeners (a new pawn or world), ended on toggle-off.
        function listenForWarnings() {
            const listens = state.warnListens = state.warnListens || new Map();
            if (settings.slowStart != "warning" || !settings.slow.black || state.slowDead) {
                if (state.warnBind || listens.size)
                    endWarnListens(true);
                return;
            }
            const bind = state.frameListen; // a new object for each new pawn or world (listenForDodgeFrames)
            if (!bind) { // no frame listener on this pawn yet: none of ours may stay on the last one
                if (state.warnBind || listens.size)
                    endWarnListens(false);
                return;
            }
            const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
            if (!pawn || state.warnBind === bind)
                return;
            endWarnListens(false);
            state.warnBind = bind;
            state.warnFullSaid = false;
            for (const [name, fn] of [[PBZ_PD_HATRED_ADDED, watchEnemy], [PBZ_PD_HATRED_REMOVED, unwatchEnemy]]) {
                let a;
                try { a = UE.AbilityAsync_WaitGameplayEvent.WaitGameplayEventToActor(pawn, tag(name), false, true); } catch (e) { }
                if (!a)
                    continue;
                state.warnPlayer.push(a); // kept before the calls that can throw, so cleanup always finds it
                try {
                    a.EventReceived.Add((data) => { try { fn(data.Target); } catch (e) { warnThrew(e); } });
                    a.Activate();
                }
                catch (e) {
                    try { a.EndAction(); } catch (x) { }
                    state.warnPlayer.pop();
                }
            }
            if (state.warnPlayer.length < 2) {
                endWarnListens(false);
                state.warnBind = bind; // once per pawn
                return pbzLog(() => "slow start mode: warning listener not available, black starts at the frame");
            }
            // enemies already fighting the player sent their Added before this bind: the list the game keeps
            let n = 0;
            try {
                const list = pawn["Get SGame Hatred Manager Component"]().BeHatredList;
                for (let i = 0, count = list.Num(); i < count; i++)
                    if (watchEnemy(list.Get(i)))
                        n++;
            }
            catch (e) {
                if (!state.warnSeedSaid) {
                    state.warnSeedSaid = true;
                    pbzLog(() => "warn seed failed: " + e);
                }
            }
            pbzLog(() => "warn listening on " + KSL.GetDisplayName(pawn) + ", " + n + " seeded");
        }
        // ends every warning listener; say: the toggle-off line
        function endWarnListens(say) {
            const listens = state.warnListens || new Map(), n = listens.size;
            for (const a of (state.warnPlayer || []).concat([...listens.values()].map((e) => e.listen)))
                try { a.EndAction(); } catch (e) { }
            listens.clear();
            state.warnListens = listens;
            state.warnPlayer = [];
            state.warnBind = undefined;
            state.cues = new Map();
            if (say)
                pbzLog(() => "warn listeners off (" + n + ")");
        }
        const enemyName = (actor) => { try { return KSL.GetDisplayName(actor); } catch (e) { return "?"; } };
        // true when it starts listening to this enemy
        function watchEnemy(actor) {
            const listens = state.warnListens;
            if (!actor || !KSL.IsValid(actor))
                return false;
            const key = KSL.GetPathName(actor);
            if (listens.has(key))
                return false;
            if (listens.size >= PBZ_PD_WARN_MAX) {
                for (const [k, e] of listens) { // dead ones first (a dead wrapper can throw)
                    let dead = true;
                    try { dead = !KSL.IsValid(e.actor); } catch (x) { }
                    if (dead) {
                        try { e.listen.EndAction(); } catch (x) { }
                        listens.delete(k);
                    }
                }
                if (listens.size >= PBZ_PD_WARN_MAX) {
                    if (!state.warnFullSaid) {
                        state.warnFullSaid = true;
                        pbzLog(() => "warn list full");
                    }
                    return false;
                }
            }
            const a = UE.AbilityAsync_WaitGameplayEvent.WaitGameplayEventToActor(actor, tag(PBZ_PD_CUE_EVENT), false, true);
            if (!a)
                return false;
            listens.set(key, { actor, listen: a }); // kept before the calls that can throw, so cleanup always finds it
            try {
                a.EventReceived.Add((data) => onCue(actor, key, data));
                a.Activate();
            }
            catch (e) {
                try { a.EndAction(); } catch (x) { }
                listens.delete(key);
                throw e; // said by the handler's warnThrew
            }
            pbzLog(() => "warn enemy +" + enemyName(actor) + " (" + listens.size + ")");
            return true;
        }
        function unwatchEnemy(actor) {
            const listens = state.warnListens;
            let key;
            try { key = KSL.GetPathName(actor); } catch (e) { } // a dead wrapper: found by identity below
            if (!listens.has(key))
                key = [...listens].find(([k, e]) => e.actor === actor)?.[0];
            const e = listens.get(key);
            if (!e)
                return;
            try { e.listen.EndAction(); } catch (x) { }
            listens.delete(key);
            pbzLog(() => "warn enemy -" + enemyName(actor) + " (" + listens.size + ")");
        }
        // a throw in a handler never reaches the game's broadcast; logged at most once a minute
        function warnThrew(e) {
            if (Math.abs(Date.now() - (state.warnThrewAt || -Infinity)) < 60000)
                return;
            state.warnThrewAt = Date.now();
            pbzLog(() => "warn threw: " + e);
        }
        // a watched enemy's black warning cue: slow now, until the hit the cue's own length predicts
        function onCue(actor, key, data) {
            try {
                const a = data.OptionalObject;
                if (!a || typeof a.GetClass != "function" || a.GetClass().GetName() !== PBZ_PD_CUE_CLASS)
                    return; // another sender of the tag
                let dur = NaN;
                try {
                    const out = puerts.$ref(new UE.LGAActionEvent());
                    a.GetActionEvent(out);
                    dur = Number(puerts.$unref(out).duration);
                }
                catch (e) { }
                if (!(dur > 0)) { // the cue's own entry in its timeline (Actions, Action, duration)
                    dur = NaN;
                    try {
                        const me = KSL.GetPathName(a), acts = a.GetTimeline().Actions;
                        for (let i = 0, n = acts.Num(); i < n; i++) {
                            const e = acts.Get(i);
                            if (e.Action && KSL.GetPathName(e.Action) === me) {
                                dur = Number(e.duration);
                                break;
                            }
                        }
                    }
                    catch (e) { }
                }
                let dist = NaN;
                try {
                    const p = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0).K2_GetActorLocation(), q = actor.K2_GetActorLocation();
                    dist = Math.hypot(p.X - q.X, p.Y - q.Y, p.Z - q.Z);
                }
                catch (e) { }
                pbzLog(() => "warn black from " + enemyName(actor) + " ga=" + gaOf(a) + " dur=" + (dur > 0 ? dur.toFixed(3) : "?") + " dist=" + (dist >= 0 ? Math.round(dist) : "?"));
                const skip = !(dur > 0) ? "no cue length" : dist > PBZ_PD_WARN_FAR_CM ? "far" : "";
                if (skip)
                    return pbzLog(() => "slow skip black " + skip + " (cue)"); // no cue length: the frame starts it
                slowWindow("black", seconds() + dur, "cue", key);
            }
            catch (e) { warnThrew(e); }
        }
        // a running slowdown replaces the one before it (one at a time)
        function startNow(pawn, sub, colour, lead, until, m, realMs, cue) {
            if (state.slow)
                endSlow(state.slow, "replaced");
            if (state.slow)
                return pbzLog(() => "slow skip " + colour + " the last slowdown is still ending" + (cue ? " (cue)" : ""));
            startSlow(pawn, sub, colour, lead, until, m, realMs, cue);
        }
        function watchSlow() {
            if (!state.slowTimer)
                state.slowTimer = setInterval(slowTick, PBZ_PD_FRAME_POLL_MS);
        }
        function cancelWait(why) {
            if (!state.slowWait)
                return;
            state.slowWait = undefined;
            pbzLog(() => "slow wait cancelled " + why);
        }
        // the record of a slowdown: stored before the call that starts it, so whatever happens next it gets its end
        function track(sub, pawn, colour, until, realMs) {
            const s = state.slow = { sub, colour, pawn: KSL.GetPathName(pawn), clock: seconds(), still: 0, until, realUntil: Date.now() + realMs, ending: "", tries: 0 };
            state.slowUsed = true;
            watchSlow();
            return s;
        }
        function startSlow(pawn, sub, colour, lead, until, m, realMs, cue) {
            if (state.slowDead || state.slow)
                return; // after slowOff, or while the last slowdown is still ending
            const s = track(sub, pawn, colour, until, realMs);
            if (cue)
                (state.cues = state.cues || new Map()).set(cue.enemy, s.cue = cue); // its own frame re-times this one or is skipped (slowWindow)
            let why = "";
            try {
                sub.ApplySlomo(PBZ_PD_SLOW_ID, m);
                if (!ourKey(sub))
                    why = "ApplySlomo did not add our key";
            }
            catch (e) { why = "start threw " + e; }
            if (why) {
                slowOff(why);
                return endSlow(s, "start failed");
            }
            pbzLog(() => "slow start " + colour + " lead=" + lead.toFixed(3) + " for=" + (until - s.clock).toFixed(3) + " s x" + m + (cue ? " (cue)" : ""));
        }
        // ApplySlomo(our id, 1.0) takes our key out; the end counts once a map read shows it gone, else slowTick tries again
        // every tick, with no limit: the key is ours by name. One line when it starts, one more if it needed retries.
        function endSlow(s, reason) {
            if (!s.ending)
                s.ending = reason;
            if (s.cue && !s.cue.ended) // what the attack's frame is told when it comes after this end (cueFrame)
                s.cue.ended = s.ending == "deadline" && (s.capped || s.cue.reachEnd) ? "length used" : "ended by " + s.ending;
            s.tries++;
            let note = "", gone = false;
            try { gone = !ourKey(s.sub); } // a start that threw before adding the key needs no call
            catch (e) { note = "map read threw " + e; }
            if (!gone) {
                try { s.sub.ApplySlomo(PBZ_PD_SLOW_ID, 1.0); }
                catch (e) { note = "end threw " + e; }
                try { gone = !ourKey(s.sub); }
                catch (e) { note = note || "map read threw " + e; }
            }
            if (gone) {
                dropSlow(s);
                state.slowLast = s.ending;
                pbzLog(() => "slow stop " + s.ending + (s.tries > 1 ? " (key gone after " + s.tries + " tries)" : ""));
            }
            else if (s.tries == 1)
                pbzLog(() => "slow stop " + s.ending + ", key still in the map (" + (note || "after ApplySlomo 1.0") + "), trying again every tick");
        }
        function dropSlow(s) {
            if (state.slow === s)
                state.slow = undefined;
            if (!state.slow && !state.slowWait && state.slowTimer) {
                clearInterval(state.slowTimer);
                state.slowTimer = undefined;
            }
        }
        // cancels a waiting start and ends the running slowdown (one already ending gets one more try, under its first reason)
        function stopSlow(reason) {
            cancelWait(reason);
            if (state.slow)
                endSlow(state.slow, reason);
        }
        // Our key left in this world's service with no record (a record dropped with its world, or an earlier copy of this
        // module) is ended like any slowdown. state.leftoverDue asks for the check (module load, each new pawn or world, a
        // dropped record); tick runs it every 500 ms while no record exists, and it stays due until a map read succeeds.
        // Nothing is looked up while the rows have never been On in this JS environment. After slowOff it still looks
        // (silently), since a key from an earlier copy may be there.
        function endLeftover(pawn) {
            if (!settings.slow.blue && !settings.slow.red && !settings.slow.black && !state.slowUsed)
                return void (state.leftoverDue = false);
            let sub;
            try { sub = state.slowDead ? slomoOf(pawn) : slowPath(pawn); }
            catch (e) { return; } // after slowOff: said once already
            if (!sub)
                return; // slowOff just now: the next check uses slomoOf
            let left;
            try { left = ourKey(sub); }
            catch (e) { return void (state.slowDead || slowOff("map read threw " + e)); }
            if (left)
                endSlow(track(sub, pawn, "leftover", -Infinity, 0), "leftover");
            state.leftoverDue = false; // checked
        }
        // every 16 ms while a slowdown runs, is ending or waits to start: the running one first, then the waiting one
        function slowTick() {
            if (state.slow)
                runTick(state.slow);
            if (state.slowWait)
                waitTick(state.slowWait);
            dropSlow(undefined); // the timer goes once neither is left
        }
        // A waiting start writes nothing. Every stop and skip rule cancels it before it starts; it starts once game time
        // reaches its start (a clock that stands still holds it, 30 still polls cancel it as a pause).
        function waitTick(w) {
            let why = "";
            try {
                const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0), t = seconds();
                why = state.slowDead ? "session off" : !pawn ? "no pawn" : KSL.GetPathName(pawn) !== w.pawn || t < w.clock ? "map load" : "";
                if (why == "map load")
                    state.slowPath = undefined; // drop the cached service with it
                if (!why) {
                    w.still = t === w.clock ? w.still + 1 : 0;
                    w.clock = t;
                    why = w.still >= 30 ? "pause" : !slowWanted(w.colour) ? "row off" : t >= w.hit ? "already hit" : slowBlocked(pawn);
                }
                const sub = !why && t >= w.startAt ? slowPath(pawn) : undefined; // undefined after slowOff: next tick says session off
                if (sub) {
                    if (state.slow)
                        endSlow(state.slow, "replaced");
                    if (state.slow)
                        return; // the last one is still ending: try again next tick
                    state.slowWait = undefined;
                    startSlow(pawn, sub, w.colour, w.hit - t, w.until, w.m, w.realMs);
                }
            }
            catch (e) { why = "error: " + e; }
            if (why)
                cancelWait(why);
        }
        function runTick(s) {
            const retry = !!s.ending;
            try {
                if (!s.ending && Date.now() > s.realUntil) {
                    s.capped = true; // the real cap, not the game-time deadline (a cue's frame then skips as "length used")
                    endSlow(s, "deadline");
                }
                if (!s.ending && seconds() >= s.until)
                    endSlow(s, "deadline");
            }
            catch (e) { }
            try {
                if (retry && state.slow === s)
                    endSlow(s, s.ending);
            }
            catch (e) { }
            if (state.slow !== s)
                return;
            let alive = false;
            try { alive = !!KSL.IsValid(s.sub); }
            catch (e) { }
            if (!alive) {
                // its service is gone, and our key with its map: the record goes and the current world is checked for
                // our key (a wrong verdict here is caught by that check)
                pbzLog(() => "slow stop " + (s.ending || "map load") + ": record dropped with its world");
                dropSlow(s);
                state.slowPath = undefined;
                state.leftoverDue = true; // check the current world
                return;
            }
            try {
                const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0), t = seconds();
                if (pawn && (KSL.GetPathName(pawn) !== s.pawn || t < s.clock)) {
                    // a new pawn or world while the service still lives: the record stays and is ended there
                    state.slowPath = undefined; // the cached service may be the old world's
                    if (!s.ending)
                        endSlow(s, "map load");
                    return;
                }
                s.still = t === s.clock ? s.still + 1 : 0;
                s.clock = t;
                if (s.ending)
                    return;
                const why = !pawn ? "no pawn" : s.still >= 30 ? "pause" : !slowWanted(s.colour) ? "row off" : slowBlocked(pawn);
                if (why)
                    endSlow(s, why); // waitTick runs next in this tick and checks the same rules for a waiting start
            }
            catch (e) {
                if (state.slow === s && !s.ending)
                    stopSlow("error: " + e); // a throw here may not repeat in waitTick: cancel a waiting start too
            }
        }
        // Auto Guard (1.8.0). A blockable attack's frame (Normal, blue or black, with time left before its hit) gets one guard
        // press at hit - 0.12 s and a guard hold from that press to 0.2 s past the hit, injected as the two actions the guard
        // button drives. One hold per attack string: a later frame inside the hold extends it, and presses again only when the
        // last press is 0.4 s old (the stock anti-mash cooldown) and the new press still lands before its hit. Nothing happens
        // while the player holds a guard key, and the hold is let go at once by the slow rows' stop rules (pause, death,
        // cutscene, QTE, the slow-motion dodge), a guard key press, AutoGuard going Off, a new pawn or world, a still clock
        // (pause), or a second load of this module. Every injection is recorded before the call; a release that throws keeps
        // the record and is tried again every 16 ms, and no new hold starts meanwhile.
        const inputValue = () => UE.EnhancedInputLibrary.MakeInputActionValueOfType(1, 0, 0, UE.EInputActionValueType.Boolean);
        // the input subsystem, the two guard actions and their keys; undefined when not ready (loading)
        function autoInput(pawn) {
            const In = ueType("EnhancedInputLocalPlayerSubsystem");
            const input = In ? UE.SubsystemBlueprintLibrary.GetLocalPlayerSubsystem(UE.PBZBlueprintFunctionLibrary.GetLocalPlayer(pawn), In.StaticClass()) : undefined;
            const press = state.pressInput = state.pressInput || UE.Object.Load(PBZ_PD_PRESS_INPUT);
            const hold = state.holdInput = state.holdInput || UE.Object.Load(PBZ_PD_HOLD_INPUT);
            return input && press && hold ? { input, press, hold } : undefined;
        }
        // whether the player holds a key bound to either guard action (IsInputKeyDown reads false in menus)
        function guardKeyHeld(k) {
            const pc = UE.GameplayStatics.GetPlayerController(gameInstance, 0);
            if (!pc)
                return false;
            for (const ia of [k.hold, k.press]) {
                const keys = k.input.QueryKeysMappedToAction(ia);
                for (let i = 0, n = keys ? keys.Num() : 0; i < n; i++)
                    if (pc.IsInputKeyDown(keys.Get(i)))
                        return true;
            }
            return false;
        }
        function watchAuto() {
            if (!state.autoTimer)
                state.autoTimer = setInterval(autoTick, PBZ_PD_FRAME_POLL_MS);
        }
        // the last real press, in game time, across holds; the main poll's listener check forgets it on a new pawn or world
        // (the clock goes back), before that pawn's frames can arrive
        const lastPress = () => state.autoLast ?? -Infinity;
        // whether a planned press's frame has landed (or can no longer be read) since it was planned
        function frameLanded(f) {
            try { return !!f.IsHit; } catch (e) { return true; }
        }
        function autoFrame(data) {
            if (!settings.autoGuard)
                return; // Off: nothing read
            try {
                const f = data.OptionalObject.ReceiveFrame, a = f.SourceAction;
                const type = a ? (typeof a.DeflectBulletType == "number" ? a.DeflectBulletType : a.DeflectType) : undefined;
                const now = seconds(), hit = f.HitGameTime, lead = hit - now, g = state.auto;
                const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
                // the stop rules and a held key are autoTick's: it runs below and lets a new or running hold go before any press
                let why = !PBZ_PD_AUTO_TYPES.includes(type) ? "type " + type : f.IsHit ? "already hit" : !(lead > PBZ_PD_AUTO_MIN_LEAD_S) ? "late" : !pawn ? "no pawn"
                    : g && g.stopping !== undefined ? "release pending" : "";
                const k = why ? undefined : autoInput(pawn);
                why = why || (!k ? "no input" : "");
                // the press for this hit: 0.12 s before it, and never inside the anti-mash cooldown of the last press made or planned
                const planned = Math.max(lastPress(now), ...(g ? g.due.map((d) => d.at) : []));
                const at = Math.max(now, hit - PBZ_PD_AUTO_PRESS_S, planned + PBZ_PD_AUTO_REPRESS_S);
                why = why || (!g && at >= hit ? "cooldown" : "");
                if (why)
                    return pbzLog(() => "auto guard skip " + why + " lead=" + lead.toFixed(3));
                if (g) { // one hold per string: extend it, and press again only past the cooldown and before this hit
                    g.until = Math.max(g.until, hit + PBZ_PD_AUTO_AFTER_S);
                    if (at < hit)
                        g.due.push({ at, hit, f });
                    pbzLog(() => "auto guard extend type=" + type + " lead=" + lead.toFixed(3) + (at < hit ? ", press again in " + (at - now).toFixed(3) : ", no new press"));
                }
                else {
                    state.auto = { pawn: KSL.GetPathName(pawn), clock: now, still: 0, k, due: [{ at, hit, f }], pressed: -Infinity, holding: false, until: hit + PBZ_PD_AUTO_AFTER_S, stopping: undefined };
                    watchAuto();
                    pbzLog(() => "auto guard on type=" + type + " lead=" + lead.toFixed(3) + ", press in " + (at - now).toFixed(3));
                }
                autoTick(); // a press due now goes at once
            }
            catch (e) {
                pbzLog(() => "auto guard threw: " + e);
                autoRelease("error");
            }
        }
        // the press (one frame of IA_Deflect), and the hold (IA_Stance) if it is not on yet; the hold is recorded before the call
        function autoPress(g, t) {
            if (!g.holding) {
                g.holding = true;
                g.k.input.StartContinuousInputInjectionForAction(g.k.hold, inputValue(), UE.NewArray(UE.InputModifier), UE.NewArray(UE.InputTrigger));
            }
            g.pressed = state.autoLast = t; // before the call: a press that throws still counts for the cooldown
            g.k.input.InjectInputForAction(g.k.press, inputValue(), UE.NewArray(UE.InputModifier), UE.NewArray(UE.InputTrigger));
            pbzLog(() => "auto guard press, hold until " + (g.until - t).toFixed(3) + " s from now");
        }
        // lets the hold go; the record stays until the stop call returns, so a stop that throws is tried again every tick
        function autoRelease(why) {
            const g = state.auto;
            if (!g)
                return;
            if (g.stopping === undefined)
                g.stopping = why;
            if (g.holding) {
                try { g.k.input.StopContinuousInputInjectionForAction(g.k.hold); }
                catch (e) {
                    if (!g.stopThrew)
                        pbzLog(() => "auto guard release threw, trying again every tick: " + e);
                    g.stopThrew = true;
                    return;
                }
                g.holding = false;
            }
            state.auto = undefined;
            if (state.autoTimer) {
                clearInterval(state.autoTimer);
                state.autoTimer = undefined;
            }
            pbzLog(() => "auto guard off" + (g.stopping ? " (" + g.stopping + ")" : "") + (g.pressed > -Infinity ? "" : ", never pressed"));
        }
        function autoTick() {
            const g = state.auto;
            if (!g) {
                if (state.autoTimer)
                    clearInterval(state.autoTimer);
                return void (state.autoTimer = undefined);
            }
            if (g.stopping !== undefined)
                return autoRelease(g.stopping);
            let why = "";
            try {
                const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0), t = seconds();
                why = !settings.autoGuard ? "off" : !pawn ? "no pawn" : KSL.GetPathName(pawn) !== g.pawn || t < g.clock ? "map load" : "";
                if (!why) {
                    g.still = t === g.clock ? g.still + 1 : 0;
                    g.clock = t;
                    why = g.still >= 30 ? "pause" : slowBlocked(pawn) || (guardKeyHeld(g.k) ? "key held" : "");
                }
                if (!why) {
                    // checked when it is sent, not only when planned: a late tick never presses for a hit that has passed or a
                    // frame that has landed since, or inside the cooldown of the press before it
                    while (g.due.length && (t >= g.due[0].hit || frameLanded(g.due[0].f))) {
                        const why = t >= g.due.shift().hit ? "its hit passed" : "its frame landed";
                        pbzLog(() => "auto guard press dropped, " + why);
                    }
                    if (g.due.length && t >= g.due[0].at && t - lastPress(t) >= PBZ_PD_AUTO_REPRESS_S) {
                        g.due.shift();
                        autoPress(g, t);
                    }
                    if (t >= g.until) // every due press is for a hit before until, so dropped by then
                        why = g.pressed > -Infinity ? "" : "passed";
                    else
                        return; // the hold runs on
                }
            }
            catch (e) { why = "error: " + e; }
            autoRelease(why);
        }
        // Fist Guard (1.8.0). FistGuard=Deflect, with Perfect Deflect on a multiplier or Always: on each of the ability's two
        // timelines the perfect action ends at stock length x the multiplier (Always: at the block's end), never past the block's
        // end, and the block action starts where the perfect one now ends, less the overlap found, keeping its own end or at
        // least 0.05 s. Written on the class's own timeline objects and, when the gauntlets are granted, on the timelines the
        // player's ability instance returns (the same objects or copies; each object once). The record is per timeline and per
        // field: base is the value we found, wrote our own read-back after each single write, pend the value of a write not yet
        // read back (so a Set that lands and a read that throws still leaves the field ours). A field that no longer reads as
        // ours (another mod, a reload) takes its new value as its base; the others keep theirs. A new timeline whose values read
        // as another record's writes, as they were at the start of the tick (a copy made from the edited class), takes that
        // record's base; with records left, Game and Off still look for such copies before putting the records back. Everything
        // is put back on Game, on Perfect Deflect Off, after a write that does not read back or ten throws with no clean tick
        // between (then off for the session), and when a timeline we wrote changes shape (then left alone once a read-back shows
        // our fields back). Nothing reaches the save: timelines are class data in memory.
        // [offline: the write path and read-back; whether a running guard plays the written timing is unproven]
        function fistObjects(pawn, fist) {
            const out = new Map();
            for (const name of PBZ_PD_FIST_TIMELINES) {
                const tl = UE.Object.Find(PBZ_PD_FIST_GA + ":" + name); // Find, not Load: only once the gauntlets' ability is loaded
                if (tl)
                    out.set(KSL.GetPathName(tl), { tl, name });
            }
            try {
                const cls = out.size ? UE.Object.Find(PBZ_PD_FIST_GA) : undefined;
                const asc = cls && pawn ? UE.AbilitySystemBlueprintLibrary.GetAbilitySystemComponent(pawn) : undefined;
                const handle = asc ? UE.AbilityUtils.FindAbilityByClass(asc, cls) : undefined, inst = puerts.$ref(false);
                const ab = handle ? UE.AbilitySystemBlueprintLibrary.GetGameplayAbilityFromSpecHandle(asc, handle, inst) : undefined;
                if (ab && puerts.$unref(inst))
                    for (const name of PBZ_PD_FIST_TIMELINES) {
                        const tl = ab.GetTimelineByName(name);
                        if (tl && !out.has(KSL.GetPathName(tl)))
                            out.set(KSL.GetPathName(tl), { tl, name });
                    }
            }
            catch (e) {
                if (!state.fistInstSaid) {
                    state.fistInstSaid = true;
                    pbzLog(() => "fist guard: no ability instance read (" + e + "), class timelines only");
                }
                fistThrew(fist, e); // counts toward the shutdown like every other throw
                out.partial = true; // the instance's timelines were not looked at
            }
            return out;
        }
        // the deflect actions of one timeline (each with its object path), and the perfect and block ones, or why not
        function fistActions(tl) {
            const acts = tl.Actions, found = [];
            for (let i = 0, n = acts.Num(); i < n; i++) {
                const e = acts.Get(i);
                if (e.Action && e.Action.GetClass().GetName() === PBZ_PD_FIST_FRAME)
                    found.push({ i, start: e.StartTime, dur: e.duration, path: KSL.GetPathName(e.Action) });
            }
            if (found.length != 2)
                return { acts, found, why: found.length + " deflect actions" };
            const [p, b] = found[0].start <= found[1].start ? found : [found[1], found[0]];
            return p.start < 0.01 && b.start > p.start && p.dur > 0 && b.dur > 0 ? { acts, found, p, b } : { acts, found, why: "unexpected deflect timing" };
        }
        // the three values wanted from a base: perfect length, block start and length
        function fistWant(base, m) {
            if (m === 1)
                return base;
            const bEnd = base.bs + base.bd, overlap = Math.max(0, base.ps + base.pd - base.bs);
            const pEnd = m === PBZ_PD_ALWAYS ? bEnd : Math.min(bEnd, base.ps + base.pd * m);
            const bs = pEnd - overlap, end = Math.max(bEnd, bs + PBZ_PD_FIST_TAIL_S);
            return { ps: base.ps, pd: pEnd - base.ps, bs, bd: end - bs };
        }
        const FIST_FIELDS = [["pd", "p", "duration"], ["bs", "b", "StartTime"], ["bd", "b", "duration"]];
        // writes one field: ours from before the Set (pend) until its read-back replaces it, so a later write that throws, or
        // a read-back that throws after the Set landed, leaves this one known as ours
        function fistSet(r, acts, i, f, field, v) {
            r.pend[f] = v;
            const e = acts.Get(i); // a copy of the struct: changed, then written back with Set
            e[field] = v;
            acts.Set(i, e);
            const back = (r.wrote[f] = acts.Get(i)[field]);
            r.pend[f] = undefined;
            return back;
        }
        const fistOurs = (r, f, v) => [r.wrote[f], r.pend[f]].some((w) => w !== undefined && close(v, w));
        function fistThrew(fist, e) {
            fist.throws = (fist.throws || 0) + 1;
            if (fist.throws == 1 || fist.throws == 10)
                pbzLog(() => "fist guard threw (" + fist.throws + "): " + e);
            if (fist.throws >= 10 && !fist.dead)
                fist.dead = "keeps throwing"; // a patch moved something: put back what we can, then leave it
        }
        // a timeline we wrote changed shape: the fields still ours go back to their base, found by action object; false when
        // one did not read back as its base (the record stays and this runs again next tick)
        function fistAbandon(r, a) {
            let back = true;
            for (const [f, which, field] of FIST_FIELDS) {
                const x = a.found.find((d) => d.path === r[which]);
                const v = x ? (field == "StartTime" ? x.start : x.dur) : undefined;
                if (x && fistOurs(r, f, v) && !close(fistSet(r, a.acts, x.i, f, field, r.base[f]), r.base[f]))
                    back = false;
            }
            return back;
        }
        function keepFistGuard() {
            const fist = state.fist = state.fist || { rec: {} };
            const throws = fist.throws || 0;
            // given up this session (fist.dead): every record goes back to its base, and nothing new is written
            const m = settings.fistGuard == "deflect" && !fist.dead ? settings.deflect : 1;
            // the records as they stand before this tick writes anything, plus those kept from ticks whose look-up did not
            // finish: a copy is matched against these, so one made from a timeline put back earlier is still known until a
            // look-up has finished without a throw
            const seen = new Set();
            const snap = Object.values(fist.rec).map((o) => ({ name: o.name, wrote: Object.assign({}, o.wrote), pend: Object.assign({}, o.pend), base: Object.assign({}, o.base) }))
                .concat(fist.oldSnap || []).filter((o) => !seen.has(JSON.stringify(o)) && seen.add(JSON.stringify(o)));
            // Game with nothing recorded or kept: nothing is looked up. Otherwise copies made from them are found first
            let objs = new Map(), whole = false;
            if (m !== 1 || snap.length)
                try {
                    objs = fistObjects(UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0), fist);
                    whole = !objs.partial;
                }
                catch (e) { fistThrew(fist, e); } // the records below are still put back or kept
            fist.oldSnap = whole || !snap.length ? undefined : snap;
            for (const [key, r] of Object.entries(fist.rec)) // records whose timeline is not in this tick's list are put back from their own object
                if (!objs.has(key))
                    objs.set(key, { tl: r.tl, name: r.name });
            for (const [key, { tl, name }] of objs) {
                let r = fist.rec[key];
                try {
                    if (!KSL.IsValid(tl)) {
                        delete fist.rec[key]; // gone with its class: our values went with it
                        continue;
                    }
                    const a = fistActions(tl);
                    if (a.why) {
                        if (r && !fistAbandon(r, a)) {
                            if (!r.stuckSaid) {
                                r.stuckSaid = true;
                                pbzLog(() => "fist guard " + name + ": " + a.why + ", our values did not read back as put back, trying again");
                            }
                            continue; // kept until a read-back shows them back
                        }
                        delete fist.rec[key];
                        if (!(fist.badSaid = fist.badSaid || {})[key]) {
                            fist.badSaid[key] = true;
                            pbzLog(() => "fist guard " + name + ": " + a.why + ", left alone" + (r ? ", our values put back" : ""));
                        }
                        continue;
                    }
                    const now = { ps: a.p.start, pd: a.p.dur, bs: a.b.start, bd: a.b.dur };
                    if (!r) {
                        // a copy made from a timeline we wrote reads as that one's writes: it takes that one's base
                        const twin = snap.find((o) => o.name === name && FIST_FIELDS.every(([f]) => fistOurs(o, f, now[f])));
                        r = fist.rec[key] = { tl, name, p: a.p.path, b: a.b.path, base: twin ? Object.assign({}, twin.base, { ps: now.ps }) : Object.assign({}, now),
                            wrote: twin ? Object.assign({}, twin.wrote) : {}, pend: twin ? Object.assign({}, twin.pend) : {} };
                    }
                    r.base.ps = now.ps;
                    for (const [f] of FIST_FIELDS)
                        if (!fistOurs(r, f, now[f])) { // stock, another mod's value, or a reload: this field's new base
                            r.base[f] = now[f];
                            r.wrote[f] = r.pend[f] = undefined;
                        }
                    const want = fistWant(r.base, m);
                    const todo = FIST_FIELDS.filter(([f]) => !close(now[f], want[f]));
                    if (todo.length) {
                        for (const [f, which, field] of todo)
                            fistSet(r, a.acts, a[which].i, f, field, want[f]);
                        const back = Object.fromEntries(FIST_FIELDS.map(([f]) => [f, r.wrote[f] !== undefined ? r.wrote[f] : now[f]]));
                        pbzLog(() => "fist guard " + name + " perfect " + now.pd.toFixed(4) + " -> " + back.pd.toFixed(4) + ", block " + now.bs.toFixed(4) + "-" + (now.bs + now.bd).toFixed(4)
                            + " -> " + back.bs.toFixed(4) + "-" + (back.bs + back.bd).toFixed(4) + " (" + (m === 1 ? "game" : show(m)) + ")");
                        if (!todo.every(([f]) => close(back[f], want[f]))) {
                            if (!fist.dead) {
                                fist.dead = "write did not read back on " + name;
                                pbzLog(() => "fist guard off for this session: " + fist.dead);
                            }
                            continue; // the next tick puts every record back (fist.dead)
                        }
                    }
                    if (m === 1)
                        delete fist.rec[key]; // back to its base: nothing of ours left here
                }
                catch (e) { fistThrew(fist, e); }
            }
            if ((fist.throws || 0) === throws)
                fist.throws = 0; // a clean tick: the ten throws count only a run of failing ticks
        }
        // Debug build only: SlowProbe=On in the settings file runs two x0.5 slowdowns out of combat and logs game time, real
        // time, rate and dilation every 250 ms before, during and after. A: ended by our deadline after 60 frames' worth of
        // game time (1 s at 60 a second, 2 real s at x0.5). B: ended by a stop call after 0.5 real s. Each says whether our
        // key is still in the map after its end.
        const dilation = () => { try { return Number(UE.GameplayStatics.GetGlobalTimeDilation(gameInstance)).toFixed(3); } catch (e) { return "?"; } };
        const keyNow = (sub) => { try { return String(ourKey(sub)); } catch (e) { return "unreadable"; } };
        function probeStart() {
            const pawn = UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0);
            const sub = pawn && !state.slow ? slowPath(pawn) : undefined;
            if (!sub)
                return pbzLog(() => "slow probe run: not run (" + (!pawn ? "no pawn" : state.slow ? "a slowdown is running" : "path=none, " + state.slowDead) + ")");
            state.probe = { pawn, sub, step: "before", r0: Date.now(), t0: seconds(), last: { r: 0, t: 0 }, slowed: false };
            if (!state.probeTimer)
                state.probeTimer = setInterval(probeTick, PBZ_PD_FRAME_POLL_MS);
        }
        function probeEnd(line) {
            pbzLog(() => "slow probe run " + line);
            state.probe = undefined;
            if (state.probeTimer)
                clearInterval(state.probeTimer);
            state.probeTimer = undefined;
        }
        // starts A or B; false when it could not
        function probeSlow(p) {
            pbzLog(() => "slow probe run " + p.step + " before: game " + seconds().toFixed(3) + " s, dilation " + dilation());
            startSlow(p.pawn, p.sub, "probe", 0, seconds() + PBZ_PD_PROBE_GAME_S, 0.5, PBZ_PD_PROBE_REAL_MS);
            p.rec = state.slow && !state.slow.ending && state.slow.colour == "probe" ? state.slow : undefined;
            if (!p.rec)
                probeEnd(p.step + " not run: " + (state.slowDead ? "path=none, " + state.slowDead : "another slowdown is running"));
            return state.probe === p;
        }
        function probeTick() {
            const p = state.probe;
            if (!p)
                return probeEnd("ended");
            try {
                const r = Date.now() - p.r0, t = seconds() - p.t0;
                if (r - p.last.r < 250)
                    return;
                const rate = (t - p.last.t) / ((r - p.last.r) / 1000);
                p.last = { r, t };
                if (p.step == "A")
                    p.slowed = p.slowed || rate < 0.75;
                pbzLog(() => "slow probe run " + p.step + ": real +" + r + " ms, game +" + t.toFixed(3) + " s, rate " + rate.toFixed(2) + ", dilation " + dilation() + (state.slow ? "" : ", none of ours"));
                if (p.step == "before" && r >= 500) {
                    p.step = "A";
                    p.a = { r, t };
                    probeSlow(p);
                }
                else if (p.step == "A" && state.slow && state.slow !== p.rec)
                    probeEnd("A over, then another slowdown started; B not run");
                else if (p.step == "A" && !state.slow) {
                    pbzLog(() => "slow probe run A over (slow stop " + state.slowLast + ") after game " + (t - p.a.t).toFixed(3) + " s, real " + ((r - p.a.r) / 1000).toFixed(3)
                        + " s: " + (p.slowed ? "slowed" : "no slowdown seen") + ", key in map " + keyNow(p.sub));
                    p.step = "after";
                    p.next = r + 1000;
                }
                else if (p.step == "after" && r >= p.next) {
                    p.step = "B";
                    p.stopAt = r + 500;
                    probeSlow(p);
                }
                else if (p.step == "B" && r >= p.stopAt && !p.stopped) {
                    p.stopped = r;
                    if (state.slow === p.rec)
                        endSlow(p.rec, "probe B stop call");
                }
                else if (p.step == "B" && state.slow && state.slow !== p.rec)
                    probeEnd("B over, then another slowdown started; done");
                else if (p.step == "B" && p.stopped && !state.slow && r >= p.stopped + 500)
                    probeEnd("B after the stop call: rate " + rate.toFixed(2) + (rate > 0.95 ? ", back to full speed" : ", still slow") + ", key in map " + keyNow(p.sub) + "; done");
            }
            catch (e) {
                stopSlow("probe error");
                probeEnd("threw: " + e);
            }
        }
        // Never stops: a load screen or a pawn being torn down can throw for a while, and the next pawn still needs the mod.
        // 1.1 (Phantom Tuner's rows): the timed-parry windows (LGAAction_CheckParry: PrePerfectWindow, PerfectWindow,
        // PostPerfectWindow, FailWindow) and the deflect lead (PreHitPointDuration of LGAAction_DurationBulletWithDeflectBase
        // and its children) are values of the action objects in the enemies' attack timelines. Lua's FindAllOf has no
        // counterpart in this script engine, so while a row is on, every PBZ_PD_ACTION_SCAN_MS the enemies (PBZCharacter_NPC)
        // are looked at: an enemy's ability system that is new, or has another number of abilities, gives the Timelines of
        // each ability (the spec's ability and its instances), and its running timeline tasks (KnownTasks) theirs; a
        // timeline is walked once while it is the same object. Each field is scaled from the value found (the game's, or
        // another mod's), never from our own last write, as the deflect window is; Off writes that value back, and then
        // the object is forgotten. An action met before its first use gets the value in time; one met later from then on.
        // [unproven in game: that the game reads these fields at each use]
        const PBZ_PD_PARRY_FIELDS = [["PrePerfectWindow", "parryNear"], ["PerfectWindow", "parryPerfect"],
            ["PostPerfectWindow", "parryNear"], ["FailWindow", "parryFail"]];
        const PBZ_PD_LEAD_FIELDS = [["PreHitPointDuration", "lead"]];
        const sameObject = (a, b) => !!a && !!b && UE.KismetMathLibrary.EqualEqual_ObjectObject(a, b);
        function actionFields(action) {
            if (typeof action.PerfectWindow == "number" && typeof action.FailWindow == "number")
                return PBZ_PD_PARRY_FIELDS;
            if (typeof action.PreHitPointDuration == "number")
                return PBZ_PD_LEAD_FIELDS;
            return undefined;
        }
        function walkTimeline(timeline) {
            const where = KSL.GetPathName(timeline);
            if (sameObject(state.actionTimelines.get(where), timeline))
                return;
            state.actionTimelines.set(where, timeline);
            const events = timeline.Actions;
            for (let i = 0; events && i < events.Num(); i++) {
                const action = events.Get(i).Action;
                const fields = action ? actionFields(action) : undefined;
                if (!fields)
                    continue;
                const key = KSL.GetPathName(action), known = state.actions.get(key);
                if (!known || !sameObject(known.obj, action))
                    state.actions.set(key, { obj: action, fields, base: {}, wrote: {} });
            }
        }
        function findActions() {
            const ref = puerts.$ref(UE.NewArray(UE.Actor));
            UE.GameplayStatics.GetAllActorsOfClass(gameInstance, UE.PBZCharacter_NPC.StaticClass(), ref);
            const npcs = puerts.$unref(ref);
            for (let i = 0; npcs && i < npcs.Num() && i < PBZ_PD_ACTION_MAX_NPCS; i++) {
                const npc = npcs.Get(i);
                const asc = npc ? UE.AbilitySystemBlueprintLibrary.GetAbilitySystemComponent(npc) : undefined;
                if (!asc)
                    continue;
                const tasks = asc.KnownTasks; // running timelines, also one an ability does not list
                for (let t = 0; tasks && t < tasks.Num(); t++) {
                    const timeline = tasks.Get(t) ? tasks.Get(t).Timeline : undefined;
                    if (timeline)
                        walkTimeline(timeline);
                }
                const specs = asc.ActivatableAbilities.Items, where = KSL.GetPathName(asc), seen = state.actionNpcs.get(where);
                const count = specs ? specs.Num() : 0;
                if (seen && sameObject(seen.asc, asc) && seen.count === count)
                    continue;
                state.actionNpcs.set(where, { asc, count });
                for (let j = 0; j < count; j++) {
                    const spec = specs.Get(j);
                    const abilities = [spec.Ability];
                    for (const list of [spec.NonReplicatedInstances, spec.ReplicatedInstances])
                        for (let k = 0; list && k < list.Num(); k++)
                            abilities.push(list.Get(k));
                    for (const ability of abilities) {
                        const timelines = ability ? ability.Timelines : undefined;
                        for (let t = 0; timelines && t < timelines.Num(); t++) {
                            const timeline = timelines.Get(t);
                            if (timeline)
                                walkTimeline(timeline);
                        }
                    }
                }
            }
        }
        function keepActions() {
            const on = ["parryPerfect", "parryNear", "parryFail", "lead"].some((k) => settings[k] !== 1);
            const actions = state.actions = state.actions || new Map();
            state.actionNpcs = state.actionNpcs || new Map();
            state.actionTimelines = state.actionTimelines || new Map();
            if (!on && !actions.size)
                return; // nothing set and nothing of ours left: no reads
            if (on && Math.abs(Date.now() - (state.actionScanAt ?? -Infinity)) >= PBZ_PD_ACTION_SCAN_MS) {
                state.actionScanAt = Date.now();
                findActions();
            }
            for (const [key, a] of actions) {
                if (!KSL.IsValid(a.obj)) {
                    actions.delete(key); // unloaded; a new object of it comes with its timeline's next walk
                    continue;
                }
                let ours = false;
                for (const [field, row] of a.fields) {
                    const was = a.obj[field];
                    if (typeof was != "number")
                        continue;
                    if (!close(was, a.wrote[field]) || a.base[field] === undefined)
                        a.base[field] = was;
                    const want = a.base[field] * settings[row];
                    if (!close(was, want)) {
                        a.obj[field] = want;
                        pbzLog(() => key + " " + field + " " + was + " -> " + a.obj[field] + " (base " + a.base[field] + ")");
                    }
                    a.wrote[field] = a.obj[field];
                    ours = ours || !close(a.wrote[field], a.base[field]);
                }
                if (!on && !ours)
                    actions.delete(key); // back to the value found: forgotten
            }
            if (!on && !actions.size) { // all back: the next row that is switched on looks at every enemy afresh
                state.actionNpcs.clear();
                state.actionTimelines.clear();
                state.actionScanAt = undefined;
            }
        }
        function tick() {
            readSettings(); // catches its own errors
            try {
                if (!UE.KismetSystemLibrary.IsValid(gameInstance))
                    return;
                if (settings.deflect === PBZ_PD_ALWAYS)
                    keepAlwaysPerfect();
                else
                    dropAlwaysPerfect();
                // 1.1: the exact counts too; Always keeps the frames the game's
                if (settings.deflect === PBZ_PD_ALWAYS)
                    scaleDeflect(1);
                else
                    scaleDeflect(settings.deflect, { [PBZ_PD_FIELDS[0]]: settings.frames, [PBZ_PD_FIELDS[1]]: settings.framesBreak });
                keepRepeatGuard();
                if (settings.noBuildUp && state.watch && !state.guardTimer)
                    watchBuildUp(); // a watch paused in a menu goes on (or ends) once game time moves
                keepGuardDamage(); // last, so a throw here never stops the rest
                errors = 0;
            }
            catch (e) {
                if (errors++ == 0)
                    pbzLog(() => "tick threw: " + e);
            }
            scaleDodge(); // catches its own errors
            try {
                keepFistGuard(); // Game with nothing of ours left: returns before any read
            }
            catch (e) {
                pbzLog(() => "fist guard threw: " + e);
            }
            try {
                keepActions(); // 1.1: nothing set and nothing of ours left: returns before any read
            }
            catch (e) {
                pbzLog(() => "parry and lead rows threw: " + e);
            }
            try {
                listenForDodgeFrames();
            }
            catch (e) {
                pbzLog(() => "slow-mo dodge listener threw: " + e);
            }
            try {
                listenForWarnings();
            }
            catch (e) {
                pbzLog(() => "warn listener threw: " + e);
            }
            try {
                const pawn = state.leftoverDue && !state.slow ? UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0) : undefined;
                if (pawn)
                    endLeftover(pawn);
            }
            catch (e) {
                pbzLog(() => "slow leftover threw: " + e);
            }
            try {
                // the probe runs once each time SlowProbe= changes to a new value, with a pawn in the world
                if (debugBuild && settings.probe !== state.probeAsked && UE.GameplayStatics.GetPlayerCharacter(gameInstance, 0)) {
                    state.probeAsked = settings.probe;
                    if (settings.probe)
                        probeStart();
                }
            }
            catch (e) {
                stopSlow("probe error");
                probeEnd("threw: " + e);
            }
        }
        // a second load of this module replaces the first copy's timer and listener instead of running beside them
        if (state.timer)
            clearInterval(state.timer);
        if (state.frameTimer)
            clearInterval(state.frameTimer);
        if (state.frameListen)
            try { state.frameListen.EndAction(); } catch (e) { }
        if (state.guardTimer)
            clearInterval(state.guardTimer);
        endGuardListens();
        endWarnListens(false);
        // the first copy's slowdown ends here, and one still ending is tried again by this copy's slowTick. The built-in entry
        // refuses a second load before this line runs, so there the first copy keeps running its own timers and stops
        // (its deadline: 1.5 real s at most, 2 s for the debug probe).
        stopSlow("mod reload");
        if (state.slowTimer)
            clearInterval(state.slowTimer);
        state.slowTimer = state.slow ? setInterval(slowTick, PBZ_PD_FRAME_POLL_MS) : undefined;
        if (state.probeTimer)
            clearInterval(state.probeTimer);
        state.probe = state.probeTimer = undefined;
        // the first copy's guard hold is let go here; one whose release threw is tried again by this copy's autoTick
        if (state.autoTimer)
            clearInterval(state.autoTimer);
        state.autoTimer = undefined;
        autoRelease("mod reload");
        state.autoTimer = state.auto ? setInterval(autoTick, PBZ_PD_FRAME_POLL_MS) : undefined;
        state.frameTimer = state.frameListen = state.framePawn = state.guardTimer = state.watch = undefined; // the next tick binds this copy's listeners
        state.frameTried = [];
        state.timer = timer = setInterval(tick, PBZ_PD_POLL_MS);
        if (debugBuild) // the debug entry's bench probes use the mod's own checks and clock
            state.debugApi = { gameInstance, tag, seconds, slowBlocked, settings };
        readSettings();
        pbzLog(() => "started: deflect " + show(settings.deflect) + ", dodge " + show(settings.dodge));
        // 1.0 (port): PBZModLoader's stop(): the settings go to the game's own (Off, Game) and each keep function writes
        // the values it found back, as for a change in the file; then the second-load teardown above runs without a new
        // timer. Each part in its own try, so one that throws (logged) never stops the others.
        pbzPerfectDefenseStop = function () {
            const part = (what, work) => {
                try {
                    work();
                }
                catch (e) {
                    console.warn(`[Easier Parry and Dodge] stop, ${what}: ${e}`);
                }
            };
            if (state.timer)
                clearInterval(state.timer);
            state.timer = timer = undefined;
            Object.assign(settings, { deflect: 1, dodge: 1, repeat: "Game", noBuildUp: false, noElement: false,
                slow: { blue: false, red: false, black: false }, autoGuard: false, fistGuard: "game",
                frames: undefined, framesBreak: undefined, lead: 1, parryPerfect: 1, parryNear: 1, parryFail: 1 });
            readAt = Infinity; // a late onChange cannot bring the file's values back
            part("always perfect", dropAlwaysPerfect);
            part("deflect window", () => scaleDeflect(1));
            part("repeat guard", keepRepeatGuard);
            part("guard damage", keepGuardDamage);
            part("dodge window", scaleDodge);
            part("fist guard", keepFistGuard);
            part("parry windows and deflect lead", keepActions); // 1.1
            part("timers and listeners", () => {
                if (state.frameTimer)
                    clearInterval(state.frameTimer);
                if (state.frameListen)
                    try { state.frameListen.EndAction(); } catch (e) { }
                if (state.guardTimer)
                    clearInterval(state.guardTimer);
                endGuardListens();
                endWarnListens(false);
            });
            // the slowdown and the auto guard hold end their own timers once they are really over; one whose end threw
            // keeps its timer, so slowTick or autoTick tries again (with every row off, they only let go), and a copy that
            // starts later takes that over as at a second load
            part("slowdown", () => {
                stopSlow("mod stop");
                if (state.probeTimer)
                    clearInterval(state.probeTimer);
            });
            part("auto guard", () => autoRelease("mod stop"));
            state.frameTimer = state.frameListen = state.framePawn = state.guardTimer = state.watch = undefined;
            state.probe = state.probeTimer = undefined;
            state.frameTried = [];
            console.log("[PBZMOD] [Easier Parry and Dodge] stopped");
        };
        console.log(`[PBZMOD] [Easier Parry and Dodge] ${PBZ_PD_VERSION} started; settings: ${path}`
            + (pbzPerfectDefenseMenu.on ? " (Mods Menu's page)" : ""));
        __pbzStandaloneReady = true;
    }
    catch (e) {
        pbzLog(() => "not started: " + e);
        console.warn(`[Easier Parry and Dodge] not started: ${e}`);
        throw e;
    }
})();
// Easier Parry and Dodge: end

if (!__pbzStandaloneReady) throw new Error("Easier Parry and Dodge: not started (no GameInstance)");
// 1.0 (port): PBZModLoader awaits this before a reload (Alt+F5).
exports.stop = function () {
    if (pbzPerfectDefenseStop)
        pbzPerfectDefenseStop();
};
