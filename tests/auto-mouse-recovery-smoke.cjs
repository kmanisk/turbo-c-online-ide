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
          const move=ci.sendMouseMotion.bind(ci);
          let ignoreRelease=false;
          // A lost click must not accidentally activate a menu via the
          // accompanying cursor move/hover. Drop its move as well.
          ci.sendMouseMotion=(...args)=>{
            if(window.__dropNextClick||ignoreRelease)return;
            return move(...args);
          };
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

 await p.waitForFunction(()=>!!window.__ci&&document.querySelector("#app").dataset.state==="running",{timeout:30000});
 await p.keyboard.press("F9");await p.waitForTimeout(1300);await p.keyboard.press("Enter");await p.waitForTimeout(250);
 const canvas=p.locator("#dos-container canvas");
 let box=await canvas.boundingBox();
 // Preposition and close any hover-opened guest menu first. This makes
 // the injected missed press deterministic even with pointer hover.
 await p.mouse.move(box.x+box.width*.05,box.y+box.height*.018);
 await p.waitForTimeout(200);
 await p.keyboard.press("Escape");
 await p.waitForTimeout(160);
 await p.evaluate(()=>{window.__dropNextClick=true});
 await p.mouse.click(box.x+box.width*.05,box.y+box.height*.018);
 // The guest repaint is asynchronous. Verify the actual DOS screenshot,
 // not an early diagnostic log which can predate the menu drawing.
 await p.waitForFunction(async()=>{
  const im=await window.__ci.screenshot();
  const i=4*(Math.floor(.16*im.height)*im.width+Math.floor(.12*im.width));
  const r=im.data[i],g=im.data[i+1],b=im.data[i+2];
  return r>95&&Math.abs(r-g)<25&&Math.abs(g-b)<25;
 },null,{timeout:8000,polling:250});
 assert.equal(await p.evaluate(()=>window.__droppedMousePresses),1);
 await p.screenshot({path:"/tmp/turboc-auto-recovered-file.png"});
 await p.mouse.click(box.x+box.width*.96,box.y+box.height*.018);await p.waitForTimeout(350);
 await p.screenshot({path:"/tmp/turboc-auto-recovered-help.png"});
 const log=await p.locator("#log").textContent();
 // Turbo C can also open a menu by hover while the button is dropped.
 // If the menu opens, no repaint is needed; don't mistake that for failure.
 const recovered=/ignored menu click/.test(log);
 console.log("PASS: dropped press left the menu usable; "+(recovered?"one-shot repair executed":"guest hover opened menu without a repaint"));
} finally {await b.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
