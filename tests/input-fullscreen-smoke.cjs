"use strict";
// Real js-dos browser smoke test for repeated Turbo C menu clicks and fullscreen.
// Test-only Playwright dependency. No changes to the static site's bundle.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert=require("node:assert/strict");

async function main(){
 const browser=await chromium.launch({
   headless:true, executablePath:process.env.CHROMIUM_BINARY || undefined,
   args:["--no-sandbox","--enable-unsafe-swiftshader"]
 });
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 const errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.addInitScript(()=>{
   let original;
   Object.defineProperty(window,"Dos",{configurable:true,
     get(){return original},
     set(fn){original=(el,options)=>{
       const callback=options.onEvent;
       options.onEvent=(event,ci)=>{if(event==="ci-ready")window.__testCi=ci;callback(event,ci)};
       return fn(el,options);
     }}
   });
 });
 const url=process.env.TURBOC_TEST_URL || "http://127.0.0.1:8769/";
 try {
   await page.goto(url,{waitUntil:"domcontentloaded"});
   await page.locator("#startBtn").click();
   await page.waitForFunction(()=>!!window.__testCi && document.querySelector("#app").dataset.state==="running",{timeout:30000});
   const clickMenu=async(name)=>{
     const bounds=await page.locator("#dos-container canvas").boundingBox();
     const x=name==="File"?.05:.96;
     await page.mouse.click(bounds.x+bounds.width*x,bounds.y+bounds.height*.018);
     // The existing guest-side mouse recovery may repaint and replay one ignored click.
     await page.waitForTimeout(1800);
   };
   const menuSample=async()=>page.evaluate(async()=>{
     const image=await window.__testCi.screenshot();
     const get=(x,y)=>{
       const offset=4*(Math.floor(y*image.height)*image.width+Math.floor(x*image.width));
       return Array.from(image.data.slice(offset,offset+3));
     };
     return {left:get(.12,.16),right:get(.84,.16)};
   });
   const isGray=rgb=>rgb.every(v=>v>100)&&Math.max(...rgb)-Math.min(...rgb)<35;
   await clickMenu("File");
   assert(isGray((await menuSample()).left),"File menu must open on first click");
   await clickMenu("Help");
   assert(isGray((await menuSample()).right),"Help menu must open on second click");
   await clickMenu("File");
   assert(isGray((await menuSample()).left),"File menu must respond to third click");

   await page.keyboard.press("Escape");
   await page.keyboard.press("Alt+F9");
   await page.waitForTimeout(1500);
   await page.keyboard.press("Enter");
   await page.waitForTimeout(300);
   await clickMenu("File");
   assert(isGray((await menuSample()).left),"Mouse File menu must work after compilation");
   await clickMenu("Help");
   assert(isGray((await menuSample()).right),"Mouse Help menu must work after compilation");
   await page.keyboard.press("Escape");
   await page.keyboard.press("F1");
   await page.waitForTimeout(600);
   await page.keyboard.press("Escape");
   await page.waitForTimeout(250);
   await clickMenu("File");
   assert(isGray((await menuSample()).left),"Mouse must work after opening and closing Help");

   await page.locator(".toolbar-more > summary").click();
   await page.locator("#resetMouseBtn").click();
   await page.waitForTimeout(550);
   assert(!isGray((await menuSample()).left),"Repair mouse must repaint and close the IDE system menu");
   await clickMenu("File");
   assert(isGray((await menuSample()).left),"Mouse must work following guest-side repair");
   await page.keyboard.press("Escape");

   await page.locator("#fullscreenBtn").click();
   await page.waitForFunction(()=>document.fullscreenElement?.id==="monitor");
   await page.waitForTimeout(320);
   const fullscreen=await page.evaluate(()=>{
     const r=element=>{let x=element.getBoundingClientRect();return{x:x.x,y:x.y,w:x.width,h:x.height}};
     return {
       canvas:r(document.querySelector("#dos-container canvas")),
       viewport:r(document.querySelector("#monitorViewport")),
       topbar:getComputedStyle(document.querySelector(".monitor-titlebar")).display,
       bottom:getComputedStyle(document.querySelector(".monitor-statusbar")).display,
       width:innerWidth,height:innerHeight
     };
   });
   assert.equal(fullscreen.canvas.x,0);
   assert.equal(fullscreen.canvas.y,0);
   assert.equal(fullscreen.canvas.w,fullscreen.width);
   assert.equal(fullscreen.canvas.h,fullscreen.height);
   assert.equal(fullscreen.topbar,"none");
   assert.equal(fullscreen.bottom,"none");
   await clickMenu("Help");
   assert(isGray((await menuSample()).right),"Mouse Help menu works in stretched fullscreen");
   await clickMenu("File");
   assert(isGray((await menuSample()).left),"Mouse File menu works in stretched fullscreen");
   await page.evaluate(()=>document.exitFullscreen());
   await page.waitForFunction(()=>!document.fullscreenElement);
   const ratio=await page.locator("#screenArea").evaluate(el=>el.getBoundingClientRect().width/el.getBoundingClientRect().height);
   assert(Math.abs(ratio-4/3)<.025,"Windowed display aspect restored");
   assert.deepEqual(errors,[]);
   console.log("PASS: multiple Turbo C mouse clicks after compile/help, guest-side Repair, edge-to-edge fullscreen, fullscreen mouse, restored windowed 4:3");
 } finally { await browser.close(); }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
