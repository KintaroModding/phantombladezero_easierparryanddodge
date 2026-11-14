// Offline test of the mod, run by build.ps1: node tests/test_mod.js
// It loads src/phantombladezero_easierparryanddodge/main.js as PBZModLoader does (a module whose __dirname is the mod's
// folder) with stand-ins for the modules the game gives it (ue, puerts, the game's TsHelper) and a small game: two loaded
// difficulty configs with their deflect window frames and anti-mash cooldown, the perfect-dodge effect's class default,
// the player with its ability system, an optional running Mods Menu and the settings file. It drives the mod's poll and
// the clock by hand, and checks the window changes, stop() and a second copy after it (PBZModLoader's reload).
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");

const FOLDER = path.join(__dirname, "..", "src", "phantombladezero_easierparryanddodge");
const SCRIPT = path.join(FOLDER, "main.js");
const SETTINGS = path.join(FOLDER, "phantombladezero_easierparryanddodge.txt");
const SETTINGS_PATH = FOLDER.replace(/[\\/]+$/, "") + "/phantombladezero_easierparryanddodge.txt";
const MENU_PATH = "C:/Game/ProjectPBZ/Saved/PBZModsMenu/Settings/phantombladezero_easierparryanddodge.txt";
const FRAMES = "Deflect Perfect Window Frames", ON_BREAK = "Deflect Perfect Window Frames On Break";
const COOLDOWN = "Deflect Quickclick Punish Cooldown";
const CONFIG = (name) => `/PBZCombatAsset/Config/GlobalConfig_Combat_${name}.GlobalConfig_Combat_${name}`;
const DASH_GE = "/PBZDeflectSystem/GameplayEffects/GE_PerfectDash.GE_PerfectDash_C";
const DEFLECT_GE = "/Game/PBZContent/UI/Help/GE_PerfectDeflect.GE_PerfectDeflect_C";
const ALWAYS_TAG = "CharacterState.EditorDebug.Deflect.AlwaysPerfect";
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mod.json"), "utf8")).version;

let failed = 0;
function check(name, ok) {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) {
        failed++;
    }
}

function modsMenu(world, missing = []) {
    return {
        api: { has: (feature) => !missing.includes(feature) },
        push(...mods) { world.pushed.push(...mods); return world.pushed.length; },
        settingsPath: (id) => (world.pushed.some((m) => m.id == id) ? MENU_PATH : undefined),
    };
}

// The game: kept across boots only when `game` is passed (a reload in the same game).
function newGame() {
    // the game's slow-motion service: ApplySlomo(id, speed) keeps an entry, 1.0 takes it away
    const slow = new Map();
    const slomo = {
        ApplySlomo(id, speed) { if (speed == 1) slow.delete(String(id)); else slow.set(String(id), speed); },
        RuntimeSlomoData: { SlomoData: { GetMaxIndex: () => slow.size, IsValidIndex: (i) => i < slow.size,
            GetKey: (i) => [...slow.keys()][i] } },
    };
    return {
        slow, slomo,
        configs: {
            [CONFIG("Normal")]: { [FRAMES]: 8, [ON_BREAK]: 12, [COOLDOWN]: 0.4 },
            [CONFIG("Easy")]: { [FRAMES]: 10, [ON_BREAK]: 14, [COOLDOWN]: 0.4 },
        },
        dashCdo: { DurationMagnitude: { ScalableFloatMagnitude: { Value: 0.15 } } },
        playerTags: new Set(["CharacterState.Space.Ground"]),
        applied: 0, removed: 0, events: [], inputs: [],
        npcs: [], scans: 0, // 1.1: the enemies, and how often the mod looked for them
    };
}

// 1.1: an engine array, a timed-parry action, a deflectable attack action, a timeline of actions, and an enemy whose
// ability system lists abilities (each with its Timelines) and running timeline tasks.
const arr = (items) => ({ Num: () => items.length, Get: (i) => items[i] });
const parryAction = (path) => ({ path, ParryTag: {}, PrePerfectWindow: 0.1, PerfectWindow: 0.2, PostPerfectWindow: 0.1, FailWindow: 0.3 });
const leadAction = (path, lead = 0.4) => ({ path, PreHitPointDuration: lead, DeflectBulletType: 1, BulletDuration: 0.1 });
const timeline = (path, actions) => ({ path, Actions: arr(actions.map((Action) => ({ Action, StartTime: 0 }))) });
function enemy(game, name, abilityTimelines, runningTimelines = []) {
    const ability = { path: "/Game/Abilities/GA_" + name, Timelines: arr(abilityTimelines) };
    const npc = { path: "/Game/Maps/Level.Level:PersistentLevel." + name, asc: { path: "/Game/Maps/Level.Level:PersistentLevel." + name + ".ASC",
        ActivatableAbilities: { Items: arr([{ Ability: ability, NonReplicatedInstances: arr([]), ReplicatedInstances: arr([]) }]) },
        KnownTasks: arr(runningTimelines.map((Timeline) => ({ Timeline }))) } };
    game.npcs.push(npc);
    return npc;
}

// One fresh load of the script. options.keepState: the mod's state on globalThis stays (a second copy in one game).
function boot(options = {}) {
    const game = options.game || newGame();
    if (!options.keepState) {
        delete globalThis.__easierParryAndDodge;
    }
    const world = { game, now: 1000000, files: new Map(), saved: [], warnings: [], logs: [], pushed: [], timer: undefined,
        interval: undefined, cleared: [], loadError: undefined };
    if (options.settings !== undefined) {
        world.files.set(options.settingsPath || SETTINGS_PATH, options.settings);
    }
    const gameInstance = { path: "/Engine/Transient.GameInstance" };
    const pawn = { path: "/Game/Maps/Level.Level:PersistentLevel.BP_Player_C_0" };
    const asc = {
        HasMatchingGameplayTag: (tag) => game.playerTags.has(tag.TagName),
        MakeEffectContext: () => ({}),
        BP_ApplyGameplayEffectToSelf(cls) {
            game.applied++;
            if (cls.path == DEFLECT_GE) game.playerTags.add(ALWAYS_TAG);
        },
        RemoveActiveGameplayEffectBySourceEffect(cls) {
            game.removed++;
            if (cls.path == DEFLECT_GE) game.playerTags.delete(ALWAYS_TAG);
        },
    };
    const ue = {
        GameplayTag: class { constructor() { this.TagName = "None"; } },
        NewArray: () => ({ items: [], Add(x) { this.items.push(x); }, Num() { return this.items.length; }, Get(i) { return this.items[i]; } }),
        KismetSystemLibrary: {
            IsValid: (o) => !!o && o.valid !== false,
            ConvertToAbsolutePath: (p) => p,
            GetPathName: (o) => o.path,
            GetDisplayName: (o) => String(o && o.path || "?").split(/[./]/).pop(),
            GetConsoleVariableIntValue: () => 0,
        },
        BlueprintPathsLibrary: { FileExists: (p) => world.files.has(p) },
        EasyCsv: {
            LoadStringFromLocalFile(p, out) { out[0] = world.files.get(p); return true; },
            SaveStringToFileWithFullPath(text, p) { world.saved.push([p, text]); world.files.set(p, text); },
        },
        GameplayStatics: {
            GetPlayerCharacter: () => pawn,
            GetPlayerController: () => undefined,
            IsGamePaused: () => false,
            GetTimeSeconds: () => world.now / 1000,
            GetGlobalTimeDilation: () => 1,
            GetAllActorsOfClass(ctx, cls, ref) { game.scans++; ref[0] = cls == "PBZCharacter_NPC" ? arr(game.npcs) : arr([]); },
        },
        PBZCharacter_NPC: { StaticClass: () => "PBZCharacter_NPC" },
        Actor: { StaticClass: () => "Actor" },
        KismetMathLibrary: { EqualEqual_ObjectObject: (a, b) => a === b },
        AbilitySystemBlueprintLibrary: { GetAbilitySystemComponent: (actor) => (actor && actor.asc) || asc },
        AbilityAsync_WaitGameplayEvent: {
            WaitGameplayEventToActor(actor, tag) {
                const event = { tag: tag && tag.TagName, ended: false, callbacks: [],
                    EventReceived: { Add(fn) { event.callbacks.push(fn); } },
                    Activate() { }, EndAction() { event.ended = true; } };
                game.events.push(event);
                return event;
            },
        },
        Object: { Find: (p) => game.configs[p] || null, Load: (p) => (p.includes("/Input/IA_") ? { path: p } : null) },
        // the player's input: any call on it is counted (the auto guard presses and holds through it)
        EnhancedInputLocalPlayerSubsystem: { StaticClass: () => "EnhancedInputLocalPlayerSubsystem" },
        SubsystemBlueprintLibrary: {
            GetLocalPlayerSubsystem: () => new Proxy({}, { get: (o, name) => (...args) => {
                game.inputs.push(String(name)); return false; } }),
            GetWorldSubsystem: (pawn, cls) => (cls == "SlomoWorldSubsystem" ? game.slomo : undefined),
        },
        SlomoWorldSubsystem: { StaticClass: () => "SlomoWorldSubsystem" },
        PBZBlueprintFunctionLibrary: { GetLocalPlayer: () => ({}) },
        EnhancedInputLibrary: { MakeInputActionValueOfType: () => ({}) },
        EInputActionValueType: { Boolean: 0 },
        Class: { Load: (p) => (p == DASH_GE || p == DEFLECT_GE ? { path: p } : null) },
        SGameAIFunctionLibrary: { GetClassDefaultObject: (cls) => (cls.path == DASH_GE ? game.dashCdo : null) },
    };
    const puerts = {
        $ref: (value) => [value],
        $unref: (box) => box[0],
        toDelegate: (owner, fn) => fn,
        argv: { getByName: (name) => (name == "GameInstance" && !options.noGameInstance ? gameInstance : undefined) },
    };
    const stubs = { "ue": ue, "puerts": puerts, "Library/TsHelper": { default: {} } };
    const load = Module._load;
    Module._load = function (request, parent, isMain) {
        if (Object.prototype.hasOwnProperty.call(stubs, request)) {
            return stubs[request];
        }
        return load.call(this, request, parent, isMain);
    };
    const realNow = Date.now, realWarn = console.warn, realLog = console.log;
    const enter = () => {
        Date.now = () => world.now;
        console.warn = (message) => world.warnings.push(String(message));
        console.log = (message) => world.logs.push(String(message));
    };
    const leave = () => {
        Date.now = realNow;
        console.warn = realWarn;
        console.log = realLog;
    };
    let nextTimer = 0;
    world.timers = new Map();
    globalThis.setInterval = (fn, ms) => {
        const id = ++nextTimer;
        world.timers.set(id, { fn, ms });
        if (ms == 500) { world.timer = fn; world.interval = ms; world.timerId = id; }
        return id;
    };
    globalThis.clearInterval = (id) => { world.cleared.push(id); world.timers.delete(id); };
    globalThis.PBZModsMenu = options.menu === "array" ? [] : options.menu ? modsMenu(world, options.menuMissing) : undefined;
    world.menuGlobal = globalThis.PBZModsMenu;
    delete require.cache[require.resolve(SCRIPT)];
    enter();
    try {
        world.exports = require(SCRIPT);
    }
    catch (e) {
        world.loadError = e;
    }
    finally {
        Module._load = load;
        leave();
    }
    // one poll of the 500 ms timer after `ms`
    world.poll = (ms = 500) => {
        world.now += ms;
        enter();
        try {
            world.timer();
        }
        finally {
            leave();
        }
    };
    world.polls = (count) => { for (let i = 0; i < count; i++) world.poll(); };
    world.stop = () => {
        enter();
        try {
            world.exports.stop();
        }
        finally {
            leave();
        }
    };
    world.windows = () => {
        const n = game.configs[CONFIG("Normal")], e = game.configs[CONFIG("Easy")];
        return `${n[FRAMES]}/${n[ON_BREAK]} ${e[FRAMES]}/${e[ON_BREAK]}`;
    };
    world.send = (tag, data) => {
        enter();
        try {
            for (const e of game.events.filter((e) => e.tag == tag && !e.ended)) e.callbacks.forEach((fn) => fn(data));
        }
        finally {
            leave();
        }
    };
    world.cooldown = () => game.configs[CONFIG("Normal")][COOLDOWN];
    world.dash = () => game.dashCdo.DurationMagnitude.ScalableFloatMagnitude.Value;
    return world;
}

// The module as PBZModLoader loads it, without Mods Menu.
{
    const text = fs.readFileSync(SCRIPT, "utf8");
    check("the source's Mods Menu start list and its throwing stop() are gone",
        !text.includes("__PBZLoaderEntries") && !text.includes("Restart the game to update"));
    const w = boot();
    check("no error at load; stop() exported; one 500 ms poll", !w.loadError && typeof w.exports.stop == "function"
        && w.interval == 500);
    check("one start line for loader.log, naming the settings file in the mod's folder",
        w.logs.length == 1 && w.logs[0] == `[PBZMOD] [Easier Parry and Dodge] ${VERSION} started; settings: ${SETTINGS_PATH}`);
    check("no Mods Menu: no page pushed anywhere", globalThis.PBZModsMenu === undefined && w.pushed.length == 0);
    check("nothing written to the game before the first poll", w.windows() == "8/12 10/14" && w.dash() == 0.15);
}

// The settings file.
{
    const w = boot();
    const shipped = fs.readFileSync(SETTINGS, "utf8");
    check("a missing settings file is written once at the start, in the mod's folder, with the shipped text (CRLF)",
        w.saved.length == 1 && w.saved[0][0] == SETTINGS_PATH && w.saved[0][1] == shipped && shipped.includes("\r\n"));
    const kept = boot({ settings: "Deflect=2\r\n" });
    check("an existing settings file is never written over", kept.saved.length == 0);
}

// Mods Menu: optional.
{
    const m = boot({ menu: true });
    const page = m.pushed[0];
    check("Mods Menu running: one page, the mod's id, version, file, store \"saved\" and name",
        m.pushed.length == 1 && page.id == "phantombladezero_easierparryanddodge" && page.version == VERSION
        && page.file == "phantombladezero_easierparryanddodge.txt" && page.store == "saved"
        && page.title.en == "Easier Parry and Dodge" && page.settings.length > 10 && typeof page.onChange == "function");
    check("... the mod reads the file the page saves (defaults written there, not in the mod's folder)",
        m.saved.length == 1 && m.saved[0][0] == MENU_PATH && !m.files.has(SETTINGS_PATH)
        && m.logs[0] == `[PBZMOD] [Easier Parry and Dodge] ${VERSION} started; settings: ${MENU_PATH} (Mods Menu's page)`);
    m.files.set(MENU_PATH, "Deflect=2\r\n");
    page.onChange();
    m.poll();
    check("a change on the page (onChange): the next poll reads it (Deflect=2: 16/24)", m.windows() == "16/24 20/28");
    const a = boot({ menu: "array" });
    check("Mods Menu not started yet (a plain array): nothing pushed, the mod's own file",
        a.menuGlobal.length == 0 && a.saved[0][0] == SETTINGS_PATH);
    const o = boot({ menu: true, menuMissing: ["store.saved"] });
    check("an older Mods Menu without store \"saved\": no page, the mod's own file",
        o.pushed.length == 0 && o.saved[0][0] == SETTINGS_PATH);
}

// The windows (the source's logic, through the port).
{
    const w = boot();
    w.poll();
    check("the defaults (x1.5): deflect frames 8/12 -> 12/18 and 10/14 -> 15/21, the cooldown stays 0.4, the perfect dodge "
        + "0.15 -> 0.225 s", w.windows() == "12/18 15/21" && w.cooldown() == 0.4 && Math.abs(w.dash() - 0.225) < 1e-9);
    w.files.set(SETTINGS_PATH, "Deflect=2\r\nRepeatGuard=0.2\r\nDodge=Off\r\n");
    w.polls(5);
    check("a changed file (live): Deflect=2 scales from the game's frames (8 -> 16, not 12 -> 24), RepeatGuard 0.2, "
        + "Dodge=Off back to 0.15", w.windows() == "16/24 20/28" && w.cooldown() == 0.2 && w.dash() == 0.15);
    w.files.set(SETTINGS_PATH, "Deflect=Always\r\n");
    w.polls(5);
    check("Deflect=Always: the game's own debug effect on the player, the frames back to the game's",
        w.game.playerTags.has(ALWAYS_TAG) && w.game.applied == 1 && w.windows() == "8/12 10/14");
}

// 1.1: Phantom Tuner's rows. Exact frames first.
{
    const w = boot({ settings: "Deflect=2\r\nDeflectFrames=12\r\nDeflectFramesOnBreak=20\r\n" });
    w.poll();
    check("DeflectFrames=12, DeflectFramesOnBreak=20: exact counts on every difficulty, over Deflect=2",
        w.windows() == "12/20 12/20");
    w.files.set(SETTINGS_PATH, "Deflect=1.5\r\nDeflectFrames=4\r\n");
    w.polls(5);
    check("an exact count may be shorter than the game's (4); the other window follows Deflect again (12 -> 18)",
        w.windows() == "4/18 4/21");
    w.files.set(SETTINGS_PATH, "Deflect=Always\r\nDeflectFrames=12\r\n");
    w.polls(5);
    check("Deflect=Always: the frames stay the game's, an exact count too", w.windows() == "8/12 10/14");
    w.files.set(SETTINGS_PATH, "Deflect=Off\r\nDeflectFrames=100\r\n");
    w.polls(5);
    check("DeflectFrames=100: at most 60 frames (2 s)", w.windows() == "60/12 60/14");
    w.files.set(SETTINGS_PATH, "Deflect=Off\r\nDeflectFrames=Game\r\n");
    w.polls(5);
    check("DeflectFrames=Game and Deflect=Off: the game's frames", w.windows() == "8/12 10/14");
}

// 1.1: the timed-parry windows and the deflect lead, on the actions of the enemies' timelines.
{
    const game = newGame();
    const parry = parryAction("/Game/Timelines/TL_Shared.TL_Shared:CheckParry_0");
    const lead = leadAction("/Game/Timelines/TL_Shared.TL_Shared:Bullet_0");
    const shared = timeline("/Game/Timelines/TL_Shared.TL_Shared", [parry, lead, { path: "/Game/Other_0", Other: 1 }]);
    enemy(game, "EnemyA", [shared]);
    enemy(game, "EnemyB", [shared]);
    const off = boot({ game });
    off.polls(10);
    check("parry and lead rows Off (the defaults): the enemies are never looked for", game.scans == 0);
    const w = boot({ game, settings: "ParryPerfect=2\r\nParryNear=1.5\r\nParryFail=1.25\r\nDeflectLead=2\r\n" });
    w.poll();
    check("ParryPerfect=2, ParryNear=1.5, ParryFail=1.25, DeflectLead=2: the windows 0.2 -> 0.4, 0.1 -> 0.15 (before and "
        + "after), 0.3 -> 0.375, the lead 0.4 -> 0.8; one timeline of two enemies scaled once",
        Math.abs(parry.PerfectWindow - 0.4) < 1e-9 && Math.abs(parry.PrePerfectWindow - 0.15) < 1e-9
        && Math.abs(parry.PostPerfectWindow - 0.15) < 1e-9 && Math.abs(parry.FailWindow - 0.375) < 1e-9
        && Math.abs(lead.PreHitPointDuration - 0.8) < 1e-9 && game.scans == 1);
    const later = leadAction("/Game/Timelines/TL_Late.TL_Late:Bullet_0", 0.5);
    const running = leadAction("/Game/Timelines/TL_Run.TL_Run:Bullet_0", 0.3);
    enemy(game, "EnemyC", [timeline("/Game/Timelines/TL_Late.TL_Late", [later])], [timeline("/Game/Timelines/TL_Run.TL_Run", [running])]);
    w.poll();
    check("an enemy that comes later: not before the next look (every 2 s)", later.PreHitPointDuration == 0.5);
    w.polls(4);
    check("... then its ability's timeline and its running timeline task: 0.5 -> 1, 0.3 -> 0.6",
        Math.abs(later.PreHitPointDuration - 1) < 1e-9 && Math.abs(running.PreHitPointDuration - 0.6) < 1e-9);
    parry.PerfectWindow = 0.3; // another mod's write
    w.poll();
    check("a value another mod wrote is the new base (0.3 x2 = 0.6, not 0.4 x2)", Math.abs(parry.PerfectWindow - 0.6) < 1e-9);
    const scans = game.scans;
    w.files.set(SETTINGS_PATH, "ParryPerfect=Off\r\nParryNear=Off\r\nParryFail=Off\r\nDeflectLead=Off\r\n");
    w.polls(5);
    check("every row Off: each value back to the one found (0.3, 0.1, 0.1, 0.3; leads 0.4, 0.5, 0.3)",
        Math.abs(parry.PerfectWindow - 0.3) < 1e-9 && Math.abs(parry.PrePerfectWindow - 0.1) < 1e-9
        && Math.abs(parry.PostPerfectWindow - 0.1) < 1e-9 && Math.abs(parry.FailWindow - 0.3) < 1e-9
        && Math.abs(lead.PreHitPointDuration - 0.4) < 1e-9 && Math.abs(later.PreHitPointDuration - 0.5) < 1e-9
        && Math.abs(running.PreHitPointDuration - 0.3) < 1e-9);
    w.polls(10);
    check("... and then no more looks for enemies", game.scans <= scans + 1);
    w.files.set(SETTINGS_PATH, "DeflectLead=1.5\r\n");
    w.polls(5);
    check("a row on again: every enemy looked at afresh (0.4 -> 0.6, 0.5 -> 0.75)",
        Math.abs(lead.PreHitPointDuration - 0.6) < 1e-9 && Math.abs(later.PreHitPointDuration - 0.75) < 1e-9);
    w.stop();
    check("stop(): the lead values back (0.4, 0.5, 0.3)", Math.abs(lead.PreHitPointDuration - 0.4) < 1e-9
        && Math.abs(later.PreHitPointDuration - 0.5) < 1e-9 && Math.abs(running.PreHitPointDuration - 0.3) < 1e-9);
    const gone = boot({ game, settings: "DeflectLead=2\r\n" });
    gone.poll();
    later.valid = false;
    gone.files.set(SETTINGS_PATH, "DeflectLead=1.5\r\n");
    gone.polls(5);
    check("an action that is unloaded is let go without a write (it keeps 1 when the row goes to 1.5), no warning",
        later.PreHitPointDuration == 1 && Math.abs(lead.PreHitPointDuration - 0.6) < 1e-9 && gone.warnings.length == 0);
}

// 1.1: the Mods Menu page has the new rows.
{
    const m = boot({ menu: true });
    const keys = m.pushed[0].settings.map((s) => s.key);
    check("the page: DeflectFrames, DeflectFramesOnBreak, DeflectLead, ParryPerfect, ParryNear, ParryFail",
        ["DeflectFrames", "DeflectFramesOnBreak", "DeflectLead", "ParryPerfect", "ParryNear", "ParryFail"].every((k) => keys.includes(k)));
}

// stop(), and a second copy after it (PBZModLoader's reload).
{
    const game = newGame();
    const w = boot({ game, settings: "Deflect=Always\r\nDodge=2\r\nRepeatGuard=0.1\r\nAutoGuard=On\r\n" });
    w.poll();
    check("before stop(): Always on, the dodge window x2, the cooldown 0.1",
        game.playerTags.has(ALWAYS_TAG) && Math.abs(w.dash() - 0.3) < 1e-9 && w.cooldown() == 0.1);
    const timerId = w.timerId;
    w.stop();
    check("stop(): the poll timer cleared", w.cleared.includes(timerId) && !w.timers.has(timerId));
    check("stop(): every value back to the game's (the Always effect off, frames 8/12 10/14, the cooldown 0.4, the dodge "
        + "0.15 s)", !game.playerTags.has(ALWAYS_TAG) && game.removed == 1 && w.windows() == "8/12 10/14"
        && w.cooldown() == 0.4 && w.dash() == 0.15);
    check(`stop(): every event listener ended (${game.events.length}), no timer left, no warning, a line for loader.log`,
        game.events.length >= 3 && game.events.every((e) => e.ended) && w.timers.size == 0 && w.warnings.length == 0
        && w.logs[w.logs.length - 1] == "[PBZMOD] [Easier Parry and Dodge] stopped");
    const again = boot({ game, keepState: true, settings: "Deflect=1.5\r\n" });
    again.poll();
    check("a second copy after stop() (the reload): it starts and scales from the game's values again (12/18, not 18/27)",
        !again.loadError && again.windows() == "12/18 15/21");
    const guard = boot({ settings: "AutoGuard=On\r\n" });
    guard.poll();
    guard.send("GameplayEvent.Ability.Action.Deflect.Frame.Deflect.Defender", { OptionalObject: { ReceiveFrame: {
        SourceAction: { DeflectBulletType: 1 }, HitGameTime: guard.now / 1000 + 0.5, IsHit: false } } });
    const guardTimers = [...guard.timers.values()].filter((t) => t.ms == 16).length;
    guard.stop();
    check(`AutoGuard=On and a blockable attack's frame: a hold on its 16 ms timer (${guardTimers}); stop() ends it, no `
        + "timer left, no warning", guardTimers == 1 && guard.timers.size == 0 && guard.warnings.length == 0);
    const slowed = boot({ settings: "SlowBlue=On\r\nSlowStart=Warning\r\n" });
    slowed.poll();
    slowed.send("GameplayEvent.Ability.Action.Deflect.Frame.Deflect.Defender", { OptionalObject: { ReceiveFrame: {
        SourceAction: { DeflectBulletType: 2 }, HitGameTime: slowed.now / 1000 + 0.5, IsHit: false } } });
    const slowEntry = slowed.game.slow.get("EasierParryAndDodge.Slow");
    slowed.stop();
    check(`SlowBlue=On and a blue attack's frame: the world slowed (${slowEntry}); stop() takes the mod's entry out of the `
        + "game's slow-motion service, no timer left, no warning", slowEntry == 0.5 && slowed.game.slow.size == 0
        && slowed.timers.size == 0 && slowed.warnings.length == 0);
    const scaled = boot({ settings: "Deflect=3\r\n" });
    scaled.poll();
    const before = scaled.windows();
    scaled.stop();
    check("stop() with wider deflect windows (x3: 24/36): the frames back to the game's",
        before == "24/36 30/42" && scaled.windows() == "8/12 10/14");
    const plain = boot();
    plain.stop();
    check("stop() before the first poll: nothing to give back, no warning", plain.warnings.length == 0
        && plain.windows() == "8/12 10/14");
}

// The source's own second-load handling still works under the new state name.
{
    const game = newGame();
    const first = boot({ game });
    first.poll();
    const second = boot({ game, keepState: true });
    second.poll();
    check("a second copy without stop(): it takes over and does not scale twice (12/18)",
        second.windows() == "12/18 15/21" && first.cleared.length > 0);
}

// A failed start.
{
    const n = boot({ noGameInstance: true });
    check("no GameInstance: the load throws (PBZModLoader logs the mod as failed), no timer",
        !!n.loadError && n.timer === undefined);
}

process.exit(failed ? 1 : 0);
