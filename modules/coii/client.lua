if not lib then return end

local config = lib.load('data.coii')
require 'modules.theme.client'
require 'modules.coii.backpack'
require 'modules.medical.client'
local Inspection = require 'modules.coii.inspect'
local Attachments = require 'modules.coii.attachments'
Attachments.register(Inspection)
client.coiiInspectProp = Inspection.definition
local updating = false
local function isOpen()
    return client.coiiIsOpen and client.coiiIsOpen() == true
end

-- Kept for the core inventory's close/logout hooks. The radial layout renders no ped.
function client.coiiClosePreview()
    Inspection.close()
    client.coiiPreviewActive = false
end

local function refreshState()
    if updating or not isOpen() then return end
    updating = true
    local ok, result = pcall(lib.callback.await, 'ox_inventory:coiiState', false)
    updating = false
    if ok and result and isOpen() then SendNUIMessage({ action = 'coiiState', data = result }) end
end

RegisterNUICallback('coiiState', function(_, cb)
    if not isOpen() then return cb(false) end
    local ok, result = pcall(lib.callback.await, 'ox_inventory:coiiState', false)
    cb(ok and result or false)
end)

-- Reject stale callbacks from an older cached UI, without activating a camera/ped.
RegisterNUICallback('coiiPreview', function(_, cb) client.coiiClosePreview(); cb(false) end)
RegisterNUICallback('coiiRotate', function(_, cb) cb(false) end)

-- Read the loaded weapon data without equipping it or touching the player's ped.
-- These are inspection values; inventory changes still use the native server callbacks.
RegisterNUICallback('coiiInspect', function(data, cb)
    if not isOpen() or type(data) ~= 'table' or type(data.name) ~= 'string' or #data.name > 100 then return cb(false) end
    local items = require 'modules.items.client'
    local item = items[data.name]
    if not item or not Inspection.definition(item) or not Inspection.open(item, data) then return cb(false) end
    if not item.weapon then return cb({ weapon = false, preview = true }) end

    local function numberFrom(fn, ...)
        if type(fn) ~= 'function' then return end
        local ok, value = pcall(fn, ...)
        if ok and type(value) == 'number' and value == value and value >= 0 and value < math.huge then return value end
    end
    local hash = item.hash or joaat(item.model or item.name)
    local damage = numberFrom(GetWeaponDamage, hash, 0)
    local interval = item.ammoname and numberFrom(GetWeaponTimeBetweenShots, hash)
    local clip = item.ammoname and numberFrom(GetWeaponClipSize, hash)
    -- The default clip native does not include extended magazines. Resolve only
    -- registered, compatible attachment hashes for the magazine readout.
    if type(data.components) == 'table' then
        for index = 1, math.min(#data.components, 16) do
            local name = data.components[index]
            local component = type(name) == 'string' and items[name]
            local hashes = component and component.component and component.client and component.client.component
            if type(hashes) == 'table' then
                for _, componentHash in ipairs(hashes) do
                    local ok, compatible = pcall(DoesWeaponTakeWeaponComponent, hash, componentHash)
                    if ok and compatible then
                        local size = numberFrom(GetWeaponComponentClipSize, componentHash)
                        if size and size > 0 then clip = size end
                    end
                end
            end
        end
    end
    cb({
        preview = true,
        weapon = true,
        damage = damage and damage > 0 and damage or nil,
        fireRate = interval and interval > 0 and 60 / interval or nil,
        recoil = numberFrom(GetWeaponRecoilShakeAmplitude, hash),
        clipSize = clip and clip > 0 and clip or nil,
        ammoName = item.ammoname,
        ammoLabel = item.ammoname and items[item.ammoname] and items[item.ammoname].label or nil,
        mounts = Attachments.catalog(item,data.components)
    })
end)

function client.coiiIsBackpack(item)
    return item and config.BackpackItems[item.name] == true and item.metadata and item.metadata.container
end

AddEventHandler('ox_inventory:updateInventory', function()
    client.coiiSyncBackpackClothing()
    if isOpen() then SetTimeout(150, refreshState) end
end)
AddEventHandler('onResourceStop', function(resource)
    if resource == GetCurrentResourceName() then client.coiiClosePreview() end
end)
return config
