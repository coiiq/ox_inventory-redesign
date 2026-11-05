-- Replicated server.cfg / inventory.cfg presentation settings. No polling.
local prefix='inventory:ui:'
local legacy=lib.load('data.coii')
local schema={
    accent={kind='color',default=legacy.Accent or '#50B7F5'},
    background={kind='color',default='#0B1320'},text={kind='color',default='#FFFFFF'},
    muted={kind='color',default='#A7B3C4'},border={kind='color',default='#2A394D'},
    pattern={kind='color',default='#29405B'},tile={kind='color',default='#FFFFFF'},
    opacity={kind='number',default=1,min=.25,max=1},patternOpacity={kind='number',default=.18,min=0,max=1},
    headingFont={kind='choice',default='barlow',choices={barlow=true,impact=true,arial=true}},
    bodyFont={kind='choice',default='barlow',choices={barlow=true,arial=true,condensed=true}},
    wheelSize={kind='number',default=66,min=48,max=72},
    tilt={kind='boolean',default=true},animations={kind='boolean',default=true},
    sounds={kind='boolean',default=true},volume={kind='number',default=1,min=0,max=1},
}
local function read()
    local result={}
    for key,rule in pairs(schema)do
        local value=GetConvar(prefix..key,tostring(rule.default))
        if rule.kind=='color'then
            value=value:match('^#%x%x%x$')or value:match('^#%x%x%x%x%x%x$')or rule.default
        elseif rule.kind=='number'then
            value=tonumber(value)
            if not value or value~=value or value==math.huge or value==-math.huge then value=rule.default end
            value=math.max(rule.min,math.min(rule.max,value))
        elseif rule.kind=='choice'then value=rule.choices[value]and value or rule.default
        else
            if value=='true'or value=='1'then value=true
            elseif value=='false'or value=='0'then value=false
            else value=rule.default end
        end
        result[key]=value
    end
    return result
end
RegisterNUICallback('coiiTheme',function(_,cb)cb(read())end)
local cookie
if type(AddConvarChangeListener)=='function'then
    cookie=AddConvarChangeListener(prefix..'*',function(name)
        if schema[name:sub(#prefix+1)]then SendNUIMessage({action='coiiTheme',data=read()})end
    end)
end
AddEventHandler('onResourceStop',function(resource)
    if resource==GetCurrentResourceName()and cookie and type(RemoveConvarChangeListener)=='function'then RemoveConvarChangeListener(cookie)end
end)
return{read=read}
