"use strict";
// Mock UE/PuerTS harness for PBZPerilWarning.js. Counts every property read and
// method call on mock UE objects as a "bridge op" (each is a JS<->C++ hop in game).
const assert = require("assert");
const path = process.argv[2];
const label = process.argv[3] || path;
const mod = require(require("path").resolve(path));

let ops = 0;
const bridged = obj => new Proxy(obj, {get(t, k) { if (typeof k === "string") ops++; return t[k]; }});
const arr = items => bridged({Num: () => items.length, Get: i => items[i]});

let gameTime = 0, wall = 1e6, slomo = 1, paused = false;
const commands = [];
const tag = n => ({TagName: n});
const mkASC = (tags, specs) => bridged({
    HasMatchingGameplayTag: t => tags.includes(t.TagName),
    HasAllMatchingGameplayTags: () => true,
    HasAnyMatchingGameplayTags: () => false,
    ActivatableAbilities: bridged({Items: arr(specs)}),
});
const effect = name => bridged({path: "/Game/FX/" + name + "." + name});
const alertAction = name => bridged({
    GetClass: () => ({path: "/Game/BP/WeaponParticle_BlueRedEye.WeaponParticle_BlueRedEye_C"}),
    NiagaraEffect: effect(name), ActivationRequirements: null,
});
const otherAction = () => bridged({GetClass: () => ({path: "/Game/BP/PlaySound.PlaySound_C"}), NiagaraEffect: null});
function mkTimelineAbility(name, events, startAt) {
    const timeline = bridged({GetName: () => name, Actions: arr(events.map(e => bridged(e))), RoleLayers: arr([])});
    const task = bridged({Timeline: timeline, get CurrentTime() { return Math.max(0, gameTime - startAt); }});
    return bridged({GetPlayTimelineTask: () => task});
}
function mkSpec(active, ability) {
    return bridged({ActiveCount: active ? 1 : 0, NonReplicatedInstances: arr(ability ? [ability] : []), ReplicatedInstances: arr([]), Ability: ability || null});
}
function mkEnemy({dist = 1000, friendly = false, dead = false, specs}) {
    return bridged({IsPlayerControlled: () => false, GetDistanceTo: () => dist, friendly,
        AbilitySystemComponent: mkASC(dead ? ["CharacterState.Dead", "CharacterType.NPC"] : ["CharacterType.NPC"], specs)});
}

// Scenario: 12 enemies in range with 40 idle abilities each; one attacker starts
// an alert ability at t=1.0 (red 1.6..2.0, blue 1.7..1.9) plus a non-alert active ability.
const idle = n => Array.from({length: n}, () => mkSpec(false));
const attackAbility = mkTimelineAbility("TL_Attack", [
    {Action: alertAction("NS_AttackAlert_Red_001"), StartTime: 0.6, Duration: 0.4},
    {Action: alertAction("NS_AttackAlert_Blue_001"), StartTime: 0.7, Duration: 0.2},
    {Action: otherAction(), StartTime: 0.1, Duration: 0.2},
], 1.0);
const walkAbility = mkTimelineAbility("TL_Walk", [{Action: otherAction(), StartTime: 0, Duration: 5}], 0);
let attackerActive = false;
const attackSpec = bridged({get ActiveCount() { return attackerActive ? 1 : 0; },
    NonReplicatedInstances: arr([attackAbility]), ReplicatedInstances: arr([]), Ability: attackAbility});
const enemies = [mkEnemy({specs: [attackSpec, mkSpec(true, walkAbility), ...idle(38)]})];
for (let i = 0; i < 11; i++) enemies.push(mkEnemy({specs: idle(40)}));
enemies.push(mkEnemy({dist: 9000, specs: idle(40)}), mkEnemy({friendly: true, specs: idle(40)}), mkEnemy({dead: true, specs: idle(40)}));

const player = bridged({AbilitySystemComponent: mkASC([], [])});
let canvasVisible = false;
const mkWidget = () => bridged({SetVisibility: v => { canvasVisible = v === "HitTestInvisible"; }, RemoveFromParent() {},
    AddChildToCanvas: () => bridged({SetAnchors() {}, SetAlignment() {}, SetAutoSize() {}, SetPosition() {}, SetZOrder() {}}),
    SetText() {}, SetFont() {}, SetShadowColorAndOpacity() {}, SetShadowOffset() {}, SetJustification() {}, SetRenderTransformPivot() {},
    SetColorAndOpacity(c) { this.color = c; }});
let textWidget;
const hud = bridged({WidgetTree: {}});
const overlay = bridged({AddChildToOverlay: () => bridged({SetHorizontalAlignment() {}, SetVerticalAlignment() {}})});
class V2 { constructor(x, y) { this.X = x; this.Y = y; } }
class LinearColor { constructor(r, g, b, a) { Object.assign(this, {r, g, b, a}); } }
const UE = bridged({
    BlueprintPathsLibrary: bridged({ConvertRelativePathToFull: () => "C:/Saved/", ProjectSavedDir: () => "Saved"}),
    EasyCsv: bridged({SaveStringToFileWithFullPath: () => true}),
    KismetSystemLibrary: bridged({
        GetConsoleVariableFloatValue: () => slomo,
        ExecuteConsoleCommand: (_, cmd) => { commands.push(cmd); slomo = Number(cmd.split(" ")[1]); },
        IsValid: o => !!o, GetPathName: o => o.path || "obj", GetGameTimeInSeconds: () => gameTime,
    }),
    SlateColor: class { }, LinearColor, Vector2D: V2, Anchors: class { },
    SlateFontInfo: class { constructor() { this.OutlineSettings = {}; } },
    GameplayTag: class { },
    PBZHUDLayout: bridged({GetHUDLayout: () => hud}),
    Widget: bridged({Find: () => overlay}),
    NewObject: cls => { const w = mkWidget(); if (cls === "TextBlock") textWidget = w; return w; },
    CanvasPanel: {StaticClass: () => "CanvasPanel"}, TextBlock: {StaticClass: () => "TextBlock"},
    Font: {Load: () => ({font: 1})},
    ESlateVisibility: {Collapsed: "Collapsed", HitTestInvisible: "HitTestInvisible"},
    EHorizontalAlignment: {}, EVerticalAlignment: {}, ETextJustify: {},
    GameplayStatics: bridged({
        GetAllActorsOfClass: (_, __, out) => { out.value = arr(enemies); },
        GetPlayerPawn: () => player, GetPlayerController: () => ({pc: 1}), IsGamePaused: () => paused,
    }),
    PBZCharacter_NPC: {StaticClass: () => "NPC"}, Actor: {}, NewArray: () => null,
    FactionUtils: bridged({GetFaction: a => ({faction: a === player ? "P" : "E"}), GetFactionRelation: (_, a) => a.friendly ? "Friendly" : "Hostile"}),
    BlueprintGameplayTagLibrary: bridged({IsGameplayTagValid: () => true}),
    ETeamAttitude: {Friendly: "Friendly"},
});
const puerts = {$ref: () => ({}), $unref: r => r.value};
const cpp = {FText: {FromString: s => s}};
const timers = {setInterval: () => 1, clearInterval() {}};
const quiet = {log() {}, warn: m => console.log("  WARN", m)};
const realNow = Date.now; Date.now = () => wall;

const ctl = mod.startController({ctx: 1}, UE, puerts, cpp, timers, quiet);
const timelineLog = [];
let tickOps = 0, ticks = 0;
for (let step = 0; step <= 200; step++) { // 16ms steps → 3.2s
    gameTime = step * 0.016; wall = 1e6 + step * 16;
    attackerActive = gameTime >= 1.0 && gameTime < 2.2;
    if (step % 16 === 0) ctl.scan();
    const before = ops; ctl.tick(); tickOps += ops - before; ticks++;
    const kind = canvasVisible ? (textWidget.color.SpecifiedColor.r === 1 ? "red" : "blue") : "-";
    timelineLog.push({t: +gameTime.toFixed(3), kind, slomo});
}
ctl.stop();
Date.now = realNow;

const at = t => timelineLog.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a);
const firstShow = timelineLog.find(x => x.kind !== "-");
const lastShow = [...timelineLog].reverse().find(x => x.kind !== "-");
console.log(`${label}: first warning t=${firstShow && firstShow.t}, last warning t=${lastShow && lastShow.t}, ` +
    `avg bridge ops/tick=${(tickOps / ticks).toFixed(0)}, commands=${JSON.stringify(commands)}`);
assert.strictEqual(at(1.2).kind, "-", "no warning before lead window");
assert.strictEqual(at(1.4).kind, "red", "red lead warning ~0.2s before glow");
assert.strictEqual(at(1.8).kind, "red", "red wins over blue overlap");
assert.ok(Math.abs(at(1.8).slomo - 0.75) < 1e-9, "slow motion during glow");
assert.strictEqual(at(1.5).slomo, 1, "no slow motion during lead");
assert.strictEqual(at(2.1).kind, "-", "warning ends after window");
assert.strictEqual(at(2.1).slomo, 1, "slow motion restored");
console.log(`${label}: behaviour assertions passed`);
