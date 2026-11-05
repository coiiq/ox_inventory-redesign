local config=lib.load('data.coii_ammo')
local Boxes={}
function Boxes.definition(item)
    local definition=item and config.boxes[item.name]
    return definition and item.ammoBox==definition.ammo and definition or nil
end
function Boxes.remaining(item,metadata)
    local definition=Boxes.definition(item)
    if not definition then return 0 end
    local rounds=metadata and metadata.rounds
    if rounds==nil then return definition.rounds end
    if type(rounds)~='number' or rounds~=rounds or math.abs(rounds)==math.huge then return 0 end
    return math.max(0,math.min(definition.rounds,math.floor(rounds)))
end
function Boxes.normalize(item,metadata)
    local definition=Boxes.definition(item)
    if definition then
        metadata.rounds=Boxes.remaining(item,metadata)
        metadata.description=('%d / %d rounds. Loads %s into a compatible equipped weapon; unused rounds stay in this box.'):format(metadata.rounds,definition.rounds,definition.label)
    end
    return metadata
end
function Boxes.capacity(weapon,metadata)
    local definition=weapon and config.weapons[weapon.name]
    if not definition then return 0 end
    local capacity=definition.clip
    for _,component in ipairs(metadata.components or {})do capacity=definition.clips[component] or capacity end
    return capacity
end
return Boxes
