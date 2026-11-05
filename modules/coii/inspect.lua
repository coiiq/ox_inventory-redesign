-- A local prop viewed through a fixed copy of the current camera. Disabling
-- its depth-of-field keeps the near prop sharp without moving the viewpoint.
-- The real player is hidden locally only while this preview renders.
local Preview = {}
local ZOOM_MIN,ZOOM_MAX=.65,2.5
local viewDefaults={depth=1.5,light=.08}
local active, pending, generation, blurSuppressed = nil, nil, 0, false
local Utils = require 'modules.utils.client'
local Attachments = require 'modules.coii.attachments'
local function isOpen() return client.coiiIsOpen and client.coiiIsOpen() == true end
local function finite(value) return type(value) == 'number' and value == value and math.abs(value) < math.huge end
local function clamp(value, low, high) return math.max(low, math.min(high, value)) end
local function length(v) return math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) end
local function unit(v)
    local size = math.max(length(v), .00001)
    return { x=v.x/size, y=v.y/size, z=v.z/size }
end
local function distance(a,b) return length({x=a.x-b.x,y=a.y-b.y,z=a.z-b.z}) end
local function ray(x,y,depth)
    local at, normal = GetWorldCoordFromScreenCoord(x,y)
    return {x=at.x+normal.x*depth,y=at.y+normal.y*depth,z=at.z+normal.z*depth}
end
local function frame(value)
    if type(value) ~= 'table' then return end
    local x,y,w,h=value.x,value.y,value.width,value.height
    if not finite(x) or not finite(y) or not finite(w) or not finite(h)
        or w < .02 or h < .02 or x < 0 or y < 0 or x+w > 1.001 or y+h > 1.001 then return end
    return {x=x,y=y,width=w,height=h}
end
function Preview.definition(item)
    -- Only the explicit top-level prop opts an item in. client.prop belongs to
    -- consumption animations and metadata may never supply an inspect model.
    local prop = item and item.prop
    local model = type(prop) == 'table' and prop.model or prop
    if type(model) == 'string' then
        if not model:find('%S') or #model > 100 then return end
    elseif not finite(model) or model == 0 or model % 1 ~= 0 then return end
    local rotation = type(prop) == 'table' and prop.rotation
    rotation = type(rotation) == 'table' and rotation or {}
    return {model=model,rotation={x=finite(rotation.x) and rotation.x or 0,y=finite(rotation.y) and rotation.y or 0,z=finite(rotation.z) and rotation.z or 0}}
end
function Preview.close(session, restore)
    if session and not (active and active.session==session) and not (pending and pending.session==session) then return false end
    generation=generation+1
    pending=nil
    local old=active
    active=nil
    if old and DoesEntityExist(old.entity) then DeleteEntity(old.entity) end
    if old and old.camera and DoesCamExist(old.camera) then
        if GetRenderingCam()==old.camera then
            SetCamActive(old.camera,false)
            if old.previousCamera and old.previousCamera~=-1 and DoesCamExist(old.previousCamera) then
                SetCamActive(old.previousCamera,true)
                RenderScriptCams(true,false,0,true,false)
            else RenderScriptCams(false,false,0,true,false) end
        end
        DestroyCam(old.camera,false)
    end
    if blurSuppressed then
        blurSuppressed=false
        if restore ~= false and isOpen() and client.screenblur then Utils.blurIn() end
    end
    return true
end
function Preview.owns(session,name)
    return active and active.session==session and active.name==name and isOpen() or false
end
local function prepareEntity(entity)
    SetEntityVisible(entity,false,false)
    SetEntityAsMissionEntity(entity,true,false)
    SetEntityCollision(entity,false,false)
    SetEntityCompletelyDisableCollision(entity,true,false)
    SetEntityHasGravity(entity,false)
    FreezeEntityPosition(entity,true)
end
function Preview.components(session,names)
    local state=active
    if not state or state.session~=session or not state.item.weapon or not isOpen() or type(names)~='table' or #names>32 then return false end
    state.componentVersion=(state.componentVersion or 0)+1
    local version=state.componentVersion
    local parts=Attachments.parts(state.item,names)
    local appearance,bodyComponent=Attachments.appearance(state.item,names,state.baseModel,state.weaponModel)
    local hashes={}
    for _,part in ipairs(parts) do hashes[#hashes+1]=part.hash end
    if state.model==appearance and state.components and #state.components==#hashes then
        local same=true
        for i,hash in ipairs(hashes) do if state.components[i]~=hash then same=false;break end end
        if same then return true end
    end
    local models={}
    local replacement
    local replace=state.model~=appearance
    local low,high,diameter
    if replace then
        models[#models+1]=appearance
        local ok,reason=pcall(lib.requestModel,appearance,5000)
        if not ok or active~=state or version~=state.componentVersion then
            SetModelAsNoLongerNeeded(appearance)
            if not ok then print(('[ox_inventory] Inspect %s: finish drawable could not load: %s'):format(state.name,tostring(reason))) end
            return false
        end
        low,high=GetModelDimensions(appearance);diameter=distance(low,high)
        if not finite(diameter) or diameter<.001 then SetModelAsNoLongerNeeded(appearance);return false end
    end
    for _,part in ipairs(parts) do
        -- VARMOD skins are weapon appearance variants, not detachable prop
        -- models. Streaming them with RequestModel can fail even though the
        -- weapon supports the finish. Let the weapon renderer resolve them.
        local model=part.type~='skin' and GetWeaponComponentTypeModel(part.hash)
        if model and model~=0 then
            models[#models+1]=model
            local ok,reason=pcall(lib.requestModel,model,3000)
            if not ok or active~=state or version~=state.componentVersion then
                for _,loaded in ipairs(models) do SetModelAsNoLongerNeeded(loaded) end
                if not ok and active==state and version==state.componentVersion then print(('[ox_inventory] Inspect %s: component %s could not load: %s'):format(state.name,part.name,tostring(reason))) end
                return false
            end
        end
    end
    local previous,wanted={},{}
    for _,part in ipairs(replace and {} or state.parts or {}) do previous[part.hash]=part end
    for _,part in ipairs(parts) do wanted[part.hash]=true end
    local ok,reason=pcall(function()
        local target=state.entity
        if replace then
            local at=state.cameraPosition
            local override=appearance%4294967296.0~=state.weaponModel%4294967296.0 and appearance or 0
            replacement=CreateWeaponObject(state.item.hash or joaat(state.item.model or state.item.name),0,at.x,at.y,at.z-10,true,1.0,override,false,false)
            if not replacement or replacement==0 then error('Finish weapon object could not be created') end
            prepareEntity(replacement);target=replacement
        end
        local restoreDefaults=replace or not state.components
        for _,old in ipairs(replace and {} or state.parts or {}) do
            if not wanted[old.hash] then
                if old.hash~=state.bodyComponent then RemoveWeaponComponentFromWeaponObject(target,old.hash) end
                if old.type~='skin' then restoreDefaults=true end
            end
        end
        if restoreDefaults then
            for _,hash in ipairs(Attachments.defaults(state.item)) do GiveWeaponComponentToWeaponObject(target,hash) end
        end
        for _,part in ipairs(parts) do
            -- Restoring a default clip/barrel can replace an upgrade of that
            -- type. Reapply physical upgrades, leaving an unchanged finish alone.
            -- The full-body finish is already the weapon's custom model. Never
            -- pass that VARMOD to the addon native: it suppresses real fittings
            -- (and removing it can crash GTA). Texture-only skins still use it.
            if part.hash~=bodyComponent and (not previous[part.hash] or restoreDefaults and part.type~='skin') then GiveWeaponComponentToWeaponObject(target,part.hash) end
        end
        RequestWeaponHighDetailModel(target)
    end)
    for _,model in ipairs(models) do SetModelAsNoLongerNeeded(model) end
    if not ok then
        if replacement and replacement~=0 and DoesEntityExist(replacement) then DeleteEntity(replacement) end
        print(('[ox_inventory] Inspect %s: components could not apply: %s'):format(state.name,tostring(reason)))
    elseif replacement then
        local old=state.entity
        state.entity,state.model=replacement,appearance
        state.diameter=diameter;state.pivot={x=(low.x+high.x)/2,y=(low.y+high.y)/2,z=(low.z+high.z)/2};state.fit=nil;state.anchorLast=nil
        if DoesEntityExist(old) then DeleteEntity(old) end
    end
    if ok then state.components=hashes;state.parts=parts;state.bodyComponent=bodyComponent;state.dirty=true;state.anchorCache=nil end
    return ok
end
local function projectAnchors(state)
    state.anchorCache=state.anchorCache or {}
    local points,changed={},not state.anchorLast
    for _,mount in ipairs(state.mounts) do
        local cached=state.anchorCache[mount.id]
        if not cached then
            local definition=Attachments.anchor(state.item,mount.id)
            if definition.x then cached={offset=definition} else
                cached={bone=-1}
                for _,name in ipairs(definition) do
                    local bone=GetEntityBoneIndexByName(state.entity,name)
                    if bone and bone>=0 then cached.bone=bone;break end
                end
                -- Finish covers the whole body, so its real drawable center is
                -- meaningful even when a replacement model has no named root.
                if cached.bone<0 and definition.boundsCenter then cached.offset=state.pivot end
            end
            state.anchorCache[mount.id]=cached
        end
        local position
        if cached.offset then
            local t,o=state.transform,cached.offset
            position={x=t.x+t.scale*(t.right.x*o.x+t.forward.x*o.y+t.up.x*o.z),
                y=t.y+t.scale*(t.right.y*o.x+t.forward.y*o.y+t.up.y*o.z),
                z=t.z+t.scale*(t.right.z*o.x+t.forward.z*o.y+t.up.z*o.z)}
        elseif cached.bone>=0 then position=GetWorldPositionOfEntityBone(state.entity,cached.bone) end
        local point={id=mount.id,visible=false}
        if position then
            local visible,x,y=GetScreenCoordFromWorldCoord(position.x,position.y,position.z)
            if visible and finite(x) and finite(y) and x>=0 and x<=1 and y>=0 and y<=1 then point.visible,point.x,point.y=true,x,y end
        end
        local old=state.anchorLast and state.anchorLast[#points+1]
        if not old or old.id~=point.id or old.visible~=point.visible or point.visible and (math.abs(old.x-point.x)>.0001 or math.abs(old.y-point.y)>.0001) then changed=true end
        points[#points+1]=point
    end
    if changed then
        state.anchorLast=points
        SendNUIMessage({action='coiiInspectAnchors',data={session=state.session,points=points}})
    end
end
local function render(state)
    local entity=state.entity
    if not DoesEntityExist(entity) then error('Inspection entity was removed') end
    -- Frame-local visibility ends naturally when this preview stops rendering.
    local ped=cache.ped
    if ped and ped~=0 and DoesEntityExist(ped) then SetEntityLocallyInvisible(ped) end
    -- Keep a broad sharp focus range on our own camera. A nearby metallic
    -- weapon must not inherit the gameplay camera's near-field blur settings.
    SetCamUseShallowDofMode(state.camera,false)
    SetCamNearDof(state.camera,0.0)
    SetCamFarDof(state.camera,10000.0)
    SetCamDofPlanes(state.camera,0.0,0.01,10000.0,10000.0)
    SetCamDofStrength(state.camera,0.0)
    local dt,bounds=clamp(GetFrameTime(),0,.1),state.frame
    local blend=1-math.exp(-dt*18)
    local yawDelta=(state.targetYaw-state.yaw+180)%360-180
    local pitchDelta=state.targetPitch-state.pitch
    local zoomDelta=state.targetZoom-state.zoom
    state.yaw=math.abs(yawDelta)<.001 and state.targetYaw or state.yaw+yawDelta*blend
    state.pitch=math.abs(pitchDelta)<.001 and state.targetPitch or state.pitch+pitchDelta*blend
    state.zoom=math.abs(zoomDelta)<.0001 and state.targetZoom or state.zoom+zoomDelta*blend
    -- Screen-to-world projection contains frame jitter. Cache the fit and leave
    -- a stationary model's matrix untouched; only drag and resize update it.
    if not state.fit then
        local x,y=bounds.x+bounds.width/2,bounds.y+bounds.height/2
        local width=distance(ray(bounds.x,y,state.depth),ray(bounds.x+bounds.width,y,state.depth))
        local height=distance(ray(x,bounds.y,state.depth),ray(x,bounds.y+bounds.height,state.depth))
        state.fit={center=ray(x,y,state.depth),scale=math.min(width,height)*.82/state.diameter}
        state.dirty=true
    end
    if state.dirty or state.lastYaw~=state.yaw or state.lastPitch~=state.pitch or state.lastZoom~=state.zoom then
        local rotation=state.rotation
        SetEntityRotation(entity,rotation.x+state.pitch,rotation.y,state.cameraRotation.z+rotation.z+state.yaw,2,true)
        local forward,right,up=GetEntityMatrix(entity)
        forward,right,up=unit(forward),unit(right),unit(up)
        local center,scale=state.fit.center,state.fit.scale*state.zoom
        local pivot=state.pivot
        local px=center.x-scale*(right.x*pivot.x+forward.x*pivot.y+up.x*pivot.z)
        local py=center.y-scale*(right.y*pivot.x+forward.y*pivot.y+up.y*pivot.z)
        local pz=center.z-scale*(right.z*pivot.x+forward.z*pivot.y+up.z*pivot.z)
        SetEntityMatrix(entity,forward.x*scale,forward.y*scale,forward.z*scale,
            right.x*scale,right.y*scale,right.z*scale,up.x*scale,up.y*scale,up.z*scale,px,py,pz)
        state.transform={forward=forward,right=right,up=up,scale=scale,x=px,y=py,z=pz}
        state.anchorDirty=3
        SetEntityVisible(entity,true,false)
        state.lastYaw,state.lastPitch,state.lastZoom,state.dirty=state.yaw,state.pitch,state.zoom,false
    end
    if state.anchorsEnabled then
        state.anchorElapsed=(state.anchorElapsed or 0)+dt
        if not state.anchorLast or (state.anchorDirty or 0)>0 and state.anchorElapsed>=1/60 then
            projectAnchors(state);state.anchorElapsed=0
            state.anchorDirty=math.max(0,(state.anchorDirty or 0)-1)
        end
    end
    local light=state.cameraPosition
    if state.light>0 then DrawLightWithRange(light.x,light.y,light.z+.25,235,245,255,3.0,state.light) end
end
function Preview.open(item, data)
    local definition=Preview.definition(item)
    local rectangle=frame(data.frame)
    if not definition or not rectangle or type(data.session) ~= 'string' or #data.session < 1 or #data.session > 100 or not isOpen() then return false end
    Preview.close()
    local ticket=generation
    pending={session=data.session}
    local model=definition.model
    local weaponHash=item.weapon and (item.hash or joaat(item.model or item.name))
    local weaponModel=weaponHash and GetWeapontypeModel(weaponHash)
    -- "assaultrifle" is an explicit short alias for this weapon's model, not
    -- an automatic fallback that would make unconfigured weapons inspectable.
    if item.weapon and type(model)=='string' and model:lower()==item.name:lower():gsub('^weapon_','') then
        model=weaponModel
    elseif type(model)=='string' then model=joaat(model) end
    if not model or model==0 or not IsModelInCdimage(model) or not IsModelValid(model) then
        if ticket==generation then pending=nil end
        return false
    end
    local modelRequested=false
    local baseModel=model
    local loaded,loadReason=pcall(function()
        if weaponHash then lib.requestWeaponAsset(weaponHash,5000) end
        if ticket~=generation or not isOpen() then return end
        model=Attachments.appearance(item,data.components,baseModel,weaponModel)
        modelRequested=true
        lib.requestModel(model,5000)
    end)
    if ticket~=generation or not isOpen() then if modelRequested then SetModelAsNoLongerNeeded(model) end;return false end
    pending=nil
    if not loaded then
        if modelRequested then SetModelAsNoLongerNeeded(model) end
        print(('[ox_inventory] Inspect %s: weapon/model could not load: %s'):format(item.name,tostring(loadReason)))
        return false
    end
    local low,high=GetModelDimensions(model)
    local diameter=distance(low,high)
    if not finite(diameter) or diameter<.001 then SetModelAsNoLongerNeeded(model); return false end
    local camera=GetFinalRenderedCamCoord()
    local entity
    if item.weapon then
        -- A weapon object renders real fitted components; the two explicit
        -- false flags keep it local and out of the network object registry.
        -- Leave the default weapon model unforced so VARMOD finishes can choose
        -- their drawable. An explicitly different configured prop stays honored.
        local override=model%4294967296.0~=weaponModel%4294967296.0 and model or 0
        entity=CreateWeaponObject(weaponHash,0,camera.x,camera.y,camera.z-10,true,1.0,override,false,false)
    else entity=CreateObjectNoOffset(model,camera.x,camera.y,camera.z-10,false,false,false) end
    SetModelAsNoLongerNeeded(model)
    if not entity or entity==0 then return false end
    prepareEntity(entity)
    local state={entity=entity,session=data.session,name=item.name,item=item,model=model,baseModel=baseModel,weaponModel=weaponModel,cameraPosition=camera,mounts=Attachments.catalog(item,data.components),frame=rectangle,rotation=definition.rotation,diameter=diameter,depth=viewDefaults.depth,light=viewDefaults.light,
        pivot={x=(low.x+high.x)/2,y=(low.y+high.y)/2,z=(low.z+high.z)/2},yaw=0,pitch=0,targetYaw=0,targetPitch=0,zoom=1,targetZoom=1}
    active=state
    if item.weapon and not Preview.components(data.session,data.components or {}) then Preview.close(data.session);return false end
    local rotation=GetFinalRenderedCamRot(2)
    state.cameraPosition,state.cameraRotation=camera,rotation
    state.previousCamera=GetRenderingCam()
    state.camera=CreateCamWithParams('DEFAULT_SCRIPTED_CAMERA',camera.x,camera.y,camera.z,rotation.x,rotation.y,rotation.z,GetFinalRenderedCamFov(),true,2)
    if not state.camera or state.camera==0 then Preview.close(data.session); return false end
    SetCamUseShallowDofMode(state.camera,false)
    SetCamDofStrength(state.camera,0.0)
    SetCamMotionBlurStrength(state.camera,0.0)
    SetCamNearClip(state.camera,.03)
    SetCamActive(state.camera,true)
    RenderScriptCams(true,false,0,true,false)
    local ok=pcall(render,state)
    if not ok then Preview.close(data.session); return false end
    if client.screenblur then Utils.blurOut(); blurSuppressed=true end
    CreateThread(function()
        while active==state do
            if not isOpen() then Preview.close(state.session); break end
            if not pcall(render,state) then
                Preview.close(state.session)
                SendNUIMessage({action='coiiInspectLost',data={session=state.session}})
                break
            end
            Wait(0)
        end
    end)
    return true
end
RegisterNUICallback('coiiInspectClose',function(data,cb)
    cb(type(data)=='table' and type(data.session)=='string' and Preview.close(data.session) or false)
end)
RegisterNUICallback('coiiInspectRotate',function(data,cb)
    if type(data)~='table' or not active or not isOpen() or data.session~=active.session or not finite(data.yaw) or not finite(data.pitch) then return cb(false) end
    active.targetYaw=data.yaw%360
    active.targetPitch=clamp(data.pitch,-75,75)
    cb(true)
end)
RegisterNUICallback('coiiInspectFrame',function(data,cb)
    local rectangle=type(data)=='table' and frame(data.frame)
    if not active or not isOpen() or not rectangle or data.session~=active.session then return cb(false) end
    local old=active.frame
    if old.x~=rectangle.x or old.y~=rectangle.y or old.width~=rectangle.width or old.height~=rectangle.height then
        active.frame=rectangle
        active.fit=nil
    end
    cb(true)
end)
RegisterNUICallback('coiiInspectZoom',function(data,cb)
    if type(data)~='table' or not active or not isOpen() or data.session~=active.session or not finite(data.zoom) then return cb(false) end
    active.targetZoom=clamp(data.zoom,ZOOM_MIN,ZOOM_MAX)
    cb(true)
end)
RegisterNUICallback('coiiInspectAnchors',function(data,cb)
    if type(data)~='table' or not active or not active.item.weapon or not isOpen() or data.session~=active.session or type(data.enabled)~='boolean' then return cb(false) end
    active.anchorsEnabled=data.enabled
    active.anchorLast=nil;active.anchorDirty=3;active.anchorCache=nil
    cb(true)
end)
-- Session-scoped local preview diagnostics. This can tune only the current
-- preview plane/fill light; it cannot alter inventory items or other entities.
RegisterNUICallback('coiiInspectView',function(data,cb)
    if type(data)~='table' or not active or not isOpen() or data.session~=active.session then return cb(false) end
    if data.depth~=nil and (not finite(data.depth) or data.depth<.35 or data.depth>6) then return cb(false) end
    if data.light~=nil and (not finite(data.light) or data.light<0 or data.light>2) then return cb(false) end
    if data.depth and data.depth~=active.depth then active.depth=data.depth;viewDefaults.depth=data.depth;active.fit=nil;active.anchorLast=nil end
    if data.light~=nil then active.light=data.light;viewDefaults.light=data.light end
    local function read(fn,...)
        if type(fn)~='function' then return end
        local ok,value=pcall(fn,...)
        if ok then return value end
    end
    local parts={}
    for _,part in ipairs(active.parts or {}) do
        local model=read(GetWeaponComponentTypeModel,part.hash)
        local body=part.hash==active.bodyComponent
        local applied=body and read(GetEntityModel,active.entity)==active.model or not body and read(HasWeaponGotWeaponComponent,active.entity,part.hash)
        parts[#parts+1]={name=part.name,type=part.type,hash=part.hash,applied=applied,body=body,
            model=model,modelValid=model and read(IsModelValid,model),modelInCdimage=model and read(IsModelInCdimage,model),modelLoaded=model and read(HasModelLoaded,model)}
    end
    cb({name=active.name,depth=active.depth,light=active.light,zoom=active.zoom,targetZoom=active.targetZoom,entityModel=read(GetEntityModel,active.entity),
        cameraOwned=GetRenderingCam()==active.camera,parts=parts})
end)
AddEventHandler('onResourceStop',function(resource) if resource==GetCurrentResourceName() then Preview.close(nil,false) end end)
return Preview
