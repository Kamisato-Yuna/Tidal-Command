import { test, expect, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector2, Vector3, Raycaster, Plane } from 'three';
import { DEFAULT_CAMERA_POSITION } from '../../src/scene/boardInteraction';
const key='tidal-command:match:v1';
const read=(p:Page)=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)!),key);
const cameraFor=(box:{width:number;height:number})=>{const c=new PerspectiveCamera(39,box.width/box.height,.1,100);c.position.set(...DEFAULT_CAMERA_POSITION);c.lookAt(0,0,0);c.updateMatrixWorld();return c;};
async function world(p:Page,x:number,z:number,y=.025){const b=(await p.locator('canvas').boundingBox())!;const v=new Vector3(x,y,z).project(cameraFor(b));return{x:b.x+(v.x+1)*b.width/2,y:b.y+(1-v.y)*b.height/2};}
async function cell(p:Page,n:number){const q=await world(p,n%10-4.5,Math.floor(n/10)-4.5);await p.mouse.click(q.x,q.y);}
async function handle(p:Page,dr:number,dc:number){const b=(await p.locator('canvas').boundingBox())!,h=(await p.getByRole('button',{name:'移动已选舰船',exact:true}).boundingBox())!;const from={x:h.x+h.width/2,y:h.y+h.height/2};const ray=new Raycaster();ray.setFromCamera(new Vector2((from.x-b.x)/b.width*2-1,1-(from.y-b.y)/b.height*2),cameraFor(b));const origin=ray.ray.intersectPlane(new Plane(new Vector3(0,1,0),-.025),new Vector3())!;const to=await world(p,origin.x+dc,origin.z+dr);await p.mouse.move(from.x,from.y);await p.mouse.down();await p.mouse.move(to.x,to.y,{steps:16});await p.mouse.up();}
async function boot(p:Page,shells=1){await p.addInitScript(()=>{if(!localStorage.getItem('tidal-command:settings:v1'))localStorage.setItem('tidal-command:settings:v1',JSON.stringify({fast:true,muted:true,quality:'medium',reducedMotion:false,ambient:false,guide:false}));});await p.goto('./');await p.getByRole('combobox',{name:'每回合炮弹数量'}).selectOption(String(shells));await p.getByRole('button',{name:'开始游戏',exact:true}).click();await p.locator('canvas').waitFor();await p.waitForTimeout(700);}
async function ready(p:Page,n:number){await expect.poll(async()=>(await read(p)).events.length,{timeout:25000}).toBe(n);await expect(p.getByRole('heading',{name:'指挥官，选择你的目标。'})).toBeVisible();}
async function volley(p:Page,targets:number[]){for(const n of targets)await cell(p,n);await expect(p.getByRole('button',{name:/齐射|^开火/})).toBeEnabled();await p.getByRole('button',{name:/齐射|^开火/}).click();}
async function miniMarkers(p:Page){return p.locator('.tactical-cell').evaluateAll(cells=>cells.flatMap((c,i)=>c.classList.contains('recent-shot')?[i]:[]));}

test('tentative handle and rotation lifecycle, physical hull selection, background blur and valid launch',async({page:p})=>{
 const errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));await boot(p);await cell(p,11);
 const rotate=p.getByRole('button',{name:'旋转已选舰船',exact:true}),move=p.getByRole('button',{name:'移动已选舰船',exact:true});
 expect(await rotate.innerText()).toBe('');expect(await move.innerText()).toBe('');await expect(p.locator('.fleet-panel .rotate-button')).toHaveCount(0);
 await handle(p,2,0);await expect(p.getByRole('status')).toContainText('舰船保持选中');
 await handle(p,0,7);await expect(p.getByRole('status')).toContainText('红色舰船暂留');
 await expect(rotate).toBeVisible();await expect(p.getByRole('button',{name:'开始战斗',exact:true})).toBeDisabled();expect(await read(p)).toBeNull();
 // A real physical red hull pixel outside the board must not count as sea blur.
 const hull=await world(p,6,-1.5,.28);await p.mouse.click(hull.x,hull.y);await expect(rotate).toBeVisible();await expect(p.getByRole('status')).toContainText('红色舰船暂留');
 await p.screenshot({path:'screenshots/r3-e2e-red-offboard-hull.png',fullPage:true});
 const sea=await world(p,-6,-1.5);await p.mouse.click(sea.x,sea.y);await expect(rotate).toHaveCount(0);await expect(p.getByRole('status')).toContainText('恢复上一个合法舰位');
 // Reactivate at the elevated deck, not the sea coordinate behind it.
 const deck=await world(p,-1.82,-1.7,.54);await p.mouse.click(deck.x,deck.y);await expect(rotate).toBeVisible();
 await cell(p,71);await rotate.click();await expect(p.getByRole('status')).toContainText('红色舰船暂留');
 await p.locator('.ship-choice').nth(1).click();await cell(p,0);await expect(p.getByRole('status')).toContainText('红色舰船暂留');
 await p.locator('.page-heading h1').click();await expect(rotate).toHaveCount(0);await expect(p.getByRole('status')).toContainText('移除未完成');await expect(p.locator('.fleet-panel .panel-title')).toContainText('1 / 5');
 // Restore horizontal direction, then rapid select → place remains deterministic.
 await p.locator('.ship-choice').first().click();
 for(const [i,n] of [[1,11],[2,31],[3,51],[4,57]]){await p.locator('.ship-choice').nth(i).click();await cell(p,n);}
 await expect(p.locator('.fleet-panel .panel-title')).toContainText('5 / 5');
 // Clicking a different raised hull selects it without moving the prior active ship.
 const carrier=await world(p,-1.82,2.3,.54);await p.mouse.click(carrier.x,carrier.y);await expect(p.locator('.ship-choice').first()).toHaveClass(/selected/);
 await cell(p,0);await expect(p.getByRole('button',{name:'开始战斗',exact:true})).toBeDisabled();expect(await read(p)).toBeNull();
 await p.keyboard.press('Escape');await p.getByRole('button',{name:'开始战斗',exact:true}).click();
 const ships=(await read(p)).fleets.player;expect(Object.fromEntries(ships.map((s:any)=>[s.id,s.cells]))).toEqual({carrier:[71,72,73,74,75],battleship:[11,12,13,14],cruiser:[31,32,33],submarine:[51,52,53],destroyer:[57,58]});expect(errors).toEqual([]);
});

test('unrestricted camera orbit keeps draft and cannot trigger instant fire, including return-to-start drag',async({page:p})=>{
 await boot(p);await cell(p,11);const box=(await p.locator('canvas').boundingBox())!;
 const start={x:box.x+box.width*.55,y:box.y+box.height*.62};
 for(let i=0;i<3;i++){await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(start.x-box.width*.44,start.y-15,{steps:22});await p.mouse.up();await p.waitForTimeout(250);await expect(p.getByRole('button',{name:'旋转已选舰船',exact:true})).toHaveCount(1);await p.screenshot({path:`screenshots/r3-e2e-orbit-${i+1}.png`,fullPage:true});}
 await p.getByRole('button',{name:'重置镜头'}).click();await p.waitForTimeout(300);await p.getByRole('button',{name:'随机布阵',exact:true}).click();await p.getByRole('button',{name:'开始战斗',exact:true}).click();await expect(p.getByRole('heading',{name:'指挥官，选择你的目标。'})).toBeVisible();await p.getByRole('checkbox',{name:'无需确认'}).check();
 const b=(await p.locator('canvas').boundingBox())!,q={x:b.x+b.width*.5,y:b.y+b.height*.5};await p.mouse.move(q.x,q.y);await p.mouse.down();await p.mouse.move(q.x+150,q.y+20,{steps:12});await p.mouse.move(q.x,q.y,{steps:12});await p.mouse.up();expect((await read(p)).events).toHaveLength(0);
 await p.getByRole('button',{name:'重置镜头'}).click();await p.waitForTimeout(300);await cell(p,44);await ready(p,2);expect((await read(p)).shots.player).toEqual([44]);
});

for(const shells of [1,3,5])test(`${shells}-shell previous completed-round markers update on both fleets and survive reload`,async({page:p})=>{
 await boot(p,shells);await p.getByRole('button',{name:'随机布阵',exact:true}).click();await p.getByRole('button',{name:'开始战斗',exact:true}).click();await expect(p.getByRole('heading',{name:'指挥官，选择你的目标。'})).toBeVisible();
 // The battle mounts a fresh Canvas; wait for its first rendered frames before aiming.
 await p.evaluate(()=>new Promise<void>(resolve=>{let n=12;const frame=()=>--n?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame);}));
 const plan=[11,22,33,44,55].slice(0,shells);await volley(p,plan);await ready(p,shells*2);let s=await read(p);expect(await miniMarkers(p)).toEqual([...s.shots.ai].sort((a:number,b:number)=>a-b));await expect(p.getByText(/方框标记第 1 回合炮击/)).toBeVisible();
 if(shells===3){await p.screenshot({path:'screenshots/r3-e2e-round-enemy.png',fullPage:true});await p.getByRole('button',{name:'我方海域',exact:true}).click();await p.screenshot({path:'screenshots/r3-e2e-round-own.png',fullPage:true});await p.getByRole('button',{name:/敌方海域/}).click();}
 await volley(p,[16,27,38,49,61].slice(0,shells));await ready(p,shells*4);s=await read(p);const expected=[...s.volleys[3].coords].sort((a:number,b:number)=>a-b);expect(await miniMarkers(p)).toEqual(expected);await expect(p.getByText(/方框标记第 2 回合炮击/)).toBeVisible();
 await p.reload();await p.getByRole('button',{name:/继续上次作战/}).click();await expect(p.getByText(/方框标记第 2 回合炮击/)).toBeVisible();expect(await miniMarkers(p)).toEqual(expected);expect((await read(p)).events).toHaveLength(shells*4);
});
