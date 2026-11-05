local Inventory=require 'modules.inventory.server'
local Items=require 'modules.items.server'
local Boxes=require 'modules.ammo.shared'
local GetLocks=require 'modules.locks'
local function integer(value)return type(value)=='number' and value==value and value>=0 and value<math.huge and value%1==0 end
lib.callback.register('ox_inventory:coiiLoadAmmoBox',function(source,data)
    local function reject(message)return{ok=false,error=message}end
    if type(data)~='table' or not integer(data.boxSlot) or not integer(data.weaponSlot) or data.boxSlot<1 or data.weaponSlot<1
        or data.boxSlot==data.weaponSlot or not integer(data.rounds) or not integer(data.ammo) or not integer(data.limit) or data.limit<1 then return reject('Invalid reload request.')end
    local inv=Inventory(source)
    local state=Player(source).state
    if Inventory.Lock or not inv or not inv.player or state.dead or state.invBusy then return reject('Cannot reload right now.')end
    local box,weapon=inv.items[data.boxSlot],inv.items[data.weaponSlot]
    local item,gun=box and Items(box.name),weapon and Items(weapon.name)
    local definition=Boxes.definition(item)
    local used=inv.usingItem
    if not definition or not gun or not gun.weapon or not used or used.coiiBoxLoaded or used.name~=box.name or used.slot~=box.slot
        or inv.weapon~=weapon.slot or weapon.count~=1 or not integer(box.count) or box.count<1 or used.count~=box.count
        or type(weapon.metadata)~='table' or type(box.metadata)~='table'
        or weapon.name~=data.name or weapon.metadata.serial~=data.serial then return reject('These items are no longer available.')end
    local locks <close> = GetLocks({('inventory-%s:slot-%s'):format(inv.id,box.slot),('inventory-%s:slot-%s'):format(inv.id,weapon.slot)})
    if not locks then return reject('These items are being moved. Please try again.')end
    if definition.ammo~=gun.ammoname or weapon.metadata.specialAmmo or box.metadata.type then return reject('This ammunition does not fit the equipped weapon.')end
    if (weapon.metadata.durability or 0)<=0 then return reject('This weapon is broken.')end
    local rounds=Boxes.remaining(item,box.metadata)
    local ammo=weapon.metadata.ammo or 0
    if rounds~=data.rounds or ammo~=data.ammo then return reject('Ammunition changed. Please try again.')end
    -- The client can request a lower native ammo limit, never exceed the
    -- server-owned magazine capacity for the weapon's actual fitted clip.
    local capacity=math.min(Boxes.capacity(gun,weapon.metadata),data.limit)
    local loaded=math.min(rounds,definition.rounds,capacity-ammo)
    if loaded<=0 then return reject(rounds<=0 and 'This ammo box is empty.' or 'The weapon magazine is full.')end
    local nextMetadata=table.clone(weapon.metadata);nextMetadata.ammo=ammo+loaded
    local boxMetadata=table.clone(box.metadata);boxMetadata.rounds=rounds-loaded;Boxes.normalize(item,boxMetadata)
    local nextWeaponWeight=Inventory.SlotWeight(gun,{count=1,metadata=nextMetadata})
    local partialSlot,partial
    if box.count>1 and boxMetadata.rounds>0 then
        partialSlot=Inventory.GetEmptySlot(inv)
        if not partialSlot or not Inventory.CanEquipSlot(inv,item,partialSlot)then
            return reject('Keep one pocket slot free for the partially used ammo box.')
        end
        partial=table.clone(box)
        partial.slot,partial.count,partial.metadata=partialSlot,1,boxMetadata
        partial.weight=Inventory.SlotWeight(item,partial)
    end
    local partialLock <close> = partialSlot and GetLocks({('inventory-%s:slot-%s'):format(inv.id,partialSlot)})or nil
    if partialSlot and not partialLock then return reject('These items are being moved. Please try again.')end
    local remainingCount=box.count-((partial or boxMetadata.rounds==0)and 1 or 0)
    local remainingMetadata=box.count>1 and box.metadata or boxMetadata
    local nextBoxWeight=remainingCount>0 and Inventory.SlotWeight(item,{count=remainingCount,metadata=remainingMetadata})or 0
    local nextWeight=inv.weight-weapon.weight-box.weight+nextWeaponWeight+nextBoxWeight+(partial and partial.weight or 0)
    if nextWeight>inv.maxWeight and nextWeight>inv.weight then return reject('Cannot carry the loaded ammunition.')end
    -- All slot, weight and allocation checks finish before the first write.
    -- Unused boxes retain their metadata. A partial box gets its own slot,
    -- so generic inventory stacking cannot copy its rounds to the whole stack.
    if boxMetadata.rounds==0 then
        if not Inventory.SetSlot(inv,item,-1,box.metadata,box.slot) then return reject('Could not consume this ammo box.')end
    elseif partial then
        local remaining=table.clone(box)
        remaining.count,remaining.weight=remainingCount,nextBoxWeight
        inv.items[box.slot],inv.items[partialSlot]=remaining,partial
    else box.metadata,box.weight=boxMetadata,nextBoxWeight end
    weapon.metadata,weapon.weight=nextMetadata,nextWeaponWeight
    used.coiiBoxLoaded=true
    inv.weight,inv.changed=nextWeight,true
    local updates={{item=weapon,inventory=inv.id},{item=inv.items[box.slot] or {slot=box.slot},inventory=inv.id}}
    if partial then updates[#updates+1]={item=partial,inventory=inv.id}end
    inv:syncSlotsWithClients(updates,true)
    if server.syncInventory then server.syncInventory(inv)end
    return{ok=true,ammo=nextMetadata.ammo,loaded=loaded,remaining=boxMetadata.rounds}
end)
