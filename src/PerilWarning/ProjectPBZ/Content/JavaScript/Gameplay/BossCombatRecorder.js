"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BossCombatRecorder = void 0;
exports.readBossRecordRoots = readBossRecordRoots;
exports.clearBossRecords = clearBossRecords;
exports.formatBossRecordReport = formatBossRecordReport;
const UE = require("ue");
const puerts_1 = require("puerts");
const TsHelper_1 = require("../Library/TsHelper");
/**
 * Boss 击杀用时记录：每个 boss 从「进战」到「打死」的游戏时间，写进当前存档槽 + 账号存档各一份。
 *
 * 信号源（与 HUD W_FrontEndHUDLayout.BossCombat 同一套）：玩家仇恨组件 BP_SGameHatredManagerComponent 在带
 * CharacterType.AI.Boss 的怪首次把玩家加进仇恨表时，向玩家发 GameplayEvent.InCombat.BossCombat（Payload.Target=boss）；
 * 该怪从 BeHatredList 移除时发 GameplayEvent.OffCombat.BossCombat。按 boss actor 逐个发（双 boss = 两条会话）。
 *
 * 成功判定按图鉴基础行选路：有 UnlockTag 只等其 EventPipeline 广播；没配才按 boss ASC 的 CharacterState.Dead（ActorState 进 Dead 状态时先加 tag、再广播 OnStateBegin →
 * BP_DeathComponent.Death Event，同步同帧、同一次状态切换）。⚠ boss 死亡本身会触发一次 OffCombat 且**先于**死亡事件
 * （boss 仇恨组件监听 dead tag → RemoveAllActorsFromHatredList → 玩家 RemoveActorFromBeHatredList），
 * 所以 OffCombat 到达时按 boss 是否已带 Dead tag 分流：有 = 击杀；无 = 活着脱战，会话保留、Dead 监听继续等
 * （先脱战后加 Dead 的照样记击杀，用时算到加 Dead 那一刻）。同一 boss 再进战沿用原会话：不重置计时、不再计挑战。
 * Tag 战斗的死亡/脱战不结算，actor 被销毁也保留纯数据会话，直到 Tag 或玩家死亡/换 pawn/切关。
 * 历史 Tag 读档只补图鉴，不补 Boss 次数或用时；没有当前进战会话的 Tag 不记挑战。没打死的会话由这几处收掉：玩家死亡（推迟一帧全丢：同帧 boss 后死仍算击杀）、
 * 普通死亡模式的 boss actor 被销毁（OnDestroyed 丢）、换 pawn / 切关。Tag 模式同名新 actor 进战会重开计时。
 * 排除：boss ASC 带 CharacterType.AI.ExcludeFromBossRecord（数据侧静态 tag，与 CharacterType.AI.Boss 同配在 ActorConfig、进战前就在）
 * → 进战时直接跳过：不开会话、不计挑战、不落盘。只在进战这一刻判，战斗中途才加的 tag 不影响本场。
 *
 * 时钟：与 PBZGameSystem 同口径的 World->GetTimeSeconds()（暂停不走、慢动作按缩放）直接差分；
 * 不调 UpdateGameTime()——它把增量截进 int64，多调一次就多丢一截小数。
 *
 * 生命周期：GameModeBuild（BP_GameMode_Build，每关一个）bindSaveTipExtension 起、ReceiveEndPlay 止；
 * 玩家 pawn 死亡复活复用同一 pawn，换 pawn（换角色）走 OnPossessedPawnChanged 重绑。
 * 会话 Map 只存纯 JS 值（key = actor 名），不持有 UE 对象（Rule #1 / #29）。
 *
 * 存档 JSON（两段同构，只差记录 key）——槽段 ObjectID "BossRecord"，key = "<周目>_<难度>"：
 *   { "<图鉴行名>": { "ClassPath": "...", "Records": { "0_2": { "BestTimeMs": 95370, "KillCount": 2, "AttemptCount": 5 } } } }
 * 账号段 __Advanced__["BossRecord"]，key = "<难度>"，附达成最快时的周目：
 *   { "<图鉴行名>": { "ClassPath": "...", "Records": { "2": { "BestTimeMs": 95370, "Cycle": 0, "KillCount": 7, "AttemptCount": 12 } } } }
 * 用时存整数毫秒（UE 的 JSON writer 会把 7.86 写成 7.8600000000000003，整数免浮点噪声）。
 * 落盘：槽段随下次任意存档；账号段每次变更（进战 / 击杀）立即 SaveAdvancedSaveGameNow，撞在途 master 写被拒就每秒重试。
 * 难度值 = EDifficultMode（0 辅助 / 1 简单 / 2 普通 / 3 困难 / 4 极难）。调试打印：控制台 PBZ.BossRecord.Dump / Clear（C++）。
 */
const SECTION_ID = "BossRecord"; // 槽段 ObjectID，同时也是 __Advanced__ 子对象 ID
const TAG_BOSS_IN_COMBAT = "GameplayEvent.InCombat.BossCombat";
const TAG_BOSS_OFF_COMBAT = "GameplayEvent.OffCombat.BossCombat";
const TAG_DEAD = "CharacterState.Dead";
const TAG_EXCLUDE_FROM_RECORD = "CharacterType.AI.ExcludeFromBossRecord"; // 数据侧「不记录」标记，定义在 Config/DefaultGameplayTags.ini
const CODEX_DT_PATH = "/Game/PBZContent/DataTable/DT_CodexEnemyDataTable.DT_CodexEnemyDataTable";
const PAWN_BIND_POLL_MS = 1000; // PlayerController 未就绪时的轮询间隔
const ACCOUNT_FLUSH_RETRY_MS = 1000; // 账号段落盘被在途 master 写拒绝后的重试间隔
const ACCOUNT_FLUSH_MAX_RETRIES = 10; // 仍被拒就交给下一次任意存档带出（数据已在 master 内存）
const DIFFICULTY_NAMES = ["辅助", "简单", "普通", "困难", "极难"]; // EDifficultMode 0..4
// 类路径归一化：去掉可能的 "Class'/Game/...'" 包裹 + 小写（Conv_SoftClassReferenceToString 与 GetPathName 两种来源对齐，
// 同 GA_Player_BuffTracker.normClassPath）。
function normalizeClassPath(raw) {
    if (!raw)
        return "";
    let inner = raw;
    let quoteStart = raw.indexOf("'");
    if (quoteStart >= 0) {
        let quoteEnd = raw.indexOf("'", quoteStart + 1);
        if (quoteEnd > quoteStart)
            inner = raw.substring(quoteStart + 1, quoteEnd);
    }
    return inner.toLowerCase();
}
// "/Pkg/Path/BP_X.BP_X_C" → "BP_X"（图鉴无行时的兜底 key，与行名约定同形）
function assetNameFromClassPath(classPath) {
    if (!classPath)
        return "";
    let dot = classPath.lastIndexOf(".");
    let name = dot >= 0 ? classPath.substring(dot + 1) : classPath;
    return name.endsWith("_C") ? name.substring(0, name.length - 2) : name;
}
// FJsonObjectWrapper → 纯 JS 对象（JsonToString 是 C++ 序列化出的合法 JSON，parse 不会抛；wrapper 无效则给空对象）
function wrapperToObject(wrapper) {
    if (!wrapper)
        return {};
    let okRef = (0, puerts_1.$ref)(false);
    let strRef = (0, puerts_1.$ref)("");
    UE.JSONUtility.JsonToString(wrapper, okRef, strRef);
    if (!(0, puerts_1.$unref)(okRef))
        return {};
    let str = (0, puerts_1.$unref)(strRef);
    if (!str)
        return {};
    let parsed = JSON.parse(str);
    if (!parsed || typeof parsed != "object" || Array.isArray(parsed))
        return {};
    return parsed;
}
// 纯 JS 对象 → FJsonObjectWrapper（失败返回 undefined，调用方跳过写入）
function objectToWrapper(root) {
    let okRef = (0, puerts_1.$ref)(false);
    let outRef = (0, puerts_1.$ref)(new UE.JsonObjectWrapper());
    UE.JSONUtility.ParseStringToJson(JSON.stringify(root), okRef, outRef);
    if (!(0, puerts_1.$unref)(okRef))
        return undefined;
    return (0, puerts_1.$unref)(outRef);
}
// GAS 异步任务取消。任务对象由 GameInstance 引用（RegisterWithGameInstance），直到 Cancel / 触发（OnlyTriggerOnce）才 EndAction 释放，
// 世界拆除时 GameMode EndPlay 阶段仍存活（PIE 停止实测）；触发后的任务在回调里同步 Cancel、不会留到 GC 之后。
// 注意 puerts 对已释放 wrapper 既不能访问成员也不能当参数传（IsValid(dead) 一样抛 "passing a invalid object"），
// 所以这里不做"先 IsValid 再 Cancel"的假守卫，只靠上述生命周期保证。
function cancelTask(task) {
    if (!task)
        return;
    task.Cancel();
}
/** 记录合并：attempt = AttemptCount+1；killMs>0 = KillCount+1 且 BestTimeMs 取 min（账号段更新 BestTimeMs 时同步写 Cycle）。 */
function mergeRecord(root, rowName, classPath, recordKey, attempt, killMs, cycleForBest) {
    let bossEntry = root[rowName];
    if (!bossEntry || typeof bossEntry != "object") {
        bossEntry = {};
        root[rowName] = bossEntry;
    }
    bossEntry.ClassPath = classPath;
    let records = bossEntry.Records;
    if (!records || typeof records != "object") {
        records = {};
        bossEntry.Records = records;
    }
    let record = records[recordKey];
    if (!record || typeof record != "object") {
        record = {};
        records[recordKey] = record;
    }
    if (attempt) {
        record.AttemptCount = (typeof record.AttemptCount == "number" ? record.AttemptCount : 0) + 1;
    }
    if (killMs > 0) {
        record.KillCount = (typeof record.KillCount == "number" ? record.KillCount : 0) + 1;
        let currentBest = typeof record.BestTimeMs == "number" ? record.BestTimeMs : -1;
        if (currentBest < 0 || killMs < currentBest) {
            record.BestTimeMs = killMs;
            if (cycleForBest >= 0)
                record.Cycle = cycleForBest;
        }
    }
}
class BossCombatRecorder {
    contextObject; // GameMode（world context）
    playerControllerBound; // 只记"绑过没有"，不缓存 PlayerController wrapper（拆世界时它先死，碰了就抛）
    onPossessedPawnChanged;
    pawnBindTimer; // 轮询 PlayerController 就绪（Rule #18：追踪 + 清理）
    inCombatTask;
    offCombatTask;
    playerDeadTask;
    sessions;
    playerDeadTimer; // 玩家死亡后的一帧宽限 timer（Rule #18）；0 = 无
    accountFlushTimer; // 账号段落盘重试 timer（Rule #18）；0 = 无
    accountFlushRetryCount;
    onPipelineTagsAdded;
    unlockTagByRowName; // 只缓存 tag 字符串，不持有 struct wrapper
    rowNameByClassPath; // 懒建：小写类路径 → 图鉴行名（只存字符串，不存 wrapper）
    start(contextObject) {
        if (!contextObject)
            return;
        this.contextObject = contextObject;
        try { require("../Mods/PBZPerilWarning").start(this, contextObject); }
        catch (e) { console.warn("[PerilWarning v0.6] startup: " + e); }
        this.sessions = new Map();
        this.pawnBindTimer = 0;
        this.playerDeadTimer = 0;
        this.accountFlushTimer = 0;
        this.accountFlushRetryCount = 0;
        this.playerControllerBound = false;
        this.bindEventPipeline();
        this.tryBindPlayerController();
        if (!this.playerControllerBound) {
            this.pawnBindTimer = setInterval(() => { this.tryBindPlayerController(); }, PAWN_BIND_POLL_MS);
        }
    }
    // 世界拆除（PIE 停 / 切关）时 PlayerController 可能先于 GameMode EndPlay 销毁——已死 wrapper 访问成员 / 当参数传
    // 都会抛并中断 GameModeBuild.ReceiveEndPlay（后面的清理全漏跑；AchievementProgression.stop 就是这么炸的）。
    // 所以不缓存 PC，这里按 world context 现取：还活着就解绑，已销毁就返回 null 跳过（委托随它一起没了）。
    stop() {
        try { require("../Mods/PBZPerilWarning").stop(this); }
        catch (e) { console.warn("[PerilWarning v0.6] shutdown: " + e); }
        if (this.pawnBindTimer) {
            clearInterval(this.pawnBindTimer);
            this.pawnBindTimer = 0;
        }
        this.clearAccountFlushRetry(); // 还在重试的那份数据已在 master 内存，随下一次任意存档带出
        this.unbindPawn();
        if (this.playerControllerBound && this.onPossessedPawnChanged && this.contextObject) {
            let playerController = UE.GameplayStatics.GetPlayerController(this.contextObject, 0);
            if (playerController)
                playerController.OnPossessedPawnChanged.Remove(this.onPossessedPawnChanged);
        }
        if (this.onPipelineTagsAdded && this.contextObject) {
            let pipeline = TsHelper_1.default.getWorldSubsystem(this.contextObject, UE.EventPipelineManager.StaticClass());
            if (pipeline)
                pipeline.OnWithSourceTagAdd.Remove(this.onPipelineTagsAdded);
        }
        this.onPipelineTagsAdded = undefined;
        this.unlockTagByRowName = undefined;
        this.onPossessedPawnChanged = undefined;
        this.playerControllerBound = false;
        this.rowNameByClassPath = undefined;
        this.contextObject = undefined;
    }
    // EventPipeline 只接实时广播；历史 tag 不结算击杀，没有进战会话也不造用时。
    // 不缓存 subsystem wrapper，拆世界时按 context 现取；handler 稳定引用用于解绑。
    bindEventPipeline() {
        let pipeline = TsHelper_1.default.getWorldSubsystem(this.contextObject, UE.EventPipelineManager.StaticClass());
        if (!pipeline)
            return;
        this.onPipelineTagsAdded = (_source, tags) => { this.onUnlockTagsAdded(tags); };
        pipeline.OnWithSourceTagAdd.Remove(this.onPipelineTagsAdded);
        pipeline.OnWithSourceTagAdd.Add(this.onPipelineTagsAdded);
    }
    onUnlockTagsAdded(tags) {
        if (!tags || !this.sessions || !this.contextObject)
            return;
        let completed = [];
        for (let [bossName, session] of this.sessions) {
            if (!session.unlockTag)
                continue;
            let tag = TsHelper_1.default.constructGameplayTag(session.unlockTag);
            if (UE.BlueprintGameplayTagLibrary.HasTag(tags, tag, true))
                completed.push(bossName);
        }
        // 先提取纯 JS key，再结算：finishSession 会重建会话 Map 并调用存档。
        for (let bossName of completed)
            this.finishSession(bossName, true);
    }
    // ---------------- 玩家绑定 ----------------
    // 绑 PlayerController 的 possess 事件（一次）+ 绑当前 pawn。可重入：PC 未就绪时由轮询反复调。
    tryBindPlayerController() {
        if (this.playerControllerBound)
            return;
        if (!this.contextObject)
            return;
        let playerController = UE.GameplayStatics.GetPlayerController(this.contextObject, 0);
        if (!playerController)
            return;
        this.playerControllerBound = true;
        // 换 pawn（重生换角色）→ 旧会话全丢、在新 pawn 上重绑（Rule #23 path A：dynamic multicast 裸 lambda，不 release）
        this.onPossessedPawnChanged = (_oldPawn, _newPawn) => { this.bindCurrentPawn(); };
        playerController.OnPossessedPawnChanged.Remove(this.onPossessedPawnChanged);
        playerController.OnPossessedPawnChanged.Add(this.onPossessedPawnChanged);
        if (this.pawnBindTimer) {
            clearInterval(this.pawnBindTimer);
            this.pawnBindTimer = 0;
        }
        this.bindCurrentPawn();
    }
    bindCurrentPawn() {
        this.unbindPawn();
        if (!this.contextObject)
            return;
        let pawn = UE.GameplayStatics.GetPlayerPawn(this.contextObject, 0);
        if (!pawn)
            return;
        // 进战 / 脱战：两条精确 tag 监听（与 HUD BossCombat 同款）。回调只拿 payload，不捕获 UE 对象（Rule #1）。
        let inCombatTask = UE.AbilityAsync_WaitGameplayEvent.WaitGameplayEventToActor(pawn, TsHelper_1.default.constructGameplayTag(TAG_BOSS_IN_COMBAT), false, true);
        inCombatTask.EventReceived.Add((payload) => { this.onBossEngaged(payload); });
        inCombatTask.Activate();
        this.inCombatTask = inCombatTask;
        let offCombatTask = UE.AbilityAsync_WaitGameplayEvent.WaitGameplayEventToActor(pawn, TsHelper_1.default.constructGameplayTag(TAG_BOSS_OFF_COMBAT), false, true);
        offCombatTask.EventReceived.Add((payload) => { this.onBossDisengaged(payload); });
        offCombatTask.Activate();
        this.offCombatTask = offCombatTask;
        // 玩家死亡 = 这次挑战失败，按玩家 Dead tag 清空全部会话。玩家仇恨 OnDead 会先给每个 boss 发一次活着的 OffCombat，
        // 那条路径只保留会话、不丢（等 boss Dead），所以丢弃全靠这里；死亡清理有时还绕过脱战事件（MusicSubsystem 实锤）。
        // 推迟一帧：同帧「玩家先死、boss 后死」（换命）时 boss 的 Dead tag 仍能在本帧内结算成击杀，不依赖委托调用顺序。
        let playerDeadTask = UE.AbilityAsync_WaitGameplayTagAdded.WaitGameplayTagAddToActor(pawn, TsHelper_1.default.constructGameplayTag(TAG_DEAD), false);
        playerDeadTask.Added.Add(() => { this.schedulePlayerDeadDiscard(); });
        playerDeadTask.Activate();
        this.playerDeadTask = playerDeadTask;
    }
    schedulePlayerDeadDiscard() {
        if (this.playerDeadTimer)
            return;
        this.playerDeadTimer = setTimeout(() => {
            this.playerDeadTimer = 0;
            this.discardAll("player dead");
        }, 0);
    }
    unbindPawn() {
        if (this.playerDeadTimer) {
            clearTimeout(this.playerDeadTimer);
            this.playerDeadTimer = 0;
        }
        this.discardAll("unbind");
        cancelTask(this.inCombatTask);
        this.inCombatTask = undefined;
        cancelTask(this.offCombatTask);
        this.offCombatTask = undefined;
        cancelTask(this.playerDeadTask);
        this.playerDeadTask = undefined;
    }
    // ---------------- 会话状态机 ----------------
    onBossEngaged(payload) {
        if (!payload)
            return;
        let boss = payload.Target;
        if (!boss)
            return;
        if (!this.sessions)
            return;
        let bossName = boss.GetName();
        // 同一 boss 再进战（活着脱战后又打回来；进战事件只在真插入仇恨表时发）：沿用原会话，不重置计时、不重复计挑战
        let existing = this.sessions.get(bossName);
        if (existing && !existing.actorDestroyed) {
            console.log(`[BossRecord] re-engaged ${existing.rowName} (${bossName}), continue session`);
            return;
        }
        if (existing)
            this.finishSession(bossName, false, "new actor with reused name");
        // 先解析图鉴基础行；配置 UnlockTag 时完全由剧情完成信号结算，不以死亡代替。
        let bossClass = boss.GetClass();
        if (!bossClass)
            return;
        let classPath = UE.KismetSystemLibrary.GetPathName(bossClass);
        let rowName = this.resolveCodexRowName(bossClass, classPath);
        let unlockTag = this.unlockTagByRowName ? (this.unlockTagByRowName.get(rowName) || "") : "";
        let bossAsc = UE.AbilitySystemBlueprintLibrary.GetAbilitySystemComponent(boss);
        // 未配剧情 Tag 时，已死 boss 的迟到进战事件不开会话。
        if (!unlockTag && bossAsc && bossAsc.HasMatchingGameplayTag(TsHelper_1.default.constructGameplayTag(TAG_DEAD)))
            return;
        // 数据侧标为「不记录」的 boss：不开会话、不计挑战、不落盘（tag 须在进战前就在 ASC 上，与 Boss tag 同一约束）
        if (bossAsc && bossAsc.HasMatchingGameplayTag(TsHelper_1.default.constructGameplayTag(TAG_EXCLUDE_FROM_RECORD))) {
            console.log(`[BossRecord] skip ${bossName}: excluded by tag`);
            return;
        }
        let session = {
            startTime: UE.GameplayStatics.GetTimeSeconds(this.contextObject),
            rowName: rowName,
            unlockTag: unlockTag,
            actorDestroyed: false,
            classPath: classPath,
            deadTask: undefined
        };
        // 先入 Map 再 Activate：WaitGameplayTag 在 tag 已存在时会在 Activate 内同步广播 Added
        this.sessions.set(bossName, session);
        if (!unlockTag) {
            let deadTask = UE.AbilityAsync_WaitGameplayTagAdded.WaitGameplayTagAddToActor(boss, TsHelper_1.default.constructGameplayTag(TAG_DEAD), true);
            session.deadTask = deadTask;
            deadTask.Added.Add(() => { this.finishSession(bossName, true); });
            deadTask.Activate();
        }
        // Tag 会话在 actor 被剧情销毁后仍等完成 Tag；普通死亡会话照旧丢弃。
        // 闭包只捕获名字；代理随 boss 回收，本类不持 actor wrapper（Rule #1 / #29）。
        boss.OnDestroyed.Add((_destroyed) => { this.onBossDestroyed(bossName); });
        this.writeRecords(rowName, classPath, true, 0);
        console.log(`[BossRecord] engaged ${rowName} (${bossName}) cycle=${this.getCycle()} diff=${this.getDifficulty()}`);
    }
    onBossDisengaged(payload) {
        if (!payload)
            return;
        let boss = payload.Target;
        if (!boss)
            return;
        if (!this.sessions)
            return;
        let bossName = boss.GetName();
        let session = this.sessions.get(bossName);
        if (!session)
            return;
        // 配置了剧情 Tag 的战斗，死亡/脱战都不能提前结算，用时持续到对应 Tag。
        if (session.unlockTag)
            return;
        // boss 死亡引发的脱战：此刻 ASC 已带 Dead tag（状态切换先加 tag 后广播）→ 击杀结算。
        let asc = UE.AbilitySystemBlueprintLibrary.GetAbilitySystemComponent(boss);
        let killed = !!asc && asc.HasMatchingGameplayTag(TsHelper_1.default.constructGameplayTag(TAG_DEAD));
        if (killed) {
            this.finishSession(bossName, true);
            return;
        }
        // 活着脱战：会话保留，进战时挂的 Dead 监听继续等——boss 之后加上 Dead（死亡过程中先脱战的）照样记击杀，
        // 用时算到加 Dead 那一刻。没打死的由玩家死亡 / boss 销毁 / 换 pawn / 切关各自的清理路径收掉。
        console.log(`[BossRecord] disengaged alive ${session.rowName} (${bossName}), keep waiting for Dead or UnlockTag`);
    }
    onBossDestroyed(bossName) {
        if (!this.sessions)
            return;
        let session = this.sessions.get(bossName);
        if (!session)
            return;
        if (session.unlockTag) {
            session.actorDestroyed = true;
            console.log(`[BossRecord] destroyed ${session.rowName} (${bossName}), keep waiting for ${session.unlockTag}`);
            return;
        }
        this.finishSession(bossName, false, "destroyed");
    }
    // 结算一条会话：删会话 + 取消死亡监听；killed 才写击杀记录。重复信号找不到会话即 no-op。
    finishSession(bossName, killed, discardReason = "") {
        if (!this.sessions)
            return;
        let session = this.sessions.get(bossName);
        if (!session)
            return;
        // 不用 Map.delete：PS5 quickjs blob 的 map_delete_record 缺摘链，删过的长寿 Map 再读写会撞野指针（Rule #8 / #26），
        // 会话表最多一两条，直接重建替换。
        let remaining = new Map();
        for (let [name, other] of this.sessions) {
            if (name != bossName)
                remaining.set(name, other);
        }
        this.sessions = remaining;
        cancelTask(session.deadTask);
        session.deadTask = undefined;
        if (!killed) {
            console.log(`[BossRecord] discard ${session.rowName} (${bossName}): ${discardReason}`);
            return;
        }
        let elapsed = UE.GameplayStatics.GetTimeSeconds(this.contextObject) - session.startTime;
        let killMs = Math.round(elapsed * 1000);
        if (killMs <= 0)
            return;
        this.writeRecords(session.rowName, session.classPath, false, killMs);
        console.log(`[BossRecord] killed ${session.rowName} (${bossName}) time=${(killMs / 1000).toFixed(2)}s cycle=${this.getCycle()} diff=${this.getDifficulty()}`);
    }
    discardAll(reason) {
        if (!this.sessions)
            return;
        if (this.sessions.size > 0)
            console.log(`[BossRecord] discard all (${this.sessions.size}): ${reason}`);
        for (let session of this.sessions.values()) {
            cancelTask(session.deadTask);
        }
        this.sessions = new Map(); // 重建替换而非 clear（Rule #8：PS5 quickjs map delete 坑）
    }
    // ---------------- 图鉴 key ----------------
    // 镜像 C++ UPBZCodexSubsystem::ResolveCodexClass：精确命中 → 父类回溯（bExcludeFromCodex 退出）→ 兜底类资产名。
    resolveCodexRowName(bossClass, classPath) {
        this.ensureCodexRowNames();
        let normalized = normalizeClassPath(classPath);
        if (this.rowNameByClassPath) {
            let exact = this.rowNameByClassPath.get(normalized);
            if (exact)
                return exact;
        }
        let ancestorRow = this.findNearestCodexAncestor(bossClass);
        if (ancestorRow)
            return ancestorRow;
        let fallback = assetNameFromClassPath(classPath);
        console.warn(`[BossRecord] no codex row for ${classPath}, fallback key=${fallback}`);
        return fallback;
    }
    // 子类 boss（图鉴里只有祖先行）：遍历图鉴行找最近的祖先类。一个类的全部祖先构成一条链，链上"最派生"的候选唯一，与遍历顺序无关；
    // 祖先类随子类加载必已驻留，.Get() 拿不到就不是祖先。与 C++ 同样只在 APBZCharacter_NPC 以下回溯（行类必须是它的真子类）。
    // 只在精确未命中时才跑（变体 boss），此时按值取一遍表：row / EnemyClass / UClass wrapper 都是临时的，不缓存任何 UE 对象。
    findNearestCodexAncestor(bossClass) {
        if (!this.rowNameByClassPath)
            return "";
        let cdo = bossClass.ClassDefaultObject;
        if (cdo && cdo.bExcludeFromCodex)
            return "";
        let codex = TsHelper_1.default.getWorldSubsystem(this.contextObject, UE.PBZCodexSubsystem.StaticClass());
        if (!codex)
            return "";
        let npcBaseClass = UE.PBZCharacter_NPC.StaticClass();
        let entries = codex.GetAllEnemyCodexEntries();
        let bestClass = undefined;
        let bestPath = "";
        for (let i = 0; i < entries.Num(); i++) {
            if (!entries.IsValidIndex(i))
                continue;
            let row = entries.GetRef(i);
            if (!row)
                continue;
            let rowClass = row.EnemyClass.Get();
            if (!rowClass || rowClass == npcBaseClass)
                continue;
            if (!UE.KismetMathLibrary.ClassIsChildOf(rowClass, npcBaseClass))
                continue;
            if (!UE.KismetMathLibrary.ClassIsChildOf(bossClass, rowClass))
                continue;
            if (!bestClass || UE.KismetMathLibrary.ClassIsChildOf(rowClass, bestClass)) {
                bestClass = rowClass;
                bestPath = normalizeClassPath(UE.KismetSystemLibrary.GetPathName(rowClass));
            }
        }
        if (!bestPath)
            return "";
        let rowName = this.rowNameByClassPath.get(bestPath);
        return rowName ? rowName : "";
    }
    // 图鉴表 → (归一化类路径 → 行名)。行名没有任何运行时接口暴露、且 8 行行名≠资产名，只能扫表；只缓存字符串。
    // 同条目别名（AliasEnemyClasses）也映射到认领它的行名，与 C++ ResolveCodexClass 一致：本身有行的类优先，别名其次。
    // DT 由 APBZCharacter_NPC::PreloadCodexTables 在 GameInstance 初始化时常驻，这里的 Load 命中已驻留对象（Rule #24 豁免）。
    ensureCodexRowNames() {
        if (this.rowNameByClassPath)
            return;
        this.rowNameByClassPath = new Map();
        this.unlockTagByRowName = new Map();
        let dataTable = UE.DataTable.Load(CODEX_DT_PATH);
        if (!dataTable)
            return;
        let rowNamesRef = (0, puerts_1.$ref)(UE.NewArray(UE.BuiltinName));
        UE.DataTableFunctionLibrary.GetDataTableRowNames(dataTable, rowNamesRef);
        let rowNames = (0, puerts_1.$unref)(rowNamesRef);
        let count = rowNames.Num();
        let aliasRowNames = [];
        for (let i = 0; i < count; i++) {
            if (!rowNames.IsValidIndex(i))
                continue;
            let rowName = rowNames.Get(i);
            if (!rowName)
                continue;
            let row = new UE.CodexEnemyRow();
            if (!UE.DataTableFunctionLibrary.Generic_GetDataTableRowFromName(dataTable, rowName, row))
                continue;
            let enemyClass = row.EnemyClass;
            if (!UE.KismetSystemLibrary.IsValidSoftClassReference(enemyClass))
                continue;
            let classPath = normalizeClassPath(UE.KismetSystemLibrary.Conv_SoftClassReferenceToString(enemyClass));
            if (!classPath)
                continue;
            if (!this.rowNameByClassPath.has(classPath))
                this.rowNameByClassPath.set(classPath, rowName.toString());
            // 可选字段兼容尚未重编的编辑器；只把名字缓存为纯 JS 字符串。
            let unlockTag = row.UnlockTag;
            if (unlockTag) {
                let tagName = UE.BlueprintGameplayTagLibrary.GetTagName(unlockTag);
                if (tagName && tagName != "None")
                    this.unlockTagByRowName.set(rowName.toString(), tagName.toString());
            }
            if (!row.AliasEnemyClasses)
                continue; // 旧编辑器二进制的行结构没有该字段
            // 循环条件持续使用父 struct，防止最后一次转换软类引用时父 row 被 V8 回收。
            for (let j = 0; j < row.AliasEnemyClasses.Num(); j++) {
                if (!row.AliasEnemyClasses.IsValidIndex(j))
                    continue;
                let aliasClass = row.AliasEnemyClasses.Get(j);
                let aliasPath = normalizeClassPath(UE.KismetSystemLibrary.Conv_SoftClassReferenceToString(aliasClass));
                if (aliasPath)
                    aliasRowNames.push([aliasPath, rowName.toString()]);
            }
        }
        // 别名在全部行登记完之后再补：别名撞上本身有行的类时让行优先；同一别名被多行认领时先到先得（同 C++）
        for (let [aliasPath, aliasRowName] of aliasRowNames) {
            if (!this.rowNameByClassPath.has(aliasPath))
                this.rowNameByClassPath.set(aliasPath, aliasRowName);
        }
    }
    // ---------------- 存档写入 ----------------
    getCycle() {
        let gameSystem = TsHelper_1.default.getGameSystem(this.contextObject);
        return gameSystem ? gameSystem.GetCycleCount() : -1; // 仅日志用；-1 = 取不到
    }
    getDifficulty() {
        return UE.PBZBlueprintFunctionLibrary.GetDiffcultMode(this.contextObject);
    }
    // attempt：两段 AttemptCount+1；killMs>0：两段 KillCount+1 / BestTimeMs 取 min。槽段随下次存档落盘，账号段每次都立即落盘。
    writeRecords(rowName, classPath, attempt, killMs) {
        if (!rowName)
            return;
        let saveLoad = TsHelper_1.default.getGameInstanceSubsystem(this.contextObject, UE.PBZSaveLoadSubsystem.StaticClass());
        if (!saveLoad)
            return;
        let gameSystem = TsHelper_1.default.getGameSystem(this.contextObject);
        if (!gameSystem) {
            console.warn(`[BossRecord] no PBZGameSystem, skip record for ${rowName}`); // 没有周目真值就不伪造 key
            return;
        }
        let cycle = gameSystem.GetCycleCount();
        let difficulty = this.getDifficulty();
        // 当前存档槽：key = 周目_难度
        let slotRef = (0, puerts_1.$ref)(new UE.JsonObjectWrapper());
        saveLoad.GetDirtySectionCopy(SECTION_ID, slotRef);
        let slotRoot = wrapperToObject((0, puerts_1.$unref)(slotRef));
        mergeRecord(slotRoot, rowName, classPath, `${cycle}_${difficulty}`, attempt, killMs, -1);
        let slotWrapper = objectToWrapper(slotRoot);
        if (slotWrapper)
            saveLoad.SaveObjectData(SECTION_ID, slotWrapper);
        // 账号级：key = 难度，BestTime 更新时记下周目
        let accountRef = (0, puerts_1.$ref)(new UE.JsonObjectWrapper());
        saveLoad.GetAdvancedObjectJsonWrapper(SECTION_ID, accountRef);
        let accountRoot = wrapperToObject((0, puerts_1.$unref)(accountRef));
        mergeRecord(accountRoot, rowName, classPath, `${difficulty}`, attempt, killMs, cycle);
        let accountWrapper = objectToWrapper(accountRoot);
        if (!accountWrapper)
            return;
        saveLoad.SaveAdvancedObjectDataAndSync(SECTION_ID, accountWrapper);
        this.flushAccountSave(saveLoad);
    }
    // 账号段立即落盘（进战 / 击杀都低频，退游戏不丢）。返回 false = 撞在途 master 写：数据已 AndSync 在 master 内存，但在途那次
    // 写的快照不含它——挂重试直到受理（同 PBZEntitlementSubsystem::PersistEntitlementRecords）。受理的写带的是当前全量内存态，
    // 所以任何一次受理都清掉挂着的重试。
    flushAccountSave(saveLoad) {
        if (saveLoad.SaveAdvancedSaveGameNow()) {
            this.clearAccountFlushRetry();
            return;
        }
        if (this.accountFlushTimer)
            return; // 已在重试
        console.log(`[BossRecord] account flush deferred: master write in flight, retry every ${ACCOUNT_FLUSH_RETRY_MS}ms`);
        this.accountFlushRetryCount = 0;
        this.accountFlushTimer = setInterval(() => { this.retryAccountFlush(); }, ACCOUNT_FLUSH_RETRY_MS);
    }
    retryAccountFlush() {
        if (!this.contextObject) {
            this.clearAccountFlushRetry();
            return;
        }
        let saveLoad = TsHelper_1.default.getGameInstanceSubsystem(this.contextObject, UE.PBZSaveLoadSubsystem.StaticClass());
        if (saveLoad && saveLoad.SaveAdvancedSaveGameNow()) {
            console.log(`[BossRecord] account flush dispatched after ${this.accountFlushRetryCount + 1} retry(ies)`);
            this.clearAccountFlushRetry();
            return;
        }
        this.accountFlushRetryCount++;
        if (this.accountFlushRetryCount < ACCOUNT_FLUSH_MAX_RETRIES)
            return;
        console.warn(`[BossRecord] account flush still refused after ${this.accountFlushRetryCount} retries, left to the next save`);
        this.clearAccountFlushRetry();
    }
    clearAccountFlushRetry() {
        if (this.accountFlushTimer) {
            clearInterval(this.accountFlushTimer);
            this.accountFlushTimer = 0;
        }
        this.accountFlushRetryCount = 0;
    }
}
exports.BossCombatRecorder = BossCombatRecorder;
// ---------------- 调试入口（DebugObj.ts 菜单 / 控制台 PBZ.BossRecord.* 的 TS 同款）----------------
/** 读两段记录（纯 JS 对象；子系统缺席返回空对象）。 */
function readBossRecordRoots(contextObject) {
    let saveLoad = TsHelper_1.default.getGameInstanceSubsystem(contextObject, UE.PBZSaveLoadSubsystem.StaticClass());
    if (!saveLoad)
        return { slot: {}, account: {} };
    let slotRef = (0, puerts_1.$ref)(new UE.JsonObjectWrapper());
    saveLoad.GetDirtySectionCopy(SECTION_ID, slotRef);
    let accountRef = (0, puerts_1.$ref)(new UE.JsonObjectWrapper());
    saveLoad.GetAdvancedObjectJsonWrapper(SECTION_ID, accountRef);
    return { slot: wrapperToObject((0, puerts_1.$unref)(slotRef)), account: wrapperToObject((0, puerts_1.$unref)(accountRef)) };
}
/** 清两段记录：槽段随下次存档落盘，账号段立即尝试落盘。返回 { found: 找到存档子系统, flushed: 账号段本次已受理写盘 }。 */
function clearBossRecords(contextObject) {
    let saveLoad = TsHelper_1.default.getGameInstanceSubsystem(contextObject, UE.PBZSaveLoadSubsystem.StaticClass());
    if (!saveLoad)
        return { found: false, flushed: false };
    let emptySlot = objectToWrapper({});
    if (emptySlot)
        saveLoad.SaveObjectData(SECTION_ID, emptySlot);
    let emptyAccount = objectToWrapper({});
    if (!emptyAccount)
        return { found: true, flushed: false };
    saveLoad.SaveAdvancedObjectDataAndSync(SECTION_ID, emptyAccount);
    // false = 撞在途 master 写：内存态已清、随后续任意存档带出（与记录器击杀落盘同一语义）
    let flushed = saveLoad.SaveAdvancedSaveGameNow();
    return { found: true, flushed: flushed === true };
}
function difficultyLabel(difficulty) {
    let name = DIFFICULTY_NAMES[difficulty];
    return name ? `${difficulty}${name}` : `${difficulty}`;
}
function formatMs(ms) {
    return (ms / 1000).toFixed(2) + "s";
}
// 一条记录 → 一行："周目0 难度3困难: 最快 95.37s 击杀2 挑战5"（账号段 key 只有难度，最快时的周目括注）
function formatRecordLine(recordKey, record, accountStyle) {
    let best = typeof record.BestTimeMs == "number" ? formatMs(record.BestTimeMs) : "-";
    let kills = typeof record.KillCount == "number" ? record.KillCount : 0;
    let attempts = typeof record.AttemptCount == "number" ? record.AttemptCount : 0;
    if (accountStyle) {
        let cycleNote = typeof record.Cycle == "number" ? `(周目${record.Cycle})` : "";
        return `  难度${difficultyLabel(Number(recordKey))}: 最快 ${best}${cycleNote} 击杀${kills} 挑战${attempts}`;
    }
    let parts = recordKey.split("_");
    let cycle = parts.length > 0 ? parts[0] : "?";
    let difficulty = parts.length > 1 ? Number(parts[1]) : -1;
    return `  周目${cycle} 难度${difficultyLabel(difficulty)}: 最快 ${best} 击杀${kills} 挑战${attempts}`;
}
function formatRootLines(root, accountStyle) {
    let lines = [];
    let rowNames = Object.keys(root).sort();
    for (let rowName of rowNames) {
        let bossEntry = root[rowName];
        if (!bossEntry || typeof bossEntry != "object")
            continue;
        lines.push(rowName);
        let records = bossEntry.Records;
        if (!records || typeof records != "object")
            continue;
        for (let recordKey of Object.keys(records).sort()) {
            let record = records[recordKey];
            if (!record || typeof record != "object")
                continue;
            lines.push(formatRecordLine(recordKey, record, accountStyle));
        }
    }
    return lines;
}
/** 两段记录 → 可读文本（Debug 菜单打印面板 / 日志用）。 */
function formatBossRecordReport(contextObject) {
    let roots = readBossRecordRoots(contextObject);
    let slotLines = formatRootLines(roots.slot, false);
    let accountLines = formatRootLines(roots.account, true);
    let slotBody = slotLines.length > 0 ? slotLines.join("\n") : "(无)";
    let accountBody = accountLines.length > 0 ? accountLines.join("\n") : "(无)";
    return "=== Boss 击杀记录 · 当前存档（周目_难度）===" + "\n" + slotBody
        + "\n" + "=== 账号级（按难度，括注最快时的周目）===" + "\n" + accountBody;
}
//# sourceMappingURL=BossCombatRecorder.js.map