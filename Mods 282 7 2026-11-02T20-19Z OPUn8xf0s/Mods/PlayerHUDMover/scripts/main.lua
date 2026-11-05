local MOD_DIR
do
    for pat in package.path:gmatch("[^;]+") do
        local dir = pat:match("^(.*)[?][%.]lua$")
        if dir and dir:find("PlayerHUDMover", 1, true) then
            MOD_DIR = dir
            break
        end
    end
end

local cfg = require("config")


local uiLang = "en"
if type(cfg.lang) == "string" and cfg.lang == "zh" then
    uiLang = "zh"
end

local STR = {
    zh = {
        menuTitle = "PlayerHUDMoverMod",
        sec_title = "PlayerHud设置",
        tip = "按面板按键打开本面板 (默认 F8, 可在设置页修改) · 应用立即生效(不保存) · 保存配置写入 config.lua",
        st_wait = "状态: 等待血条出现 / 点应用",
        chk_enabled = "启用功能 (enabled)",
        chk_hideFrame = "隐藏原框并显示填充条 (hideFrame)",
        chk_showBorder = "保留原版边框 (showBorder)",
        lbl_x = "横向 X (px)",
        lbl_y = "纵向 Y (0=默认)",
        lbl_scale = "缩放",
        btn_apply = "应用",
        btn_save = "保存配置",
        btn_reset = "恢复默认",
        st_applied = "已应用: X=%d Y=%d 缩放=%.2f | 处理 %d 个血条",
        st_nobar = "未找到血条 — 请先进入有 HUD 的游戏内场景",
        st_applyfail = "应用失败: %s",
        st_save_ok = "已保存到 config.lua (重启后生效)",
        st_save_nopath = "找不到 config.lua 路径",
        st_save_fail = "保存失败: %s",
        st_reset = "已恢复默认并应用 (未保存)",
        set_pageHint = "本页修改会自动写入 config.lua；按键立即生效，语言需点应用。",
        set_keyHint = "打开本面板的按键 (选择后立即生效)",
        set_langHint = "面板显示语言 (切换需点“应用 (保存)”)",
        sec_lang_title = "语言",
        lbl_lang = "语言 / Language",
        btn_applyLang = "应用 (保存)",
        st_langNow = "当前语言: %s",
        st_langSaved = "当前语言: %s (已保存)",
        nudge_hint = "单击 +/− 按钮按 5 步调整 (缩放为 0.1 步)；双击按住不放可连续增减，松开即停。",
        lbl_key = "面板按键 (key)",
        st_keyNow = "当前按键: %s",
        st_keySaved = "当前按键: %s (已保存)",
        chrome_dock = "窗口位置",
        side_top = "上",
        side_bottom = "下",
        side_left = "左",
        side_right = "右",
    },
    en = {
        menuTitle = "PlayerHUDMoverMod",
        sec_title = "PlayerHudSettings",
        tip = "Open this panel with the panel hotkey (default F8, changeable in Settings) · Apply takes effect immediately (not saved) · Save config writes config.lua",
        st_wait = "Status: waiting for HP bar / click Apply",
        chk_enabled = "Enabled (enabled)",
        chk_hideFrame = "Hide original frame, show fill bars (hideFrame)",
        chk_showBorder = "Keep the game's bar border (showBorder)",
        lbl_x = "Screen X (px)",
        lbl_y = "Screen Y (0 = default)",
        lbl_scale = "Scale",
        btn_apply = "Apply",
        btn_save = "Save config",
        btn_reset = "Reset defaults",
        st_applied = "Applied: X=%d Y=%d scale=%.2f | %d bar(s) processed",
        st_nobar = "No HP bar found — enter an in-game scene with the HUD first",
        st_applyfail = "Apply failed: %s",
        st_save_ok = "Saved to config.lua (takes effect on restart)",
        st_save_nopath = "config.lua path not found",
        st_save_fail = "Save failed: %s",
        st_reset = "Defaults restored and applied (not saved)",
        set_pageHint = "Changes on this page are saved to config.lua automatically; the hotkey applies instantly, language needs Apply.",
        set_keyHint = "Key that opens this panel (applies immediately)",
        set_langHint = "Panel display language (press Apply to switch)",
        sec_lang_title = "Language",
        lbl_lang = "Language",
        btn_applyLang = "Apply (save)",
        st_langNow = "Current language: %s",
        st_langSaved = "Current language: %s (saved)",
        nudge_hint = "Click a +/− button to adjust by 5 (0.1 for scale); double-click and hold it down to adjust continuously — release to stop.",
        lbl_key = "Panel hotkey (key)",
        st_keyNow = "Current hotkey: %s",
        st_keySaved = "Current hotkey: %s (saved)",
        chrome_dock = "Window position",
        side_top = "top",
        side_bottom = "bottom",
        side_left = "left",
        side_right = "right",
    },
}

local function T(key)
    local d = STR[uiLang] or STR.zh
    return d[key] or STR.zh[key] or key
end

local function TF(key, ...)
    local s = T(key)
    if select("#", ...) == 0 then
        return s
    end
    return string.format(s, ...)
end

local function LangName(lang)
    if lang == "en" then
        return "English"
    end
    return "中文"
end

local function ChromeLangFor(lang)
    if lang == "zh" then
        return {
            dockLabel = STR.zh.chrome_dock,
            sides = { top = "上", bottom = "下", left = "左", right = "右" },
        }
    end
    return {
        dockLabel = STR.en.chrome_dock,
        sides = { top = "top", bottom = "bottom", left = "left", right = "right" },
    }
end

local function TabsForLang()
    if uiLang == "en" then
        return { "Function", "Settings" }
    end
    return { "功能", "设置" }
end

local function TabName(cat)
    if uiLang == "en" then
        local m = { func = "Function", lang = "Settings" }
        return m[cat] or cat
    end
    local m = { func = "功能", lang = "设置" }
    return m[cat] or cat
end


local function screenSize()
    local ok, cdo = pcall(StaticFindObject, "Default__PBZSettingsLocal")
    if ok and cdo and cdo:IsValid() then
        local w = cdo.ResolutionSizeX
        local h = cdo.ResolutionSizeY
        if type(w) == "number" and type(h) == "number" and w > 0 and h > 0 then
            return w, h
        end
    end
    return 1280, 720
end

local ART_X_OFFSET = 800
local DEFAULT_BOTTOM_MARGIN = 129

local function targetOffset(W, H)
    local tx
    if not cfg.x or cfg.x == 0 then
        tx = ART_X_OFFSET
    else
        tx = cfg.x - (W / 2 - ART_X_OFFSET)
    end
    local ty
    if not cfg.y or cfg.y == 0 then
        ty = 0
    else
        ty = cfg.y - (H - DEFAULT_BOTTOM_MARGIN)
    end
    return tx, ty
end

local function scaleFromCfg()
    local s = cfg.scale
    if type(s) == "table" then
        local sx = (type(s.x) == "number" and s.x) or (type(s[1]) == "number" and s[1]) or 1
        local sy = (type(s.y) == "number" and s.y) or (type(s[2]) == "number" and s[2]) or sx
        if sx == 0 then sx = 1 end
        if sy == 0 then sy = 1 end
        return sx, sy
    end
    if type(s) == "number" and s ~= 0 then
        return s, s
    end
    return 1, 1
end


local function objUsable(o)
    if not (o and o:IsValid()) then
        return false
    end
    local ok = pcall(function()
        return o:GetFullName()
    end)
    return ok
end


local function pickRoot(inst)
    local cands = {}
    local rw = inst.RootWidget
    if rw then
        cands[#cands + 1] = rw
    end
    local tree = inst.WidgetTree
    if tree and tree:IsValid() then
        local trw = tree.RootWidget
        if trw then
            cands[#cands + 1] = trw
        end
    end
    for i = 1, #cands do
        if objUsable(cands[i]) then
            return cands[i]
        end
    end
    return nil
end

local function findLiveHPBarRoots(reason)
    local roots = {}
    local t0 = os.clock()
    local ok, list = pcall(FindAllOf, "WB_PlayerHPBar_V1_C")
    if not ok or not list then
        return roots
    end
    for i = 1, #list do
        local inst = list[i]
        if inst and inst:IsValid() then
            local full = ""
            pcall(function() full = inst:GetFullName() end)
            if full:find("Transient") then
                local root = pickRoot(inst)
                if root then
                    roots[#roots + 1] = { root = root, name = full, inst = inst }
                end
            end
        end
    end
    return roots
end

local function purePath(s)
    if type(s) ~= "string" then
        return ""
    end
    local p = s:match("^%S+%s(.*)$")
    return p or s
end


local function resolveChildren(root, marker, items)
    local out = {}
    local missing = {}
    for i = 1, #items do
        local item = items[i]
        local ok, w = pcall(function()
            return root:FindChildByName(item.name)
        end)
        if ok and w and w:IsValid() then
            out[item.key] = w
        else
            missing[#missing + 1] = item
        end
    end
    if #missing > 0 then
        local prefix = purePath(marker)
        local want = {}
        for i = 1, #missing do
            want[missing[i].name] = missing[i].key
        end
        local ok2, list = pcall(FindAllOf, "Image")
        if ok2 and list then
            for i = 1, #list do
                local w = list[i]
                if w and w:IsValid() then
                    local full = ""
                    pcall(function() full = w:GetFullName() end)
                    if full:find(prefix, 1, true) then
                        local short = full:match("([^%.]+)$")
                        local key = short and want[short]
                        if key and not out[key] then
                            out[key] = w
                        end
                    end
                end
            end
        end
    end
    return out
end

local FILL_Y = 0.45
local YELLOW_R, YELLOW_G, YELLOW_B = 1, 0.78, 0.22
-- With hideFrame on, the game's own bar backgrounds (Image_HpBG / Image_ShaChiBarBG) stay
-- visible but are tinted to this dark colour, so the lost part of HP / Sha-chi shows as a
-- black gap. They already sit behind the fills in the game's layout and match their size.
local TRACK_COLOR = { R = 0, G = 0, B = 0, A = 0.65 }
-- How often the mover fills are re-scaled to the current HP / Sha-chi ratio.
local FILL_UPDATE_MS = 100

local function setRenderVec(w, fn, x, y)
    local ok = pcall(function()
        w[fn](w, { X = x, Y = y })
    end)
    if ok then
        return true
    end
    ok = pcall(function()
        w[fn](w, FVector2D.New(x, y))
    end)
    return ok
end

local function makeRect(outer, name, r, g, b, a)
    a = a or 1
    local ok, img = pcall(NewObject, "/Script/UMG.Image", outer, name)
    if not (ok and (img and img:IsValid())) then
        return nil
    end
    local okC = pcall(function()
        img.ColorAndOpacity = { R = r, G = g, B = b, A = a }
    end)
    if not okC then
        pcall(function()
            img:SetColorAndOpacity({ SpecifiedColor = { R = r, G = g, B = b, A = a } })
        end)
    end
    return img
end

local function addOverlayChild(panel, img)
    local ok = pcall(function()
        panel:AddChildToOverlay(img)
    end)
    if ok then
        return true
    end
    return pcall(function()
        panel:AddChild(img)
    end)
end

local function makeFill(root, name, r, g, b, pivotY, a)
    local rect = makeRect(root, name, r, g, b, a)
    if not (rect and rect:IsValid() and addOverlayChild(root, rect)) then
        return nil
    end
    setRenderVec(rect, "SetRenderTransformPivot", 0, pivotY)
    local slot = rect.Slot
    if slot and slot:IsValid() then
        pcall(function()
            slot.HorizontalAlignment = 1
            slot.VerticalAlignment = 1
        end)
    end
    setRenderVec(rect, "SetRenderScale", 0, FILL_Y)
    return rect
end


local function findChild(root, name)
    local ok, w = pcall(function()
        return root:FindChildByName(name)
    end)
    if ok and w and w:IsValid() then
        return w
    end
    return nil
end

local function getOrCreateFill(root, name, r, g, b, pivotY, a)
    return findChild(root, name) or makeFill(root, name, r, g, b, pivotY, a)
end

local MOVER_WIDGETS = { "PBZMoverHPFill", "PBZMoverShFill" }

local function readColor(img)
    local ok, c = pcall(function()
        local v = img.ColorAndOpacity
        return { R = v.R, G = v.G, B = v.B, A = v.A }
    end)
    if ok and c and type(c.R) == "number" then
        return c
    end
    return nil
end

local function setImageColor(img, c)
    -- UImage::SetColorAndOpacity(FLinearColor) also refreshes the live Slate widget.
    local ok = pcall(function()
        img:SetColorAndOpacity(c)
    end)
    if not ok then
        pcall(function()
            img.ColorAndOpacity = c
        end)
    end
end

local bgOriginalColor = {}

-- hideFrame on: show the bar background tinted dark. Off: restore its original colour.
local function applyTrack(img, asTrack)
    local okN, key = pcall(function()
        return img:GetFullName()
    end)
    if not okN then
        return
    end
    if asTrack then
        if not bgOriginalColor[key] then
            bgOriginalColor[key] = readColor(img) or { R = 1, G = 1, B = 1, A = 1 }
        end
        setImageColor(img, TRACK_COLOR)
    elseif bgOriginalColor[key] then
        setImageColor(img, bgOriginalColor[key])
        bgOriginalColor[key] = nil
    end
end

local function setMoverOpacity(root, opacity)
    for _, name in ipairs(MOVER_WIDGETS) do
        local w = findChild(root, name)
        if w and w.RenderOpacity ~= opacity then
            pcall(function()
                w:SetRenderOpacity(opacity)
            end)
        end
    end
end

local function readRatio(inst, prop)
    if not (inst and inst:IsValid()) then
        return nil
    end
    local ok, v = pcall(function()
        return inst[prop]
    end)
    if ok and type(v) == "number" then
        return v
    end
    return nil
end

local function clamp01(v)
    if type(v) ~= "number" then
        return nil
    end
    if v < 0 then
        return 0
    end
    if v > 1 then
        return 1
    end
    return v
end

local function resetRootTransform(root)
    local okT = pcall(function()
        root:SetRenderTranslation({ X = 0, Y = 0 })
    end)
    if not okT then
        pcall(function()
            root:SetRenderTranslation(FVector2D.New(0, 0))
        end)
    end
    local okS = pcall(function()
        root:SetRenderScale({ X = 1, Y = 1 })
    end)
    if not okS then
        pcall(function()
            root:SetRenderTransform(FTransform2D.New(0, 0, 1, 1))
        end)
    end
end

local appliedOnce = false
-- HP bars handled by the last doOneShot; fillLoop keeps their mover fills in sync.
local liveBars = {}

-- Scale each mover fill to the current ratio so it shrinks with HP / Sha-chi and
-- uncovers the dark track. Only touches the widget when the ratio actually changed.
local function updateFills()
    for i = 1, #liveBars do
        local e = liveBars[i]
        for _, f in ipairs { { "hpFill", "HPBarWhiteRatio", "hpLast" }, { "shFill", "ShachiBarRatio", "shLast" } } do
            local fill = e[f[1]]
            if fill and fill:IsValid() then
                local ratio = clamp01(readRatio(e.inst, f[2]))
                if ratio and ratio ~= e[f[3]] and setRenderVec(fill, "SetRenderScale", ratio, FILL_Y) then
                    e[f[3]] = ratio
                end
            end
        end
    end
end


local function doOneShot(reason)
    local roots = findLiveHPBarRoots(reason)
    if #roots == 0 then
        return false, 0
    end

    if cfg.enabled == false then
        for i = 1, #roots do
            resetRootTransform(roots[i].root)
        end
        appliedOnce = true
        return true, #roots
    end

    local W, H = screenSize()
    local tx, ty = targetOffset(W, H)
    local sx, sy = scaleFromCfg()
    local hide = cfg.hideFrame ~= false

    for i = 1, #roots do
        local entry = roots[i]
        local root = entry.root

        
        local okT = pcall(function()
            root:SetRenderTranslation({ X = tx, Y = ty })
        end)
        if not okT then
            okT = pcall(function()
                root:SetRenderTranslation(FVector2D.New(tx, ty))
            end)
        end
        if okT then
            local okS = pcall(function()
                root:SetRenderScale({ X = sx, Y = sy })
            end)
            if not okS then
                pcall(function()
                    root:SetRenderTransform(FTransform2D.New(tx, ty, sx, sy))
                end)
            end
        end

        
        local kids = resolveChildren(root, entry.name, {
            { key = "frame", name = "Image_OverallBG" },
            { key = "hpBG", name = "Image_HpBG" },
            { key = "shBG", name = "Image_ShaChiBarBG" },
        })
        -- The game's outer frame (Image_OverallBG) draws the bar border; hideFrame hides it
        -- unless showBorder is on. The HP / Sha-chi backgrounds stay visible and become the
        -- dark track behind the fills.
        local hideBorder = hide and cfg.showBorder == false
        for _, key in ipairs { "frame", "hpBG", "shBG" } do
            local w = kids[key]
            if w and w:IsValid() then
                local target = (hideBorder and key == "frame") and 0 or 1
                local cur = w.RenderOpacity
                if type(cur) ~= "number" or cur ~= target then
                    pcall(function()
                        w:SetRenderOpacity(target)
                    end)
                end
                if key ~= "frame" then
                    applyTrack(w, hide)
                end
            end
        end


        if hide then
            setMoverOpacity(root, 1)
            entry.hpFill = getOrCreateFill(root, "PBZMoverHPFill", 1, 1, 1, 0)
            entry.shFill = getOrCreateFill(root, "PBZMoverShFill", YELLOW_R, YELLOW_G, YELLOW_B, 1)
        else
            setMoverOpacity(root, 0)
        end
    end
    liveBars = hide and roots or {}
    updateFills()
    appliedOnce = true
    return true, #roots
end

local PINS = {}
local BAR_WBP_PKG = "/Game/PBZContent/UI/FrontEnd/WB_PlayerHPBar_V1.WB_PlayerHPBar_V1_C"
local HOOK_BAR = BAR_WBP_PKG .. ":Construct"

local hookedBar = false
local frames = 0
local refreshPending = false


local function afterTicks(ticks, fn)
    local function step()
        ticks = ticks - 1
        if ticks > 0 then
            ExecuteInGameThread(step)
            return
        end
        pcall(fn)
    end
    ExecuteInGameThread(step)
end


local function delayMs(ms, fn)
    if type(ExecuteInGameThreadWithDelay) == "function" then
        ExecuteInGameThreadWithDelay(ms, fn)
    else
        afterTicks(math.max(1, math.ceil(ms / 16.67)), fn)
    end
end

local function fillLoop()
    if #liveBars > 0 and cfg.enabled ~= false and cfg.hideFrame ~= false then
        pcall(updateFills)
    end
    delayMs(FILL_UPDATE_MS, fillLoop)
end
delayMs(FILL_UPDATE_MS, fillLoop)

local function onBarConstructed()
    if refreshPending then
        return
    end
    refreshPending = true
    afterTicks(15, function()
        refreshPending = false
        doOneShot("hook")
    end)
end

local function tryHook()
    if not hookedBar then
        local ok = pcall(RegisterHook, HOOK_BAR, onBarConstructed)
        if ok then
            hookedBar = true
        end
    end
    if hookedBar then
        PINS[tryHook] = nil
        return
    end
    frames = frames + 1
    if frames >= 60 * 60 then
        PINS[tryHook] = nil
        return
    end
    PINS[tryHook] = true
    ExecuteInGameThread(tryHook)
end

PINS[tryHook] = true
ExecuteInGameThread(tryHook)


local function watchdog()
    if not appliedOnce then
        pcall(doOneShot, "watchdog")
    end
    if not appliedOnce then
        afterTicks(60 * 30, watchdog)
    end
end

afterTicks(60 * 5, watchdog)


local function killShell(w)
    pcall(function() w:SetVisibility(2) end)
    pcall(function() w:RemoveFromParent() end)
    local how = "仅摘除(未能销毁)"
    local okD = pcall(function() w:Destroy() end)
    if okD then
        how = "Destroy"
    else
        local okG = pcall(function() w:MarkAsGarbage() end)
        if okG then
            how = "MarkAsGarbage"
        end
    end
    
    local okC, kids = pcall(function() return w:GetChildren() end)
    if okC and type(kids) == "table" then
        for k = 1, #kids do
            pcall(function() kids[k]:Destroy() end)
        end
    end
    return how
end

local function cleanupStaleMenuShells()
    local function run()
        local removed = 0
        pcall(function()
            local roots = FindAllOf("UserWidget") or {}
            for i = 1, #roots do
                local w = roots[i]
                if w and w:IsValid() then
                    local full = ""
                    pcall(function() full = w:GetFullName() end)
                    if full:find("ModMenu_Root_PlayerHUDMover", 1, true) then
                        local how = killShell(w)
                        removed = removed + 1
                    end
                end
            end
        end)
        pcall(function()
            local okUEH, UEHelpers = pcall(require, "UEHelpers.UEHelpers")
            if okUEH and UEHelpers then
                local pc = UEHelpers.GetPlayerController()
                if pc then
                    pcall(function() UEHelpers.SetInputMode_GameOnly(pc, false) end)
                    pcall(function() pc:SetShowMouseCursor(false) end)
                    pcall(function() pc:SetIgnoreLookInput(false) end)
                end
            end
        end)
    end
    if type(ExecuteInGameThreadWithDelay) == "function" then
        ExecuteInGameThreadWithDelay(50, run)
    else
        afterTicks(3, run)
    end
end

cleanupStaleMenuShells()


local function findSharedDir()
    for entry in package.path:gmatch("[^;]+") do
        local d = entry:match("^(.*)[/\\]shared[/\\][?][/][?][%.]lua$")
            or entry:match("^(.*)[/\\]shared[/\\][?][%.]lua$")
        if d and d:lower():find("ue4ss", 1, true) then
            return d .. "/shared"
        end
    end
    return nil
end

local function loadModMenu()
    local sharedDir = findSharedDir()
    local bundlePath = sharedDir and (sharedDir .. "/ModMenu/ModMenu.lua") or nil
    local probe = "?"
    if bundlePath then
        local f = io.open(bundlePath, "r")
        probe = (f ~= nil) and "exists" or "missing"
        if f then
            f:close()
        end
    end

    
    local ok, m = pcall(require, "ModMenu.ModMenu")
    if ok and type(m) == "table" then
        return m
    end

    
    if bundlePath then
        local f = io.open(bundlePath, "r")
        if f then
            local src = f:read("*a")
            f:close()
            local okL, chunk = pcall(load, src or "", bundlePath)
            if okL then
                local okR, r = pcall(chunk)
                if okR and type(r) == "table" then
                    package.loaded["ModMenu.ModMenu"] = r
                    return r
                end
            end
        end
    end
    
    return nil
end

local ModMenu = loadModMenu()

local SEC = "PlayerHUDMover"


local INST = SEC .. "_" .. os.time() .. "_" .. math.floor(os.clock() * 1000)
local SEC_LANG = "Lang"
local SEC_KEY = "Key"    
local RANGE = {
    x     = { lo = 0, hi = 2560, step = 5, int = true },
    y     = { lo = 0, hi = 1440, step = 5, int = true },
    scale = { lo = 0.5, hi = 4, step = 0.1, int = false },
}
local DEFAULTS = { x = 520, y = 0, scale = 2, enabled = true, hideFrame = true, showBorder = true, key = "F8" }


local KEY_OPTIONS = {
    { id = "F1", label = "F1" },
    { id = "F2", label = "F2" },
    { id = "F3", label = "F3" },
    { id = "F4", label = "F4" },
    { id = "F5", label = "F5" },
    { id = "F6", label = "F6" },
    { id = "F7", label = "F7" },
    { id = "F8", label = "F8" },
    { id = "F9", label = "F9" },
    { id = "F10", label = "F10" },
    { id = "F11", label = "F11" },
    { id = "F12", label = "F12" },
}
local KEY_SET = {}
local KEY_LABEL = {}
for _, o in ipairs(KEY_OPTIONS) do
    KEY_SET[o.id] = true
    KEY_LABEL[o.id] = o.label
end
local function KeyFor(id)
    if type(id) ~= "string" or not KEY_SET[id] then
        return nil
    end
    if id:match("^F%d+$") then
        return rawget(Key, id) or Key[id]
    end
    return nil
end
local function KeyLabel(id)
    return KEY_LABEL[id] or id
end


if type(cfg.key) ~= "string" or not KEY_SET[cfg.key] then
    cfg.key = "F8"
end


local THEME = {
    panelBg = { R = 0.07, G = 0.08, B = 0.11, A = 0.94 },
    panelBorder = { R = 0.30, G = 0.36, B = 0.48, A = 0.90 },
    textPrimary = { R = 0.96, G = 0.97, B = 1.00 },
    textMuted = { R = 0.60, G = 0.65, B = 0.75 },
    textAccent = { R = 0.30, G = 0.78, B = 0.85 },
    textStatus = { R = 0.90, G = 0.76, B = 0.30 },
    buttonBg = { R = 0.16, G = 0.18, B = 0.24 },
    buttonText = { R = 0.96, G = 0.97, B = 1.00 },
    buttonBgPrimary = { R = 0.20, G = 0.50, B = 0.90 },
    buttonTextPrimary = { R = 1.00, G = 1.00, B = 1.00 },
    buttonBgSecondary = { R = 0.28, G = 0.31, B = 0.39 },
    buttonTextSecondary = { R = 0.94, G = 0.95, B = 0.99 },
    buttonBgSuccess = { R = 0.14, G = 0.55, B = 0.34 },
    buttonTextSuccess = { R = 0.94, G = 0.99, B = 0.95 },
    buttonBgDanger = { R = 0.78, G = 0.22, B = 0.26 },
    buttonTextDanger = { R = 1.00, G = 1.00, B = 1.00 },
    buttonBgWarning = { R = 0.95, G = 0.72, B = 0.15 },
    buttonTextWarning = { R = 0.10, G = 0.09, B = 0.05 },
    buttonBgInfo = { R = 0.16, G = 0.56, B = 0.66 },
    buttonTextInfo = { R = 0.93, G = 0.99, B = 1.00 },
    buttonBgActive = { R = 0.14, G = 0.48, B = 0.42 },
    buttonTextActive = { R = 0.78, G = 0.98, B = 0.90 },
    buttonBgDisabled = { R = 0.13, G = 0.14, B = 0.17 },
    buttonTextDisabled = { R = 0.45, G = 0.47, B = 0.52 },
    sectionHeaderBg = { R = 0.12, G = 0.13, B = 0.17 },
    sectionMark = { R = 0.55, G = 0.60, B = 0.70 },
    fieldBg = { R = 0.05, G = 0.06, B = 0.08 },
    fieldText = { R = 0.96, G = 0.97, B = 1.00 },
    fieldHint = { R = 0.52, G = 0.55, B = 0.63 },
    dropdownHeaderBg = { R = 0.18, G = 0.20, B = 0.27 },
    dropdownHeaderText = { R = 0.96, G = 0.97, B = 1.00 },
    dropdownOptionBg = { R = 0.11, G = 0.12, B = 0.15 },
    dropdownOptionText = { R = 0.93, G = 0.94, B = 0.98 },
    dropdownMore = { R = 0.60, G = 0.65, B = 0.75 },
    overlayDim = { R = 0.03, G = 0.04, B = 0.07, A = 0.68 },
    confirmCardBg = { R = 0.11, G = 0.12, B = 0.16, A = 0.98 },
    confirmDivider = { R = 0.30, G = 0.34, B = 0.44, A = 1.0 },
}

if type(ModMenu) == "table" then
    
    local diagTabs = TabsForLang()
    local okInit = pcall(function()
        ModMenu.Init({
            title = T("menuTitle"),
            instanceId = INST,
            key = KeyFor(cfg.key) or Key.F8,
            keyHint = cfg.key,
            inputBackend = "engine",
            dock = "right",
            theme = "dark",
            colors = THEME,
            fontScale = 1.05,
            widthFrac = 0.38,
            ignoreLook = true,
            debug = false,
            tabs = diagTabs,
        })
    end)

    
    
    local gS = nil
    if debug and debug.getupvalue and type(ModMenu.GetTab) == "function" then
        for i = 1, 12 do
            local _, v = debug.getupvalue(ModMenu.GetTab, i)
            if type(v) == "table" and type(v.config) == "table" then
                gS = v
                break
            end
        end
    end

    if okInit then
        pcall(ModMenu.SetChromeLabels, ChromeLangFor(uiLang))

        

        local function setLabel(sec, id, text)
            pcall(ModMenu.SetLabel, sec, id, text)
        end

        local function panelValues()
            local x = ModMenu.Get(SEC, "x")
            local y = ModMenu.Get(SEC, "y")
            local s = ModMenu.Get(SEC, "scale")
            return {
                enabled = ModMenu.Get(SEC, "enabled") ~= false,
                x = (type(x) == "number") and math.floor(x + 0.5) or 0,
                y = (type(y) == "number") and math.floor(y + 0.5) or 0,
                scale = (type(s) == "number" and s > 0) and s or 1,
                hideFrame = ModMenu.Get(SEC, "hideFrame") ~= false,
                showBorder = ModMenu.Get(SEC, "showBorder") ~= false,
            }
        end

        local function onApply()
            local v = panelValues()
            cfg.enabled = v.enabled
            cfg.x = v.x
            cfg.y = v.y
            cfg.scale = v.scale
            cfg.hideFrame = v.hideFrame
            cfg.showBorder = v.showBorder
            ExecuteInGameThread(function()
                local pcallOk, success, nRoots = pcall(doOneShot, "apply")
                if pcallOk and success then
                    setLabel(SEC, "hpStatus", TF("st_applied", v.x, v.y, v.scale, nRoots or 0))
                elseif pcallOk then
                    setLabel(SEC, "hpStatus", T("st_nobar"))
                else
                    setLabel(SEC, "hpStatus", TF("st_applyfail", tostring(success)))
                end
            end)
        end

        
        local function writeConfigFile()
            local path = MOD_DIR and (MOD_DIR .. "\\config.lua")
            if not path then
                return false, T("st_save_nopath")
            end
            local okF, f = pcall(io.open, path, "w")
            if not okF or not f then
                return false, tostring(f)
            end
            local function fieldln(k, v)
                f:write(string.format("    %s = %s,\n", k, v))
            end
            f:write("return {\n")
            fieldln("enabled", (cfg.enabled and "true" or "false"))
            fieldln("x", tostring(cfg.x or 0))
            fieldln("y", tostring(cfg.y or 0))
            fieldln("scale", string.format("%g", (type(cfg.scale) == "number" and cfg.scale > 0) and cfg.scale or 1))
            fieldln("key", string.format('"%s"', cfg.key or "F8"))
            fieldln("hideFrame", (cfg.hideFrame and "true" or "false"))
            fieldln("showBorder", (cfg.showBorder ~= false and "true" or "false"))
            fieldln("lang", string.format('"%s"', uiLang))
            f:write("}\n")
            f:close()
            return true, path
        end

        local function onSave()
            local oldKey = cfg.key
            local v = panelValues()
            cfg = v
            cfg.key = oldKey
            local okW, info = writeConfigFile()
            if okW then
                setLabel(SEC, "saveStatus", T("st_save_ok"))
            else
                setLabel(SEC, "saveStatus", TF("st_save_fail", info))
            end
        end

        
        
        local function applyKey(hint)
            if type(hint) ~= "string" or not KEY_SET[hint] or KeyFor(hint) == nil then
                return false
            end
            if gS and type(gS.config) == "table" then
                gS.config.key = KeyFor(hint)
                gS.config.keyHint = hint
                gS.config.keyName = hint
            end
            local v = panelValues()
            cfg = v
            cfg.key = hint
            pcall(writeConfigFile)
            pcall(ModMenu.Init, {
                title = T("menuTitle"),
                tabs = TabsForLang(),
                key = KeyFor(hint),
                keyHint = hint,
            })
            setLabel(SEC_KEY, "keyStatus", TF("st_keySaved", KeyLabel(hint)))
            return true
        end

        local function onKeyChange(v)
            if type(v) == "string" then
                applyKey(v)
            end
        end

        
        local function onReset()
            pcall(ModMenu.Set, SEC, "x", DEFAULTS.x)
            pcall(ModMenu.Set, SEC, "y", DEFAULTS.y)
            pcall(ModMenu.Set, SEC, "scale", DEFAULTS.scale)
            pcall(ModMenu.Set, SEC, "enabled", DEFAULTS.enabled)
            pcall(ModMenu.Set, SEC, "hideFrame", DEFAULTS.hideFrame)
            pcall(ModMenu.Set, SEC, "showBorder", DEFAULTS.showBorder)
            onApply()
            pcall(ModMenu.Set, SEC_KEY, "key", DEFAULTS.key)
            if (cfg.key or "F8") ~= DEFAULTS.key then
                applyKey(DEFAULTS.key)
            end
            setLabel(SEC, "saveStatus", T("st_reset"))
        end

        
        local btnCache = {}
        local function findBtnWidget(idPart)
            local cached = btnCache[idPart]
            if cached and cached:IsValid() then
                return cached
            end
            local ok, list = pcall(FindAllOf, "Button")
            if not ok or not list then
                return nil
            end
            for i = 1, #list do
                local b = list[i]
                if b and b:IsValid() then
                    local full = ""
                    pcall(function() full = b:GetFullName() end)
                    if full:find("_" .. idPart, 1, true) then
                        btnCache[idPart] = b
                        return b
                    end
                end
            end
            return nil
        end

        local function nudgeOnce(field, dir)
            local r = RANGE[field]
            if not r then
                return
            end
            local v = ModMenu.Get(SEC, field)
            if type(v) ~= "number" then
                v = 0
            end
            v = v + dir * r.step
            if v < r.lo then
                v = r.lo
            end
            if v > r.hi then
                v = r.hi
            end
            if field == "scale" then
                v = math.floor(v * 10 + 0.5) / 10
            else
                v = math.floor(v + 0.5)
            end
            pcall(ModMenu.Set, SEC, field, v)
        end

        


        local activeNudges = {}
        local function startNudge(field, dir, btnId)
            nudgeOnce(field, dir)
            local function chain()
                activeNudges[field] = nil
                local btn = findBtnWidget(btnId)
                local still = false
                if btn then
                    local ok, p = pcall(function()
                        return btn:IsPressed()
                    end)
                    still = (ok and p == true)
                end
                if still then
                    nudgeOnce(field, dir)
                    activeNudges[field] = true
                    delayMs(100, chain)
                end
            end
            activeNudges[field] = true
            delayMs(100, chain)
        end

        local function minusBtn(field, btnId)
            return { type = "button", id = btnId, label = "−", onClick = function() startNudge(field, -1, btnId) end }
        end
        local function plusBtn(field, btnId)
            return { type = "button", id = btnId, label = "+", onClick = function() startNudge(field, 1, btnId) end }
        end

        
        local applyLanguage

        local function onApplyLang()
            local sel = ModMenu.Get(SEC_LANG, "uiLang") or uiLang
            if sel == "zh" or sel == "en" then
                pcall(applyLanguage, sel)
            end
        end

        
        
        local function buildFuncSection()
            return {
                id = SEC,
                title = T("sec_title"),
                tab = TabName("func"),
                items = {
                    { type = "label", label = T("tip") },
                    { type = "label", id = "hpStatus", label = T("st_wait") },
                    { type = "checkbox", id = "enabled", label = T("chk_enabled"), default = cfg.enabled ~= false },
                    { type = "checkbox", id = "hideFrame", label = T("chk_hideFrame"), default = cfg.hideFrame ~= false },
                    { type = "checkbox", id = "showBorder", label = T("chk_showBorder"), default = cfg.showBorder ~= false },
                    {
                        type = "row",
                        items = {
                            minusBtn("x", "xMinus"),
                            { type = "number", id = "x", label = T("lbl_x"), min = RANGE.x.lo, max = RANGE.x.hi, integer = true, default = cfg.x or 0, fieldWidth = 72 },
                            plusBtn("x", "xPlus"),
                        },
                    },
                    {
                        type = "row",
                        items = {
                            minusBtn("y", "yMinus"),
                            { type = "number", id = "y", label = T("lbl_y"), min = RANGE.y.lo, max = RANGE.y.hi, integer = true, default = cfg.y or 0, fieldWidth = 72 },
                            plusBtn("y", "yPlus"),
                        },
                    },
                    {
                        type = "row",
                        items = {
                            minusBtn("scale", "scaleMinus"),
                            { type = "number", id = "scale", label = T("lbl_scale"), min = RANGE.scale.lo, max = RANGE.scale.hi, default = cfg.scale or 1, fieldWidth = 72 },
                            plusBtn("scale", "scalePlus"),
                        },
                    },
                    { type = "label", label = T("nudge_hint") },
                    { type = "button", id = "apply", label = T("btn_apply"), variant = "primary", onClick = onApply },
                    {
                        type = "row",
                        items = {
                            { type = "button", id = "save", label = T("btn_save"), variant = "primary", onClick = onSave },
                            { type = "button", id = "reset", label = T("btn_reset"), variant = "warning", onClick = onReset },
                        },
                    },
                    { type = "label", id = "saveStatus", label = "" },
                },
            }
        end

        local function buildKeySection()
            return {
                id = SEC_KEY,
                title = T("lbl_key"),
                tab = TabName("lang"),
                titleFontSize = 20,
                items = {
                    { type = "label", label = T("set_pageHint") },
                    {
                        type = "dropdown",
                        id = "key",
                        label = T("set_keyHint"),
                        options = (function()
                            local t = {}
                            for _, o in ipairs(KEY_OPTIONS) do
                                t[#t + 1] = { label = o.label, value = o.id }
                            end
                            return t
                        end)(),
                        default = cfg.key or "F8",
                        onChange = onKeyChange,
                    },
                    { type = "label", id = "keyStatus", label = TF("st_keyNow", KeyLabel(cfg.key or "F8")) },
                },
            }
        end

        local function buildLangSection()
            return {
                id = SEC_LANG,
                title = T("sec_lang_title"),
                tab = TabName("lang"),
                items = {
                    {
                        type = "dropdown",
                        id = "uiLang",
                        label = T("set_langHint"),
                        options = {
                            { label = "中文 (Chinese)", value = "zh" },
                            { label = "English", value = "en" },
                        },
                        default = uiLang,
                    },
                    { type = "button", id = "applyLang", label = T("btn_applyLang"), variant = "primary", onClick = onApplyLang },
                    { type = "label", id = "langStatus", label = TF("st_langNow", LangName(uiLang)) },
                },
            }
        end

        local function buildAndRegister()
            for _, def in ipairs({ buildFuncSection(), buildKeySection(), buildLangSection() }) do
                pcall(ModMenu.Register, def)
            end
        end

        applyLanguage = function(lang)
            if (lang ~= "zh" and lang ~= "en") or lang == uiLang then
                return
            end
            uiLang = lang
            cfg.lang = lang
            pcall(writeConfigFile)  
            pcall(ModMenu.Init, {
                title = T("menuTitle"),
                tabs = TabsForLang(),
                key = KeyFor(cfg.key or "F8") or Key.F8,
                keyHint = cfg.key or "F8",
            })
            pcall(ModMenu.SetChromeLabels, ChromeLangFor(lang))
            buildAndRegister()
            ExecuteInGameThread(function()
                pcall(ModMenu.Set, SEC_LANG, "uiLang", lang)
                setLabel(SEC_LANG, "langStatus", TF("st_langSaved", LangName(lang)))
            end)
        end

        buildAndRegister()
    end
end