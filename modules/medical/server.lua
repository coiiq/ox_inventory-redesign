local config=lib.load('data.coii_medical')
local prepared,cooldowns={},{}
local sequence=0
local function notify(inventory,message)TriggerClientEvent('ox_lib:notify',inventory.id,{type='error',description=message})end
local function health(inventory,completing)
    if not inventory or not inventory.player then return end
    local state=Player(inventory.id).state
    -- ox_lib clears its busy state as progress finishes; replication can lag
    -- the successful item-use reply. Completion is bound to that native use.
    if state.dead or state.invBusy and not completing then return end
    local ped=GetPlayerPed(inventory.id)
    if not ped or ped==0 or not DoesEntityExist(ped)then return end
    local value=GetEntityHealth(ped)
    local maximum=200
    if type(GetEntityMaxHealth)=='function'then
        local ok,result=pcall(GetEntityMaxHealth,ped)
        if ok and type(result)=='number'and result>100 then maximum=result end
    end
    if type(value)~='number'or value<=100 or value>=maximum then return end
    return ped
end
exports('medicalSyringe',function(event,item,inventory,slot)
    if not item or item.name~=config.item or not inventory or not inventory.player then return false end
    local id,now=inventory.id,GetGameTimer()
    if event=='usingItem'then
        if cooldowns[id]and now<cooldowns[id]then
            notify(inventory,('Wait %d seconds before using another syringe.'):format(math.ceil((cooldowns[id]-now)/1000)))
            return false
        end
        local ped=health(inventory)
        if not ped then notify(inventory,'You can only use a syringe while alive and injured.');return false end
        prepared[id]={ped=ped,slot=slot,started=now}
    elseif event=='usedItem'then
        local record=prepared[id]
        prepared[id]=nil
        local used=inventory.usingItem
        if not record or record.slot~=slot or not used or used.name~=config.item or used.slot~=slot
            or now-record.started<config.duration or now-record.started>config.duration+15000
            or record.ped~=health(inventory,true)then return false end
        cooldowns[id]=now+config.cooldown
        sequence=sequence+1
        -- A committed native item-use grants health; clients cannot request a
        -- heal amount or a target player through any new server event.
        TriggerClientEvent('ox_inventory:coiiSyringeApplied',id,{ticket=sequence})
    end
end)
AddEventHandler('playerDropped',function()prepared[source]=nil;cooldowns[source]=nil end)
