"use strict";
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
(async()=>{
const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BINARY||undefined,args:["--no-sandbox","--enable-unsafe-swiftshader"]});
const p=await b.newPage({viewport:{width:1366,height:768}});
try {
 await p.addInitScript(()=>{
   let dos;
   Object.defineProperty(window,"Dos",{configurable:true,
     get(){return dos},
     set(fn){dos=(el,opt)=>{const on=opt.onEvent;opt.onEvent=(e,ci)=>{if(e==="ci-ready")window.__ci=ci;on(e,ci)};return fn(el,opt)}}
   });
 });
 await p.goto(process.env.TURBOC_TEST_URL||"http://127.0.0.1:8769/");
 await p.waitForFunction(()=>!!window.__ci && document.getElementById("app").dataset.state==="running",{timeout:30000});
 await p.setInputFiles("#fileInput",{
   name:"HELLO.C",mimeType:"text/plain",
   buffer:Buffer.from("#include <stdio.h>\r\nint main(void) { puts(\"Hello\"); return 0; }\r\n")
 });
 await p.waitForFunction(async()=>{
   try {
     const tree=await window.__ci.fsTree();
     const turbo=tree.nodes.find(x=>x.name==="TURBOC3");
     return turbo?.nodes.some(x=>x.name.toUpperCase()==="PROJECTS"&&x.nodes.some(f=>f.name==="HELLO.C"));
   }catch{return false;}
 },null,{timeout:8000,polling:200});
 const result=await p.evaluate(async()=>{
   const ci=window.__ci,tree=await ci.fsTree(),turbo=tree.nodes.find(e=>e.name==="TURBOC3");
   const projects=turbo.nodes.filter(e=>e.name.toUpperCase()==="PROJECTS");
   const hello=await ci.fsReadFile("TURBOC3/Projects/HELLO.C");
   const again=await ci.fsReadFile("TURBOC3/Projects/HELLO.C");
   return {projectCount:projects.length,filenames:projects.flatMap(x=>x.nodes.map(e=>e.name)),helloSize:hello.length,helloTwice:again.length};
 });
 assert.equal(result.projectCount,1,"Mixed-case Projects directory must not be duplicated");
 assert(result.filenames.includes("HELLO.C"));
 assert(result.filenames.includes("SHOWCASE.CPP"));
 assert.equal(result.helloSize,result.helloTwice,"Guest reads must be repeatable");

 await p.locator("#downloadBtn").click();
 await p.locator("#saveWorkspaceBtn").click();await p.waitForTimeout(200);
 await p.locator("#filesDrawer .close-drawer").click();
 const logBefore=await p.locator("#log").textContent();
 assert(!/Guest read failed/i.test(logBefore),"Explicit Save locally should read imported files successfully");
 await p.keyboard.press("F9");
 await p.waitForTimeout(1900);
 const objs=await p.evaluate(async()=>{
   const t=await window.__ci.fsTree(),turbo=t.nodes.find(x=>x.name==="TURBOC3"),source=turbo.nodes.find(x=>x.name==="SOURCE");
   return source?.nodes.filter(x=>/SHOWCASE\.(OBJ|EXE)/i.test(x.name)).map(x=>x.name)||[];
 });
 assert(objs.includes("SHOWCASE.OBJ")&&objs.includes("SHOWCASE.EXE"),
   "F9 must compile and link the C++ SHOWCASE.CPP into OBJ and EXE");
 console.log("PASS: single canonical Projects directory, repeatable file reads, explicit save and F9 OBJ/EXE build");
} finally {await b.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
