import * as T from 'three';
import {RoomEnvironment} from '/three-addons/environments/RoomEnvironment.js';
const renderer=new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
renderer.setSize(768,768);renderer.setClearColor(0,0);renderer.outputColorSpace=T.SRGBColorSpace;
renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
document.body.appendChild(renderer.domElement);
const pmrem=new T.PMREMGenerator(renderer),environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;
const textures=await(await fetch('/artifacts/icon-source/textures.json')).json();
const components=await(await fetch('/artifacts/icon-source/components.json')).json();
const manifest=await(await fetch('/artifacts/icon-source/manifest.json')).json();
const availableModels=new Set(await(await fetch('/artifacts/icon-source/models.json')).json());
const xmlCache=new Map(),textureCache=new Map();
const loadXml=async model=>{
 model=model.toLowerCase();if(xmlCache.has(model))return xmlCache.get(model);
 if(!availableModels.has(model))return null;
 const response=await fetch('/artifacts/icon-source/'+model+'.ydr.xml');
 if(!response.ok)return null;
 const xml=new DOMParser().parseFromString(await response.text(),'application/xml');xmlCache.set(model,xml);return xml;
};
const value=node=>node?.textContent.trim(),attributes=node=>node?['x','y','z','w'].map(k=>Number(node.getAttribute(k))):null;
const child=(node,name)=>Array.from(node.children).find(n=>n.tagName===name);
async function texture(name,model){
 if(!name)return null;name=name.toLowerCase();
 const candidates=textures[name]||[];
 const base=model.toLowerCase().replace(/_hi$/,'');
 const url=candidates.find(p=>p.split('/')[1]===base+'+hi')||candidates.find(p=>p.split('/')[1]===base)||candidates[0];
 if(!url)return null;
 if(!textureCache.has(url))textureCache.set(url,new T.TextureLoader().loadAsync('/artifacts/icon-source/'+url).then(t=>{t.flipY=false;t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t}));
 return textureCache.get(url);
}
function pixels(image){const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return{canvas,context,data:context.getImageData(0,0,image.width,image.height)};}
function tintedTexture(map,palette){
 const source=pixels(map.image),lookup=pixels(palette.image),rgba=source.data.data;
 // GTA weapon tint uses diffuse alpha as a palette column, not opacity.
 // The default finish is the first palette row (CodeWalker BasicPS.hlsl).
 for(let i=0;i<rgba.length;i+=4){const x=Math.max(0,Math.min(palette.image.width-1,Math.floor((rgba[i+3]-32)*.007813*palette.image.width)));const at=x*4;for(let c=0;c<3;c++)rgba[i+c]=Math.round(rgba[i+c]*lookup.data.data[at+c]/255);rgba[i+3]=255;}
 source.context.putImageData(source.data,0,0);const result=new T.CanvasTexture(source.canvas);result.flipY=false;result.colorSpace=T.SRGBColorSpace;result.anisotropy=8;return result;
}
function bones(xml){
 const result=new Map(),matrices=[];
 for(const node of xml.querySelectorAll('Skeleton > Bones > Item')){
  const position=new T.Vector3(...attributes(child(node,'Translation')).slice(0,3));
  const rotation=new T.Quaternion(...attributes(child(node,'Rotation')));
  const scale=new T.Vector3(...attributes(child(node,'Scale')).slice(0,3));
  const matrix=new T.Matrix4().compose(position,rotation,scale);
  const parent=Number(child(node,'ParentIndex').getAttribute('value'));
  if(parent>=0&&matrices[parent])matrix.premultiply(matrices[parent]);
  matrices.push(matrix);result.set(value(child(node,'Name')).toLowerCase(),matrix);
 }
 return result;
}
async function drawable(model,transform=new T.Matrix4()){
 const xml=await loadXml(model);if(!xml)return null;
 const materialDefinitions=Array.from(xml.querySelectorAll('ShaderGroup > Shaders > Item'));
 const materials=await Promise.all(materialDefinitions.map(async shader=>{
  const diffuse=shader.querySelector('Parameters > Item[name="DiffuseSampler"] > Name');
  let map=await texture(value(diffuse),model);
  const palette=await texture(value(shader.querySelector('Parameters > Item[name="TextureSamplerDiffPal"] > Name')),model);
  if(map&&palette)map=tintedTexture(map,palette);
  const normal=await texture(value(shader.querySelector('Parameters > Item[name="BumpSampler"] > Name')),model);
  let normalMap=null;
  if(normal){const source=pixels(normal.image),rgba=source.data.data;for(let i=0;i<rgba.length;i+=4){const x=rgba[i]/127.5-1,y=rgba[i+1]/127.5-1;rgba[i+2]=Math.round((Math.sqrt(Math.max(0,1-x*x-y*y))*.5+.5)*255);rgba[i+3]=255;}source.context.putImageData(source.data,0,0);normalMap=new T.CanvasTexture(source.canvas);normalMap.flipY=false;normalMap.colorSpace=T.NoColorSpace;}
  return new T.MeshStandardMaterial({map,normalMap,normalScale:new T.Vector2(.7,.7),color:map?0xffffff:0x54565b,metalness:.42,roughness:.46,side:T.DoubleSide,alphaTest:palette?0:.04});
 }));
 const group=new T.Group();let triangles=0;
 const high=xml.querySelector('DrawableModelsHigh')||xml.querySelector('DrawableModelsMedium');
 if(!high)throw Error('No drawable geometry '+model);
 for(const node of high.querySelectorAll('Geometries > Item')){
  const buffer=child(node,'VertexBuffer'),layout=child(buffer,'Layout');if(!buffer||!layout)continue;
  const sizes={Position:3,Normal:3,Tangent:4,BlendWeights:4,BlendIndices:4,Colour0:4,Colour1:4,TexCoord0:2,TexCoord1:2,TexCoord2:2,TexCoord3:2};
  let size=0;const offsets={};for(const element of layout.children){offsets[element.tagName]=size;size+=sizes[element.tagName]||0;}
  const rows=value(child(buffer,'Data2')||child(buffer,'Data')).split(/[\r\n]+/).map(r=>r.trim().split(/\s+/).map(Number));
  const index=value(node.querySelector('IndexBuffer > Data')).split(/\s+/).map(Number);
  const geometry=new T.BufferGeometry();
  const vectorAttribute=(name,key,width)=>geometry.setAttribute(name,new T.Float32BufferAttribute(rows.flatMap(row=>row.slice(offsets[key],offsets[key]+width)),width));
  vectorAttribute('position','Position',3);if(offsets.Normal!=null)vectorAttribute('normal','Normal',3);if(offsets.TexCoord0!=null)vectorAttribute('uv','TexCoord0',2);
  geometry.setIndex(index);geometry.applyMatrix4(transform);if(!geometry.attributes.normal)geometry.computeVertexNormals();
  const material=materials[Number(child(node,'ShaderIndex').getAttribute('value'))]||materials[0];
  group.add(new T.Mesh(geometry,material));triangles+=index.length/3;
 }
 group.userData={model,triangles,bones:bones(xml)};return group;
}
function cartridge(kind){
 const group=new T.Group();const rifle=/rifle|sniper/.test(kind),shotgun=/shotgun|flare/.test(kind),grenade=/grenade|ammo-emp/.test(kind),rocket=/rocket|firework/.test(kind);
 const brass=new T.MeshStandardMaterial({color:0xbd8f35,metalness:.88,roughness:.24});
 const copper=new T.MeshStandardMaterial({color:0xa4592d,metalness:.8,roughness:.27});
 const shell=new T.MeshStandardMaterial({color:shotgun?0x9a2426:kind==='ammo-firework'?0xb98728:kind==='ammo-emp'?0x3f6a72:0x3d4a32,metalness:.15,roughness:.5});
 const dimensions={'ammo-22':[.038,.34],'ammo-38':[.07,.42],'ammo-44':[.09,.43],'ammo-45':[.092,.3],'ammo-50':[.105,.37],'ammo-rifle':[.06,.58],'ammo-rifle2':[.076,.52],'ammo-sniper':[.073,.69],'ammo-heavysniper':[.09,.97]};
 const radius=dimensions[kind]?.[0]||(shotgun?.105:grenade?.13:rocket?.095:rifle?.06:.085);
 const height=dimensions[kind]?.[1]||(shotgun?.53:grenade?.48:rocket?.85:rifle?.58:.31);
 for(let n=0;n<(rocket?1:3);n++){
  const bullet=new T.Group();const pts=[];
  const rings=rifle?[[0,radius],[height*.72,radius],[height*.82,radius*.68],[height*.9,radius*.62]]:[[0,radius],[height*.92,radius],[height,radius*.96]];
  for(const [y,r]of rings)pts.push(new T.Vector2(r,y));
  bullet.add(new T.Mesh(new T.LatheGeometry(pts,48),shotgun||rocket?shell:brass));
  const rim=new T.Mesh(new T.CylinderGeometry(radius*1.08,radius*1.08,.025,48),brass);rim.position.y=.0125;bullet.add(rim);
  if(shotgun){const cap=new T.Mesh(new T.CylinderGeometry(radius*.98,radius*.98,.012,48),shell);cap.position.y=height;bullet.add(cap);}
  else{
   const tipHeight=rocket?.34:grenade?.17:rifle?.22:.13;
   const profile=rifle?[[.62,0],[.6,.3],[.38,.78],[.02,1]]:grenade||rocket?[[.96,0],[.8,.3],[.48,.78],[.02,1]]:[[.96,0],[.96,.35],[.82,.75],[.5,.95],[.02,1]];
   const tip=new T.Mesh(new T.LatheGeometry(profile.map(([r,h])=>new T.Vector2(radius*r,tipHeight*h)),48),grenade||rocket?shell:copper);tip.position.y=rifle?height*.9:height;bullet.add(tip);
  }
  if(rocket){for(let i=0;i<4;i++){const fin=new T.Mesh(new T.BoxGeometry(.012,.2,.24),shell);fin.position.y=.12;fin.rotation.y=i*Math.PI/2;bullet.add(fin);}}
  bullet.position.set((n-1)*radius*2.6,n===1?.035:0,n===1?-.045:.015);bullet.rotation.z=n===0?-.12:n===2?.13:0;group.add(bullet);
 }
 group.rotation.x=Math.PI/2;return group;
}
function specialAmmo(kind){
 const group=new T.Group();
 if(kind==='ammo-musket'){
  const steel=new T.MeshStandardMaterial({color:0x6d737b,metalness:.88,roughness:.28});
  for(const [x,y,z]of [[-.15,0,0],[.15,0,0],[0,.08,.2]]){const ball=new T.Mesh(new T.SphereGeometry(.16,48,32),steel);ball.position.set(x,y,z);group.add(ball);}return group;
 }
 const metal=new T.MeshStandardMaterial({color:0x303840,metalness:.7,roughness:.38});
 const rubber=new T.MeshStandardMaterial({color:0x13171c,roughness:.8});
 const contact=new T.MeshStandardMaterial({color:0xb99245,metalness:.9,roughness:.25});
 const body=new T.Mesh(new T.BoxGeometry(.38,.23,.57),metal);group.add(body);
 for(let i=0;i<5;i++){const rib=new T.Mesh(new T.BoxGeometry(.4,.25,.026),rubber);rib.position.z=-.19+i*.09;group.add(rib);}
 for(let i=0;i<3;i++){const pin=new T.Mesh(new T.BoxGeometry(.065,.06,.075),contact);pin.position.set((i-1)*.105,0,.315);group.add(pin);}
 const strip=new T.Mesh(new T.BoxGeometry(.2,.008,.024),new T.MeshStandardMaterial({color:0x55b8d8,emissive:0x052536,emissiveIntensity:.6}));strip.position.set(0,-.12,.12);group.add(strip);
 group.rotation.z=-.17;return group;
}
function ammoBox(caliber){
 const group=new T.Group(),canvas=document.createElement('canvas');canvas.width=1024;canvas.height=640;
 const c=canvas.getContext('2d');c.fillStyle='#e6e4dc';c.fillRect(0,0,1024,640);
 let seed=7301;for(let i=0;i<35000;i++){seed=(seed*16807)%2147483647;const x=seed%1024;seed=(seed*16807)%2147483647;c.fillStyle=`rgba(50,40,30,${.02+(seed%5)*.007})`;c.fillRect(x,seed%640,1,1);}
 c.strokeStyle='rgba(15,25,35,.09)';c.lineWidth=2;for(let x=-200;x<1200;x+=130){c.beginPath();c.moveTo(x,0);c.lineTo(x+300,640);c.stroke();}
 c.fillStyle='#131b23';c.font='600 40px Arial';c.fillText('COII  /  AMMUNITION',52,80);
 c.font='italic 900 180px Impact';c.fillText(caliber,45,282);
 c.fillStyle='#26313b';c.font='600 37px Arial';c.fillText(caliber==='9MM'?'PISTOL CARTRIDGES':'RIFLE CARTRIDGES',56,354);
 c.fillStyle='#51b9e9';c.fillRect(0,435,1024,126);c.fillStyle='#0c1520';c.font='900 64px Impact';c.fillText('30 ROUNDS',55,519);
 c.fillStyle='#26313b';c.font='600 25px Arial';c.fillText('KEEP DRY   ·   STANDARD LOAD',56,607);
 const label=new T.CanvasTexture(canvas);label.colorSpace=T.SRGBColorSpace;label.anisotropy=8;
 const paper=new T.MeshStandardMaterial({color:0x363c3d,roughness:.88,metalness:0});
 const face=new T.MeshStandardMaterial({map:label,roughness:.82});
 const body=new T.Mesh(new T.BoxGeometry(.86,.45,.5),[paper,paper,paper,paper,face,paper]);body.rotation.x=Math.PI/2;group.add(body);
 const lid=new T.Mesh(new T.BoxGeometry(.875,.51,.015),new T.MeshStandardMaterial({color:0x414749,roughness:.85}));lid.position.z=.232;group.add(lid);
 const rounds=cartridge(caliber==='9MM'?'ammo-9':caliber==='7.62'?'ammo-rifle2':'ammo-rifle');rounds.scale.setScalar(.52);rounds.position.set(.37,-.35,-.22);group.add(rounds);
 group.rotation.z=-.12;return group;
}
async function render(entry){
 const scene=new T.Scene();scene.environment=environment;scene.environmentIntensity=.6;
 scene.add(new T.HemisphereLight(0xffffff,0x737b87,1.8));
 for(const [position,power]of [[[-2,-3,5],3.4],[[2,2,2],2.3]]){const light=new T.DirectionalLight(0xffffff,power);light.position.set(...position);scene.add(light);}
 let group,missing=[];
 if(entry.model){
  group=await drawable(entry.model+'_hi')||await drawable(entry.model);if(!group)throw Error('Missing weapon model '+entry.name+' / '+entry.model);
  for(const part of entry.defaults){const data=components[part.name];if(!data?.model||data.model.toLowerCase()==='null')continue;const bone=part.bone?.toLowerCase();const transform=group.userData.bones.get(bone)||(bone==='wapclip'&&(group.userData.bones.get('wap_clip')||group.userData.bones.get('gun_feed')));if(!transform){missing.push(part.name+' bone');continue;}const extra=await drawable(data.model,transform);if(extra)group.add(extra);else missing.push(data.model);}
  group.rotation.y=-.32;
  if(entry.name==='WEAPON_KNUCKLE'){group.rotation.z=Math.PI/2;group.rotation.x=.1;}
 }else if(entry.name.startsWith('ammo-box-'))group=ammoBox(entry.caliber);
 else if(['ammo-laser','ammo-railgun','ammo-musket'].includes(entry.name))group=specialAmmo(entry.name);
 else group=cartridge(entry.name);
 scene.add(group);group.updateMatrixWorld(true);
 let bounds=new T.Box3().setFromObject(group),center=bounds.getCenter(new T.Vector3());group.position.sub(center);group.updateMatrixWorld(true);bounds=new T.Box3().setFromObject(group);
 const camera=new T.OrthographicCamera(-1,1,1,-1,.01,100);camera.up.set(0,0,1);camera.position.set(.1,-5,1.3);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const screenBounds=new T.Box3();for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])screenBounds.expandByPoint(new T.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
 const size=screenBounds.getSize(new T.Vector3()),half=Math.max(size.x,size.y)*.54;
 camera.left=-half;camera.right=half;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();
 renderer.render(scene,camera);
 const measure=()=>{
  const gl=renderer.getContext(),pixels=new Uint8Array(768*768*4);gl.readPixels(0,0,768,768,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  let visible=0,minX=768,maxX=0,minY=768,maxY=0;
  for(let y=0;y<768;y++)for(let x=0;x<768;x++)if(pixels[(y*768+x)*4+3]>16){visible++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  return{visible,minX,maxX,minY,maxY,width:maxX-minX+1,height:maxY-minY+1};
 };
 const first=measure(),fittedHalf=half*Math.max(first.width,first.height)/(768*.92);
 const offsetX=((first.minX+first.maxX+1)/2-384)*2*half/768,offsetY=((first.minY+first.maxY+1)/2-384)*2*half/768;
 camera.left=offsetX-fittedHalf;camera.right=offsetX+fittedHalf;camera.top=offsetY+fittedHalf;camera.bottom=offsetY-fittedHalf;camera.updateProjectionMatrix();renderer.render(scene,camera);
 const data=renderer.domElement.toDataURL('image/png'),final=measure();
 group.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.normalMap?.dispose();m.dispose();}}});
 for(const pending of textureCache.values())(await pending).dispose();textureCache.clear();xmlCache.clear();renderer.renderLists.dispose();
 return{data,missing,visible:final.visible,bounds:{width:final.width,height:final.height,minX:final.minX,minY:final.minY}};
}
window.renderInventoryIcon=render;window.iconManifest=manifest;document.documentElement.dataset.ready='true';
