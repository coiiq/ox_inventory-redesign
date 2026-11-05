# COII Radial Inventory

A GTA-style radial inventory for FiveM. Manage your items, equipment and storage through a compact wheel, with 3D weapon inspection and a configurable interface.

![Inventory overview](https://i.imgur.com/ERm4bfT.jpeg)

## Features

- **Radial inventory** — eight sectors per page, scroll selection and drag-and-drop transfers.
- **Dedicated Quick slots** — five shortcuts separate from your 24 pocket slots.
- **Backpack equipment** — additional storage, visible clothing and physical drops that keep their contents.
- **Weapon inspection** — rotate and zoom the model, view its stats and manage compatible attachments.
- **Storage and shops** — ground items, stashes, crafting, shops, gloveboxes and trunks.
- **Targeting integration** — compatible with [COII Target](docs/CONFIGURATION.md#targeting) for world interactions.
- **Ammo boxes** — stackable 9mm, 5.56 and 7.62 boxes with remaining-round tracking.
- **Medical syringe** — configurable healing, animation and visual/audio feedback.
- **Customizable theme** — colours, fonts, patterns, wheel size, tilt, motion and sound.

## Weapon inspection

View the weapon in 3D with floating attachment controls. Installed parts appear on the model; compatible parts can be fitted or removed when you own them.

![Weapon inspection](https://i.imgur.com/IcXwtXp.jpeg)

## Backpacks and storage

Equip a backpack to access its extra slots. Drop the whole bag with its contents, open it in place or pick it up through target interactions. Carry limits and item metadata stay with the bag.

![Backpacks and storage](https://i.imgur.com/ETEP2LL.jpeg)

## Configuration

Set the interface colours and presentation in your server configuration:

```cfg
setr inventory:slots 24
setr inventory:weight 30000

setr inventory:ui:accent "#50B7F5"
setr inventory:ui:background "#0B1320"
setr inventory:ui:text "#FFFFFF"
setr inventory:ui:muted "#A7B3C4"
setr inventory:ui:wheelSize 66
setr inventory:ui:tilt true
setr inventory:ui:sounds true
setr inventory:ui:volume 1.0
```

Run `exec inventory.cfg` to apply theme changes. Carrying limits use grams; changing gameplay settings requires a resource restart.

| File | Settings |
| --- | --- |
| `data/coii.lua` | Backpack capacity, clothing and world prop |
| `data/items.lua`, `data/weapons.lua` | Items, weights, models and weapon definitions |
| `data/coii_medical.lua` | Healing, cooldown, animation and syringe prop |

See the [configuration reference](docs/CONFIGURATION.md) for all options and defaults.

## Documentation

[Browse the documentation](docs/README.md) for setup and full configuration.

**Version:** `1.0.0-rc.1`
