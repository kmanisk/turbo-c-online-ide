"use strict";
const assert=require("node:assert/strict");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
(async()=>{
const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BINARY||undefined,args:["--no-sandbox","--enable-unsafe-swiftshader"]});
const p=await b.newPage({viewport:{width:1366,height:768}});
try {
 await p.addInitScript(()=>{
  let DosFn;
  Object.defineProperty(window,"Dos",{configurable:true,
    get(){return DosFn},
    set(original){DosFn=(root,opt)=>{
      const callback=opt.onEvent;
      opt.onEvent=(event,ci)=>{
        if(event==="ci-ready"){
          window.__ci=ci;
          const orig=ci.sendMouseButton.bind(ci);
          let ignoreRelease=false;
          ci.sendMouseButton=(button,pressed)=>{
            if(button===0&&pressed&&window.__dropNextClick){
              window.__dropNextClick=false;
              ignoreRelease=true;
              window.__droppedMousePresses=(window.__droppedMousePresses||0)+1;
              return;
            }
            if(button===0&&!pressed&&ignoreRelease){ignoreRelease=false;return;}
            orig(button,pressed);
          };
        }
        callback(event,ci);
      };
      return original(root,opt);
    }}
  });
 });
 await p.goto(process.env.TURBOC_TEST_URL||"http://127.0.0.1:8769/",{waitUntil:"domcontentloaded"});
 await p.locator("#startBtn").click();
 await p.waitForFunction(()=>!!window.__ci&&document.querySelector("#app").dataset.state==="running",{timeout:30000});
 await p.keyboard.press("F9");await p.waitForTimeout(1300);await p.keyboard.press("Enter");await p.waitForTimeout(250);
 await p.evaluate(()=>{window.__dropNextClick=true});
 const canvas=p.locator("#dos-container canvas");
 let box=await canvas.boundingBox();
 await p.mouse.click(box.x+box.width*.05,box.y+box.height*.018);
 await p.waitForFunction(()=>document.querySelector("#log").textContent.includes("Turbo C menu recovered automatically"),{timeout:6000});
 assert.equal(await p.evaluate(()=>window.__droppedMousePresses),1);
 await p.screenshot({path:"/tmp/turboc-auto-recovered-file.png"});
 const check=await p.evaluate(async()=>{
  const im=await window.__ci.screenshot(),i=4*(Math.floor(.16*im.height)*im.width+Math.floor(.12*im.width));
  return [im.data[i],im.data[i+1],im.data[i+2]];
 });
 assert(check[0]>95 && Math.abs(check[0]-check[1])<25,"File menu should be visible after automatic recovery");
 await p.mouse.click(box.x+box.width*.96,box.y+box.height*.018);await p.waitForTimeout(350);
 await p.screenshot({path:"/tmp/turboc-auto-recovered-help.png"});
 const log=await p.locator("#log").textContent();
 assert.match(log,/ignored menu click/);
 console.log("PASS: dropped mouse press detected, one-shot Turbo C repaint + retry recovered File menu");
} finally {await b.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
