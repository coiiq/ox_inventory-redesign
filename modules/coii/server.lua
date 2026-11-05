if not lib then return end

local Inventory = require 'modules.inventory.server'
local TriggerEventHooks = require 'modules.hooks.server'
local config = lib.load('data.coii')
local db = require 'modules.mysql.server'
local repack = require 'modules.coii.slots'
local sessions = {}
local groundSessions = {}
require 'modules.coii.attachments_server'
require 'modules.ammo.server'
require 'modules.medical.server'

-- Only called after a native transfer has committed. Rearranging carried
-- pockets, Quick and owned containers does not add or remove belongings.
function server.coiiNotifyTransfer(player, fromInventory, toInventory, fromItem, toItem, count, swapping, ownedPack, groundMove)
    if fromInventory == toInventory then return end
    local function carried(inventory)
        if inventory == player or inventory == ownedPack then return true end
        local parent = player.containerSlot and player.items[player.containerSlot]
        return not groundMove and parent and parent.metadata and parent.metadata.container == inventory.id
    end
    local fromCarried, toCarried = carried(fromInventory), carried(toInventory)
    if (not not fromCarried) == (not not toCarried) then return end
    local leaving = toInventory.type == 'drop' and 'ui_dropped' or toInventory.player and 'ui_given' or 'ui_stored'
    local arriving = fromInventory.type == 'drop' and 'ui_picked_up' or fromInventory.player and 'ui_received' or 'ui_taken'
    if fromCarried then
        TriggerClientEvent('ox_inventory:itemNotify', player.id, { fromItem, leaving, swapping and fromItem.count or count })
        if swapping and toItem then
            local action = toInventory.type == 'drop' and 'ui_picked_up' or toInventory.player and 'ui_received' or 'ui_taken'
            TriggerClientEvent('ox_inventory:itemNotify', player.id, { toItem, action, toItem.count })
        end
    else
        TriggerClientEvent('ox_inventory:itemNotify', player.id, { fromItem, arriving, swapping and fromItem.count or count })
        if swapping and toItem then
            local action = fromInventory.type == 'drop' and 'ui_dropped' or fromInventory.player and 'ui_given' or 'ui_stored'
            TriggerClientEvent('ox_inventory:itemNotify', player.id, { toItem, action, toItem.count })
        end
    end
end

function server.coiiCanAccessPhysicalDrop(player, inventory)
    if not inventory.coiiBackpackDrop then return true end
    if not player or not player.player or not inventory.coords then return false end
    if inventory.instance and inventory.instance ~= Player(player.id).state.instance then return false end
    local ped = player.player.ped
    if not ped or not DoesEntityExist(ped) then return false end
    local coords, target = GetEntityCoords(ped), inventory.coords
    local dx, dy, dz = coords.x - target.x, coords.y - target.y, coords.z - target.z
    return dx * dx + dy * dy + dz * dz <= 2.5 * 2.5
end

function server.coiiGroundBackpackPresent(player, context)
    return context and Inventory(context.drop.id) == context.drop and Inventory(context.inventory.id) == context.inventory
        and context.drop.items[context.slot] == context.parent and context.parent.count == 1
        and context.parent.metadata.container == context.inventory.id
        and server.coiiCanAccessPhysicalDrop(player, context.drop)
end

function server.coiiResolveGroundBackpack(player, dropId)
    local drop = type(dropId) == 'string' and Inventory(dropId)
    if not drop or not drop.coiiBackpackDrop or not server.coiiCanAccessPhysicalDrop(player, drop) then return end
    for slot, item in pairs(drop.items) do
        local metadata = item.metadata
        if config.BackpackItems[item.name] and item.count == 1 and metadata and type(metadata.container) == 'string'
            and type(metadata.size) == 'table' then
            local slots, maxWeight = tonumber(metadata.size[1]), tonumber(metadata.size[2])
            if not slots or slots < 1 or not maxWeight or maxWeight < 1 then return end
            local pack = Inventory(metadata.container) or Inventory.Create(metadata.container, item.label or 'Backpack', 'container', slots, 0, maxWeight, false)
            if not pack or pack.type ~= 'container' then return end
            local context = { drop = drop, parent = item, slot = slot, inventory = pack }
            if server.coiiGroundBackpackPresent(player, context) then return pack, context end
        end
    end
end

function server.coiiBindGroundBackpack(player, context)
    player.coiiGroundBackpack = context
    groundSessions[player.id] = context
end

function server.coiiClearGroundBackpack(player)
    player.coiiGroundBackpack = nil
    groundSessions[player.id] = nil
end

function server.coiiCloseGroundBackpack(dropId)
    for source, context in pairs(groundSessions) do
        if context.drop.id == dropId then
            groundSessions[source] = nil
            local player = Inventory(source)
            if player and player.coiiGroundBackpack == context then player:closeInventory() end
        end
    end
end

function server.coiiGroundMove(player, fromInventory, toInventory, ownedPack, ownedParent)
    local context = player.coiiGroundBackpack
    if not context or (context.inventory ~= fromInventory and context.inventory ~= toInventory) then return end
    if player.open ~= context.inventory.id or not server.coiiGroundBackpackPresent(player, context) then return false end
    return { context = context, owned = ownedPack, ownedParent = ownedParent }
end

function server.coiiGroundMoveValid(player, move)
    if player.coiiGroundBackpack ~= move.context or player.open ~= move.context.inventory.id
        or not server.coiiGroundBackpackPresent(player, move.context) then return false end
    if move.toDelta and move.toDelta > 0 and move.toInventory.weight + move.toDelta > move.toInventory.maxWeight then return false end
    if move.fromDelta and move.fromDelta > 0 and move.fromInventory.weight + move.fromDelta > move.fromInventory.maxWeight then return false end
    return true
end

function server.coiiCommitGroundMove(player, move)
    local context = move.context
    Inventory.ContainerWeight(context.parent, context.inventory.weight, context.drop)
    context.drop:syncSlotsWithClients({ { item = context.parent, inventory = context.drop.id } })
    if move.owned then
        Inventory.ContainerWeight(move.ownedParent, move.owned.weight, player)
        player.changed = true
        player:syncSlotsWithPlayer({ { item = move.ownedParent, inventory = player.id } }, player.weight)
        if server.syncInventory then server.syncInventory(player) end
    end
end

lib.callback.register('ox_inventory:coiiPickupBackpack', function(source, dropId)
    if Inventory.Lock then return false end
    local player = Inventory(source)
    if not player or not player.player then return false end
    if player.open then return false, 'Close your inventory first.' end
    local _, context = server.coiiResolveGroundBackpack(player, dropId)
    if not context then return false, 'This backpack is no longer within reach.' end
    local slot = Inventory.GetEmptySlot(player)
    if not slot then return false, 'Your pockets are full.' end
    player:openInventory(context.drop)
    local ok, result, reason = pcall(Inventory.SwapItems, source, {
        fromType = 'drop', fromSlot = context.slot, toType = 'player', toSlot = slot, count = 1
    })
    if player.open == context.drop.id then player:closeInventory(true) end
    if ok and result then return true end
    return false, ok and type(reason) == 'string' and locale(reason) or 'Could not pick up this backpack.'
end)

-- An existing ground pile must never absorb a backpack. Resolve the location
-- and instance from the player, not NUI coordinates or a client-supplied model.
function server.coiiPreparePhysicalDrop(player, fromInventory, toInventory, data)
    if not server.coiiCanAccessPhysicalDrop(player, fromInventory)
        or not server.coiiCanAccessPhysicalDrop(player, toInventory) then return false end
    if data.toType ~= 'drop' and data.toType ~= 'newdrop' then return true end
    if fromInventory == toInventory and data.fromType == data.toType and data.toType ~= 'newdrop' then return true end
    local item = fromInventory.items[data.fromSlot]
    local backpack = item and config.BackpackItems[item.name] == true
    if not backpack and not toInventory.coiiBackpackDrop then return true end
    if backpack and (item.count ~= 1 or not item.metadata or type(item.metadata.container) ~= 'string') then return false end
    local ped = player.player.ped
    if not ped or not DoesEntityExist(ped) or GetVehiclePedIsIn(ped, false) ~= 0 then return false end
    data.toType = 'newdrop'
    if backpack then data.toSlot = 1; data.count = 1 end
    data.coords = GetEntityCoords(ped)
    data.instance = Player(player.id).state.instance
    data.heading = GetEntityHeading(ped)
    return true
end

local function minimal(items)
    local result = {}
    for _, item in pairs(items) do
        result[#result + 1] = { name = item.name, slot = item.slot, count = item.count, metadata = item.metadata }
    end
    return result
end

local function overflowName(owner) return 'coii_overflow_' .. owner end

function server.coiiPrepareSlots(player, items)
    local saved = db.loadStash(player.identifier, 'coii_slot_layout')
    local layout = saved and json.decode(saved)
    if layout and layout.pockets == shared.pocketslots then return items end
    local mapped, overflow = repack(items, layout and layout.pockets or config.LegacyPocketSlots, shared.pocketslots)
    local name = overflowName(player.identifier)
    local stored
    if #overflow > 0 then
        local previous = db.loadStash(player.identifier, name)
        stored = previous and json.decode(previous) or {}
        local highest = 0
        for _, item in pairs(stored) do highest = math.max(highest, item.slot) end
        for _, item in ipairs(overflow) do
            highest = highest + 1
            item.slot = highest
            stored[#stored + 1] = item
        end
    end
    if not db.migratePlayerSlots(player.identifier, json.encode(minimal(mapped)), json.encode({ pockets = shared.pocketslots }), name, stored and json.encode(minimal(stored))) then
        error('Could not preserve inventory while applying the pocket slot limit; saved items were not changed.')
    end
    if stored then
        SetTimeout(3000, function()
            TriggerClientEvent('ox_lib:notify', player.source, { type = 'inform', description = 'Extra belongings were saved safely. Use /inventoryoverflow to collect them.' })
        end)
    end
    return mapped
end

-- Only used for saved items that did not fit when reducing the old slot limit.
RegisterCommand('inventoryoverflow', function(source)
    local player = Inventory(source)
    if not player or not player.player then return end
    local name = overflowName(player.owner)
    local saved = db.loadStash(player.owner, name)
    local items = saved and json.decode(saved) or {}
    if not next(items) then return end
    local highest = 24
    for _, item in pairs(items) do highest = math.max(highest, item.slot) end
    local stash = Inventory(name .. ':' .. player.owner) or Inventory.Create(name, 'Stored belongings', 'stash', highest, 0, 100000000, player.owner)
    if not stash then return end
    stash.coiiOverflowOwner = player.owner
    server.forceOpenInventory(source, 'stash', stash.id)
end, false)

local function detach(source)
    local previous = sessions[source]
    if previous then
        local pack = Inventory(previous)
        if pack then
            pack.openedBy[source] = nil
            if not next(pack.openedBy) then pack:set('open', false) end
        end
        sessions[source] = nil
    end
end

-- Resolve from the player's authoritative items, never a client-supplied id.
function server.coiiGetBackpack(player)
    if not player or not player.player or not player.open then return end

    local candidate = player.items[shared.backpackslot]
    local item = candidate and config.BackpackItems[candidate.name]
        and candidate.metadata and type(candidate.metadata.container) == 'string'
        and type(candidate.metadata.size) == 'table' and candidate

    if not item then detach(player.id) return end
    local metadata = item.metadata
    local pack = Inventory(metadata.container)
    if not pack then
        local slots, maxWeight = tonumber(metadata.size[1]), tonumber(metadata.size[2])
        if not slots or not maxWeight or slots < 1 or maxWeight < 1 then return end
        pack = Inventory.Create(metadata.container, item.label, 'container', slots, 0, maxWeight, false)
    end
    if not pack or pack.type ~= 'container' then return end

    if sessions[player.id] ~= pack.id then
        local hooks <close> = TriggerEventHooks('openInventory', {
            source = player.id, inventoryId = pack.id, inventoryType = 'container', slot = item.slot
        })
        if not hooks.success or player.items[shared.backpackslot] ~= item
            or item.slot ~= shared.backpackslot or not player.open then return end
        detach(player.id)
        sessions[player.id] = pack.id
    end
    pack.openedBy[player.id] = true
    pack:set('open', true)
    return pack, item
end

function server.coiiOwnsBackpack(player, pack, item)
    if not player or not player.open or not pack or not item or item.slot ~= shared.backpackslot then return false end
    local current = player.items[item.slot]
    return current == item and config.BackpackItems[current.name] == true
        and current.metadata and current.metadata.container == pack.id
end

lib.callback.register('ox_inventory:coiiState', function(source)
    local player = Inventory(source)
    if not player or not player.player or not player.open then return end
    local pack, parent = server.coiiGetBackpack(player)
    local result = {
        profile = { name = player.label or GetPlayerName(source), id = source },
        config = { accent = config.Accent, equipment = config.Equipment, preview = config.Preview, quickSlotStart = shared.quickslotstart,
            backpackSlot = shared.backpackslot, backpackItems = config.BackpackItems },
        backpack = false
    }
    if pack then
        result.backpack = {
            id = pack.id, label = pack.label, type = 'coii_pack', slots = pack.slots,
            maxWeight = pack.maxWeight, weight = pack.weight, items = pack.items,
            parentSlot = parent.slot
        }
    end
    return result
end)

AddEventHandler('ox_inventory:closedInventory', function(source)
    -- Stock also emits this while changing secondary containers. Keep the owned
    -- pack subscribed during that transition, release it on a real close.
    SetTimeout(300, function()
        local player = Inventory(source)
        if not player or not player.open then detach(source) end
    end)
end)

AddEventHandler('playerDropped', function()
    local context = groundSessions[source]
    if context then
        context.inventory.openedBy[source] = nil
        if not next(context.inventory.openedBy) then context.inventory:set('open', false) end
        groundSessions[source] = nil
    end
    detach(source)
end)
AddEventHandler('onResourceStop', function(resource)
    if resource ~= GetCurrentResourceName() then return end
    for source in pairs(sessions) do detach(source) end
end)

return config
