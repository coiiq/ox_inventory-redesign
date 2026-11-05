# Configuration

Load `inventory.cfg` from `server.cfg` before `ensure ox_inventory`. Start with `setup/inventory.cfg`, then append `setup/COII-THEME.cfg` for presentation settings.

## Gameplay

| Setting | Default | Purpose |
| --- | --- | --- |
| `inventory:framework` | `esx` | Framework bridge: `esx`, `ox`, `qbx` or `nd` |
| `inventory:slots` | `24` | Pocket slots, capped at 24; Quick/equipment slots are additional |
| `inventory:weight` | `30000` | Player carrying limit in grams |
| `inventory:target` | `false` | Enable ox_target; start it before inventory |
| `inventory:keys` | `["F2", "K", "TAB"]` | Inventory, secondary inventory and hotbar bindings |
| `inventory:screenblur` | `true` | Blur the game while inventory is open |
| `inventory:itemnotify` | `true` | Item notifications |
| `inventory:dropprops` | `false` | Generic dropped-item props; physical backpacks still use their configured prop |

The supplied example enables generic drop props. Use `setr` for client/shared settings. Restart the resource after changing gameplay settings or Lua definitions. Weights use grams internally and kilograms in the interface.

## Targeting

COII Target and ox_target are supported. Start your targeting resource before `ox_inventory`.

Physical backpacks automatically use COII Target when it is running, with **Open backpack** and **Pick up backpack** interactions. The `inventory:target` setting controls the original ox_target location integration. Nearby Ground inventory remains available without a targeting resource.

## Theme

All keys below follow `inventory:ui:` and use `setr`. Run `exec inventory.cfg` after editing them; theme updates apply live without rebuilding the UI.

| Key | Default | Values / meaning |
| --- | --- | --- |
| `accent` | `#50B7F5` | Selection, actions and progress bars |
| `background` | `#0B1320` | Panel colour |
| `text` | `#FFFFFF` | Main text |
| `muted` | `#A7B3C4` | Secondary text |
| `border` | `#2A394D` | Segment borders |
| `pattern` | `#29405B` | Background lines |
| `tile` | `#FFFFFF` | Key hints and image tiles |
| `opacity` | `1` | Background multiplier, 0.25–1 |
| `patternOpacity` | `0.18` | Line opacity, 0–1 |
| `headingFont` | `barlow` | `barlow`, `impact`, `arial` |
| `bodyFont` | `barlow` | `barlow`, `arial`, `condensed` |
| `wheelSize` | `66` | Diameter in viewport-height units, 48–72 |
| `tilt` | `true` | Mouse-driven wheel tilt |
| `animations` | `true` | Intro/motion; disabling also disables tilt |
| `sounds` | `true` | Hover/treatment audio |
| `volume` | `1` | Audio multiplier, 0–1 |

Colours accept quoted `#RGB` or `#RRGGBB`. Invalid values fall back to defaults; selected text chooses a contrasting foreground. Keep the HTML/body canvas transparent and browser colour scheme `only light`, even with dark panels.

## Backpack

`data/coii.lua` configures accepted backpack items, slots/weight, world-drop model and clothing component 5. Defaults: eight slots, 12 kg, `p_michael_backpack_s`, freemode drawable 45. Set male/female drawable/texture/palette for your clothing pack. The previous clothing component is restored on unequip; the resource does not save outfits to your skin system.

Only a backpack in the equipment slot enables its storage/clothing. Contents remain with its unique container ID through normal transfers. The two prop interactions require ox_target (or an installed compatible coii_target). Without targeting, use nearby Ground inventory. World drop positions do not persist through server restarts; collect valuable drops before shutdown.

Before first migration, set `LegacyPocketSlots` to the previous installation's pocket count. See [installation](INSTALL.md).

## Items, weapons and attachments

- `data/items.lua`, `data/weapons.lua`: item definitions and weapon components.
- A top-level `prop` enables Inspect. Use an exact model name or `{ model = 'model_name', rotation = { x = 0, y = 0, z = 0 } }`. `client.prop` separately controls item-use animation props.
- `data/coii_attachments.lua`: authoritative compatible component hashes/defaults. Custom anchor overrides accept a bone name or model-space `{x, y, z}` offset per fitting type.
- `data/coii_ammo.lua`: ammo-box contents and actual magazine capacities. Update this when adding custom weapons/clips.
- `data/coii_medical.lua`: syringe healing, use time, cooldown, screen-effect duration, animation and prop placement.

Only stream models you are allowed to use, and verify native component compatibility. A declared attachment alone cannot make an unsupported weapon model display it.
