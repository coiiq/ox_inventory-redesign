if not lib then return end

local config = lib.load('data.coii')
local male, female = joaat('mp_m_freemode_01'), joaat('mp_f_freemode_01')
local worn, running = nil, false
local component = 5

local function variation(ped)
    return { drawable = GetPedDrawableVariation(ped, component), texture = GetPedTextureVariation(ped, component),
        palette = GetPedPaletteVariation(ped, component) }
end

local function matches(ped, value)
    return GetPedDrawableVariation(ped, component) == value.drawable
        and GetPedTextureVariation(ped, component) == value.texture
        and GetPedPaletteVariation(ped, component) == (value.palette or 0)
end

local function apply(ped, value)
    SetPedComponentVariation(ped, component, value.drawable, value.texture, value.palette or 0)
end

function client.coiiClearBackpackClothing()
    if worn and DoesEntityExist(worn.ped) and GetEntityModel(worn.ped) == worn.model and matches(worn.ped, worn.applied) then
        apply(worn.ped, worn.previous)
    end
    worn = nil
end

local function equipped()
    local item = PlayerData and PlayerData.loaded and PlayerData.inventory and PlayerData.inventory[shared.backpackslot]
    return item and config.BackpackItems[item.name] and item.count > 0 and item
end

local function enforce()
    local ped = cache.ped
    if not ped or not DoesEntityExist(ped) then client.coiiClearBackpackClothing(); return end
    local model = GetEntityModel(ped)
    local style = config.BackpackClothing and config.BackpackClothing[model == male and 'male' or model == female and 'female' or '']
    if worn and (worn.ped ~= ped or worn.model ~= model) then client.coiiClearBackpackClothing() end
    if not style or style.drawable < 0 or style.drawable >= GetNumberOfPedDrawableVariations(ped, component)
        or style.texture < 0 or style.texture >= GetNumberOfPedTextureVariations(ped, component, style.drawable) then return end
    if not worn then worn = { ped = ped, model = model, previous = variation(ped), applied = style } end
    if not matches(ped, style) then
        -- Remember outfit changes underneath the equipped bag, without saving an
        -- inventory-only component into skinchanger's persistent character skin.
        worn.previous = variation(ped)
        apply(ped, style)
    end
end

function client.coiiSyncBackpackClothing()
    if not equipped() then client.coiiClearBackpackClothing(); return end
    enforce()
    if running then return end
    running = true
    CreateThread(function()
        while equipped() do
            enforce()
            -- Requested 1 ms cadence; FiveM resumes this on the next game tick.
            Wait(1)
        end
        running = false
        client.coiiClearBackpackClothing()
    end)
end

lib.onCache('ped', function() if equipped() then client.coiiSyncBackpackClothing() end end)
AddEventHandler('onResourceStop', function(resource)
    if resource == GetCurrentResourceName() then client.coiiClearBackpackClothing() end
end)
