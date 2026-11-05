-- Inspection edits use the player's own slots and server-owned compatibility.
-- No client-supplied inventory id, hash, count, metadata or target slot is trusted.
local Inventory = require 'modules.inventory.server'
local Items = require 'modules.items.server'
local GetLocks = require 'modules.locks'
local fits = lib.load('data.coii_attachments')
local function integer(value) return type(value)=='number' and value==value and value%1==0 and value>0 end
local function resolve(source, data)
    if type(data)~='table' or data.inventory~='player' or not integer(data.slot) then return end
    local inv=Inventory(source)
    if Inventory.Lock or not inv or not inv.player or not inv.open or inv.usingItem then return end
    local state=Player(source).state
    if state.invBusy or state.dead then return end
    local slot=inv.items[data.slot]
    local item=slot and Items(slot.name)
    if not item or not item.weapon or not item.prop or slot.count~=1 or slot.name~=data.name
        or type(slot.metadata)~='table' or slot.metadata.serial~=data.serial then return end
    return inv,slot,item
end
local function revision(slot) return table.concat(slot.metadata.components or {},'|') end
local function snapshot(inv,slot)
    local installed,available,occupied,fittedNames={},{},{},{}
    for _,name in ipairs(slot.metadata.components or {}) do
        local item=Items(name)
        if item and item.component then
            occupied[item.type or name]=true
            fittedNames[name]=true
            installed[#installed+1]={name=name,label=item.label,type=item.type or 'attachment'}
        end
    end
    local allowed=fits[slot.name] and fits[slot.name].components or {}
    for name in pairs(allowed) do
        local item=Items(name)
        if item and item.component then
            local count=0
            for _,candidate in pairs(inv.items) do if candidate.name==name then count=count+candidate.count end end
            if count>0 and not fittedNames[name] then available[#available+1]={name=name,label=item.label,type=item.type or 'attachment',count=count,blocked=occupied[item.type or name] or false} end
        end
    end
    local function sort(a,b) return a.type==b.type and a.name<b.name or a.type<b.type end
    table.sort(installed,sort);table.sort(available,sort)
    return {revision=revision(slot),installed=installed,available=available}
end
lib.callback.register('ox_inventory:coiiAttachmentState',function(source,data)
    local inv,slot=resolve(source,data)
    if not inv then return false end
    return snapshot(inv,slot)
end)
lib.callback.register('ox_inventory:coiiInspectAttachment',function(source,data)
    local inv,weapon,item=resolve(source,data)
    if not inv then return {ok=false,error='This weapon is no longer available.'} end
    local function reject(message) return {ok=false,error=message,state=snapshot(inv,weapon)} end
    if (data.action~='install' and data.action~='remove') or type(data.component)~='string'
        or #data.component>100 or data.revision~=revision(weapon) then return reject('Attachments changed. Please try again.') end
    local component=Items(data.component)
    if not component or not component.component then return reject('Unknown attachment.') end
    local components=weapon.metadata.components or {}
    local index
    for i,name in ipairs(components) do if name==component.name then index=i end end
    local otherSlot,otherItem,metadata
    if data.action=='install' then
        local allowed=fits[weapon.name] and fits[weapon.name].components
        if not allowed or not allowed[component.name] then return reject('This attachment does not fit this weapon.') end
        for _,name in ipairs(components) do
            local fitted=Items(name)
            if name==component.name or fitted and fitted.type==component.type then return reject('Remove the fitted attachment of this type first.') end
        end
        for i=1,inv.slots do
            local candidate=inv.items[i]
            if candidate and candidate.name==component.name and candidate.count>0 then otherSlot,otherItem=i,candidate;break end
        end
        if not otherSlot then return reject('You no longer have this attachment.') end
        metadata=table.clone(otherItem.metadata or {})
    else
        if not index then return reject('This attachment is no longer fitted.') end
        metadata=table.clone(weapon.metadata.coiiAttachmentItems and weapon.metadata.coiiAttachmentItems[component.name] or {})
        otherSlot=Inventory.GetSlotForItem(inv,component.name,metadata)
        if not otherSlot then return reject('Make room in your pockets to remove this attachment.') end
        otherItem=inv.items[otherSlot]
    end
    local locks <close> = GetLocks({('inventory-%s:slot-%s'):format(inv.id,weapon.slot),('inventory-%s:slot-%s'):format(inv.id,otherSlot)})
    if not locks then return reject('These items are being moved. Please try again.') end
    -- SetSlot and SlotWeight are synchronous. Validate both new weights before
    -- committing either slot, then publish the pair as one inventory update.
    local nextMetadata=table.clone(weapon.metadata)
    nextMetadata.components=table.clone(components)
    nextMetadata.coiiAttachmentItems=table.clone(weapon.metadata.coiiAttachmentItems or {})
    if data.action=='install' then
        nextMetadata.components[#components+1]=component.name
        nextMetadata.coiiAttachmentItems[component.name]=metadata
    else
        table.remove(nextMetadata.components,index)
        nextMetadata.coiiAttachmentItems[component.name]=nil
    end
    local nextWeapon={count=1,metadata=nextMetadata}
    local nextWeaponWeight=Inventory.SlotWeight(item,nextWeapon)
    local nextCount=(otherItem and otherItem.count or 0)+(data.action=='install' and -1 or 1)
    local nextOtherWeight=nextCount>0 and Inventory.SlotWeight(component,{count=nextCount,metadata=metadata}) or 0
    local nextWeight=inv.weight-weapon.weight-(otherItem and otherItem.weight or 0)+nextWeaponWeight+nextOtherWeight
    if nextWeight>inv.maxWeight and nextWeight>inv.weight then return reject('You cannot carry the removed attachment.') end
    local success=Inventory.SetSlot(inv,component,data.action=='install' and -1 or 1,metadata,otherSlot)
    if not success then return reject('Could not move this attachment.') end
    weapon.metadata,weapon.weight=nextMetadata,nextWeaponWeight
    inv.weight,inv.changed=nextWeight,true
    inv:syncSlotsWithClients({{item=weapon,inventory=inv.id},{item=inv.items[otherSlot] or {slot=otherSlot},inventory=inv.id}},true)
    if server.syncInventory then server.syncInventory(inv) end
    return {ok=true,state=snapshot(inv,weapon),components=table.clone(nextMetadata.components)}
end)
