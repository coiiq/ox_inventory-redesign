local fits=lib.load('data.coii_attachments')
local Attachments={}
local mounts={
    sight={label='SIGHT',bones={'WAPScop','WAPScop_2','WAPScop_3'}},
    scope={label='OPTIC',bones={'WAPScop','WAPScop_2','WAPScop_3'}},
    muzzle={label='MUZZLE',bones={'WAPSupp','WAPSupp_2','gun_muzzle'}},
    magazine={label='MAGAZINE',bones={'WAPClip','WAPClip_2','gun_ammo'}},
    flashlight={label='LIGHT',bones={'WAPFlshLasr','WAPFlshLasr_2','WAPFlsh','WAPFlsh_2'}},
    grip={label='GRIP',bones={'WAPGrip','WAPGrip_2'}},
    barrel={label='BARREL',bones={'WAPBarrel','WAPBarrel_2','gun_barrels'}},
    skin={label='FINISH',bones={'Gun_Main_Bone','Gun_Root','root',boundsCenter=true}},
}
function Attachments.catalog(item,names)
    if not item.weapon then return {} end
    local items=require 'modules.items.client'
    local allowed=fits[item.name] and fits[item.name].components or {}
    local candidates,groups={},{ }
    for name,hash in pairs(allowed) do if DoesWeaponTakeWeaponComponent(item.hash,hash) then candidates[name]=true end end
    for _,name in ipairs(type(names)=='table' and names or {}) do if type(name)=='string' then candidates[name]=true end end
    for name in pairs(candidates) do
        local part=items[name]
        if part and part.component then
            local id=part.type or 'attachment'
            local definition=mounts[id] or {label=string.upper(id),bones={'gun_root','root'}}
            groups[id]=groups[id] or {id=id,label=definition.label,parts={}}
            groups[id].parts[#groups[id].parts+1]={name=name,label=part.label,type=id}
        end
    end
    local result={}
    for _,group in pairs(groups) do table.sort(group.parts,function(a,b)return a.name<b.name end);result[#result+1]=group end
    table.sort(result,function(a,b)return a.id<b.id end)
    return result
end
function Attachments.anchor(item,id)
    local anchors=fits[item.name] and fits[item.name].anchors
    local custom=anchors and (anchors[id] or id=='sight' and anchors.scope)
    if type(custom)=='string' then return {custom} end
    if type(custom)=='table' and type(custom.x)=='number' and type(custom.y)=='number' and type(custom.z)=='number' then return custom end
    return mounts[id] and mounts[id].bones or {'gun_root','root'}
end
function Attachments.parts(item,names)
    local items=require 'modules.items.client'
    local found={}
    local hash=item.hash or joaat(item.model or item.name)
    for index=1,math.min(type(names)=='table' and #names or 0,32) do
        local component=type(names[index])=='string' and items[names[index]]
        local hashes=component and component.component and component.client and component.client.component
        for _,candidate in ipairs(type(hashes)=='table' and hashes or {}) do
            if DoesWeaponTakeWeaponComponent(hash,candidate) then found[#found+1]={hash=candidate,name=component.name or names[index],type=component.type};break end
        end
    end
    return found
end
function Attachments.hashes(item,names)
    local hashes={}
    for _,part in ipairs(Attachments.parts(item,names)) do hashes[#hashes+1]=part.hash end
    return hashes
end
function Attachments.appearance(item,names,baseModel,weaponModel)
    -- A VARMOD component flag alone does not replace a weapon object's body.
    -- Use the component drawable for real model variants; texture-only finishes
    -- and explicitly different configured props retain their base drawable.
    if not item.weapon or not weaponModel or baseModel%4294967296.0~=weaponModel%4294967296.0 then return baseModel end
    for _,part in ipairs(Attachments.parts(item,names)) do
        if part.type=='skin' then
            local ok,model=pcall(GetWeaponComponentTypeModel,part.hash)
            if ok and type(model)=='number' and model~=0 and (IsModelValid(model) or IsModelInCdimage(model)) then
                -- A different full body is installed by CreateWeaponObject.
                -- Giving that VARMOD again corrupts subsequent physical parts.
                return model,model%4294967296.0~=weaponModel%4294967296.0 and part.hash or nil
            end
        end
    end
    return baseModel
end
function Attachments.defaults(item) return fits[item.name] and fits[item.name].defaults or {} end
function Attachments.clip(item,names)
    local clip=item.ammoname and GetWeaponClipSize(item.hash)
    for _,part in ipairs(Attachments.parts(item,names)) do
        if part.type=='magazine' then
            local ok,size=pcall(GetWeaponComponentClipSize,part.hash)
            if ok and type(size)=='number' and size==size and size>0 and size<math.huge then clip=size end
        end
    end
    return clip
end
function Attachments.register(Preview)
    local busy=false
    local function owned(data)
        if type(data)~='table' or data.inventory~='player' or type(data.slot)~='number' then return end
        if not client.coiiIsOpen() or not Preview.owns(data.session,data.name) then return end
        local slot=PlayerData.inventory and PlayerData.inventory[data.slot]
        if not slot or slot.name~=data.name or slot.metadata.serial~=data.serial then return end
        local item=(require 'modules.items.client')[slot.name]
        if item and item.weapon then return item,slot end
    end
    local function filter(state,item)
        if type(state)~='table' then return false end
        local available={}
        local allowed=fits[item.name] and fits[item.name].components or {}
        for _,option in ipairs(state.available or {}) do
            local hash=allowed[option.name]
            if hash and DoesWeaponTakeWeaponComponent(item.hash,hash) then available[#available+1]=option end
        end
        state.available=available
        return state
    end
    RegisterNUICallback('coiiAttachmentState',function(data,cb)
        local item=owned(data)
        if not item then return cb(false) end
        local ok,state=pcall(lib.callback.await,'ox_inventory:coiiAttachmentState',false,data)
        cb(ok and owned(data) and filter(state,item) or false)
    end)
    RegisterNUICallback('coiiInspectAttachment',function(data,cb)
        local item,slot=owned(data)
        if not item or busy then return cb({ok=false,error='This weapon is not available for modification.'}) end
        if data.action=='install' then
            local allowed=fits[item.name] and fits[item.name].components
            local hash=allowed and allowed[data.component]
            if not hash or not DoesWeaponTakeWeaponComponent(item.hash,hash) then return cb({ok=false,error='This attachment does not fit this weapon.'}) end
        end
        busy=true
        local ok,result=pcall(lib.callback.await,'ox_inventory:coiiInspectAttachment',false,data)
        busy=false
        if not ok or type(result)~='table' then return cb({ok=false,error='Could not update this attachment. Please try again.'}) end
        if result.state then result.state=filter(result.state,item) end
        if result.ok then
            -- Sync only an already equipped matching weapon. Inspection never
            -- equips, reloads or switches the player's current weapon.
            local held=exports.ox_inventory:getCurrentWeapon()
            if held and held.slot==slot.slot and held.name==slot.name and held.metadata.serial==slot.metadata.serial then
                -- Touch only the committed part. Built-in/default components
                -- and components owned by another integration stay intact.
                for _,hash in ipairs(Attachments.hashes(item,{data.component})) do
                    local has=HasPedGotWeaponComponent(cache.ped,item.hash,hash)
                    if data.action=='install' and not has then
                        GiveWeaponComponentToPed(cache.ped,item.hash,hash)
                        TriggerEvent('ox_inventory:updateWeaponComponent','added',hash,data.component)
                    elseif data.action=='remove' and has then
                        RemoveWeaponComponentFromPed(cache.ped,item.hash,hash)
                        TriggerEvent('ox_inventory:updateWeaponComponent','removed',hash,data.component)
                    end
                end
            end
        end
        cb(result)
    end)
    RegisterNUICallback('coiiInspectComponents',function(data,cb)
        if type(data)~='table' then return cb(false) end
        local item=(require 'modules.items.client')[data.name]
        if not item or not item.weapon or not Preview.owns(data.session,data.name) then return cb(false) end
        local ok=Preview.components(data.session,data.components)
        cb(ok and {clipSize=Attachments.clip(item,data.components)} or false)
    end)
end
return Attachments
