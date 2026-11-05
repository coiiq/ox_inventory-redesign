-- Repack a saved layout without deleting items or assigning normal items to Quick.
return function(items, oldPockets, pockets)
    local result, pending, overflow, slots = {}, {}, {}, {}
    for slot in pairs(items) do slots[#slots + 1] = slot end
    table.sort(slots)
    for _, slot in ipairs(slots) do
        local item = items[slot]
        if slot > oldPockets and slot <= oldPockets + 5 then
            local target = pockets + slot - oldPockets
            item.slot = target
            result[target] = item
        elseif slot >= 1 and slot <= pockets then
            result[slot] = item
        else
            pending[#pending + 1] = item
        end
    end
    for _, item in ipairs(pending) do
        local target
        for slot = 1, pockets do if not result[slot] then target = slot break end end
        if target then
            item.slot = target
            result[target] = item
        else
            item.slot = #overflow + 1
            overflow[#overflow + 1] = item
        end
    end
    return result, overflow
end
