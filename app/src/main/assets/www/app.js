(() => {
  "use strict";
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const META_KEY = "caanel-field-meta-v1";
  const DB_NAME = "caanel-field-files";
  const STORE = "files";

  const state = {
    meta: loadMeta(),
    currentView: "projectsView",
    currentProjectId: null,
    currentFileId: null,
    pdfDoc: null,
    pageNum: 1,
    pageCount: 1,
    renderScale: 1.45,
    tool: "pan",
    tempPoints: [],
    deferredInstall: null,
    viewZoom: 1,
    baseCanvasWidth: 0,
    baseCanvasHeight: 0,
    gesturePointers: new Map(),
    gestureStart: null,
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    pinchAnchor: null,
    lastTapAt: 0,
    suppressClickUntil: 0,
    fitZoom: 1,
    lockViewAcrossDrawings: true,
    pendingViewState: null,
    syncCapture: null,
    touchState: null,
    currentProjectCategory: "Alla",
    smartHotspots: [],
    pendingArmatureTarget: null,
    armatureReturn: null,
    armatureHighlight: null,
    selectedArmatureEntry: null,
    analysisBusy: false
  };

  function defaultMeta() {
    return { projects: [], todos: [], fileMeta: {}, measurements: {}, version: 2 };
  }
  function loadMeta() {
    try { return {...defaultMeta(), ...JSON.parse(localStorage.getItem(META_KEY) || "{}")}; }
    catch { return defaultMeta(); }
  }
  function saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(state.meta));
  }
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmtBytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
  const projectById = id => state.meta.projects.find(p => p.id === id);
  const currentProject = () => projectById(state.currentProjectId);
  const fileMeta = id => state.meta.fileMeta[id];


  const CATEGORY_ORDER = ["Belysning","Kraft","Tele","Kanalisation","Brand","Passage","Övrigt"];
  const stripPdf = name => String(name||"").replace(/\.pdf$/i,"");
  const displayLabel = f => stripPdf(f?.name || f?.originalName || "Ritning");
  const cleanTag = s => String(s||"").toUpperCase().replace(/\s+/g," ").trim().replace(/^ARM\s*(\d+)$/, "ARM $1");

  function splitArmatureTag(text){
    const t=String(text||"").trim().replace(/\s+/g," ");
    const m=t.match(/^(ARM\s*\d+|L\d+[A-Z]?|N\d+[A-Z]?|P\d+[A-Z]?|K\d+[A-Z]?|BL)(?:\s+(.+))?$/i);
    return m ? {tag:cleanTag(m[1]), rest:(m[2]||"").trim()} : null;
  }
  function normalizeCategory(text){
    const u=String(text||"").toUpperCase();
    if(/BELYSNING|LJUSPLAN|ARMATURPLAN/.test(u)) return "Belysning";
    if(/KANALISATION|KANALISERING/.test(u)) return "Kanalisation";
    if(/\bKRAFT\b|KRAFTPLAN/.test(u)) return "Kraft";
    if(/\bTELE\b|DATA\/TELE|TELEPLAN/.test(u)) return "Tele";
    if(/\bBRAND\b|BRANDLARM/.test(u)) return "Brand";
    if(/PASSAGE|PASSERSYSTEM|PASSER/.test(u)) return "Passage";
    return "Övrigt";
  }
  function extractPlan(text){
    const m=String(text||"").match(/\bPLAN\s*0*(\d{1,3})\b/i);
    return m ? String(Number(m[1])) : "";
  }
  function smartSortFiles(a,b){
    const ca=CATEGORY_ORDER.indexOf(a.category||"Övrigt"), cb=CATEGORY_ORDER.indexOf(b.category||"Övrigt");
    if(ca!==cb) return (ca<0?99:ca)-(cb<0?99:cb);
    const pa=Number(a.plan||9999), pb=Number(b.plan||9999);
    if(pa!==pb) return pa-pb;
    return displayLabel(a).localeCompare(displayLabel(b),"sv");
  }

  function valueAfterLabel(lines,label){
    const labels=new Set(["BEST NR","TYP","BESTYCKNING","MONTAGE","MÅTT","TILLBEHÖR","STYRNING"]);
    const i=lines.findIndex(x=>String(x).trim().toUpperCase()===label);
    if(i<0)return "";
    for(let j=i+1;j<Math.min(lines.length,i+6);j++){
      const v=String(lines[j]||"").trim();
      if(!v || labels.has(v.toUpperCase())) continue;
      return v;
    }
    return "";
  }

  async function analyzePdfBlob(blob, originalName){
    if(!window.pdfjsLib) return null;
    try{
      const buf=await blob.arrayBuffer();
      const doc=await pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
      const pages=[];
      const maxPages=Math.min(doc.numPages,30);
      for(let n=1;n<=maxPages;n++){
        const page=await doc.getPage(n);
        const tc=await page.getTextContent();
        const viewport=page.getViewport({scale:1});
        const items=tc.items.map(item=>{
          const str=String(item.str||"").trim();
          if(!str)return null;
          const tx=pdfjsLib.Util.transform(viewport.transform,item.transform);
          const h=Math.max(5,Math.hypot(tx[2],tx[3])||Math.abs(item.height||8));
          const w=Math.max(5,(item.width||str.length*4));
          return {str,x:tx[4],y:tx[5]-h,w,h};
        }).filter(Boolean);
        pages.push({page:n,items,viewport});
      }
      const first=pages[0]?.items.map(x=>x.str)||[];
      const all=pages.flatMap(p=>p.items.map(x=>x.str));
      const allText=all.join(" ");
      const tagCount=all.filter(x=>splitArmatureTag(x)).length;
      const isSchedule=/armatur/i.test(originalName||"") || (/BESTYCKNING/i.test(allText)&&/MONTAGE/i.test(allText)&&/STYRNING/i.test(allText)&&tagCount>=4);
      const tail=first.slice(-Math.max(80,Math.ceil(first.length*.28)));
      const tailText=tail.join(" ");
      let category=isSchedule ? "Belysning" : "Övrigt";
      if(!isSchedule){
        const exact=tail.map(x=>String(x).trim().toUpperCase());
        const exactMap=[["BELYSNING","Belysning"],["KRAFT","Kraft"],["TELE","Tele"],["KANALISATION","Kanalisation"],["BRAND","Brand"],["PASSAGE","Passage"]];
        const hit=exactMap.find(([k])=>exact.includes(k));
        category=hit?hit[1]:normalizeCategory(tailText);
      }
      const plan=extractPlan(tailText)||extractPlan(first.join(" "));
      const armatureIndex=[];
      if(isSchedule){
        for(const pg of pages){
          const its=pg.items;
          const starts=[];
          for(let i=0;i<its.length;i++) if(splitArmatureTag(its[i].str)) starts.push(i);
          for(let si=0;si<starts.length;si++){
            const i=starts[si], end=starts[si+1]??its.length;
            const hit=splitArmatureTag(its[i].str); if(!hit)continue;
            const group=its.slice(i,Math.min(end,i+45)).map(x=>x.str);
            const brand=hit.rest || group.slice(1).find(v=>!["BEST NR","TYP","BESTYCKNING","MONTAGE","MÅTT","TILLBEHÖR","STYRNING"].includes(String(v).toUpperCase())) || "";
            armatureIndex.push({
              tag:hit.tag,page:pg.page,x:its[i].x,y:its[i].y,w:its[i].w,h:its[i].h,
              brand, type:valueAfterLabel(group,"TYP"), lamp:valueAfterLabel(group,"BESTYCKNING"),
              montage:valueAfterLabel(group,"MONTAGE"), control:valueAfterLabel(group,"STYRNING"),
              raw:group.slice(0,22)
            });
          }
        }
      }
      let displayName;
      if(isSchedule) displayName="Armaturförteckning";
      else if(category!=="Övrigt") displayName=category+(plan?` – Plan ${plan}`:"");
      else displayName=stripPdf(originalName);
      return {analysisVersion:2,documentType:isSchedule?"armatureSchedule":"drawing",category,plan,displayName,armatureIndex,pages:doc.numPages};
    }catch(err){console.warn("PDF analysis failed",originalName,err);return null}
  }

  function applyAnalysis(f,a){
    if(!f||!a)return;
    f.analysisVersion=2; f.documentType=a.documentType; f.category=a.category; f.plan=a.plan; f.armatureIndex=a.armatureIndex||[]; f.pageCount=a.pages||1;
    if(f.name===f.originalName || f.autoNamed){ f.name=a.displayName+".pdf"; f.autoNamed=true; }
  }

  async function analyzeProjectFilesMissing(projectId){
    if(state.analysisBusy)return;
    const p=projectById(projectId); if(!p)return;
    const ids=(p.files||[]).filter(id=>fileMeta(id)?.analysisVersion!==2);
    if(!ids.length)return;
    state.analysisBusy=true;
    try{
      for(let i=0;i<ids.length;i++){
        const f=fileMeta(ids[i]), blob=await getBlob(ids[i]); if(!f||!blob)continue;
        if(state.currentProjectId===projectId) $("#projectStatus").textContent=`Analyserar ritningar… ${i+1}/${ids.length}`;
        applyAnalysis(f,await analyzePdfBlob(blob,f.originalName));
      }
      state.meta.version=2; saveMeta();
      if(state.currentProjectId===projectId){$("#projectStatus").textContent="PDF-analys klar.";renderProject()}
      renderProjects(); renderAllDrawings();
    }finally{state.analysisBusy=false}
  }

  function findArmatureSchedule(projectId){
    const p=projectById(projectId);
    return (p?.files||[]).map(id=>fileMeta(id)).find(f=>f?.documentType==="armatureSchedule" && (f.armatureIndex||[]).length);
  }

  let dbPromise;
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function putBlob(id, blob) {
    const d = await db();
    await new Promise((resolve,reject)=>{
      const tx=d.transaction(STORE,"readwrite"); tx.objectStore(STORE).put(blob,id);
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    });
  }
  async function getBlob(id) {
    const d=await db();
    return new Promise((resolve,reject)=>{
      const req=d.transaction(STORE,"readonly").objectStore(STORE).get(id);
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
  }
  async function deleteBlob(id) {
    const d=await db();
    await new Promise((resolve,reject)=>{
      const tx=d.transaction(STORE,"readwrite"); tx.objectStore(STORE).delete(id);
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    });
  }
  async function clearBlobs() {
    const d=await db();
    await new Promise((resolve,reject)=>{
      const tx=d.transaction(STORE,"readwrite"); tx.objectStore(STORE).clear();
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    });
  }

  function showView(id, nav=true) {
    $$(".view").forEach(v=>v.classList.toggle("active", v.id===id));
    state.currentView=id;
    $("#bottomNav").classList.toggle("hidden", id==="viewerView" || id==="projectView");
    if(nav) $$(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.view===id));
    window.scrollTo({top:0,behavior:"instant"});
  }

  function toast(msg) {
    const el=$("#toast"); el.textContent=msg; el.classList.remove("hidden");
    clearTimeout(el._t); el._t=setTimeout(()=>el.classList.add("hidden"),2400);
  }

  function promptModal(title, text, value="", type="text") {
    return new Promise(resolve=>{
      $("#modalTitle").textContent=title; $("#modalText").textContent=text || "";
      const input=$("#modalInput"); input.type=type; input.value=value; $("#modal").classList.remove("hidden");
      setTimeout(()=>{input.focus();input.select()},30);
      const done = val => {
        $("#modal").classList.add("hidden");
        $("#modalOk").onclick=null; $("#modalCancel").onclick=null; input.onkeydown=null; resolve(val);
      };
      $("#modalOk").onclick=()=>done(input.value.trim());
      $("#modalCancel").onclick=()=>done(null);
      input.onkeydown=e=>{ if(e.key==="Enter") done(input.value.trim()); if(e.key==="Escape") done(null); };
    });
  }

  function renderProjects() {
    const grid=$("#projectGrid");
    if(!state.meta.projects.length){
      grid.innerHTML='<div class="empty">Inga projekt ännu.<br><strong>Skapa ditt första projekt ovan.</strong></div>';
      return;
    }
    grid.innerHTML=state.meta.projects.map(p=>{
      const files=(p.files||[]).length;
      return `<button class="project-card" data-project="${p.id}">
        <div class="project-top"><div><p class="eyebrow">PROJEKT</p><h3>${esc(p.name)}</h3></div><span class="project-arrow">›</span></div>
        <div class="project-count">${files} ${files===1?"ritning":"ritningar"}</div>
      </button>`;
    }).join("");
    $$("[data-project]").forEach(b=>b.onclick=()=>openProject(b.dataset.project));
  }

  function openProject(id){
    state.currentProjectId=id;
    state.currentProjectCategory="Alla";
    renderProject();
    showView("projectView", false);
    setTimeout(()=>analyzeProjectFilesMissing(id),80);
  }

  function renderProject(){
    const p=currentProject(); if(!p) return;
    $("#projectName").textContent=p.name;
    $("#projectMeta").textContent=`${(p.files||[]).length} PDF-filer`;
    const q=$("#projectSearch").value.trim().toLowerCase();
    let files=(p.files||[]).map(id=>fileMeta(id)).filter(Boolean);
    renderCategoryTabs(files);
    if(state.currentProjectCategory!=="Alla") files=files.filter(f=>(f.category||"Övrigt")===state.currentProjectCategory);
    if(q) files=files.filter(f => `${f.name} ${f.originalName||""} ${f.path||""} ${f.category||""} ${f.plan||""}`.toLowerCase().includes(q));
    const sort=$("#sortSelect").value;
    if(sort==="recent") files.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
    else if(sort==="name") files.sort((a,b)=>displayLabel(a).localeCompare(displayLabel(b),"sv"));
    else files.sort(smartSortFiles);
    const list=$("#projectFiles");
    if(!files.length){
      list.innerHTML='<div class="empty">Inga PDF-filer i den här kategorin.</div>';
      return;
    }
    list.innerHTML=files.map(f=>fileRowHtml(f,true)).join("");
    wireFileRows(list);
  }

  function renderCategoryTabs(files){
    const root=$("#categoryTabs"); if(!root)return;
    const counts={}; files.forEach(f=>counts[f.category||"Övrigt"]=(counts[f.category||"Övrigt"]||0)+1);
    const cats=["Alla",...CATEGORY_ORDER];
    root.innerHTML=cats.map(c=>`<button class="category-tab ${state.currentProjectCategory===c?"active":""}" data-category="${esc(c)}">${esc(c)} <span class="category-count">${c==="Alla"?files.length:(counts[c]||0)}</span></button>`).join("");
    root.querySelectorAll("[data-category]").forEach(b=>b.onclick=()=>{state.currentProjectCategory=b.dataset.category;renderProject()});
  }

  function fileRowHtml(f, showProject=false){
    const project=projectById(f.projectId);
    const tags=[f.category||"Övrigt",f.plan?`Plan ${f.plan}`:"",f.documentType==="armatureSchedule"?"Smart dokument":""].filter(Boolean);
    return `<div class="file-row" data-file-row="${f.id}">
      <div class="file-icon">${f.documentType==="armatureSchedule"?"LIST":"PDF"}</div>
      <div class="file-main">
        <div class="file-name">${esc(displayLabel(f))}</div>
        <div class="file-tags">${tags.map((t,i)=>`<button class="file-tag ${i===2?"smart":""} ${i===0?"category-edit":""}" ${i===0?`data-category-edit="${f.id}"`:""}>${esc(t)}</button>`).join("")}</div>
        <div class="file-meta">${showProject&&project?esc(project.name)+" • ":""}${esc(f.originalName||"")}${f.path?" • "+esc(f.path):""} • ${fmtBytes(f.size||0)}</div>
      </div>
      <div class="row-actions">
        <button class="row-btn open-file" title="Öppna">›</button>
        <button class="row-btn rename-file" title="Byt namn">✎</button>
        <button class="row-btn delete-file" title="Ta bort">×</button>
      </div>
    </div>`;
  }

  function wireFileRows(root){
    root.querySelectorAll("[data-file-row]").forEach(row=>{
      const id=row.dataset.fileRow;
      row.querySelector(".open-file").onclick=()=>openPdf(id);
      row.querySelector(".rename-file").onclick=()=>renameFile(id);
      row.querySelector(".delete-file").onclick=()=>deleteFile(id);
      row.querySelector(".file-main").onclick=()=>openPdf(id);
      const cat=row.querySelector(".category-edit");
      if(cat) cat.onclick=async e=>{e.stopPropagation();await editFileCategory(id)};
    });
  }

  async function editFileCategory(id){
    const f=fileMeta(id);if(!f)return;
    const v=await promptModal("Ändra kategori","Skriv: Belysning, Kraft, Tele, Kanalisation, Brand, Passage eller Övrigt.",f.category||"Övrigt");
    if(!v)return;
    const match=CATEGORY_ORDER.find(c=>c.toLowerCase()===v.toLowerCase())||"Övrigt";
    f.category=match; saveMeta(); renderProject(); renderAllDrawings(); toast(`Kategori: ${match}`);
  }

  async function renameFile(id){
    const f=fileMeta(id); if(!f) return;
    const base=f.name.replace(/\.pdf$/i,"");
    const name=await promptModal("Byt namn","Originalfilen behålls i bakgrunden.",base);
    if(!name) return;
    f.name=name.replace(/\.pdf$/i,"")+".pdf"; f.autoNamed=false; saveMeta(); renderProject(); renderAllDrawings(); toast("Namnet sparades");
  }

  async function deleteFile(id){
    const f=fileMeta(id); if(!f) return;
    const ok=await promptModal("Ta bort ritning",`Skriv TA BORT för att radera ${f.name}.`,"");
    if(ok!=="TA BORT") return;
    const p=projectById(f.projectId);
    p.files=(p.files||[]).filter(x=>x!==id);
    delete state.meta.fileMeta[id];
    Object.keys(state.meta.measurements).filter(k=>k.startsWith(id+":")).forEach(k=>delete state.meta.measurements[k]);
    saveMeta(); await deleteBlob(id); renderProject(); renderProjects(); renderAllDrawings(); toast("Ritningen togs bort");
  }

  async function addPdfBlob(blob, originalName, path=""){
    const p=currentProject(); if(!p) return;
    const id=uid();
    await putBlob(id, blob);
    const base=originalName.split("/").pop();
    const f={id,projectId:p.id,name:base,originalName:base,path,size:blob.size,addedAt:Date.now(),scales:{},category:"Övrigt"};
    state.meta.fileMeta[id]=f;
    p.files=p.files||[]; p.files.push(id); saveMeta();
    $("#projectStatus").textContent=`Läser ${base}…`;
    applyAnalysis(f,await analyzePdfBlob(blob,base));
    saveMeta();
  }

  async function importPdfs(fileList){
    $("#projectStatus").textContent="Importerar PDF-filer…";
    for(const file of [...fileList]) if(file.name.toLowerCase().endsWith(".pdf")) await addPdfBlob(file,file.name,"");
    $("#projectStatus").textContent="Klart.";
    renderProject(); renderProjects(); renderAllDrawings(); toast("PDF-filer importerade");
  }

  async function importZip(file){
    if(!window.JSZip){toast("ZIP-modulen kunde inte laddas");return}
    $("#projectStatus").textContent=`Packar upp ${file.name}…`;
    try{
      const zip=await JSZip.loadAsync(file);
      const entries=Object.values(zip.files).filter(e=>!e.dir&&e.name.toLowerCase().endsWith(".pdf"));
      if(!entries.length){$("#projectStatus").textContent="ZIP-filen innehöll inga PDF-filer.";return}
      let n=0;
      for(const e of entries){
        const blob=await e.async("blob");
        const parts=e.name.split("/"); const name=parts.pop(); const path=parts.join("/");
        await addPdfBlob(blob,name,path); n++;
        $("#projectStatus").textContent=`Packar upp… ${n}/${entries.length}`;
      }
      $("#projectStatus").textContent=`Klart: ${n} PDF-filer extraherades.`;
      renderProject(); renderProjects(); renderAllDrawings(); toast(`${n} PDF-filer uppackade`);
    }catch(err){ console.error(err); $("#projectStatus").textContent="Kunde inte packa upp ZIP-filen."; }
  }

  function renderAllDrawings(){
    const q=$("#drawingSearch").value.trim().toLowerCase();
    let files=Object.values(state.meta.fileMeta);
    if(q) files=files.filter(f=>`${f.name} ${f.originalName||""} ${f.category||""} ${f.plan||""} ${projectById(f.projectId)?.name||""}`.toLowerCase().includes(q));
    files.sort(smartSortFiles);
    const list=$("#allDrawings");
    if(!files.length){list.innerHTML='<div class="empty">Inga ritningar ännu.</div>';return}
    list.innerHTML=files.map(f=>fileRowHtml(f,true)).join("");
    wireFileRows(list);
  }

  function renderTodos(){
    const list=$("#todoList");
    if(!state.meta.todos.length){list.innerHTML='<div class="empty">Inga punkter ännu.</div>';return}
    list.innerHTML=state.meta.todos.map(t=>`<div class="todo-row ${t.done?"done":""}" data-todo="${t.id}">
      <input type="checkbox" ${t.done?"checked":""}><div class="todo-text">${esc(t.text)}</div><button class="row-btn">×</button>
    </div>`).join("");
    list.querySelectorAll("[data-todo]").forEach(row=>{
      const id=row.dataset.todo, t=state.meta.todos.find(x=>x.id===id);
      row.querySelector("input").onchange=e=>{t.done=e.target.checked;saveMeta();renderTodos()};
      row.querySelector("button").onclick=()=>{state.meta.todos=state.meta.todos.filter(x=>x.id!==id);saveMeta();renderTodos()};
    });
  }

  async function openPdf(id, opts={}){
    const f=fileMeta(id); if(!f) return;
    const blob=await getBlob(id); if(!blob){toast("PDF-filen saknas lokalt");return}
    const pending=opts.viewState || state.pendingViewState;
    state.currentFileId=id; state.pageNum=opts.page||1; state.tempPoints=[]; state.tool="pan"; state.smartHotspots=[];
    $("#viewerTitle").textContent=displayLabel(f); $("#viewerSubtitle").textContent=projectById(f.projectId)?.name||"";
    setTool("pan"); showView("viewerView",false);
    try{
      const buf=await blob.arrayBuffer();
      state.pdfDoc=await pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
      state.pageCount=state.pdfDoc.numPages;
      state.pageNum=clamp(state.pageNum,1,state.pageCount);
      await renderPdfPage();
      updateDrawingNav(); populateFloorSwitcher(); syncFloorButtonState(); syncSmartNavUI();
      if(pending){ state.pendingViewState=null; restoreViewState(pending); }
      else fitDrawing();
      if(state.pendingArmatureTarget && f.documentType==="armatureSchedule"){
        const target=state.pendingArmatureTarget; state.pendingArmatureTarget=null;
        focusArmatureTarget(target);
      }
    }catch(e){console.error(e);toast("Kunde inte öppna PDF-filen")}
  }

  function pageKey(){return `${state.currentFileId}:${state.pageNum}`}
  function currentScale(){
    const f=fileMeta(state.currentFileId); return Number(f?.scales?.[state.pageNum] || 100);
  }
  function setScale(n){
    const f=fileMeta(state.currentFileId); if(!f) return;
    f.scales=f.scales||{}; f.scales[state.pageNum]=Number(n); saveMeta(); syncScaleUI(); drawOverlay();
  }
  function syncScaleUI(){
    const s=currentScale(); $("#scaleLabel").textContent=`Skala 1:${Number(s.toFixed(2))}`;
    const preset=$("#scalePreset");
    const known=["20","50","100","200","500"];
    preset.value=known.includes(String(s))?String(s):"custom";
  }

  async function renderPdfPage(){
    const page=await state.pdfDoc.getPage(state.pageNum);
    const viewport=page.getViewport({scale:state.renderScale});
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const canvas=$("#pdfCanvas"), overlay=$("#overlayCanvas"), wrap=$("#canvasWrap");
    canvas.width=Math.floor(viewport.width*dpr); canvas.height=Math.floor(viewport.height*dpr);
    state.baseCanvasWidth=viewport.width; state.baseCanvasHeight=viewport.height;
    canvas.style.width=viewport.width+"px"; canvas.style.height=viewport.height+"px";
    overlay.width=Math.floor(viewport.width*dpr); overlay.height=Math.floor(viewport.height*dpr);
    overlay.style.width=viewport.width+"px"; overlay.style.height=viewport.height+"px";
    state.fitZoom=computeFitZoom();
    if(!state.pendingViewState) state.viewZoom=state.fitZoom;
    applyZoom(false);
    const ctx=canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0);
    await page.render({canvasContext:ctx,viewport}).promise;
    await loadSmartHotspots(page,viewport);
    $("#pageLabel").textContent=`${state.pageNum} / ${state.pageCount}`;
    $("#prevPageBtn").disabled=state.pageNum<=1; $("#nextPageBtn").disabled=state.pageNum>=state.pageCount;
    syncScaleUI(); state.tempPoints=[]; drawOverlay(); updateHint();
  }

  function getMeasurements(){
    state.meta.measurements[pageKey()]=state.meta.measurements[pageKey()]||[];
    return state.meta.measurements[pageKey()];
  }
  function pdfPointFromEvent(e){
    const r=$("#overlayCanvas").getBoundingClientRect();
    return {x:(e.clientX-r.left)/(state.renderScale*state.viewZoom),y:(e.clientY-r.top)/(state.renderScale*state.viewZoom)};
  }
  function distancePt(a,b){return Math.hypot(b.x-a.x,b.y-a.y)}
  function ptToM(pt){return pt/72*0.0254*currentScale()}
  function formatLength(m){return m<1?`${Math.round(m*1000)} mm`:`${m.toFixed(2)} m`}
  function polygonAreaPt2(points){
    let s=0; for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];s+=a.x*b.y-b.x*a.y} return Math.abs(s)/2;
  }
  function pt2ToM2(a){const onePtM=1/72*0.0254*currentScale();return a*onePtM*onePtM}
  function routeLength(points){let n=0;for(let i=1;i<points.length;i++)n+=distancePt(points[i-1],points[i]);return n}

  function setTool(tool){
    state.tool=tool; state.tempPoints=[];
    $$(".tool[data-tool]").forEach(b=>b.classList.toggle("active",b.dataset.tool===tool));
    $("#finishMeasureBtn").classList.toggle("hidden",!(tool==="route"||tool==="area"));
    $("#overlayCanvas").style.pointerEvents=tool==="pan"?"none":"auto";
    updateHint(); drawOverlay();
  }
  function updateHint(){
    const text={
      pan:"Nyp för zoom • dubbeltryck på t.ex. L13 för armaturinfo • dubbeltryck annars för helskärm.",
      distance:"Tryck på två punkter för att mäta ett avstånd.",
      route:"Tryck ut en kabelväg/sträcka. Tryck Slutför när du är klar.",
      area:"Markera hörnen runt en yta. Tryck Slutför när du är klar."
    }[state.tool];
    $("#measureHint").textContent=text;
  }

  function drawOverlay(){
    const c=$("#overlayCanvas"), dpr=Math.min(window.devicePixelRatio||1,2), ctx=c.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,c.width/dpr,c.height/dpr);
    ctx.lineWidth=2.5;ctx.strokeStyle="#ff6a00";ctx.fillStyle="#ff6a00";ctx.font="700 13px system-ui";
    const toPx=p=>({x:p.x*state.renderScale,y:p.y*state.renderScale});
    function drawPath(points,closed=false,label=""){
      if(points.length<1)return; const q=points.map(toPx);ctx.beginPath();ctx.moveTo(q[0].x,q[0].y);
      q.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));if(closed&&q.length>2)ctx.closePath();ctx.stroke();
      q.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill()});
      if(label&&q.length){const p=q[Math.floor(q.length/2)];ctx.fillStyle="rgba(11,11,12,.88)";ctx.fillRect(p.x+6,p.y-20,Math.max(70,label.length*7),22);ctx.fillStyle="#ff6a00";ctx.fillText(label,p.x+11,p.y-5)}
    }
    getMeasurements().forEach(m=>drawPath(m.points,m.type==="area",m.label));
    const f=fileMeta(state.currentFileId);
    const refs=f?.syncRefs?.[state.pageNum] || [];
    const live=state.syncCapture?.fileId===state.currentFileId ? state.syncCapture.points : [];
    [...refs, ...live].forEach((p,i)=>{
      const q=toPx(p);
      ctx.beginPath(); ctx.arc(q.x,q.y,7,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle="rgba(11,11,12,.9)"; ctx.fillRect(q.x+9,q.y-13,24,22);
      ctx.fillStyle="#ff6a00"; ctx.fillText(i%2===0?"A":"B",q.x+15,q.y+3);
    });
    const hi=state.armatureHighlight;
    if(hi && hi.fileId===state.currentFileId && hi.page===state.pageNum){
      const e=hi.entry,q=toPx({x:e.x,y:e.y});
      const w=Math.max(42,(e.w||25)*state.renderScale),h=Math.max(26,(e.h||12)*state.renderScale);
      ctx.save();ctx.strokeStyle="#ff6a00";ctx.lineWidth=4;ctx.strokeRect(q.x-10,q.y-10,w+20,h+20);ctx.restore();
    }
    if(state.tempPoints.length) drawPath(state.tempPoints,false,"");
  }

  function finishTemp(){
    const pts=[...state.tempPoints]; if(!pts.length)return;
    if(state.tool==="route"&&pts.length>=2){
      const m=ptToM(routeLength(pts)); getMeasurements().push({id:uid(),type:"route",points:pts,label:formatLength(m)});
      $("#measureResult").textContent=formatLength(m);
    }else if(state.tool==="area"&&pts.length>=3){
      const m2=pt2ToM2(polygonAreaPt2(pts)); getMeasurements().push({id:uid(),type:"area",points:pts,label:`${m2.toFixed(2)} m²`});
      $("#measureResult").textContent=`${m2.toFixed(2)} m²`;
    }
    state.tempPoints=[]; saveMeta(); drawOverlay();
  }

  $("#overlayCanvas").addEventListener("click",e=>{
    if(Date.now()<state.suppressClickUntil)return;
    if(state.tool==="pan")return;
    const p=pdfPointFromEvent(e);
    if(state.tool==="distance"){
      state.tempPoints.push(p);
      if(state.tempPoints.length===2){
        const m=ptToM(distancePt(state.tempPoints[0],state.tempPoints[1]));
        getMeasurements().push({id:uid(),type:"distance",points:[...state.tempPoints],label:formatLength(m)});
        $("#measureResult").textContent=formatLength(m); state.tempPoints=[]; saveMeta();
      }
    }else state.tempPoints.push(p);
    drawOverlay();
  });


  async function loadSmartHotspots(page,viewport){
    state.smartHotspots=[];
    const f=fileMeta(state.currentFileId); if(!f || f.documentType!=="drawing" || f.category!=="Belysning")return;
    const schedule=findArmatureSchedule(f.projectId); if(!schedule)return;
    const index=new Map((schedule.armatureIndex||[]).map(e=>[cleanTag(e.tag),e]));
    if(!index.size)return;
    try{
      const tc=await page.getTextContent();
      for(const item of tc.items){
        const hit=splitArmatureTag(item.str); if(!hit || !index.has(hit.tag))continue;
        const tx=pdfjsLib.Util.transform(viewport.transform,item.transform);
        const h=Math.max(6,Math.hypot(tx[2],tx[3]));
        const w=Math.max(8,(item.width||hit.tag.length*5)*state.renderScale);
        state.smartHotspots.push({tag:hit.tag,entry:index.get(hit.tag),x:tx[4]/state.renderScale,y:(tx[5]-h)/state.renderScale,w:w/state.renderScale,h:h/state.renderScale});
      }
    }catch(err){console.warn("Hotspot scan failed",err)}
  }

  function nearestSmartHotspot(clientX,clientY){
    if(!state.smartHotspots.length)return null;
    const p=pdfPointFromClient(clientX,clientY);
    let best=null,bestD=Infinity;
    for(const h of state.smartHotspots){
      const pad=Math.max(14,28/state.viewZoom);
      const inside=p.x>=h.x-pad&&p.x<=h.x+h.w+pad&&p.y>=h.y-pad&&p.y<=h.y+h.h+pad;
      const cx=h.x+h.w/2,cy=h.y+h.h/2,d=Math.hypot(p.x-cx,p.y-cy);
      if((inside||d<pad*1.6)&&d<bestD){best=h;bestD=d}
    }
    return best;
  }

  function showArmatureCard(entry){
    state.selectedArmatureEntry=entry;
    $("#armatureTitle").textContent=entry.tag;
    const rows=[["Fabrikat",entry.brand],["Typ",entry.type],["Bestyckning",entry.lamp],["Montage",entry.montage],["Styrning",entry.control],["Förteckning",`Sida ${entry.page}`]].filter(x=>x[1]);
    $("#armatureDetails").innerHTML=rows.map(([k,v])=>`<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join("");
    $("#armatureSheet").classList.remove("hidden");
  }

  function closeArmatureCard(){ $("#armatureSheet").classList.add("hidden"); }

  async function handleSmartDoubleTap(clientX,clientY){
    if(state.tool!=="pan" || state.syncCapture)return false;
    const hit=nearestSmartHotspot(clientX,clientY);
    if(!hit)return false;
    showArmatureCard(hit.entry); return true;
  }

  async function openSelectedArmatureInPdf(){
    const entry=state.selectedArmatureEntry; if(!entry)return;
    const source=fileMeta(state.currentFileId); if(!source)return;
    const schedule=findArmatureSchedule(source.projectId); if(!schedule){toast("Ingen armaturförteckning hittades i projektet");return}
    closeArmatureCard();
    state.armatureReturn={fileId:state.currentFileId,page:state.pageNum,viewState:captureViewState()};
    state.pendingArmatureTarget=entry;
    await openPdf(schedule.id,{page:entry.page});
  }

  function focusArmatureTarget(entry){
    const viewport=$("#pdfViewport");
    state.armatureHighlight={fileId:state.currentFileId,page:state.pageNum,entry};
    state.viewZoom=clamp(Math.max(state.fitZoom*2.6,1.25),state.fitZoom,Math.max(6,state.fitZoom*10));
    applyZoom(false);
    requestAnimationFrame(()=>{
      const cx=(entry.x+(entry.w||20)/2)*state.renderScale*state.viewZoom;
      const cy=(entry.y+(entry.h||12)/2)*state.renderScale*state.viewZoom;
      viewport.scrollLeft=Math.max(0,cx-viewport.clientWidth/2);
      viewport.scrollTop=Math.max(0,cy-viewport.clientHeight/2);
      drawOverlay();
    });
  }

  function syncSmartNavUI(){
    const f=fileMeta(state.currentFileId);
    const show=!!state.armatureReturn && f?.documentType==="armatureSchedule";
    $("#backToDrawingBtn").classList.toggle("hidden",!show);
  }

  async function returnToArmatureSource(){
    const r=state.armatureReturn;if(!r)return;
    state.armatureReturn=null; state.armatureHighlight=null;
    await openPdf(r.fileId,{page:r.page,viewState:r.viewState});
  }

  async function calibrate(){
    setTool("distance"); state.tempPoints=[];
    $("#measureHint").textContent="Kalibrering: tryck på två punkter med ett känt mått.";
    const handler=async e=>{
      const p=pdfPointFromEvent(e); state.tempPoints.push(p); drawOverlay();
      if(state.tempPoints.length===2){
        $("#overlayCanvas").removeEventListener("click",handler,true);
        const rawM=distancePt(state.tempPoints[0],state.tempPoints[1])/72*0.0254;
        const input=await promptModal("Kalibrera ritningen","Ange det verkliga avståndet mellan punkterna i meter, t.ex. 3.00.","3.00","number");
        if(input){
          const known=Number(String(input).replace(",","."));
          if(Number.isFinite(known)&&known>0){
            const denom=known/rawM; setScale(denom); toast(`Kalibrerad till ca 1:${denom.toFixed(2)}`);
          }
        }
        state.tempPoints=[]; setTool("pan"); drawOverlay();
      }
    };
    $("#overlayCanvas").addEventListener("click",handler,true);
  }


  function clamp(v,min,max){return Math.max(min,Math.min(max,v))}

  function computeFitZoom(){
    const viewport=$("#pdfViewport");
    if(!state.baseCanvasWidth || !state.baseCanvasHeight || !viewport.clientWidth || !viewport.clientHeight) return 1;
    const pad=8;
    return Math.min(
      Math.max(.08,(viewport.clientWidth-pad)/state.baseCanvasWidth),
      Math.max(.08,(viewport.clientHeight-pad)/state.baseCanvasHeight),
      1
    );
  }

  function isFullyZoomedOut(){
    return state.viewZoom <= state.fitZoom * 1.035;
  }

  function applyZoom(keepCenter=true){
    const viewport=$("#pdfViewport"), wrap=$("#canvasWrap"), canvas=$("#pdfCanvas"), overlay=$("#overlayCanvas");
    if(!state.baseCanvasWidth || !state.baseCanvasHeight)return;
    const oldW=parseFloat(wrap.style.width)||state.baseCanvasWidth*state.viewZoom;
    const oldH=parseFloat(wrap.style.height)||state.baseCanvasHeight*state.viewZoom;
    const centerX=viewport.scrollLeft+viewport.clientWidth/2;
    const centerY=viewport.scrollTop+viewport.clientHeight/2;
    const fx=oldW?centerX/oldW:.5, fy=oldH?centerY/oldH:.5;

    const min=state.fitZoom||.1;
    state.viewZoom=clamp(state.viewZoom,min,Math.max(6,min*10));
    const w=state.baseCanvasWidth*state.viewZoom, h=state.baseCanvasHeight*state.viewZoom;
    canvas.style.width=w+"px"; canvas.style.height=h+"px";
    overlay.style.width=w+"px"; overlay.style.height=h+"px";
    wrap.style.width=w+"px"; wrap.style.height=h+"px";
    $("#zoomResetBtn").textContent=isFullyZoomedOut()?"Passa":Math.round(state.viewZoom/state.fitZoom*100)+"%";
    if(keepCenter){
      requestAnimationFrame(()=>{
        viewport.scrollLeft=Math.max(0,fx*w-viewport.clientWidth/2);
        viewport.scrollTop=Math.max(0,fy*h-viewport.clientHeight/2);
      });
    }
  }

  function fitDrawing(){
    state.fitZoom=computeFitZoom();
    state.viewZoom=state.fitZoom;
    applyZoom(false);
    const viewport=$("#pdfViewport");
    requestAnimationFrame(()=>{
      viewport.scrollLeft=Math.max(0,($("#canvasWrap").scrollWidth-viewport.clientWidth)/2);
      viewport.scrollTop=Math.max(0,($("#canvasWrap").scrollHeight-viewport.clientHeight)/2);
    });
  }

  function setZoom(next,anchorClient=null){
    const viewport=$("#pdfViewport");
    const old=state.viewZoom;
    const min=state.fitZoom||.1;
    const z=clamp(next,min,Math.max(6,min*10));
    if(Math.abs(z-old)<.0005)return;
    let contentX=null,contentY=null,clientX=null,clientY=null;
    if(anchorClient){
      const vr=viewport.getBoundingClientRect();
      clientX=anchorClient.x-vr.left; clientY=anchorClient.y-vr.top;
      contentX=(viewport.scrollLeft+clientX)/old;
      contentY=(viewport.scrollTop+clientY)/old;
    }
    state.viewZoom=z;
    applyZoom(!anchorClient);
    if(anchorClient){
      requestAnimationFrame(()=>{
        viewport.scrollLeft=Math.max(0,contentX*z-clientX);
        viewport.scrollTop=Math.max(0,contentY*z-clientY);
      });
    }
  }

  function orderedProjectFiles(){
    const f=fileMeta(state.currentFileId); if(!f)return[];
    const p=projectById(f.projectId); return (p?.files||[]).filter(id=>fileMeta(id));
  }

  function populateFloorSwitcher(){
    const sel=$("#floorDrawingSelect");
    if(!sel)return;
    const ids=orderedProjectFiles();
    sel.innerHTML="";
    ids.forEach((id,i)=>{
      const f=fileMeta(id),o=document.createElement("option");
      o.value=id;
      o.textContent=f?.name||("Ritning "+(i+1));
      o.selected=id===state.currentFileId;
      sel.appendChild(o);
    });
  }

  function currentPdfCenter(){
    const viewport=$("#pdfViewport");
    const denom=state.renderScale*state.viewZoom;
    return {
      x:(viewport.scrollLeft+viewport.clientWidth/2)/denom,
      y:(viewport.scrollTop+viewport.clientHeight/2)/denom
    };
  }

  function captureViewState(){
    const source=fileMeta(state.currentFileId);
    const p=currentPdfCenter();
    const pdfW=state.baseCanvasWidth/state.renderScale;
    const pdfH=state.baseCanvasHeight/state.renderScale;
    return {
      sourceFileId:state.currentFileId,
      sourcePage:state.pageNum,
      zoom:state.viewZoom,
      fitZoom:state.fitZoom,
      center:p,
      normX:pdfW?p.x/pdfW:.5,
      normY:pdfH?p.y/pdfH:.5
    };
  }

  function refsFor(fileId,page=1){
    return fileMeta(fileId)?.syncRefs?.[page] || null;
  }

  function mapByTwoRefs(point, sourceRefs, targetRefs){
    if(!sourceRefs || !targetRefs || sourceRefs.length<2 || targetRefs.length<2) return null;
    const a=sourceRefs[0], b=sourceRefs[1], A=targetRefs[0], B=targetRefs[1];
    const sx=b.x-a.x, sy=b.y-a.y, tx=B.x-A.x, ty=B.y-A.y;
    const sl=Math.hypot(sx,sy), tl=Math.hypot(tx,ty);
    if(sl<1e-6 || tl<1e-6)return null;
    const scale=tl/sl;
    const ang=Math.atan2(ty,tx)-Math.atan2(sy,sx);
    const c=Math.cos(ang), s=Math.sin(ang);
    const px=point.x-a.x, py=point.y-a.y;
    return {
      x:A.x+scale*(px*c-py*s),
      y:A.y+scale*(px*s+py*c),
      scale
    };
  }

  function restoreViewState(v){
    const viewport=$("#pdfViewport");
    const targetFileId=state.currentFileId;
    const sourceRefs=refsFor(v.sourceFileId,v.sourcePage||1);
    const targetRefs=refsFor(targetFileId,state.pageNum);
    const mapped=mapByTwoRefs(v.center,sourceRefs,targetRefs);

    let targetCenter, targetZoom;
    if(mapped){
      targetCenter={x:mapped.x,y:mapped.y};
      targetZoom=clamp(v.zoom/mapped.scale,state.fitZoom,Math.max(6,state.fitZoom*10));
      $("#measureHint").textContent="Synkad vy: samma fysiska område mellan våningsplan.";
    }else{
      const pdfW=state.baseCanvasWidth/state.renderScale;
      const pdfH=state.baseCanvasHeight/state.renderScale;
      targetCenter={x:(v.normX??.5)*pdfW,y:(v.normY??.5)*pdfH};
      const relative=v.fitZoom? v.zoom/v.fitZoom : 1;
      targetZoom=clamp(state.fitZoom*relative,state.fitZoom,Math.max(6,state.fitZoom*10));
    }

    state.viewZoom=targetZoom;
    applyZoom(false);
    requestAnimationFrame(()=>{
      viewport.scrollLeft=Math.max(0,targetCenter.x*state.renderScale*state.viewZoom-viewport.clientWidth/2);
      viewport.scrollTop=Math.max(0,targetCenter.y*state.renderScale*state.viewZoom-viewport.clientHeight/2);
    });
  }

  async function switchDrawingKeepView(id){
    if(!id || id===state.currentFileId)return;
    state.pendingViewState=state.lockViewAcrossDrawings?captureViewState():null;
    await openPdf(id);
  }

  async function openAdjacentDrawing(dir){
    const ids=orderedProjectFiles();
    if(ids.length<2){toast("Det finns inga fler ritningar");return}
    const i=ids.indexOf(state.currentFileId); if(i<0)return;
    const next=i+dir;
    if(next<0||next>=ids.length){toast(dir>0?"Sista ritningen":"Första ritningen");return}
    await switchDrawingKeepView(ids[next]);
  }

  function updateDrawingNav(){
    const ids=orderedProjectFiles(), i=ids.indexOf(state.currentFileId);
    $("#prevDrawingBtn").disabled=i<=0;
    $("#nextDrawingBtn").disabled=i<0||i>=ids.length-1;
  }

  function syncFloorButtonState(){
    const f=fileMeta(state.currentFileId);
    const refs=f?.syncRefs?.[state.pageNum]||[];
    const b=$("#syncFloorBtn");
    if(!b)return;
    b.classList.toggle("synced",refs.length===2);
    b.textContent=refs.length===2?"⌖ Synkad":"⌖ Synka plan";
  }

  function pdfPointFromClient(clientX,clientY){
    const r=$("#overlayCanvas").getBoundingClientRect();
    return {
      x:(clientX-r.left)/(state.renderScale*state.viewZoom),
      y:(clientY-r.top)/(state.renderScale*state.viewZoom)
    };
  }

  async function startFloorSync(){
    if(state.syncCapture){
      state.syncCapture=null; drawOverlay(); updateHint(); toast("Synkning avbruten"); return;
    }
    const ok=await promptModal(
      "Synka våningsritning",
      "Markera två tydliga punkter A och B som finns på samma fysiska plats på alla våningsritningar, t.ex. två hörn i ett trapphus. Gör samma sak på nästa våning.",
      "START"
    );
    if(ok===null)return;
    setTool("pan");
    state.syncCapture={fileId:state.currentFileId,page:state.pageNum,points:[]};
    $("#measureHint").textContent="Synkning: tryck på referenspunkt A.";
    drawOverlay();
  }

  function handleSyncTap(clientX,clientY){
    const sc=state.syncCapture;
    if(!sc || sc.fileId!==state.currentFileId || sc.page!==state.pageNum)return false;
    sc.points.push(pdfPointFromClient(clientX,clientY));
    if(sc.points.length===1){
      $("#measureHint").textContent="Synkning: tryck på referenspunkt B.";
      drawOverlay();
    }else{
      const f=fileMeta(state.currentFileId);
      f.syncRefs=f.syncRefs||{};
      f.syncRefs[state.pageNum]=sc.points.slice(0,2);
      state.syncCapture=null;
      saveMeta(); drawOverlay(); syncFloorButtonState();
      $("#measureHint").textContent="Plan synkat. Markera samma A- och B-punkter på nästa våningsritning.";
      toast("Referenspunkter sparade");
    }
    return true;
  }

  async function toggleFullscreen(){
    const viewer=$("#viewerView");
    const isNative=!!(document.fullscreenElement||document.webkitFullscreenElement);
    const isPseudo=viewer.classList.contains("pseudo-fullscreen");
    if(isNative){
      try{
        if(document.exitFullscreen)await document.exitFullscreen();
        else if(document.webkitExitFullscreen)document.webkitExitFullscreen();
      }catch(e){}
      viewer.classList.remove("fullscreen-ui"); return;
    }
    if(isPseudo){
      viewer.classList.remove("pseudo-fullscreen","fullscreen-ui");
      $("#fullscreenBtn").textContent="⛶"; return;
    }
    try{
      if(viewer.requestFullscreen){await viewer.requestFullscreen();viewer.classList.add("fullscreen-ui")}
      else if(viewer.webkitRequestFullscreen){viewer.webkitRequestFullscreen();viewer.classList.add("fullscreen-ui")}
      else throw new Error("fullscreen unsupported");
    }catch(e){
      viewer.classList.add("pseudo-fullscreen","fullscreen-ui");
    }
    $("#fullscreenBtn").textContent="⤢";
  }

  function syncFullscreenUI(){
    const active=!!(document.fullscreenElement||document.webkitFullscreenElement)||$("#viewerView").classList.contains("pseudo-fullscreen");
    $("#fullscreenBtn").textContent=active?"⤢":"⛶";
    $("#viewerView").classList.toggle("fullscreen-ui",active);
  }

  function installViewerGestures(){
    const viewport=$("#pdfViewport");

    // Mouse / stylus fallback
    let mouse=null;
    viewport.addEventListener("pointerdown",e=>{
      if(e.pointerType==="touch" || state.currentView!=="viewerView")return;
      mouse={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop,time:Date.now(),moved:false};
      try{viewport.setPointerCapture(e.pointerId)}catch(_){}
    });
    viewport.addEventListener("pointermove",e=>{
      if(e.pointerType==="touch" || !mouse || state.tool!=="pan")return;
      const dx=e.clientX-mouse.x,dy=e.clientY-mouse.y;
      mouse.lastX=e.clientX; mouse.lastY=e.clientY;
      if(Math.abs(dx)>4||Math.abs(dy)>4)mouse.moved=true;
      if(!isFullyZoomedOut()){
        viewport.scrollLeft=mouse.scrollLeft-dx;
        viewport.scrollTop=mouse.scrollTop-dy;
      }
    });
    viewport.addEventListener("pointerup",async e=>{
      if(e.pointerType==="touch" || !mouse)return;
      const m=mouse;mouse=null;
      const dx=m.lastX-m.x,dy=m.lastY-m.y,dt=Date.now()-m.time;
      if(isFullyZoomedOut() && dt<800 && Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)*1.25){
        await openAdjacentDrawing(dx<0?1:-1); return;
      }
      if(!m.moved && handleSyncTap(e.clientX,e.clientY))return;
    });

    // Native touch handling for Android/Samsung browsers
    viewport.addEventListener("touchstart",e=>{
      if(state.currentView!=="viewerView")return;
      if(e.touches.length===2){
        e.preventDefault();
        const a=e.touches[0],b=e.touches[1];
        state.touchState={
          mode:"pinch",
          startDistance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),
          startZoom:state.viewZoom,
          midX:(a.clientX+b.clientX)/2,
          midY:(a.clientY+b.clientY)/2
        };
        state.suppressClickUntil=Date.now()+450;
      }else if(e.touches.length===1){
        const t=e.touches[0];
        state.touchState={
          mode:"single",startX:t.clientX,startY:t.clientY,lastX:t.clientX,lastY:t.clientY,
          scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop,time:Date.now(),moved:false
        };
      }
    },{passive:false});

    viewport.addEventListener("touchmove",e=>{
      const ts=state.touchState;if(!ts)return;
      if(e.touches.length===2){
        e.preventDefault();
        const a=e.touches[0],b=e.touches[1];
        const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
        if(ts.mode!=="pinch"){
          ts.mode="pinch";
          ts.startDistance=d;
          ts.startZoom=state.viewZoom;
        }
        if(ts.startDistance>4){
          setZoom(ts.startZoom*(d/ts.startDistance),{
            x:(a.clientX+b.clientX)/2,
            y:(a.clientY+b.clientY)/2
          });
        }
        state.suppressClickUntil=Date.now()+350;
        return;
      }
      if(e.touches.length===1 && ts.mode==="single" && state.tool==="pan"){
        e.preventDefault();
        const t=e.touches[0],dx=t.clientX-ts.startX,dy=t.clientY-ts.startY;
        ts.lastX=t.clientX;ts.lastY=t.clientY;
        if(Math.abs(dx)>4||Math.abs(dy)>4)ts.moved=true;

        // Inzoomad = panorera. Helt utzoomad = reservera horisontell gest för byte av ritning.
        if(!isFullyZoomedOut()){
          viewport.scrollLeft=ts.scrollLeft-dx;
          viewport.scrollTop=ts.scrollTop-dy;
        }
      }
    },{passive:false});

    viewport.addEventListener("touchend",async e=>{
      const ts=state.touchState;if(!ts || e.touches.length>0)return;
      state.touchState=null;
      if(ts.mode!=="single")return;
      const dx=ts.lastX-ts.startX,dy=ts.lastY-ts.startY,dt=Date.now()-ts.time;

      if(isFullyZoomedOut() && state.tool==="pan" && dt<850 && Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.2){
        state.suppressClickUntil=Date.now()+400;
        await openAdjacentDrawing(dx<0?1:-1);
        return;
      }

      if(!ts.moved){
        const changed=e.changedTouches?.[0];
        const cx=changed?.clientX ?? ts.lastX, cy=changed?.clientY ?? ts.lastY;
        if(handleSyncTap(cx,cy)){
          state.suppressClickUntil=Date.now()+400; return;
        }
        if(state.tool==="pan" && dt<350){
          const now=Date.now();
          if(now-state.lastTapAt<360){
            state.lastTapAt=0; state.suppressClickUntil=now+450;
            const smart=await handleSmartDoubleTap(cx,cy);
            if(!smart) await toggleFullscreen();
          }else state.lastTapAt=now;
        }
      }
    },{passive:false});

    viewport.addEventListener("touchcancel",()=>{state.touchState=null},{passive:true});
    viewport.addEventListener("dblclick",async e=>{
      if(state.tool!=="pan" || state.syncCapture)return;
      e.preventDefault();
      const smart=await handleSmartDoubleTap(e.clientX,e.clientY);
      if(!smart) toggleFullscreen();
    });
  }

  async function exportProject(){
    const p=currentProject(); if(!p||!window.JSZip)return;
    $("#projectStatus").textContent="Skapar ZIP…";
    const zip=new JSZip(); const folder=zip.folder(p.name.replace(/[\\/:*?"<>|]/g,"_"));
    for(const id of p.files||[]){
      const f=fileMeta(id), blob=await getBlob(id); if(f&&blob) folder.file(f.name,blob);
    }
    folder.file("_CAANEL_metadata.json",JSON.stringify({project:p,files:(p.files||[]).map(id=>fileMeta(id))},null,2));
    const out=await zip.generateAsync({type:"blob"});
    downloadBlob(out,`${p.name.replace(/[\\/:*?"<>|]/g,"_")}.zip`);
    $("#projectStatus").textContent="Projektet exporterades."; toast("Projekt ZIP skapad");
  }

  async function exportBackup(){
    if(!window.JSZip){toast("ZIP-modulen saknas");return}
    const zip=new JSZip(); zip.file("caanel-backup.json",JSON.stringify(state.meta,null,2));
    const folder=zip.folder("pdf");
    for(const id of Object.keys(state.meta.fileMeta)){const b=await getBlob(id);if(b)folder.file(id+".pdf",b)}
    const out=await zip.generateAsync({type:"blob"}); downloadBlob(out,"CAANEL_Field_backup.zip"); toast("Backup skapad");
  }

  async function importBackup(file){
    if(!window.JSZip)return;
    try{
      const zip=await JSZip.loadAsync(file), mf=zip.file("caanel-backup.json"); if(!mf)throw new Error("metadata missing");
      const meta=JSON.parse(await mf.async("text"));
      await clearBlobs();
      for(const id of Object.keys(meta.fileMeta||{})){const zf=zip.file(`pdf/${id}.pdf`);if(zf)await putBlob(id,await zf.async("blob"))}
      state.meta={...defaultMeta(),...meta}; saveMeta(); renderProjects();renderAllDrawings();renderTodos();showView("projectsView");toast("Backup återställd");
    }catch(e){console.error(e);toast("Kunde inte importera backup")}
  }

  function downloadBlob(blob,name){
    if(window.Android && typeof Android.saveBase64==="function"){
      const r=new FileReader();
      r.onload=()=>Android.saveBase64(name,String(r.result||""));
      r.onerror=()=>toast("Kunde inte förbereda filen för nedladdning");
      r.readAsDataURL(blob);
      return;
    }
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),3000);
  }

  // Navigation & UI wiring
  $$(".nav-btn").forEach(b=>b.onclick=()=>{showView(b.dataset.view); if(b.dataset.view==="projectsView")renderProjects(); if(b.dataset.view==="drawingsView")renderAllDrawings(); if(b.dataset.view==="todoView")renderTodos()});
  $("#brandBtn").onclick=()=>{renderProjects();showView("projectsView")};
  $("#newProjectBtn").onclick=async()=>{
    const name=await promptModal("Nytt projekt","Ge projektet ett namn.","Nytt projekt");
    if(!name)return; const p={id:uid(),name,files:[],createdAt:Date.now()};state.meta.projects.unshift(p);saveMeta();renderProjects();openProject(p.id);
  };
  $("#backProjectsBtn").onclick=()=>{renderProjects();showView("projectsView")};
  $("#renameProjectBtn").onclick=async()=>{const p=currentProject();const n=await promptModal("Byt projektnamn","",p.name);if(n){p.name=n;saveMeta();renderProject()}};
  $("#pdfInput").onchange=e=>{if(e.target.files.length)importPdfs(e.target.files);e.target.value=""};
  $("#zipInput").onchange=e=>{if(e.target.files[0])importZip(e.target.files[0]);e.target.value=""};
  $("#projectSearch").oninput=renderProject; $("#sortSelect").onchange=renderProject; $("#drawingSearch").oninput=renderAllDrawings;
  $("#exportProjectBtn").onclick=exportProject; $("#exportBackupBtn").onclick=exportBackup; $("#backupInput").onchange=e=>{if(e.target.files[0])importBackup(e.target.files[0]);e.target.value=""};
  $("#newTodoBtn").onclick=async()=>{const t=await promptModal("Ny punkt","Vad ska göras?","");if(t){state.meta.todos.unshift({id:uid(),text:t,done:false});saveMeta();renderTodos()}};
  $("#backFilesBtn").onclick=()=>{const f=fileMeta(state.currentFileId); state.armatureReturn=null; state.armatureHighlight=null; if(f){state.currentProjectId=f.projectId;renderProject();showView("projectView",false)}else showView("projectsView")};
  $("#backToDrawingBtn").onclick=returnToArmatureSource;
  $("#closeArmatureSheet").onclick=closeArmatureCard;
  $("#armatureSheet").onclick=e=>{if(e.target===$("#armatureSheet"))closeArmatureCard()};
  $("#showArmaturePdfBtn").onclick=openSelectedArmatureInPdf;
  $("#renameDrawingBtn").onclick=()=>renameFile(state.currentFileId);
  $("#prevDrawingBtn").onclick=()=>openAdjacentDrawing(-1);
  $("#nextDrawingBtn").onclick=()=>openAdjacentDrawing(1);
  $("#fullscreenBtn").onclick=toggleFullscreen;
  $("#zoomResetBtn").onclick=fitDrawing;
  $("#floorDrawingSelect").onchange=e=>switchDrawingKeepView(e.target.value);
  $("#lockViewBtn").onclick=()=>{
    state.lockViewAcrossDrawings=!state.lockViewAcrossDrawings;
    $("#lockViewBtn").classList.toggle("active",state.lockViewAcrossDrawings);
    $("#lockViewBtn").textContent=state.lockViewAcrossDrawings?"🔒 Vy":"🔓 Vy";
    toast(state.lockViewAcrossDrawings?"Vy följer med mellan ritningar":"Vy-lås av");
  };
  $("#syncFloorBtn").onclick=startFloorSync;
  document.addEventListener("fullscreenchange",syncFullscreenUI);
  document.addEventListener("webkitfullscreenchange",syncFullscreenUI);
  $("#prevPageBtn").onclick=async()=>{if(state.pageNum>1){state.pageNum--;state.armatureHighlight=null;await renderPdfPage()}};
  $("#nextPageBtn").onclick=async()=>{if(state.pageNum<state.pageCount){state.pageNum++;state.armatureHighlight=null;await renderPdfPage()}};
  $("#scalePreset").onchange=async e=>{
    if(e.target.value==="custom"){
      const v=await promptModal("Egen skala","Ange nämnaren. För 1:75 skriver du 75.",String(currentScale()),"number");
      if(v&&Number(v)>0)setScale(Number(v)); else syncScaleUI();
    }else setScale(Number(e.target.value));
  };
  $("#calibrateBtn").onclick=calibrate;
  $$(".tool[data-tool]").forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
  $("#finishMeasureBtn").onclick=finishTemp;
  $("#clearMeasuresBtn").onclick=()=>{state.meta.measurements[pageKey()]=[];state.tempPoints=[];saveMeta();drawOverlay();$("#measureResult").textContent="Rensat"};

  // Install prompt
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();state.deferredInstall=e;$("#installBtn").classList.remove("hidden")});
  $("#installBtn").onclick=async()=>{if(!state.deferredInstall)return;state.deferredInstall.prompt();await state.deferredInstall.userChoice;state.deferredInstall=null;$("#installBtn").classList.add("hidden")};

  if("serviceWorker" in navigator && location.protocol!=="file:") navigator.serviceWorker.register("sw.js").catch(()=>{});

  installViewerGestures();
  renderProjects(); renderAllDrawings(); renderTodos();
})();