import { test, expect, type Page } from '@playwright/test';
const key='tidal-command:match:v1';
const read=(page:Page)=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)!),key);
async function boot(page:Page,normal=false){await page.addInitScript(()=>{localStorage.setItem('tidal-command:settings:v1',JSON.stringify({fast:true,muted:true,quality:'low',reducedMotion:true,ambient:false,guide:false}));});await page.goto('./');if(normal)await page.getByRole('button',{name:/普通 高强度/}).click();await page.getByRole('button',{name:'开始游戏',exact:true}).click();await page.getByRole('button',{name:'随机布阵',exact:true}).click();await page.getByRole('button',{name:'开始战斗',exact:true}).click();}
async function select(page:Page,cell:number){await page.keyboard.press('ArrowRight');let col=5,row=4;while(col!==cell%10){await page.keyboard.press(col<cell%10?'ArrowRight':'ArrowLeft');col+=col<cell%10?1:-1;}while(row!==Math.floor(cell/10)){await page.keyboard.press(row<Math.floor(cell/10)?'ArrowDown':'ArrowUp');row+=row<Math.floor(cell/10)?1:-1;}}
async function awaitTurn(page:Page,n:number){await expect.poll(async()=>(await read(page)).events.length,{timeout:20000}).toBe(n);await expect(page.getByRole('heading',{name:'指挥官，选择你的目标。'})).toBeVisible();}
test('complete match, saved continuation and full result log',async({page})=>{const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await boot(page);const original=await read(page);expect(original.fleets.player.flatMap((s:any)=>s.cells)).toHaveLength(17);const targets:number[]=original.fleets.ai.flatMap((s:any)=>s.cells);for(let i=0;i<targets.length;i++){await select(page,targets[i]);await expect(page.getByRole('button',{name:/开火/})).toBeEnabled();await page.keyboard.press('Enter');if(i<16)await awaitTurn(page,(i+1)*2);if(i===4){await page.reload();await page.getByRole('button',{name:/继续上次作战/}).click();await expect(page.getByRole('heading',{name:'指挥官，选择你的目标。'})).toBeVisible();expect((await read(page)).events).toHaveLength(10);}}await expect(page.getByRole('heading',{name:'这片海域，属于你。'})).toBeVisible();const final=await read(page);expect(final.winner).toBe('player');expect(final.shots.player).toHaveLength(17);expect(final.events).toHaveLength(33);expect(final.fleets).toEqual(original.fleets);expect(errors).toEqual([]);await page.screenshot({path:'screenshots/04-results.png',fullPage:true});await page.getByRole('button',{name:'查看完整攻击记录'}).click();await expect(page.locator('.modal .log-row')).toHaveCount(33);});
test('normal worker blocks duplicate submissions and restores pending turn',async({page})=>{await boot(page,true);await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await page.keyboard.press('Enter');await awaitTurn(page,2);let state=await read(page);expect(state.events[1].aiDiagnostics.strategy).toBe('normal');expect(state.events[1].aiDiagnostics.samples).toBeGreaterThan(0);await page.keyboard.press('ArrowRight');await expect(page.getByRole('button',{name:/开火/})).toBeDisabled();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');await page.reload();await page.getByRole('button',{name:/继续上次作战/}).click();await awaitTurn(page,4);state=await read(page);expect(new Set(state.shots.player).size).toBe(2);expect(new Set(state.shots.ai).size).toBe(2);});
test('corrupt save safety and responsive firing controls',async({page})=>{await page.addInitScript(()=>localStorage.setItem('tidal-command:match:v1','{bad'));await page.goto('./');await expect(page.getByRole('status')).toContainText('无法读取存档');await page.getByRole('button',{name:'开始游戏',exact:true}).click();await expect(page.getByRole('button',{name:'开始战斗',exact:true})).toBeDisabled();await page.getByRole('button',{name:'随机布阵',exact:true}).click();await page.getByRole('button',{name:'开始战斗',exact:true}).click();await page.setViewportSize({width:390,height:844});const b=await page.getByRole('button',{name:/开火/}).boundingBox();expect(b!.x).toBeGreaterThanOrEqual(0);expect(b!.x+b!.width).toBeLessThanOrEqual(390);expect(b!.y+b!.height).toBeLessThanOrEqual(844);await page.screenshot({path:'screenshots/05-mobile.png',fullPage:true});});
test('settings and help keyboard interaction at1280x720',async({page})=>{await page.goto('./');await page.setViewportSize({width:1280,height:720});await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('switch',{name:'减少动态效果'}).click();await expect(page.getByRole('switch',{name:'减少动态效果'})).toBeChecked();await page.keyboard.press('Escape');await page.getByRole('button',{name:'玩法说明',exact:true}).click();await expect(page.getByText('本局采用约定的经典变体：舰船互不接触（包括斜角）；每艘船与地图外边界接触的单元边总数最多为1。角落有2条边，不能放置；长舰不能沿边平行摆放，但可用端点垂直接触一条边。旧存档保留原有相邻规则。')).toBeVisible();await page.keyboard.press('Escape');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'screenshots/06-desktop-1280.png',fullPage:true});});


test('high-quality desktop scene screenshots',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('tidal-command:settings:v1',JSON.stringify({fast:true,muted:true,quality:'high',reducedMotion:true,ambient:false,guide:false})));
  await page.goto('./');
  await expect(page.getByRole('button',{name:'开始游戏',exact:true})).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  // Initial React visibility precedes WebGL initialization. Let the renderer settle
  // before collecting visual evidence, including on software-rendered CI runners.
  await page.evaluate(()=>new Promise<void>(resolve=>{
    let frames=30;
    const next=()=>{if(--frames===0)resolve();else requestAnimationFrame(next);};
    requestAnimationFrame(next);
  }));
  await page.screenshot({path:'screenshots/01-home-high.png',fullPage:true});
  await page.getByRole('button',{name:'开始游戏',exact:true}).click();
  await page.getByRole('button',{name:'随机布阵',exact:true}).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  await page.screenshot({path:'screenshots/02-placement-high.png',fullPage:true});
  await page.getByRole('button',{name:'开始战斗',exact:true}).click();
  await expect(page.getByRole('heading',{name:'指挥官，选择你的目标。'})).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  await page.screenshot({path:'screenshots/03-battle-high.png',fullPage:true});
  expect(errors).toEqual([]);
});
