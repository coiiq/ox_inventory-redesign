return {
    Accent = '#50B7F5',
    -- 24 pockets, five Quick slots, and one backpack equipment slot.
    LegacyPocketSlots = 50, -- Previous layout, used once when preserving saved items.
    BackpackItems = { backpack = true },
    BackpackSlots = 8,
    BackpackWeight = 12000,
    -- Each dropped backpack is a separate physical pickup, including its contents.
    BackpackDrop = { model = 'p_michael_backpack_s' },
    -- GTA freemode bags, component 5. Change these for your clothing pack.
    -- No skin is saved: the previous bag component is restored on unequip.
    BackpackClothing = {
        male = { drawable = 45, texture = 0, palette = 0 },
        female = { drawable = 45, texture = 0, palette = 0 }
    },
    Preview = false, -- Radial inventory has no character preview.
    Equipment = {
        backpack = { 'backpack' },
        armor = { 'armour', 'armor', 'bulletproof' },
        phone = { 'phone' },
        parachute = { 'parachute', 'gadget_parachute' }
    }
}
