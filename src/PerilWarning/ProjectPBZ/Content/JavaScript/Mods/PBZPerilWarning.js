"use strict";
const active = new WeakMap();
const LEAD = 0.3;
const SLOW_MULTIPLIER = 0.75;
const PREFIX = "[PerilWarning v0.7.1]";
// Expensive work (enemy eligibility, ability lists, timeline discovery) runs at this
// cadence; the 16ms tick only reads CurrentTime of timelines that carry alert windows.
const DISCOVER_MS = 50;
const FACTION_CACHE_MS = 1000;
const ALERT_EFFECTS = [
    {path:"/NS_AttackAlert_Red_001.", kind:"red"},
    {path:"/NS_AttackAlert_Red_004.", kind:"red"},
    {path:"/NS_AttackAlert_Blue_001.", kind:"blue"},
    {path:"/NS_AttackAlert_Blue_002.", kind:"blue"}
];

function inWindow(time, event, rate = 1) {
    return Number.isFinite(time) && Number.isFinite(event.start) && Number.isFinite(event.end) &&
        event.end > event.start && time >= Math.max(0, event.start - LEAD * rate) && time < event.end;
}
function advanceClock(previous, time, now) {
    let rate = previous ? previous.rate : 1;
    if (previous && now > previous.now && time >= previous.time) {
        const sample = (time - previous.time) / (now - previous.now);
        if (sample > 0.01 && sample < 20) rate = sample;
    } else if (previous && time < previous.time) rate = 1;
    return {time, now, rate};
}
function arrayValues(a) {
    const result = [];
    if (a && typeof a.Num === "function") for (let i = 0; i < a.Num(); i++) result.push(a.Get(i));
    return result;
}
function eventWindow(ev) {
    // The cooked usmap spells this "duration", but the game's native reflection
    // registers "Duration". PuerTS property access is case sensitive.
    const duration = ev.Duration !== undefined ? ev.Duration : ev.duration;
    const start = Number(ev.StartTime) + Number(ev.TriggerTimeOffset || 0);
    const end = Number(ev.StartTime) + Number(duration) + Number(ev.EndTriggerTimeOffset || 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        throw new Error("Invalid alert event timing: StartTime=" + ev.StartTime +
            " Duration=" + ev.Duration + " duration=" + ev.duration +
            " TriggerTimeOffset=" + ev.TriggerTimeOffset + " EndTriggerTimeOffset=" + ev.EndTriggerTimeOffset);
    return {start,end,action:ev.Action};
}

function startController(context, UE, puerts, cpp, timers, log) {
    const output = log, lines = [];
    let dirty = false, lastFlush = 0, nextStatus = 0;
    function record(message, warn) {
        (warn ? output.warn : output.log).call(output, message);
        lines.push(new Date().toISOString() + " " + message);
        if (lines.length > 120) lines.shift();
        dirty = true;
    }
    log = {log: m => record(m,false), warn: m => record(m,true)};
    function flush(force = false) {
        if (!dirty || (!force && Date.now() - lastFlush < 3000)) return;
        lastFlush = Date.now();
        try {
            const dir = UE.BlueprintPathsLibrary.ConvertRelativePathToFull(UE.BlueprintPathsLibrary.ProjectSavedDir(), "");
            if (UE.EasyCsv.SaveStringToFileWithFullPath(lines.join("\n"), dir + "PerilWarning.log")) dirty = false;
        } catch (_) {}
    }
    let stopped = false, tickTimer, scanTimer, enemies = [], hud, canvas, text, font;
    let slowBase, slowApplied;
    let counts = {};
    function slow(wanted) {
        if (wanted && slowBase === undefined) {
            const base = Number(UE.KismetSystemLibrary.GetConsoleVariableFloatValue("debugslomo"));
            if (!Number.isFinite(base) || base <= 0) {reportOnce("slow motion", "invalid debugslomo baseline " + base); return;}
            UE.KismetSystemLibrary.ExecuteConsoleCommand(context, "debugslomo " + base * SLOW_MULTIPLIER);
            slowBase = base; slowApplied = base * SLOW_MULTIPLIER;
            noteOnce("slow motion activated", "multiplier=" + SLOW_MULTIPLIER + "; baseline=" + base);
        } else if (!wanted && slowBase !== undefined) {
            // Preserve changes made by the game's own debug UI while we held this source.
            const current = Number(UE.KismetSystemLibrary.GetConsoleVariableFloatValue("debugslomo"));
            if (Math.abs(current - slowApplied) < 0.0001)
                UE.KismetSystemLibrary.ExecuteConsoleCommand(context, "debugslomo " + slowBase);
            slowBase = slowApplied = undefined;
        }
    }
    let visible = false, firstTimeline = false, firstWarning = false, displayedKind;
    const glyphColors = {};
    function setGlyphColor(kind) {
        if (displayedKind === kind) return;
        if (!glyphColors[kind]) {
            const color = new UE.SlateColor();
            color.SpecifiedColor = kind === "blue" ? new UE.LinearColor(0.025, 0.35, 1, 1) : new UE.LinearColor(1, 0.025, 0.015, 1);
            glyphColors[kind] = color;
        }
        text.SetColorAndOpacity(glyphColors[kind]);
        displayedKind = kind;
    }
    const clocks = new WeakMap();
    const windows = new WeakMap();
    const reported = new Set();
    const tag = name => {const t = new UE.GameplayTag(); t.TagName = name; return t;};
    const dead = tag("CharacterState.Dead"), sequence = tag("CharacterState.InLevelSequence"), npc = tag("CharacterType.NPC");
    const valid = obj => {try {return !!obj && UE.KismetSystemLibrary.IsValid(obj);} catch (_) {return false;}};
    function reportOnce(key, error) {if (!reported.has(key)) {reported.add(key); log.warn(PREFIX + " " + key + ": " + error);}}
    function noteOnce(key, message) {if (!reported.has(key)) {reported.add(key); log.log(PREFIX + " " + key + ": " + message);}}
    function hide() {slow(false); if (valid(canvas)) canvas.SetVisibility(UE.ESlateVisibility.Collapsed); visible = false;}
    function destroyUI() {
        try {if (valid(canvas)) canvas.RemoveFromParent();} catch (_) {}
        canvas = text = hud = undefined;
        displayedKind = undefined;
        visible = false;
    }
    function ensureUI() {
        const current = UE.PBZHUDLayout.GetHUDLayout(context);
        if (!valid(current)) {destroyUI(); return false;}
        if (current === hud && valid(canvas) && valid(text)) return true;
        destroyUI();
        const tree = current.WidgetTree;
        const overlay = tree ? UE.Widget.Find("Overlay_0", tree) : undefined;
        if (!valid(overlay) || typeof overlay.AddChildToOverlay !== "function") return false;
        hud = current;
        canvas = UE.NewObject(UE.CanvasPanel.StaticClass(), hud);
        canvas.SetVisibility(UE.ESlateVisibility.Collapsed);
        const outerSlot = overlay.AddChildToOverlay(canvas);
        outerSlot.SetHorizontalAlignment(UE.EHorizontalAlignment.HAlign_Fill);
        outerSlot.SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Fill);
        text = UE.NewObject(UE.TextBlock.StaticClass(), hud);
        text.SetText(cpp.FText.FromString("危"));
        const face = new UE.SlateFontInfo();
        if (!font) font = UE.Font.Load("/Game/PBZContent/UI/Fonts/ZH_ZiKuTangKuangShanKaiShuJF_Font.ZH_ZiKuTangKuangShanKaiShuJF_Font");
        if (!valid(font)) throw new Error("Calligraphy font could not load");
        face.FontObject = font;
        face.TypefaceFontName = "Default";
        face.Size = 150;
        const outline = face.OutlineSettings;
        outline.OutlineSize = 3;
        outline.OutlineColor = new UE.LinearColor(0.12, 0.003, 0.002, 0.95);
        face.OutlineSettings = outline;
        text.SetFont(face);
        text.SetShadowColorAndOpacity(new UE.LinearColor(0.3, 0, 0, 0.8));
        text.SetShadowOffset(new UE.Vector2D(2, 3));
        text.SetJustification(UE.ETextJustify.Center);
        text.SetVisibility(UE.ESlateVisibility.HitTestInvisible);
        const slot = canvas.AddChildToCanvas(text);
        const anchors = new UE.Anchors();
        anchors.Minimum = new UE.Vector2D(0.5, 0.34);
        anchors.Maximum = new UE.Vector2D(0.5, 0.34);
        slot.SetAnchors(anchors);
        slot.SetAlignment(new UE.Vector2D(0.5, 0.5));
        slot.SetAutoSize(true);
        slot.SetPosition(new UE.Vector2D(0, 0));
        slot.SetZOrder(1000);
        text.SetRenderTransformPivot(new UE.Vector2D(0.5, 0.5));
        log.log(PREFIX + " HUD ready; automatic combat warning only.");
        return true;
    }
    function scan() {
        if (stopped || !valid(context)) return;
        try {
            const out = puerts.$ref(UE.NewArray(UE.Actor));
            UE.GameplayStatics.GetAllActorsOfClass(context, UE.PBZCharacter_NPC.StaticClass(), out);
            enemies = arrayValues(puerts.$unref(out));
            flush();
        } catch(e) {enemies = []; reportOnce("enemy scan",e);}
    }
    const factionCache = new WeakMap();
    function friendly(actor, player, nowMs) {
        const cached = factionCache.get(actor);
        if (cached && cached.player === player && nowMs < cached.until) return cached.friendly;
        // Mirror EnemyHPBar.checkIsFriendly: the faction API defaults to Friendly
        // when a component is absent, including on actual monsters.
        const pf = UE.FactionUtils.GetFaction(player), af = UE.FactionUtils.GetFaction(actor);
        const result = UE.BlueprintGameplayTagLibrary.IsGameplayTagValid(pf) && UE.BlueprintGameplayTagLibrary.IsGameplayTagValid(af) &&
            UE.FactionUtils.GetFactionRelation(player, actor) === UE.ETeamAttitude.Friendly;
        factionCache.set(actor, {player, friendly: result, until: nowMs + FACTION_CACHE_MS});
        return result;
    }
    // Returns the actor's ASC when it should be watched, otherwise undefined.
    function eligible(actor, player, nowMs) {
        if (!valid(actor) || actor === player || actor.IsPlayerControlled() || actor.GetDistanceTo(player) > 2500) return undefined;
        const asc = actor.AbilitySystemComponent;
        if (!valid(asc) || asc.HasMatchingGameplayTag(dead)) return undefined;
        if (asc.HasMatchingGameplayTag(npc) && friendly(actor, player, nowMs)) return undefined;
        counts.eligible++;
        return asc;
    }
    function requirementsMet(req, asc) {
        if (!req) return true;
        return asc.HasAllMatchingGameplayTags(req.RequireTags) && !asc.HasAnyMatchingGameplayTags(req.IgnoreTags);
    }
    function readWindows(task) {
        if (windows.has(task)) return windows.get(task);
        const timeline = task.Timeline;
        if (!valid(timeline)) return [];
        const result = [];
        if (!timeline.Actions || typeof timeline.Actions.Num !== "function") throw new Error("timeline.Actions is not exposed");
        const events = arrayValues(timeline.Actions);
        for (const layer of arrayValues(timeline.RoleLayers)) events.push(...arrayValues(layer.Actions));
        for (const ev of events) {
            const action = ev.Action;
            if (!valid(action)) continue;
            // Only the common red/blue warning particles; exclude other particle effects.
            const cls = UE.KismetSystemLibrary.GetPathName(action.GetClass());
            if (!String(cls).includes("WeaponParticle_BlueRedEye")) continue;
            const effect = action.NiagaraEffect;
            if (!valid(effect)) continue;
            const effectPath = UE.KismetSystemLibrary.GetPathName(effect);
            noteOnce("particle " + effectPath, "timeline=" + timeline.GetName());
            const alert = ALERT_EFFECTS.find(x => String(effectPath).includes(x.path));
            if (!alert) continue;
            // Read the requirements struct once per timeline instead of every in-window tick.
            result.push({...eventWindow(ev),kind:alert.kind,req:action.ActivationRequirements || null});
        }
        windows.set(task,result);
        if (result.length) log.log(PREFIX + " alert timeline: " + timeline.GetName() + " windows=" + result.map(x=>x.kind+":"+x.start.toFixed(3)+".."+x.end.toFixed(3)).join(","));
        return result;
    }
    // Collect the active timelines of one enemy that contain red/blue alert windows.
    function collectAlertTimelines(asc, found) {
        const container = asc.ActivatableAbilities;
        if (!container || !container.Items) throw new Error("ASC ability list is unavailable");
        if (typeof container.Items.Num !== "function") throw new Error("ASC ability Items is not exposed as TArray");
        const specs = arrayValues(container.Items); counts.specs += specs.length;
        noteOnce("ability list", "specs=" + specs.length);
        for (const spec of specs) {
            if (spec.ActiveCount === undefined) throw new Error("spec.ActiveCount is not exposed");
            if (!(spec.ActiveCount > 0)) continue;
            counts.active++;
            const instances = [...arrayValues(spec.NonReplicatedInstances), ...arrayValues(spec.ReplicatedInstances)];
            // Non-instanced native abilities use their spec object; only use a live timeline if present.
            if (!instances.length && valid(spec.Ability)) instances.push(spec.Ability);
            const seen = new Set();
            for (const ability of instances) {
                counts.instances++;
                if (!valid(ability) || seen.has(ability)) continue;
                if (typeof ability.GetPlayTimelineTask !== "function") {
                    reportOnce("ability without timeline API", UE.KismetSystemLibrary.GetPathName(ability)); continue;
                }
                seen.add(ability);
                const task = ability.GetPlayTimelineTask();
                if (!valid(task) || !valid(task.Timeline)) continue;
                const time = Number(task.CurrentTime);
                if (!Number.isFinite(time)) throw new Error("task.CurrentTime is not exposed");
                counts.timelines++;
                if (!firstTimeline) {firstTimeline=true; log.log(PREFIX + " native active timeline read verified; actions=" + arrayValues(task.Timeline.Actions).length);}
                const alertWindows = readWindows(task);
                for (const event of alertWindows) counts[event.kind + "Windows"]++;
                if (alertWindows.length) found.push({task, windows: alertWindows, asc});
            }
        }
    }
    // Slow path, every DISCOVER_MS: rebuild the list of alert timelines to watch.
    let tracked = [], nextDiscover = 0;
    function discover(player, nowMs) {
        counts = {enemies:enemies.length,eligible:0,specs:0,active:0,instances:0,timelines:0,tracked:0,redWindows:0,blueWindows:0};
        const found = [];
        for (const enemy of enemies) {
            try {
                const asc = eligible(enemy, player, nowMs);
                if (asc) collectAlertTimelines(asc, found);
            } catch(e) {reportOnce("timeline read",e);}
        }
        counts.tracked = found.length;
        tracked = found;
    }
    function tick() {
        if (stopped) return;
        try {
            if (!valid(context)) {stop(); return;}
            const player = UE.GameplayStatics.GetPlayerPawn(context,0);
            const pc = UE.GameplayStatics.GetPlayerController(context,0);
            if (!valid(player) || !valid(pc) || UE.GameplayStatics.IsGamePaused(context)) {hide();return;}
            const asc = player.AbilitySystemComponent;
            if (!valid(asc) || asc.HasMatchingGameplayTag(dead) || asc.HasMatchingGameplayTag(sequence)) {hide();return;}
            const nowMs = Date.now();
            if (nowMs >= nextDiscover) {nextDiscover = nowMs + DISCOVER_MS; discover(player, nowMs);}
            let wanted = false;
            let glowing = false;
            let warningKind;
            if (tracked.length) {
                // Fast path: only timelines already known to carry alert windows.
                const now = UE.KismetSystemLibrary.GetGameTimeInSeconds(context);
                for (const entry of tracked) {
                    try {
                        if (!valid(entry.task)) continue;
                        const time = Number(entry.task.CurrentTime);
                        if (!Number.isFinite(time)) continue;
                        const state = advanceClock(clocks.get(entry.task), time, now);
                        clocks.set(entry.task, state);
                        for (const event of entry.windows) {
                            if (inWindow(time,event,state.rate) && requirementsMet(event.req,entry.asc)) {
                                wanted = true;
                                if (!warningKind || event.kind === "red") warningKind = event.kind;
                                if (time >= event.start) glowing = true;
                            }
                        }
                    } catch(e) {reportOnce("timeline read",e);}
                }
            }
            slow(glowing);
            if (nowMs >= nextStatus) {
                nextStatus = nowMs + 10000;
                log.log(PREFIX + " scan " + JSON.stringify(counts)); flush();
            }
            if (!wanted) {hide(); return;}
            if (!ensureUI()) return;
            setGlyphColor(warningKind || "red");
            if (!visible && !firstWarning) {firstWarning=true;log.log(PREFIX + " first alert warning displayed");}
            canvas.SetVisibility(UE.ESlateVisibility.HitTestInvisible);
            visible = true;
        } catch(e) {hide();reportOnce("tick",e);}
    }
    function stop() {
        if (stopped) return;
        stopped = true;
        try {slow(false);} catch(e) {reportOnce("restore speed",e);}
        if (tickTimer !== undefined) timers.clearInterval(tickTimer);
        if (scanTimer !== undefined) timers.clearInterval(scanTimer);
        enemies = []; tracked = [];
        destroyUI(); font = undefined;
        flush(true);
    }
    scan();
    tickTimer = timers.setInterval(tick, 16);
    scanTimer = timers.setInterval(scan, 250);
    log.log(PREFIX + " loaded: red and blue alerts, 0.3s lead; actual glow interval 0.75x speed; discovery every " + DISCOVER_MS + "ms; pending combat verification");
    flush(true);
    return {stop,tick,scan};
}
exports.start = function(owner, context) {
    exports.stop(owner);
    if (!context) return;
    active.set(owner,startController(context,require("ue"),require("puerts"),require("cpp"),{setInterval,clearInterval},console));
};
exports.stop = function(owner) {const c=active.get(owner);if(c)c.stop();active.delete(owner);};
exports.inWindow=inWindow;
exports.advanceClock=advanceClock;
exports.eventWindow=eventWindow;
exports.startController=startController;
