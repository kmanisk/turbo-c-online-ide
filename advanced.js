/* Full DOS UI and filesystem tools. Loaded only after Full DOS is selected. */
(() => {
  "use strict";

  window.createAdvancedMode = async (host) => {
    const markup = await fetch("advanced-ui.html?v=1", {cache:"force-cache"});
    if (!markup.ok) throw new Error("Advanced panels are unavailable");
    const root = document.createElement("div");
    root.id = "advancedPanelRoot";
    root.innerHTML = await markup.text();
    document.body.append(root);
    const $ = (id) => document.getElementById(id);
    const ui = Object.fromEntries([
      "advancedFilesDrawer","settingsDrawer","advDropzone","advancedInput","advTarget","advMountDrive",
      "advBrowseBtn","advMountBtn","advImportStatus","advTree","advSelectedPath","advUsedSpace","advStorageState",
      "advDownloadItem","advRenameItem","advDeleteItem","advNewName","advMakeFolder",
      "advDownloadZip","advRefreshBtn","advSaveBtn","advResetBtn",
      "advCycles","advFixedCycles","advMemsize","advMachine","advSound","advKeyboard",
      "advMouseSensitivity","advRender","advConfigEditor","advSaveSettings",
      "advConfigReset","advApplySettings","advSettingsStatus"
    ].map(id => [id, $(id)]));
    const STORAGE_KEY = "turboc:advanced-options";
    const MAX_FILE = 64 * 1024 * 1024;
    const MAX_ARCHIVE = 128 * 1024 * 1024;
    const MAX_ENTRIES = 1024;
    let selected = null, selectedImage = null;
    let fsQueue = Promise.resolve();
    const serial = (cb) => {
      const current=fsQueue.then(cb);
      fsQueue=current.catch(()=>{});
      return current;
    };
    const message = (value) => {
      ui.advImportStatus.textContent = value;
      host.announce(value);
    };
    const ext = (name) => String(name).split(".").pop().toLowerCase();
    const toDos = (segment, keepExt = false) => {
      const part=String(segment).replace(/\\/g,"/").split("/").pop().toUpperCase();
      const dot=part.lastIndexOf(".");
      const base=(dot>0?part.slice(0,dot):part).replace(/[^A-Z0-9_$~!#%&'()@^-]/g,"").slice(0,8)||"FILE";
      const e=dot>0?part.slice(dot+1).replace(/[^A-Z0-9]/g,"").slice(0,3):"";
      return keepExt && !e ? base : base+(e?"."+e:"");
    };
    const folderPath = (value) => {
      let path=String(value||"UPLOADS").replace(/\\/g,"/").replace(/^C:/i,"").replace(/^\/+/,"").replace(/\/+$/,"");
      const bits=path.split("/");
      if (bits.some(bit=>bit===".."||bit==="."||bit.length===0) || bits.length>5) throw new Error("Use a relative DOS folder path");
      return bits.map(bit=>toDos(bit)).join("/");
    };
    const cleanEntry = (entry) => {
      if (entry.includes("\0")) throw Error("Invalid filename");
      const path=entry.replace(/\\/g,"/");
      if (path.startsWith("/")||/^[A-Z]:/i.test(path) || path.split("/").some(x=>x===".."||x===".")) throw Error("Unsafe archive path");
      const bits=path.split("/").filter(Boolean);
      if (bits.length>8) throw Error("Archive path too deep");
      if (!bits.length) throw Error("Empty archive path");
      return bits.map(toDos).join("/");
    };
    const defaultOptions = () => ({
      cycles:"auto",fixedCycles:10000,memsize:32,machine:"svga_s3",sound:"on",keyboard:"auto",
      sensitivity:100,render:"fit",custom:"",mount:null
    });
    let opts=defaultOptions();
    try {
      const stored=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
      if (stored && typeof stored==="object") opts={...opts,...stored};
    } catch {}
    const baseline = () => {
      const cycles=opts.cycles==="fixed" ? String(opts.fixedCycles) : opts.cycles;
      return [
        "[sdl]","fullscreen=false","autolock=false",
        "[dosbox]","memsize="+opts.memsize,"machine="+opts.machine,
        "[cpu]","cycles="+cycles,
        "[mixer]","nosound="+(opts.sound==="off"?"true":"false"),
        "[render]","aspect=true","scaler=none",
        "[dos]","keyboardlayout="+opts.keyboard,
        "[autoexec]","@echo off","mount c .","c:","cd \\",
        "set PATH=Z:\\;C:\\TURBOC3\\BIN;C:\\TURBOC3;C:\\UPLOADS"
      ].join("\n");
    };
    const validate = (value) => {
      if (value.length>16000) throw Error("Config exceeds 16 KiB");
      if (!/\[autoexec\]/i.test(value)||!/^mount\s+c\s+\.$/im.test(value)||!/^c:$/im.test(value))
        throw Error("Config must include [autoexec], mount c . and c: on separate lines");
      if (/\b(?:boot|exit|shutdown|format)\b/i.test(value)) throw Error("Boot/exit/format commands are not allowed in autoexec");
      return value;
    };
    const getConfig = () => {
      let config=validate(opts.custom || baseline());
      if (opts.mount && host.getSaved().has(opts.mount.path)) {
        const path=opts.mount.path.replace(/\//g,"\\");
        const flag=opts.mount.drive==="D"?"-t iso":"-t floppy";
        // Add the command after the C: mount, when the DOS host drive is ready.
        config=config.replace(/^c:$/im,"c:\nimgmount "+opts.mount.drive.toLowerCase()+" C:\\"+path+" "+flag);
      }
      return config+"\n";
    };
    const persistOptions=()=>{
      localStorage.setItem(STORAGE_KEY,JSON.stringify(opts));
    };
    const fields = [
      ["advCycles","cycles"],["advFixedCycles","fixedCycles"],["advMemsize","memsize"],
      ["advMachine","machine"],["advSound","sound"],["advKeyboard","keyboard"],
      ["advMouseSensitivity","sensitivity"],["advRender","render"]
    ];
    const populate = () => {
      for(const [id,key] of fields) ui[id].value=String(opts[key]);
      ui.advConfigEditor.value=opts.custom || baseline();
      ui.advConfigEditor.dataset.manual=opts.custom?"true":"false";
    };
    const applyFields = () => {
      const n = (id,min,max) => {
        const v=Number(ui[id].value);
        if(!Number.isInteger(v)||v<min||v>max)throw Error("Invalid setting: "+id);
        return v;
      };
      opts.cycles=ui.advCycles.value;
      opts.fixedCycles=n("advFixedCycles",100,500000);
      opts.memsize=n("advMemsize",4,64);
      opts.machine=ui.advMachine.value;
      opts.sound=ui.advSound.value;
      opts.keyboard=ui.advKeyboard.value;
      opts.sensitivity=n("advMouseSensitivity",20,200);
      opts.render=ui.advRender.value;
      opts.custom=ui.advConfigEditor.dataset.manual==="true"?validate(ui.advConfigEditor.value):"";
      validate(getConfig());
      persistOptions();
      host.setScale(opts.render);
      ui.advSettingsStatus.textContent="Saved. Restart Full DOS to apply.";
    };
    const saveSettings = () => {
      try {applyFields();return true;}catch(e){ui.advSettingsStatus.textContent=e.message;return false;}
    };
    const resetSettings = () => {
      opts=defaultOptions();persistOptions();populate();
      ui.advSettingsStatus.textContent="Defaults restored. Restart to recover.";
      host.setScale("fit");
    };
    populate();
    for(const [id] of fields) ui[id].addEventListener("change",()=>{
      if(ui.advConfigEditor.dataset.manual!=="true")ui.advConfigEditor.value=baseline();
    });
    ui.advConfigEditor.addEventListener("input",()=>{ui.advConfigEditor.dataset.manual="true";});
    ui.advSaveSettings.addEventListener("click",saveSettings);
    ui.advConfigReset.addEventListener("click",resetSettings);
    ui.advApplySettings.addEventListener("click",()=>{
      if(!saveSettings())return;
      host.confirm(ui.advApplySettings,"Apply DOSBox settings?","Current DOS work will be saved locally before restarting. Custom settings may prevent DOSBox from starting.",async()=>{
        host.closeDrawer();
        await host.restart();
      });
    });
    // Never interleave two commands: js-dos keyboard messages are asynchronous
    // and concurrent chips otherwise corrupt DOS command lines.
    let commandQueue=Promise.resolve();
    const typeCommand = async (cmd) => {
      const ci=host.getCI();
      if (!ci || typeof ci.sendKeyEvent!=="function" || host.getState()!=="running") {
        message("Start Full DOS first."); return false;
      }
      if (!/^[A-Za-z0-9 ._:\\/+-]{1,120}$/.test(cmd)) {
        message("Unsupported character in DOS command"); return false;
      }
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      // ASCII key codes are the documented js-dos CI contract for letters.
      // Use deliberate press/release/gaps so the DOSBox worker samples all keys.
      for (const ch of cmd.toUpperCase()) {
        const code=ch.charCodeAt(0);
        ci.sendKeyEvent(code,true);
        await wait(65);
        ci.sendKeyEvent(code,false);
        await wait(85);
      }
      ci.sendKeyEvent(257,true);
      await wait(65);
      ci.sendKeyEvent(257,false);
      await wait(160);
      host.announce("Sent "+cmd+" to DOS. The prompt must be active.");
      return true;
    };
    const command = cmd => {
      const next=commandQueue.then(()=>typeCommand(cmd));
      commandQueue=next.catch(e=>host.log("DOS input failed",e.message));
      return next;
    };
    const getTree = async () => {
      const ci=host.getCI();
      return ci?.fsTree ? await serial(()=>ci.fsTree()) : null;
    };
    const getSavedFile = async path => {
      const ci=host.getCI();
      if(ci?.fsReadFile){
        try{return new Uint8Array(await serial(()=>ci.fsReadFile(path)));}catch {}
      }
      const stored=host.getSaved().get(path);
      return stored || null;
    };
    const savePath = async (path,bytes) => {
      if(!bytes.length) throw Error("Empty file");
      if(bytes.length>MAX_FILE) throw Error("File exceeds 64 MiB");
      const ci=host.getCI();
      await host.stage(path,bytes);
      if (ci?.fsWriteFile) {
        try {
          await serial(()=>ci.fsWriteFile(path,bytes));
        }catch(e){host.log("Live import deferred: "+path,e.message);}
      }
    };

    const treeRows = [];
    const render = (tree) => {
      ui.advTree.replaceChildren();
      treeRows.length=0;
      const buttonFor = (node,path,depth) => {
        const row=document.createElement("button");
        row.type="button";row.className="dos-tree-row";
        row.style.paddingLeft=(8+Math.min(depth,6)*13)+"px";
        const folder=Array.isArray(node.nodes);
        row.textContent=(folder?"▸ ":"  ")+node.name+(folder?"\\":"");
        row.title=path||"C:\\";
        row.setAttribute("role","treeitem");
        row.setAttribute("aria-selected",String(selected?.path===path));
        if(selected?.path===path)row.classList.add("selected");
        row.addEventListener("click",()=>{
          selected={path,folder,name:node.name,size:node.size||0};
          ui.advSelectedPath.textContent="Selected: C:\\"+path.replace(/\//g,"\\");
          ui.advDownloadItem.disabled=false;
          ui.advRenameItem.disabled=folder;
          ui.advDeleteItem.disabled=folder || host.isBundled(path);
          ui.advDownloadZip.disabled=false;
          ui.advMountBtn.disabled=!/\.(ISO|IMG|IMA|CUE)$/i.test(node.name);
          selectedImage=ui.advMountBtn.disabled?null:path;
          render(tree);
        });
        treeRows.push(row);
        return row;
      };
      const add=(parent,node,path,depth)=>{
        if (depth>9)return;
        if(node.name==="."&&depth===0){
          for(const child of node.nodes||[])add(parent,child,child.name,1);
          return;
        }
        const folder=Array.isArray(node.nodes);
        if(folder) {
          const section=document.createElement("details");
          section.open=depth<2 || selected?.path?.startsWith(path+"/");
          section.className="dos-tree-folder";
          const summary=document.createElement("summary");
          summary.append(buttonFor(node,path,depth));
          section.append(summary);
          for(const child of node.nodes)add(section,child,path+"/"+child.name,depth+1);
          parent.append(section);
        }else parent.append(buttonFor(node,path,depth));
      };
      if(tree)add(ui.advTree,tree,"",0);
      else{
        const synthesized={name:".",nodes:[],size:null};
        const root=new Map();
        for(const [name,data] of host.getSaved()){
          const full=name.includes("/")?name:"TURBOC3/Projects/"+name;
          const bits=full.split("/");
          let current=synthesized;
          for(const part of bits.slice(0,-1)){
            let directory=current.nodes.find(n=>n.name.toUpperCase()===part.toUpperCase()&&n.nodes);
            if(!directory){directory={name:part,size:null,nodes:[]};current.nodes.push(directory);}
            current=directory;
          }
          current.nodes.push({name:bits[bits.length-1],size:data.length,nodes:null});
        }
        add(ui.advTree,synthesized,"",0);
      }
      if(ui.advTree.childElementCount===0)ui.advTree.textContent="No filesystem data yet.";
      const bytes=[...host.getSaved().values()].reduce((sum,data)=>sum+data.length,0);
      ui.advUsedSpace.textContent="Saved user data: "+bytes.toLocaleString()+" B";
      ui.advStorageState.textContent=host.getSaved().size+" saved file(s)";
    };
    let lastTree=null;
    const refresh = async () => {
      try { lastTree=await getTree();render(lastTree); }
      catch(e){host.log("Advanced tree read failed",e.message);render(null);}
    };
    const downloadFile = (name,data) => host.download(name,data,"application/octet-stream");
    const collect = async (prefix) => {
      const out=new Map();
      const fromNode = async (node,path) => {
        if (node.nodes) {
          for(const child of node.nodes)await fromNode(child,path?path+"/"+child.name:child.name);
        } else if(!prefix || path.toUpperCase().startsWith(prefix.toUpperCase()+"/") || path.toUpperCase()===prefix.toUpperCase()){
          if(node.size!==null && node.size>MAX_FILE)return;
          const bytes=await getSavedFile(path);
          if(bytes)out.set(path,bytes);
        }
      };
      if(lastTree)await fromNode(lastTree,"");
      for(const [name,bytes] of host.getSaved()){
        const path=name.includes("/")?name:"TURBOC3/Projects/"+name;
        if(!prefix||path.toUpperCase().startsWith(prefix.toUpperCase()+"/")||path.toUpperCase()===prefix.toUpperCase())out.set(path,bytes);
      }
      return out;
    };
    const exportZip = async () => {
      const prefix=selected?.folder?selected.path:"";
      const all=await collect(prefix);
      if(!all.size){message("No files to export");return;}
      if(!window.fflate?.zipSync) await host.ensureZip();
      const base=prefix?prefix+"/":"";
      const data=Object.fromEntries([...all].map(([path,bytes])=>[path.startsWith(base)?path.slice(base.length):path,bytes]));
      const zip=window.fflate.zipSync(data,{level:3});
      host.download((selected?.folder?toDos(selected.name):"C-DRIVE")+"-FILES.zip",zip,"application/zip");
      message("ZIP downloaded: "+all.size+" file(s).");
    };
    const downloadSelected = async () => {
      if(!selected)return;
      if(selected.folder){await exportZip();return;}
      const bytes=await getSavedFile(selected.path);
      if(!bytes){message("File not available. Restart or refresh.");return;}
      downloadFile(selected.name,bytes);message("Downloaded "+selected.name);
    };
    const deleteSelected = async () => {
      if(!selected || selected.folder || host.isBundled(selected.path))return;
      const path=selected.path;
      host.confirm(ui.advDeleteItem,"Delete "+selected.name+"?","Delete the file from the browser workspace and running DOS filesystem? This cannot be undone.",async()=>{
        const ci=host.getCI();
        if(ci?.fsDeleteFile) {
          try{await serial(()=>ci.fsDeleteFile(path));}catch(e){host.log("Guest delete warning",e.message);}
        }
        await host.remove(path);
        selected=null;
        await refresh();
        message("File removed. DOS may require a restart to refresh its directory.");
      });
    };
    const renameSelected = async () => {
      if(!selected||selected.folder||host.isBundled(selected.path))return;
      let filename=ui.advNewName.value.trim();
      if(!filename){message("Enter the new filename first.");return;}
      if(filename.includes("/")||filename.includes("\\")||filename.includes("..")){message("Name must be a single DOS filename");return;}
      filename=toDos(filename);
      const dir=selected.path.split("/").slice(0,-1).join("/");
      const next=(dir?dir+"/":"")+filename;
      if(next.toUpperCase()===selected.path.toUpperCase())return;
      const original=await getSavedFile(selected.path);
      if(!original){message("Source file not available");return;}
      if(host.getSaved().has(next)){message("Destination already exists");return;}
      try{
        await savePath(next,original);
        const ci=host.getCI();
        if(ci?.fsDeleteFile) await serial(()=>ci.fsDeleteFile(selected.path));
        await host.remove(selected.path);
        selected=null;await refresh();
        message("Renamed to "+filename+". Restart to refresh DOS directory.");
      }catch(e){message("Rename failed: "+e.message);}
    };
    const makeFolder = async () => {
      let name=ui.advNewName.value.trim();
      if(!name){message("Enter a folder name");return;}
      try{
        name=folderPath(name);
        const ok=await command("MD "+name.replace(/\//g,"\\"));
        if(ok)message("Sent MD "+name+" to DOS. Press Refresh when complete.");
      }catch(e){message("Invalid folder: "+e.message);}
    };
    // Read the ZIP central directory before decompressing. fflate.unzip()
    // otherwise allocates all expanded files before we can reject a ZIP bomb.
    const verifyZip = bytes => {
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      const u16=at=>view.getUint16(at,true);
      const u32=at=>view.getUint32(at,true);
      let end=-1;
      for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--) {
        if(u32(p)===0x06054b50 && p+22+u16(p+20)===bytes.length) {end=p;break;}
      }
      if(end<0) throw Error("ZIP central directory missing (or unsupported ZIP format)");
      const count=u16(end+10),centralSize=u32(end+12),centralOffset=u32(end+16);
      if(count===0 || count>MAX_ENTRIES || u16(end+8)!==count)
        throw Error("ZIP contains too many entries or spans multiple disks");
      if(centralOffset+centralSize>bytes.length || centralOffset+centralSize>end)
        throw Error("Invalid ZIP directory bounds");
      let pos=centralOffset,total=0;
      for(let n=0;n<count;n++) {
        if(pos+46>bytes.length || u32(pos)!==0x02014b50)
          throw Error("Invalid ZIP directory record");
        const flags=u16(pos+8),method=u16(pos+10),compressed=u32(pos+20),expanded=u32(pos+24);
        const nameSize=u16(pos+28),extraSize=u16(pos+30),commentSize=u16(pos+32);
        if(flags&1)throw Error("Encrypted ZIP files are unsupported");
        if(![0,8].includes(method))throw Error("Unsupported ZIP compression method");
        if(compressed===0xFFFFFFFF||expanded===0xFFFFFFFF)
          throw Error("ZIP64 archives are unsupported");
        if(expanded>MAX_FILE)throw Error("ZIP file exceeds 64 MiB uncompressed");
        total+=expanded;
        if(total>MAX_ARCHIVE)throw Error("ZIP expands beyond 128 MiB");
        const endName=pos+46+nameSize;
        if(endName+extraSize+commentSize>bytes.length)
          throw Error("Invalid ZIP entry length");
        pos=endName+extraSize+commentSize;
      }
      if(pos>centralOffset+centralSize)
        throw Error("ZIP central directory overflow");
      return count;
    };
    const unpack = async (file,container) => {
      await host.ensureZip();
      const zipped=new Uint8Array(await file.arrayBuffer());
      if(zipped.length>MAX_ARCHIVE)throw Error("Archive exceeds the 128 MiB limit");
      verifyZip(zipped);
      const extracted=await new Promise((resolve,reject)=>window.fflate.unzip(zipped,(e,v)=>e?reject(e):resolve(v)));
      const entries=Object.entries(extracted).filter(([n])=>!n.endsWith("/") && !/^\.jsdos\//i.test(n) && !/(^|\/)\.DS_Store$/i.test(n));
      if(entries.length>MAX_ENTRIES)throw Error("Archive contains too many files");
      let total=0,count=0;
      for(const [name,bytes] of entries){
        total+=bytes.length;
        if(bytes.length>MAX_FILE||total>MAX_ARCHIVE)throw Error("Archive has oversized extracted content");
        const relative=cleanEntry(name);
        const path=container+"/"+relative;
        if(host.isBundled(path))throw Error("Archive would overwrite bundled Turbo C");
        await savePath(path,bytes);count++;
      }
      return count;
    };
    const importFiles = async (files) => {
      const input=Array.from(files);
      if(!input.length)return;
      let ok=0;
      for(const file of input){
        try {
          const kind=ext(file.name);
          if(!["c","cpp","h","hpp","txt","exe","com","bat","zip","jsdos","iso","img","ima","cue","bin"].includes(kind))
            throw Error("Unsupported extension: "+kind);
          if(file.size>MAX_ARCHIVE)throw Error("File exceeds the 128 MiB limit");
          if(["zip","jsdos"].includes(kind)){
            const path=folderPath(ui.advTarget.value);
            ok+=await unpack(file,path);
            message("Imported archive into C:\\"+path.replace(/\//g,"\\")+". Restart Full DOS before running files.");
            continue;
          }
          const destination=["iso","img","ima","cue","bin"].includes(kind)?"IMAGES":
            ["c","cpp","h","hpp"].includes(kind)?"TURBOC3/Projects":folderPath(ui.advTarget.value);
          const fileName=toDos(file.name);
          if(["iso","img","ima"].includes(kind)&&fileName.split(".").pop()!==kind.toUpperCase()){
            throw Error("Disk image extension cannot be shortened reliably");
          }
          const path=destination+"/"+fileName;
          if(host.isBundled(path))throw Error("Cannot replace bundled Turbo C file");
          await savePath(path,new Uint8Array(await file.arrayBuffer()));
          ok++;
          if(["iso","img","ima","cue"].includes(kind)){
            selectedImage=path;
            ui.advMountBtn.disabled=false;
            ui.advMountDrive.value=kind==="iso"||kind==="cue"?"D":"A";
          }
        }catch(e){message(file.name+": "+e.message);host.log("Advanced import rejected",e.message);}
      }
      await refresh();
      if(ok)message("Imported "+ok+" file(s). Restart to refresh the DOS drive.");
      ui.advancedInput.value="";
    };
    const mountImage = async () => {
      const path=selectedImage;
      if(!path)return;
      if(!host.getSaved().has(path)){message("Image not saved. Reimport it first.");return;}
      const kind=ext(path);
      const drive=ui.advMountDrive.value;
      if(drive==="D" && !["iso","cue"].includes(kind)){message("Choose an ISO/CUE image for D:");return;}
      if(drive==="A" && !["img","ima"].includes(kind)){message("Choose an IMG/IMA floppy image for A:");return;}
      if(kind==="cue"){message("CUE/BIN auto-mount is not verified. Use a plain ISO for D:.");return;}
      host.confirm(ui.advMountBtn,"Mount image as "+drive+":?","Restart Full DOS and mount your supplied "+path+" as "+drive+":. The current DOS session is saved locally.",async()=>{
        opts.mount={drive,path};persistOptions();
        host.closeDrawer();
        await host.restart();
      });
    };
    const onOpenFiles=async()=>{await refresh();};
    const onReady=()=>{if(opts.mount)message("Requested mount "+opts.mount.path+" as "+opts.mount.drive+":. Run MOUNT to verify.");};
    const getSensitivity=()=>Math.max(20,Math.min(200,Number(opts.sensitivity)||100));
    ui.advBrowseBtn.addEventListener("click",()=>ui.advancedInput.click());
    ui.advDropzone.addEventListener("click",()=>ui.advancedInput.click());
    ui.advDropzone.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();ui.advancedInput.click();}});
    ui.advancedInput.addEventListener("change",()=>void importFiles(ui.advancedInput.files));
    ui.advDropzone.addEventListener("dragover",e=>{e.preventDefault();ui.advDropzone.classList.add("is-dragging");});
    ui.advDropzone.addEventListener("dragleave",()=>ui.advDropzone.classList.remove("is-dragging"));
    ui.advDropzone.addEventListener("drop",e=>{e.preventDefault();ui.advDropzone.classList.remove("is-dragging");void importFiles(e.dataTransfer.files);});
    ui.advRefreshBtn.addEventListener("click",()=>void refresh());
    ui.advSaveBtn.addEventListener("click",()=>void host.saveWorkspace());
    ui.advResetBtn.addEventListener("click",()=>host.confirm(ui.advResetBtn,"Reset saved workspace?","Delete saved user files in both modes? The current DOS session remains running until restart.",async()=>{await host.reset();selected=null;await refresh();}));
    ui.advDownloadItem.addEventListener("click",()=>void downloadSelected());
    ui.advRenameItem.addEventListener("click",()=>void renameSelected());
    ui.advDeleteItem.addEventListener("click",()=>void deleteSelected());
    ui.advDownloadZip.addEventListener("click",()=>void exportZip());
    ui.advMakeFolder.addEventListener("click",()=>void makeFolder());
    ui.advMountBtn.addEventListener("click",()=>void mountImage());
    root.querySelectorAll("[data-close-drawer]").forEach(b=>b.addEventListener("click",host.closeDrawer));
    return { ui, getConfig, getSensitivity, resetSettings, onOpenFiles, onReady, importFiles, command, refresh, collect };
  };
})();
