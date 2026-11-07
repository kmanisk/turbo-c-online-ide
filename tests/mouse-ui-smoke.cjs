"use strict";
// Browser UI smoke test with a mocked js-dos backend; real DOS is tested separately.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert=require("node:assert/strict");
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BINARY || undefined,args:["--no-sandbox"]});
 const page=await browser.newPage({viewport:{width:1366,height:768},acceptDownloads:true});
 const errors=[]; page.on("pageerror",e=>errors.push(e.message));
 await page.route("**/js-dos.css",r=>r.fulfill({body:"",contentType:"text/css"}));
 await page.route("**/js-dos.js",r=>r.fulfill({contentType:"text/javascript",body:`
 window.__mock={buttons:[],moves:[],starts:0,stops:0,pauses:[],files:new Map()};
 window.Dos=(container,opts)=>{
   const st=window.__mock;
   st.starts++;
   for(const file of opts.initFs)if(file.path)st.files.set(file.path.toUpperCase(),file.contents);
   const canvas=document.createElement("canvas"); canvas.width=640;canvas.height=400;
   canvas.style.width="100%";canvas.style.height="100%";container.append(canvas);
   const ci={
     sendMouseSync(){st.moves.push("sync");},
     sendMouseMotion(x,y){st.moves.push([x,y]);},
     sendMouseButton(button,down){st.buttons.push([button,down]);},
     async fsReadFile(path){const data=st.files.get(path.toUpperCase());if(!data)throw Error("missing");return data;},
     async fsWriteFile(path,data){st.files.set(path.toUpperCase(),data);},
     async fsTree(){return{name:".",nodes:[{name:"TURBOC3",nodes:[{name:"Projects",
       nodes:[...st.files].filter(([n])=>n.startsWith("TURBOC3/PROJECTS/")).map(([n,b])=>({name:n.split("/").at(-1),size:b.length,nodes:null}))
     }]}]};}
   };
   setTimeout(()=>opts.onEvent("emu-ready"),1);
   setTimeout(()=>opts.onEvent("ci-ready",ci),4);
   return{stop:async()=>{st.stops++},setNoCloud(){},setNoCursor(){},setMouseCapture(){},
     setPaused(v){st.pauses.push(v)},setRenderAspect(){},getVersion:()=>["8.5.3","mock"]};
 };
 `}));
 await page.route("**/fflate@0.8.2/umd/index.js",r=>r.fulfill({contentType:"text/javascript",body:`
 window.fflate={
  unzip(data,cb){const files=["TURBOC3/BIN/TC.EXE","TURBOC3/BIN/TCC.EXE","TURBOC3/BIN/TLINK.EXE","TURBOC3/INCLUDE/GRAPHICS.H","TURBOC3/LIB/GRAPHICS.LIB","TURBOC3/BGI/EGAVGA.BGI","TURBOC3/Projects/SHOWCASE.CPP"];cb(null,Object.fromEntries(files.map(k=>[k,new Uint8Array([1,2,3])])));},
  zipSync(){return new Uint8Array([80,75,3,4]);}
 };
 `}));
 await page.route("**/Turboc3.zip*",r=>r.fulfill({body:Buffer.from([1,2,3]),contentType:"application/zip"}));
 try{
  await page.goto(process.env.TURBOC_TEST_URL || "http://127.0.0.1:8769/");
  assert.equal(await page.locator("#app").getAttribute("data-state"),"idle");
  assert.equal(await page.evaluate(()=>typeof window.Dos),"undefined","js-dos must load after Start");
  await page.locator("#idleSampleSelect").selectOption("hello");
  await page.waitForTimeout(160);
  assert.equal(await page.locator("#savedIndicator").textContent(),"Saved locally");
  await page.locator("#startBtn").click();
  await page.waitForFunction(()=>document.getElementById("app").dataset.state==="running");
  assert.equal(await page.evaluate(()=>window.__mock.starts),1);
  await page.waitForTimeout(250); // finish the one-shot ci-ready sync before asserting click sequence
  const canvas=page.locator("#dos-container canvas");
  await canvas.click({position:{x:90,y:75}});
  await canvas.click({position:{x:100,y:85}});
  await page.waitForTimeout(460); // serialized mouse presses include an up-state gap
  assert.deepEqual(await page.evaluate(()=>window.__mock.buttons.slice(-4)),[[0,true],[0,false],[0,true],[0,false]]);
  await page.locator("#pauseBtn").click();
  assert.equal(await page.locator("#app").getAttribute("data-state"),"paused");
  await page.locator("#resumeBtn").click();
  assert.equal(await page.locator("#app").getAttribute("data-state"),"running");
  await page.locator("#restartBtn").click();
  assert.equal(await page.locator("#confirmPopover").isVisible(),true);
  await page.locator("#cancelConfirmBtn").click();
  assert.equal(await page.evaluate(()=>window.__mock.stops),0);
  await page.locator("#themeBtn").click();
  assert.equal(await page.locator("body").getAttribute("data-theme"),"classic");
  await page.locator("#scaleBtn").click();
  assert.equal(await page.locator("#scaleBtn").getAttribute("aria-pressed"),"true");
  await page.locator("#helpBtn").click();
  assert.match(await page.locator("#helpDrawer").innerText(),/Alt\+F9/);
  await page.locator("#helpDrawer .close-drawer").click();
  await page.locator("#diagnosticsBtn").click();
  assert.equal(await page.locator("#checks .check").count(),5);
  await page.locator("#diagnosticsPanel .close-drawer").click();
  await page.locator("#downloadBtn").click();
  assert.match(await page.locator("#fileList").innerText(),/HELLO.C/);
  await page.locator("#filesDrawer .close-drawer").click();
  await page.locator("#stopBtn").click();
  await page.locator("#acceptConfirmBtn").click();
  await page.waitForFunction(()=>document.getElementById("app").dataset.state==="idle");
  assert.equal(await page.evaluate(()=>window.__mock.stops),1);
  await page.reload();await page.waitForTimeout(180);
  await page.locator("#downloadBtn").click();
  assert.match(await page.locator("#fileList").innerText(),/HELLO.C/,"Files must persist through reload");
  await page.locator("#resetWorkspaceBtn").click();
  await page.locator("#cancelConfirmBtn").click();
  assert.match(await page.locator("#fileList").innerText(),/HELLO.C/);
  await page.locator("#filesDrawer .close-drawer").click();
  await page.locator("#startBtn").click();
  await page.waitForFunction(()=>document.getElementById("app").dataset.state==="running");
  await page.locator("#downloadBtn").click();
  await page.locator("#resetWorkspaceBtn").click();
  await page.locator("#acceptConfirmBtn").click();
  await page.waitForTimeout(130);
  await page.locator("#filesDrawer .close-drawer").click();
  await page.locator("#stopBtn").click();
  await page.locator("#acceptConfirmBtn").click();
  await page.waitForFunction(()=>document.getElementById("app").dataset.state==="idle");
  await page.reload();
  await page.waitForTimeout(140);
  await page.locator("#downloadBtn").click();
  assert.doesNotMatch(await page.locator("#fileList").innerText(),/HELLO.C/,
    "Reset during a running DOS session must not auto-resave the cleared files on Stop");
  assert.deepEqual(errors,[]);
  console.log("PASS: lazy loading, input timing, pause/resume, confirmation, dialogs, themes, scaling, persistence and running-session reset");
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
