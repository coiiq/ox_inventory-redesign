local config=lib.load('data.coii_medical')
local inventory=exports[shared.resource]
local active,lastTicket=nil,0
local function alive(ped)return ped and ped==cache.ped and not PlayerData.dead and not IsEntityDead(ped)and GetEntityHealth(ped)>100 end
local function stop()
    if active and type(lib.progressActive)=='function'and lib.progressActive()then lib.cancelProgress()end
    active=nil;SendNUIMessage({action='coiiMedicalStop'})
end
exports('medicalSyringe',function(data)
    if active or type(data)~='table'or data.name~=config.item then return end
    local ped=cache.ped
    if not alive(ped)then return end
    if GetEntityHealth(ped)>=GetEntityMaxHealth(ped)then return lib.notify({type='inform',description='Your health is already full.'})end
    if cache.vehicle then return lib.notify({type='error',description='Step out of the vehicle to use the syringe.'})end
    local use={ped=ped,completed=false}
    active=use
    local requested=false
    local ok,reason=pcall(function()
        lib.requestModel(config.prop.model,5000)
        requested=true
        lib.requestAnimDict(config.anim.dict,5000)
        if active~=use or not alive(ped)then return end
        TriggerEvent('ox_inventory:disarm',true)
        inventory:useItem(data,function(result)if result and active==use then use.completed=true end end)
    end)
    if requested then SetModelAsNoLongerNeeded(joaat(config.prop.model))end
    if not ok then
        print(('[ox_inventory] Medical syringe: %s'):format(tostring(reason)))
        lib.notify({type='error',description='The syringe animation could not load.'})
    end
    if active==use then
        if not ok or not use.completed then active=nil
        else SetTimeout(5000,function()if active==use then active=nil end end)end
    end
end)
RegisterNetEvent('ox_inventory:coiiSyringeApplied',function(data)
    if source~=65535 or not active or type(data)~='table'or type(data.ticket)~='number'
        or data.ticket%1~=0 or data.ticket<=lastTicket or not alive(active.ped)then return end
    local ped=active.ped
    local before=GetEntityHealth(ped)
    local target=math.min(GetEntityMaxHealth(ped),before+config.heal)
    lastTicket=data.ticket;active=nil
    if target<=before then return end
    SetEntityHealth(ped,target)
    SendNUIMessage({action='coiiMedicalPulse',data={duration=config.effectDuration}})
end)
AddEventHandler('esx:onPlayerDeath',stop)
AddEventHandler('esx:onPlayerLogout',stop)
AddEventHandler('playerSpawned',stop)
AddEventHandler('onResourceStop',function(resource)if resource==GetCurrentResourceName()then stop()end end)
