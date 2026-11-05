import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('./', import.meta.url));
const read = name => readFile(path.join(root, name), 'utf8');
if (process.argv.includes('--vendor')) {
  const cwd = path.join(root, 'web/upstream');
  const bun = process.env.BUN_PATH || 'bun';
  execFileSync(bun, ['install', '--frozen-lockfile'], { cwd, stdio: 'inherit', windowsHide: true });
  execFileSync(bun, ['run', 'build'], { cwd, stdio: 'inherit', windowsHide: true });
  const provenance = JSON.parse(await read('web/vendor/provenance.json'));
  const outputs = await Promise.all(Object.entries(provenance.bundles).map(async ([name, expected]) => {
    const bytes = await readFile(path.join(cwd, 'build/assets', name.replace('ox-inventory', 'index')));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) {
      throw new Error(`Upstream ${name} differs from the pinned release. Review the compiler/output change before updating the UI adapters.`);
    }
    return [name, bytes];
  }));
  for (const [name, bytes] of outputs) await writeFile(path.join(root, 'web/vendor', name), bytes);
  console.log('Upstream bundles rebuilt and verified.');
}
let code = await read('web/vendor/ox-inventory.js');
function replace(before, after) {
  if (code.split(before).length !== 2) throw new Error(`Stock UI adapter mismatch: ${before.slice(0, 90)}`);
  code = code.replace(before, after);
}
function replaceAll(before, after, count) {
  if (code.split(before).length !== count + 1) throw new Error(`Stock quick-slot adapter mismatch: ${before}`);
  code = code.split(before).join(after);
}
// Keep ox's real React, Redux, DnD, tooltips, transactions and context menus.
// The checked-in vendor bundle is untouched; all changes are reproducible here.
replace('initialState:{leftInventory:', 'initialState:{packInventory:{id:``,type:`coii_pack`,slots:0,items:[]},leftInventory:');
replace('sourceInventory:t===Ma.PLAYER?e.leftInventory:e.rightInventory,targetInventory:n?n===Ma.PLAYER?e.leftInventory:e.rightInventory:t===Ma.PLAYER?e.rightInventory:e.leftInventory',
  'sourceInventory:t===Ma.PLAYER?e.leftInventory:t===`coii_pack`?e.packInventory:e.rightInventory,targetInventory:n?n===Ma.PLAYER?e.leftInventory:n===`coii_pack`?e.packInventory:e.rightInventory:t===Ma.PLAYER?e.rightInventory:e.leftInventory');
replace('reducers:{stackSlots:', 'reducers:{coiiBackpack:(e,t)=>{let p=t.payload,i=Math.floor(Date.now()/1e3);e.packInventory=p?{...p,type:`coii_pack`,items:Array.from({length:p.slots},(_,n)=>{let r=Object.values(p.items||{}).find(v=>v&&v.slot===n+1)||{slot:n+1};return r.name?{...r,durability:kl(r.metadata,i)}:r})}:{id:``,type:`coii_pack`,slots:0,items:[]}},stackSlots:');
replace('coiiBackpack:(e,t)=>', 'coiiPackWeight:(e,t)=>{let p=e.leftInventory.items.find(i=>i.slot===e.packInventory.parentSlot);if(p)p.weight=t.payload},coiiBackpack:(e,t)=>');
replace('let r=t.inventory?t.inventory===Ma.PLAYER?e.leftInventory:e.rightInventory:e.leftInventory;',
  'let r=!t.inventory||t.inventory===Ma.PLAYER||t.inventory===e.leftInventory.id?e.leftInventory:t.inventory===`coii_pack`||t.inventory===e.packInventory.id?e.packInventory:e.rightInventory;');
replace('history={leftInventory:gi(e.leftInventory),rightInventory:gi(e.rightInventory)}',
  'history={leftInventory:gi(e.leftInventory),rightInventory:gi(e.rightInventory),packInventory:gi(e.packInventory)}');
replace('e.rightInventory=e.history.rightInventory),e.isBusy=!1',
  'e.rightInventory=e.history.rightInventory,e.packInventory=e.history.packInventory||e.packInventory),e.isBusy=!1');
replace('if(i.type===Ma.CONTAINER)return console.log', 'if(i.type===Ma.CONTAINER||i.type===`coii_pack`)return console.log');
replace('typeof r==`number`&&n(Vl(r))', 'typeof r==`number`&&n(e.fromType===`coii_pack`||e.toType===`coii_pack`?{type:`inventory/coiiPackWeight`,payload:r}:Vl(r))');
replace('&&n!==Ma.SHOP&&n!==Ma.CRAFTING}),[n,e])', '&&n!==Ma.SHOP&&n!==Ma.CRAFTING&&(!(t.inventory===Ma.SHOP||t.inventory===Ma.CRAFTING)||n===Ma.PLAYER)}),[n,e])');
replace('&&n!==Ma.SHOP&&n!==Ma.CRAFTING&&(!(t.inventory===Ma.SHOP', '&&n!==Ma.SHOP&&n!==Ma.CRAFTING&&window.CoiiInventory.canDropSlot(t,n,e.slot,e)&&(!(t.inventory===Ma.SHOP');
// Every native move path (including context/ctrl-click) respects equipment.
replace('let s=t?i.items[t.item.slot-1]:Dl(a,o,i.items);', 'let s=t?i.items[t.item.slot-1]:Dl(a,o,i.type===Ma.PLAYER?i.items.filter(v=>v.slot<Number(i.quickSlotStart||window.CoiiInventory.quickSlotStart||25)):i.items);if(s&&!window.CoiiInventory.canDropSlot({...e,item:a},i.type,s.slot,s))return;');
// Quick cells are real reserved player slots; ordinary slots 1..5 are pockets.
replace('n=$l(G).items.slice(0,5)', 'n=window.CoiiInventory.quickItems($l(G))');
replaceAll('n===`player`&&e.slot<=5', 'n===`player`&&window.CoiiInventory.quickKey(e.slot)>0', 2);
replaceAll('className:`inventory-slot-number`,children:e.slot', 'className:`inventory-slot-number`,children:window.CoiiInventory.quickKey(e.slot)', 2);
// Inspect is available on any populated storage slot. Player-only actions keep
// their original scope; the context records its inventory id to reject stale menus.
replace('!(n!==`player`||!Tl(e))&&o(Jl({item:e,coords:{x:t.clientX,y:t.clientY}}))',
  'Tl(e)&&(n===`player`||window.CoiiInventory.canInspect(e))&&o(Jl({item:e,inventory:n,inventoryId:Ol(Zl.getState().inventory,n).sourceInventory.id,coords:{x:t.clientX,y:t.clientY}}))');
replace('e.coords=t.payload.coords,e.item=t.payload.item',
  'e.coords=t.payload.coords,e.item=t.payload.item,e.inventory=t.payload.inventory||`player`,e.inventoryId=t.payload.inventoryId');
replace('Mv=()=>{let e=$l(e=>e.contextMenu).item,t=t=>', 'Mv=()=>{let c=$l(e=>e.contextMenu),e=c.item,t=t=>');
replace('case`use`:tu({name:e.name,slot:e.slot});', 'case`inspect`:window.CoiiInventory.inspectItem({inventory:c.inventory||`player`,id:c.inventoryId,item:e});Zl.dispatch(Yl());break;case`use`:tu({name:e.name,slot:e.slot});');
replace('children:[(0,z.jsx)(Av,{onClick:()=>t({action:`use`})',
  'children:[(!c.inventory||c.inventory===`player`)&&(0,z.jsx)(Av,{onClick:()=>t({action:`use`})');
replace('label:ru.ui_drop||`Drop`}),e&&e.metadata?.ammo>0',
  'label:ru.ui_drop||`Drop`}),window.CoiiInventory.canInspect(e)&&(0,z.jsx)(Av,{onClick:()=>t({action:`inspect`}),label:ru.ui_inspect||`Inspect`}),e&&e.metadata?.ammo>0');
for (const action of ['give','drop']) replace(`(0,z.jsx)(Av,{onClick:()=>t({action:\`${action}\`})`, `(!c.inventory||c.inventory===\`player\`)&&(0,z.jsx)(Av,{onClick:()=>t({action:\`${action}\`})`);
for (const marker of ['e&&e.metadata?.ammo>0','e&&e.metadata?.components&&e.metadata?.components.length>0','(e&&e.name&&hl[e.name]?.buttons?.length||0)>0']) {
  replace(marker+'&&', '(!c.inventory||c.inventory===`player`)&&'+marker+'&&');
}
replace('Pv=()=>', 'CoiiLayout=window.CoiiInventory.createLayout({React:x,Slot:kh,useSelector:$l,useDispatch:Ql,getLeft:G,getRight:K,store:Zl,fetchNui:Sl,useNuiEvent:eu,image:Ml,items:hl,locale:ru,setAmount:Fl,useDrop:yr,move:wh,useItem:tu,giveItem:nu,buyItem:Eh,craftItem:Oh,findSlot:Dl,canAccess:Cl,canCraft:wl,openTooltip:Wl,closeTooltip:Gl,closeContext:Yl}),Pv=()=>');
replace('Pv=()=>', 'CoiiNotifications=window.CoiiInventory.createNotifications({React:x,useNuiEvent:eu,image:Ml,items:hl,locale:ru,portal:T.createPortal}),Pv=()=>');
// Replace the stock item toast provider, retaining the live event bridge even
// when the inventory wheel is closed. Context menus and tooltips are unchanged.
replace('children:(0,z.jsx)(Hv,{children:(0,z.jsx)(Rv,{})})', 'children:(0,z.jsx)(CoiiNotifications,{children:(0,z.jsx)(Rv,{})})');
replace('children:[(0,z.jsx)(Ph,{}),(0,z.jsx)(Bm,{}),(0,z.jsx)(Nh,{}),(0,z.jsx)(Ev,{}),(0,z.jsx)(Mv,{})]',
  'children:[(0,z.jsx)(CoiiLayout,{}),(0,z.jsx)(Ev,{}),(0,z.jsx)(Mv,{})]');
// Never load the stock external demo image in the shipped UI.
replace('vl()&&(Uv.style.backgroundImage=`url("https://i.imgur.com/3pzRj9n.png")`,Uv.style.backgroundSize=`cover`,Uv.style.backgroundRepeat=`no-repeat`,Uv.style.backgroundPosition=`center`),', '');
await mkdir(path.join(root, 'web/build/assets'), { recursive: true });
await writeFile(path.join(root, 'web/build/assets/index.js'), code);
await writeFile(path.join(root, 'web/build/assets/coii-layout.js'), await read('web/src/layout.js'));
await writeFile(path.join(root, 'web/build/assets/coii-theme.js'), await read('web/src/theme.js'));
await writeFile(path.join(root, 'web/build/assets/coii-medical.js'), await read('web/src/medical.js'));
await writeFile(path.join(root, 'web/build/assets/index.css'), (await read('web/vendor/ox-inventory.css')) + '\n' + (await read('web/src/style.css')) + '\n' + (await read('web/src/theme.css')) + '\n' + (await read('web/src/medical.css')));
console.log('Built COII layout with original ox transactions and three-inventory support.');
