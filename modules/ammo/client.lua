local Boxes=require 'modules.ammo.shared'
local Items=require 'modules.items.client'
local Ammo={}
function Ammo.findSlot(inventory,weapon)
    if not weapon or weapon.metadata.specialAmmo then return end
    local found
    for slot,item in pairs(inventory)do
        local definition=Boxes.definition(Items[item.name])
        if definition and definition.ammo==weapon.ammo and Boxes.remaining(Items[item.name],item.metadata)>0 and (not found or slot<found) then found=slot end
    end
    return found
end
function Ammo.reload(data,getWeapon,useItem)
    local weapon=getWeapon()
    local definition=Boxes.definition(data)
    local function notify(message)lib.notify({type='error',description=message})end
    if not weapon or not definition then return end
    if weapon.ammo~=definition.ammo then return notify('This ammo box does not fit the equipped weapon.')end
    if weapon.metadata.specialAmmo then return notify('Unload special ammunition before using a standard ammo box.')end
    if (weapon.metadata.durability or 0)<=0 then return notify('This weapon is broken.')end
    local ped=cache.ped
    local capacity=GetMaxAmmoInClip(ped,weapon.hash,true)
    local _,maximum=GetMaxAmmo(ped,weapon.hash)
    if GetAmmoInPedWeapon(ped,weapon.hash)>=math.min(capacity,maximum) then return notify('The weapon magazine is full.')end
    useItem(data,function(box)
        if not box or getWeapon()~=weapon then return end
        local before=GetAmmoInPedWeapon(ped,weapon.hash)
        if before<(weapon.metadata.ammo or 0) then
            if not lib.callback.await('ox_inventory:updateWeapon',false,'ammo',before) then return end
        end
        if getWeapon()~=weapon then return end
        local _,maxAmmo=GetMaxAmmo(ped,weapon.hash)
        local result=lib.callback.await('ox_inventory:coiiLoadAmmoBox',false,{
            boxSlot=box.slot,weaponSlot=weapon.slot,name=weapon.name,serial=weapon.metadata.serial,
            rounds=Boxes.remaining(data,box.metadata),ammo=before,limit=math.min(GetMaxAmmoInClip(ped,weapon.hash,true),maxAmmo),
        })
        if not result or not result.ok then return notify(result and result.error or 'Could not reload from this ammo box.')end
        -- A holster/switch while the callback yields never equips another gun.
        -- The committed ammo remains on that inventory weapon for its next use.
        if getWeapon()~=weapon then return end
        weapon.metadata.ammo=result.ammo
        SetPedAmmo(ped,weapon.hash,result.ammo)
        if cache.vehicle then
            if cache.seat>-1 or IsVehicleStopped(cache.vehicle) then TaskReloadWeapon(ped,true)
            else
                lib.waitFor(function()
                    if getWeapon()~=weapon then return true end
                    RefillAmmoInstantly(ped)
                    local _,amount=GetAmmoInClip(ped,weapon.hash)
                    return amount==result.ammo or nil
                end)
            end
        else MakePedReload(ped)end
    end)
end
return Ammo
