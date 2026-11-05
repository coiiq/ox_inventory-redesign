# Installation and upgrades

The resource directory must be named **ox_inventory**. This fork replaces ox_inventory; run one copy only. Existing integrations call its original events and exports.

## Requirements

| Component | Requirement |
| --- | --- |
| FXServer | Artifact 6116 or later, with OneSync enabled; use a current supported artifact |
| Database | MySQL/MariaDB through oxmysql 2.7.3 or later |
| ox_lib | 3.36.4 or later |
| Framework | ESX 1.6.0 or later is the primary tested integration |
| Target interactions | [COII Target](CONFIGURATION.md#targeting) or ox_target, optional |

The inherited `ox`, `qbx` and `nd` bridges are included, but have not received the same live acceptance checks as ESX. This is not a standalone economy/framework implementation. Native models available to Inspect also depend on the server's enforced game build. The two backpack prop-target interactions require targeting; without it, collect the bag through the ordinary nearby Ground inventory. The default phone hook supports npwd when installed; integrate your own phone's use behavior if needed.

## New installation

1. Download the fork's `ox_inventory.zip` release asset and extract its `ox_inventory` directory into your resources directory. The same archive includes the built UI and complete buildable source. Node and Bun are not needed by FXServer.
2. Install and configure your framework, oxmysql and ox_lib. For ESX, set `Config.CustomInventory = 'ox'` in es_extended. Disable competing inventory resources, including `esx_inventory` and `esx_inventoryhud` where installed. Configure weapon licenses/status resources if your shops or item actions use them.
3. Copy [inventory.cfg](../setup/inventory.cfg) and the contents of [COII-THEME.cfg](../setup/COII-THEME.cfg) into a file named `inventory.cfg` in the server-data directory. Review the framework and target settings. Use one copy of each convar.
4. Put the configuration before the resource start in `server.cfg`:

```cfg
exec inventory.cfg
ensure oxmysql
ensure ox_lib
ensure es_extended
# ensure ox_target  # required only with inventory:target true
ensure ox_inventory
```

For another framework, substitute its start command and matching `inventory:framework` value. Scripts that call inventory exports should start after ox_inventory.

5. Start the server and review the console before allowing players to join. The database module creates its `ox_inventory` table and adds missing inventory/glovebox/trunk columns to the framework tables; the database account needs permission for those operations. ESX expects `users`, `owned_vehicles`, `licenses` and `user_licenses` as provided by its standard schema/license integration. Resolve database errors rather than ignoring them.
6. Test the release on a staging server with two connected players. Restarting inventory can stop dependent scripts; start those again afterwards. A fresh reconnect checks native models and NUI assets.

## Upgrade from standard ox_inventory

Back up the resource, configuration/data files and database before changing slot layouts. Stop the server for replacement. Merge your item definitions, shops, stashes, crafting recipes and bridge customizations with this release; overwriting the fork with old files can remove required code.

The default layout has 24 pockets, five dedicated Quick slots and one backpack equipment slot. Pockets 1–5 are ordinary pockets. On first load, saved slots are remapped and the layout marker is written in a database transaction. Items that do not fit are saved to the player's recovery stash, available through `/inventoryoverflow`.

`data/coii.lua` has `LegacyPocketSlots = 50`. **Set this to the previous installation's pocket-slot count before players first join** if it differed from 50. Existing custom items must remain defined while migrating them. Check one populated test account, its weapon metadata and recovery stash before migrating everyone.

Changing the pocket count later changes the reserved Quick/backpack slot numbers. Integrations must not assume the first five slots are hotkeys. Pockets are capped at 24. Rollback requires restoring the matching resource and database snapshot together; reverting only Lua files does not undo saved slot migration.

## Customization

- Presentation: replicated `inventory:ui:*` convars; see [theme settings](CONFIGURATION.md). After initial startup, `exec inventory.cfg` applies these live.
- Backpack capacity, clothing and dropped model: `data/coii.lua`, [backpack settings](CONFIGURATION.md).
- Weapons/items: `data/weapons.lua`, `data/items.lua`; top-level `prop` opts an entry into Inspect. Custom models must be streamed separately.
- Attachments/capacity: `data/coii_attachments.lua`, `data/coii_ammo.lua`. Use actual native component hashes and capacities for custom weapons.
- Healing/cooldown/animation/prop offsets: `data/coii_medical.lua`. Test the prop on the ped/clothing models used by your server.

Weights are configured in **grams**, displayed in kilograms. Lua changes require a resource restart. Theme edits require no rebuild.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing exports/UI | Directory is exactly `ox_inventory`, one copy is started, and `web/build` is included |
| Inventory never opens | Resource console, dependencies, framework configuration and database errors |
| Buy stays disabled | Player inventory initialized with a real ID; currency/license/grade/stock/carry requirements are met |
| Model cannot be inspected | Top-level `prop` is set and its model/game build is available |
| Item does not use | Resource named by its client/server export exists and is started |
| Black screen while closed | Restore transparent root styles and `color-scheme: only light`; avoid browser dark mode on html/body |
| Backpack clothing missing | Configure component 5 for your ped/clothing pack |
| Extra items after migration | Use `/inventoryoverflow` and check `LegacyPocketSlots` |

Original event/export docs: [Overextended](https://overextended.dev/docs/ox_inventory). Fork-specific support belongs in this repository.
