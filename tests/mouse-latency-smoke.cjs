"use strict";
// Actual Turbo C Run-menu graphics demo, exit, then other IDE menus.
// This catches accidental blocking screenshot checks and slow guest repaint.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict");
(async()=>{
const browser=await chromium.launch({
 headless:true,executablePath:process.env.CHROMIUM_BINARY||undefined,
 args:["--no-sandbox","--enable-unsafe-swiftshader"]
});
const page=await browser.newPage({viewport:{width:1366,height:768}});
const errors=[];page.on("pageerror",e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{
  window.__inputTiming=[];
  let original;
  Object.defineProperty(window,"Dos",{configurable:true,get(){return original},
   set(fn){original=(el,options)=>{
    const cb=options.onEvent;
    options.onEvent=(event,ci)=>{
     if(event==="ci-ready"){
      window.__ci=ci;
      const send=ci.sendMouseButton.bind(ci);
      ci.sendMouseButton=(button,pressed)=>{
       if(button===0&&pressed)window.__inputTiming.push({kind:"press",time:performance.now()});
       return send(button,pressed);
      };
     }
     cb(event,ci);
    };
    return fn(el,options);
   }}
  });
  window.addEventListener("pointerdown",event=>{
   if(event.target.closest("#dos-container"))
    window.__inputTiming.push({kind:"pointer",time:performance.now()});
  },true);
 });
 await page.goto(process.env.TURBOC_TEST_URL||"http://127.0.0.1:8769/",{waitUntil:"domcontentloaded"});

 await page.waitForFunction(()=>window.__ci&&document.querySelector("#app").dataset.state==="running",{timeout:30000});
 await page.waitForTimeout(650);
 const click=async(x,y=.018)=>{
  const r=await page.locator("#dos-container canvas").boundingBox();
  await page.mouse.click(r.x+r.width*x,r.y+r.height*y,{delay:55});
 };
 const hasIdeMenu=async()=>page.evaluate(async()=>{
  const im=await window.__ci.screenshot();
  if(im.width!==640||im.height!==400)return false;
  let n=0;
  for(let x=20;x<620;x+=20){
   const i=4*(12*im.width+x);
   if(im.data[i]>=130&&im.data[i]<=200&&Math.abs(im.data[i]-im.data[i+1])<12)n++;
  }
  return n>=20;
 });
 const menuPixels=async(name)=>page.evaluate(async name=>{
  const bounds={Run:[210,400],File:[30,185],Help:[410,630]}[name];
  const im=await window.__ci.screenshot();let gray=0;
  for(let y=35;y<135;y+=4){
   for(let x=bounds[0];x<bounds[1];x+=4){
    const i=4*(y*im.width+x);
    const r=im.data[i],g=im.data[i+1],b=im.data[i+2];
    if(r>120&&r<215&&Math.abs(r-g)<22&&Math.abs(g-b)<22)gray++;
   }
  }
  return gray;
 },name);
 await click(.355);await page.waitForTimeout(300); // Run menu
 assert((await menuPixels("Run"))>100,"Run menu should open promptly");
 await click(.08);await page.waitForTimeout(300);   // File menu
 assert((await menuPixels("File"))>100,"File menu should replace Run without repaint");
 await click(.96);await page.waitForTimeout(300);   // Help menu
 assert((await menuPixels("Help"))>100,"Help menu should replace File without repaint");
 const beforeLog=await page.locator("#log").textContent();
 assert(!/ignored menu click/i.test(beforeLog),"Healthy menu switches must not start recovery");
 const timings=await page.evaluate(()=>window.__inputTiming);
 const presses=timings.filter(x=>x.kind==="press");
 const downs=timings.filter(x=>x.kind==="pointer");
 const latencies=downs.slice(0,3).map(e=>presses.find(p=>p.time>=e.time)?.time-e.time);
 assert(latencies.every(t=>Number.isFinite(t)&&t<60),"Mouse presses should dispatch promptly");
 console.log("MENU_PRESS_LATENCY_MS",latencies.map(n=>Math.round(n)));

 await page.keyboard.press("Escape");
 await click(.355);await page.waitForTimeout(250); // Run menu again
 await click(.355,.08); // Run first entry: Ctrl+F9
 await page.waitForTimeout(1400);
 assert.equal(await hasIdeMenu(),false,"Graphics demo should execute after Run menu");
 await page.keyboard.press("Enter"); // close BGI demo's getch()
 await page.waitForFunction(async()=>{
  const im=await window.__ci.screenshot();
  let n=0;
  for(let x=20;x<620;x+=20){
   const i=4*(12*im.width+x);
   if(im.data[i]>=130&&im.data[i]<=200&&Math.abs(im.data[i]-im.data[i+1])<12)n++;
  }
  return n>=20;
 },null,{timeout:5500,polling:120});

 await click(.08); // File after graphics mode exit
 await page.waitForFunction(async()=>{
  const im=await window.__ci.screenshot();let n=0;
  for(let y=35;y<135;y+=4)for(let x=30;x<185;x+=4){
   const i=4*(y*im.width+x),r=im.data[i],g=im.data[i+1],b=im.data[i+2];
   if(r>120&&r<215&&Math.abs(r-g)<22&&Math.abs(g-b)<22)n++;
  }
  return n>100;
 },null,{timeout:4000,polling:125});
 await click(.96); // Help after File
 await page.waitForFunction(async()=>{
  const im=await window.__ci.screenshot();let n=0;
  for(let y=35;y<135;y+=4)for(let x=410;x<630;x+=4){
   const i=4*(y*im.width+x),r=im.data[i],g=im.data[i+1],b=im.data[i+2];
   if(r>120&&r<215&&Math.abs(r-g)<22&&Math.abs(g-b)<22)n++;
  }
  return n>100;
 },null,{timeout:4000,polling:125});
 const finalLog=await page.locator("#log").textContent();
 const recoveryCount=(finalLog.match(/ignored menu click/g)||[]).length;
 assert(recoveryCount<=1,"Menu switching should not repeatedly trigger guest repaint");
 assert.deepEqual(errors,[]);
 console.log("PASS: Run menu, graphics demo, exit, File and Help responsive; recovery attempts:",recoveryCount);
}finally{await browser.close()}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
