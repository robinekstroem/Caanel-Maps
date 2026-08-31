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
    touchState: null
  };

  function defaultMeta() {
    return { projects: [], todos: [], fileMeta: {}, measurements: {}, version: 1 };
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
    renderProject();
    showView("projectView", false);
  }

  function renderProject(){
    const p=currentProject(); if(!p) return;
    $("#projectName").textContent=p.name;
    $("#projectMeta").textContent=`${(p.files||[]).length} PDF-filer`;
    const q=$("#projectSearch").value.trim().toLowerCase();
    let files=(p.files||[]).map(id=>fileMeta(id)).filter(Boolean);
    if(q) files=files.filter(f => `${f.name} ${f.originalName||""} ${f.path||""}`.toLowerCase().includes(q));
    if($("#sortSelect").value==="recent") files.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
    else files.sort((a,b)=>a.name.localeCompare(b.name,"sv"));
    const list=$("#projectFiles");
    if(!files.length){
      list.innerHTML='<div class="empty">Inga PDF-filer här ännu.<br>Importera PDF eller packa upp en ZIP.</div>';
      return;
    }
    list.innerHTML=files.map(f=>fileRowHtml(f,true)).join("");
    wireFileRows(list);
  }

  function fileRowHtml(f, showProject=false){
    const project=projectById(f.projectId);
    return `<div class="file-row" data-file-row="${f.id}">
      <div class="file-icon">PDF</div>
      <div class="file-main">
        <div class="file-name">${esc(f.name)}</div>
        <div class="file-meta">${showProject&&project?esc(project.name)+" • ":""}${f.path?esc(f.path)+" • ":""}${fmtBytes(f.size||0)}</div>
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
    });
  }

  async function renameFile(id){
    const f=fileMeta(id); if(!f) return;
    const base=f.name.replace(/\.pdf$/i,"");
    const name=await promptModal("Byt namn","Originalfilen behålls i bakgrunden.",base);
    if(!name) return;
    f.name=name.replace(/\.pdf$/i,"")+".pdf"; saveMeta(); renderProject(); renderAllDrawings(); toast("Namnet sparades");
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
    state.meta.fileMeta[id]={
      id, projectId:p.id, name:originalName.split("/").pop(), originalName:originalName.split("/").pop(),
      path, size:blob.size, addedAt:Date.now(), scales:{}
    };
    p.files=p.files||[]; p.files.push(id); saveMeta();
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
    if(q) files=files.filter(f=>`${f.name} ${f.originalName||""} ${projectById(f.projectId)?.name||""}`.toLowerCase().includes(q));
    files.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
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

  async function openPdf(id){
    const f=fileMeta(id); if(!f) return;
    const blob=await getBlob(id); if(!blob){toast("PDF-filen saknas lokalt");return}
    const pending=state.pendingViewState;
    state.currentFileId=id; state.pageNum=1; state.tempPoints=[]; state.tool="pan";
    $("#viewerTitle").textContent=f.name; $("#viewerSubtitle").textContent=projectById(f.projectId)?.name||"";
    setTool("pan"); showView("viewerView",false);
    try{
      const buf=await blob.arrayBuffer();
      state.pdfDoc=await pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
      state.pageCount=state.pdfDoc.numPages;
      await renderPdfPage();
      updateDrawingNav();
      populateFloorSwitcher();
      syncFloorButtonState();
      if(pending){
        state.pendingViewState=null;
        restoreViewState(pending);
      }else{
        fitDrawing();
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
      pan:"Nyp med två fingrar för zoom • helt utzoomad: swipa mellan ritningar • dubbeltryck för helskärm.",
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
            state.lastTapAt=0; state.suppressClickUntil=now+450; await toggleFullscreen();
          }else state.lastTapAt=now;
        }
      }
    },{passive:false});

    viewport.addEventListener("touchcancel",()=>{state.touchState=null},{passive:true});
    viewport.addEventListener("dblclick",e=>{
      if(state.tool!=="pan" || state.syncCapture)return;
      e.preventDefault(); toggleFullscreen();
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
  $("#backFilesBtn").onclick=()=>{const f=fileMeta(state.currentFileId); if(f){state.currentProjectId=f.projectId;renderProject();showView("projectView",false)}else showView("projectsView")};
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
  $("#prevPageBtn").onclick=async()=>{if(state.pageNum>1){state.pageNum--;await renderPdfPage()}};
  $("#nextPageBtn").onclick=async()=>{if(state.pageNum<state.pageCount){state.pageNum++;await renderPdfPage()}};
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