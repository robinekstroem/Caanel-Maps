(() => {
  "use strict";
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const META_KEY = "caanel-field-meta-v1"; // keep key so existing projects survive rebrand
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
    analysisBusy: false,
    todoFilter: "open",
    editMeasure: null,
    distanceDraft: null,
    pageTextItems: [],
    calibrationMode: null,
    ataFilter: "open", ataSelected: new Set(), ataPhotoTarget: null, riserMode:false, selectedOverlay:null, drawDraft:null
  };

  function defaultMeta() {
    return { projects: [], todos: [], atas: [], fileMeta: {}, measurements: {}, annotations: {}, version: 5 };
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


  const ANALYSIS_VERSION = 6;
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
  function extractTitlePlanPart(text){
    const t=String(text||"").replace(/\s+/g," ");
    const m=t.match(/\bPLAN\s*0*(\d{1,3})\s*[,;:\-]?\s*DEL\s*0*(\d{1,2})\b/i);
    return m ? {plan:String(Number(m[1])),part:String(Number(m[2]))} : null;
  }
  function extractPart(text, originalName="", plan=""){
    const t=String(text||"");
    let m=t.match(/\b(?:DEL|DELEN|PART)\s*0*(\d{1,2})\b/i);
    if(m) return String(Number(m[1]));
    const base=stripPdf(originalName).replace(/\s+/g,"");
    m=base.match(/(?:^|[-_])([0-9]{2})([0-9]{2})(?:$|[-_])/);
    if(m && (!plan || String(Number(m[1]))===String(Number(plan)))) return String(Number(m[2]));
    m=base.match(/(?:^|[-_])([0-9]{2,3})([0-9])$/);
    if(m && plan && String(Number(m[1]))===String(Number(plan))) return String(Number(m[2]));
    return "";
  }
  function extractDrawingScale(text){
    const t=String(text||"").replace(/\s+/g," ");
    const patterns=[/SKALA[^\d]{0,18}1\s*[:/]\s*(20|25|50|75|100|150|200|250|500)\b/i,/\b1\s*[:/]\s*(20|25|50|75|100|150|200|250|500)\b/];
    for(const re of patterns){const m=t.match(re);if(m)return Number(m[1]);}
    return null;
  }
  function normalizeProductText(s){
    return String(s||"").toLowerCase().replace(/[®™]/g,"").replace(/[^a-z0-9åäö]+/g," ").replace(/\b(?:led|dali|occhio|w|k|cri|matt|white|black|svart|vit|bronze|brons)\b/g," ").replace(/\s+/g," ").trim();
  }
  function productTokens(s){return new Set(normalizeProductText(s).split(" ").filter(x=>x.length>=3));}
  function occhioMatchScore(scheduleEntry,occhioEntry){
    const a=productTokens([scheduleEntry.brand,scheduleEntry.type,scheduleEntry.lamp,(scheduleEntry.raw||[]).join(" ")].join(" "));
    const b=productTokens([occhioEntry.type,occhioEntry.lamp,(occhioEntry.raw||[]).join(" ")].join(" "));
    if(!a.size||!b.size)return 0;
    let common=0; for(const x of a)if(b.has(x))common++;
    const denom=Math.max(2,Math.min(a.size,b.size));
    return common/denom;
  }
  function enrichEntryWithOcchio(projectId,entry){
    if(!entry || entry.occhio)return entry;
    const occ=findArmatureSchedules(projectId).filter(s=>s.documentType==="occhioSchedule").flatMap(s=>s.armatureIndex||[]);
    const manual=state.meta.occhioLinks?.[projectId]?.[cleanTag(entry.tag)];
    if(manual){const hit=occ.find(o=>cleanTag(o.tag)===cleanTag(manual)||cleanTag(o.aliases?.[0])===cleanTag(manual));if(hit)return {...entry,occhioMatch:hit,occhioConfidence:1,occhioManual:true};}
    let best=null,score=0;
    for(const o of occ){const q=occhioMatchScore(entry,o);if(q>score){score=q;best=o;}}
    if(best && score>=.42){return {...entry,occhioMatch:best,occhioConfidence:score};}
    return entry;
  }
  function findTagOccurrences(text){
    const out=[]; const t=String(text||"").toUpperCase();
    const re=/(?:^|[^A-Z0-9])(ARM\s*\d+|L\d+[A-Z]?|N\d+[A-Z]?|P\d+[A-Z]?|K\d+[A-Z]?|BL)(?=$|[^A-Z0-9])/g;
    let m; while((m=re.exec(t)))out.push(cleanTag(m[1]));
    const pos=/\b(?:POSITION|POS)\s*0*(\d{1,2})\b/g; while((m=pos.exec(t)))out.push(`POS ${String(Number(m[1])).padStart(2,"0")}`);
    return [...new Set(out)];
  }

  function smartSortFiles(a,b){
    const ca=CATEGORY_ORDER.indexOf(a.category||"Övrigt"), cb=CATEGORY_ORDER.indexOf(b.category||"Övrigt");
    if(ca!==cb) return (ca<0?99:ca)-(cb<0?99:cb);
    const pa=Number(a.plan||9999), pb=Number(b.plan||9999);
    if(pa!==pb) return pa-pb;
    const da=Number(a.part||0), db=Number(b.part||0); if(da!==db)return da-db;
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
      const isOcchio=/occhio/i.test(originalName||"") || (/product overview/i.test(allText)&&/position\s*0?1/i.test(allText)&&/Occhio/i.test(allText));
      const isSchedule=isOcchio || /armatur/i.test(originalName||"") || (/BESTYCKNING/i.test(allText)&&/MONTAGE/i.test(allText)&&/STYRNING/i.test(allText)&&tagCount>=4);
      const tail=first.slice(-Math.max(80,Math.ceil(first.length*.28)));
      const tailText=tail.join(" ");
      let category=isSchedule ? "Belysning" : "Övrigt";
      if(!isSchedule){
        const exact=tail.map(x=>String(x).trim().toUpperCase());
        const exactMap=[["BELYSNING","Belysning"],["KRAFT","Kraft"],["TELE","Tele"],["KANALISATION","Kanalisation"],["BRAND","Brand"],["PASSAGE","Passage"]];
        const hit=exactMap.find(([k])=>exact.includes(k));
        category=hit?hit[1]:normalizeCategory(tailText);
      }
      // Title block wins over orientation figures and other PLAN references on the sheet.
      const titlePlanPart=extractTitlePlanPart(tailText)||extractTitlePlanPart(first.join(" "));
      const plan=titlePlanPart?.plan || extractPlan(tailText)||extractPlan(first.join(" "));
      const part=titlePlanPart?.part || extractPart(tailText+" "+first.join(" "),originalName,plan);
      const armatureIndex=[];
      if(isOcchio){
        for(const pg of pages){
          const its=pg.items;
          for(let i=0;i<its.length;i++){
            const mm=its[i].str.match(/^position\s*0*(\d{1,2})$/i); if(!mm)continue;
            const num=String(Number(mm[1])).padStart(2,"0");
            const group=its.slice(i,Math.min(i+18,its.length)).map(x=>x.str);
            const product=group.slice(1).find(v=>/^1\s*x\s+/i.test(v))||group[1]||"Occhio";
            const power=(product.match(/\b\d+(?:[.,]\d+)?W\b/i)||[])[0]||"";
            const kelvin=(product.match(/\b\d{4}(?:-\d{4})?K\b/i)||[])[0]||"";
            armatureIndex.push({tag:`POS ${num}`,aliases:[`POSITION ${num}`,`POS ${num}`,`POS${num}`],page:pg.page,x:its[i].x,y:its[i].y,w:its[i].w,h:its[i].h,brand:"Occhio",type:product.replace(/^1\s*x\s+/i,"").trim(),lamp:[power,kelvin].filter(Boolean).join(" · "),montage:"",control:"Occhio air",raw:group.slice(0,12),occhio:true});
          }
        }
      } else if(isSchedule){
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
      if(isOcchio) displayName="Armaturförteckning – Occhio";
      else if(isSchedule) displayName="Armaturförteckning";
      else if(category!=="Övrigt") displayName=category+(plan?` – P${plan}`:"")+(part?` – Del ${part}`:"");
      else displayName=stripPdf(originalName);
      const detectedScales={};
      for(const pg of pages){const ds=extractDrawingScale(pg.items.map(x=>x.str).join(" "));if(ds)detectedScales[pg.page]=ds;}
      const drawingNumber=(allText.match(/\bE[-–]\d{3}[-–]\d[-–]\d{3,5}\b/i)||[])[0]||stripPdf(originalName).match(/E[-–]\d{3}[-–]\d[-–]\d{3,5}/i)?.[0]||"";
      const sourceDate=(allText.match(/\b20\d{2}[-./]\d{2}[-./]\d{2}\b/)||[])[0]||"";
      return {analysisVersion:ANALYSIS_VERSION,documentType:isOcchio?"occhioSchedule":(isSchedule?"armatureSchedule":"drawing"),category,plan,part,displayName,armatureIndex,pages:doc.numPages,detectedScales,drawingNumber,sourceDate};
    }catch(err){console.warn("PDF analysis failed",originalName,err);return null}
  }

  function applyAnalysis(f,a){
    if(!f||!a)return;
    f.analysisVersion=ANALYSIS_VERSION; f.documentType=a.documentType; f.category=a.category; f.plan=a.plan; f.part=a.part||""; f.armatureIndex=a.armatureIndex||[]; f.pageCount=a.pages||1; f.drawingNumber=a.drawingNumber||f.drawingNumber||""; f.sourceDate=a.sourceDate||f.sourceDate||"";
    f.scales=f.scales||{}; for(const [pg,sc] of Object.entries(a.detectedScales||{})){if(!f.scales[pg] || f.scales[pg]===100)f.scales[pg]=sc;}
    if(f.name===f.originalName || f.autoNamed){ f.name=a.displayName+".pdf"; f.autoNamed=true; }
  }

  async function analyzeProjectFilesMissing(projectId){
    if(state.analysisBusy)return;
    const p=projectById(projectId); if(!p)return;
    const ids=(p.files||[]).filter(id=>fileMeta(id)?.analysisVersion!==ANALYSIS_VERSION);
    if(!ids.length)return;
    state.analysisBusy=true;
    try{
      for(let i=0;i<ids.length;i++){
        const f=fileMeta(ids[i]), blob=await getBlob(ids[i]); if(!f||!blob)continue;
        if(state.currentProjectId===projectId) $("#projectStatus").textContent=`Analyserar ritningar… ${i+1}/${ids.length}`;
        applyAnalysis(f,await analyzePdfBlob(blob,f.originalName));
      }
      state.meta.version=ANALYSIS_VERSION; saveMeta();
      if(state.currentProjectId===projectId){$("#projectStatus").textContent="PDF-analys klar.";renderProject()}
      renderProjects(); renderAllDrawings();
    }finally{state.analysisBusy=false}
  }

  function findArmatureSchedules(projectId){
    const p=projectById(projectId);
    return (p?.files||[]).map(id=>fileMeta(id)).filter(f=>["armatureSchedule","occhioSchedule"].includes(f?.documentType) && (f.armatureIndex||[]).length);
  }
  function findArmatureSchedule(projectId){ return findArmatureSchedules(projectId)[0]||null; }
  function findScheduleForEntry(projectId,entry){ return findArmatureSchedules(projectId).find(s=>(s.armatureIndex||[]).some(e=>e===entry || (e.tag===entry.tag && e.page===entry.page))) || findArmatureSchedule(projectId); }

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

  function confirmDelete(title, text) {
    return new Promise(resolve=>{
      $("#modalTitle").textContent=title || "Vill du verkligen ta bort detta?";
      $("#modalText").textContent=text || "Detta går inte att ångra.";
      const input=$("#modalInput"); input.classList.add("hidden");
      const ok=$("#modalOk"), cancel=$("#modalCancel");
      ok.textContent="Ja, ta bort"; cancel.textContent="Nej";
      $("#modal").classList.remove("hidden");
      setTimeout(()=>cancel.focus(),30);
      const done=val=>{ $("#modal").classList.add("hidden"); input.classList.remove("hidden"); ok.textContent="Spara"; cancel.textContent="Avbryt"; ok.onclick=null; cancel.onclick=null; resolve(val); };
      ok.onclick=()=>done(true); cancel.onclick=()=>done(false);
    });
  }


  function choiceModal(title, text, options){
    return new Promise(resolve=>{
      const modal=$("#modal"), input=$("#modalInput"), ok=$("#modalOk"), cancel=$("#modalCancel"), actions=modal.querySelector('.modal-actions');
      $("#modalTitle").textContent=title; $("#modalText").textContent=text||""; input.classList.add('hidden'); ok.classList.add('hidden');
      const made=[];
      const done=val=>{made.forEach(b=>b.remove());modal.classList.add('hidden');input.classList.remove('hidden');ok.classList.remove('hidden');ok.textContent='Spara';cancel.textContent='Avbryt';cancel.onclick=null;resolve(val)};
      for(const opt of options){const b=document.createElement('button');b.type='button';b.className='btn'+(opt.primary?' primary':'');b.textContent=opt.label;b.onclick=()=>done(opt.value);actions.insertBefore(b,cancel);made.push(b)}
      cancel.textContent='Avbryt'; cancel.onclick=()=>done(null); modal.classList.remove('hidden'); setTimeout(()=>cancel.focus(),30);
    });
  }

  async function sha256Blob(blob){
    const buf=await blob.arrayBuffer();
    const dig=await crypto.subtle.digest('SHA-256',buf);
    return [...new Uint8Array(dig)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  async function ensureFileHash(f){
    if(f?.contentHash)return f.contentHash;
    if(!f)return ''; const blob=await getBlob(f.id); if(!blob)return '';
    try{f.contentHash=await sha256Blob(blob);saveMeta();return f.contentHash}catch{return ''}
  }

  function revisionKey(f){
    if(!f)return '';
    if(f.drawingNumber)return `NR|${String(f.drawingNumber).toUpperCase().replace(/\s+/g,'')}`;
    const orig=stripPdf(f.originalName||f.name).toUpperCase().replace(/(?:[-_. ]?REV(?:ISION)?[-_. ]*[A-Z0-9]+)$/i,'').trim();
    if(f.category&&f.plan&&f.part)return `${f.category}|P${f.plan}|D${f.part}`.toUpperCase();
    return `NAME|${orig}`;
  }

  function revisionEvidence(existing,incoming){
    const bits=[];
    if(incoming.drawingNumber||existing.drawingNumber)bits.push(`Ritningsnr: ${incoming.drawingNumber||existing.drawingNumber}`);
    if(incoming.plan)bits.push(`Plan ${incoming.plan}${incoming.part?`, Del ${incoming.part}`:''}`);
    if(incoming.sourceDate||existing.sourceDate)bits.push(`Datum: ${existing.sourceDate||'–'} → ${incoming.sourceDate||'–'}`);
    bits.push(`Befintlig: ${existing.originalName||existing.name}`); bits.push(`Ny: ${incoming.originalName||incoming.name}`);
    return bits.join(' · ');
  }

  function renderProjects() {
    const grid=$("#projectGrid");
    if(!state.meta.projects.length){
      grid.innerHTML='<div class="empty">Inga projekt ännu.<br><strong>Skapa ditt första projekt ovan.</strong></div>';
      return;
    }
    grid.innerHTML=state.meta.projects.map(p=>{
      const files=(p.files||[]).length;
      return `<div class="project-card-wrap"><button class="project-card" data-project="${p.id}">
        <div class="project-top"><div><p class="eyebrow">PROJEKT</p><h3>${esc(p.name)}</h3></div><span class="project-arrow">›</span></div>
        <div class="project-count">${files} ${files===1?"ritning":"ritningar"}</div>
      </button><button class="project-delete-btn" data-delete-project="${p.id}" aria-label="Ta bort ${esc(p.name)}">✕</button></div>`;
    }).join("");
    $$("[data-project]").forEach(b=>b.onclick=()=>openProject(b.dataset.project));
    $$("[data-delete-project]").forEach(b=>b.onclick=async e=>{e.stopPropagation();await deleteProjectById(b.dataset.deleteProject)});
  }

  async function deleteProjectById(id){
    const p=projectById(id); if(!p) return;
    const fileCount=(p.files||[]).length;
    const ok=await confirmDelete('Ta bort projekt?',`Vill du verkligen ta bort “${p.name}”? ${fileCount} ritning${fileCount===1?'':'ar'} samt projektets ÄTA, Att göra, markeringar och mätningar tas bort.`);
    if(!ok) return;
    const fileIds=[...(p.files||[])];
    for(const fid of fileIds){
      try{ await deleteBlob(fid); }catch(e){ console.warn('Kunde inte ta bort PDF-data',fid,e); }
      delete state.meta.fileMeta[fid];
      Object.keys(state.meta.measurements||{}).filter(k=>k.startsWith(fid+':')).forEach(k=>delete state.meta.measurements[k]);
      Object.keys(state.meta.annotations||{}).filter(k=>k.startsWith(fid+':')).forEach(k=>delete state.meta.annotations[k]);
    }
    state.meta.todos=(state.meta.todos||[]).filter(t=>t.projectId!==id);
    state.meta.atas=(state.meta.atas||[]).filter(a=>a.projectId!==id);
    if(state.meta.occhioLinks) delete state.meta.occhioLinks[id];
    state.meta.projects=(state.meta.projects||[]).filter(x=>x.id!==id);
    if(state.currentProjectId===id) state.currentProjectId=null;
    saveMeta(); renderProjects(); renderAllDrawings(); renderTodos(); renderAtas(); showView('projectsView'); toast('Projektet togs bort');
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
    const docs=(p.files||[]).map(id=>fileMeta(id)).filter(f=>["armatureSchedule","occhioSchedule"].includes(f?.documentType));
    const sd=$("#smartDocs"); if(sd){sd.innerHTML=docs.length ? (`<div class="smart-doc-title">Smarta dokument</div>` + docs.map(d=>`<button class="smart-doc" data-smart-open="${d.id}"><span>✓</span><div><strong>${esc(displayLabel(d))}</strong><small>${(d.armatureIndex||[]).length} poster indexerade · autosync aktiv</small></div><b>›</b></button>`).join("")) : ""; sd.querySelectorAll("[data-smart-open]").forEach(b=>b.onclick=()=>openPdf(b.dataset.smartOpen));}
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
    const tags=[f.category||"Övrigt",f.plan?`P${f.plan}`:"",f.part?`Del ${f.part}`:"",["armatureSchedule","occhioSchedule"].includes(f.documentType)?"Smart dokument":""].filter(Boolean);
    return `<div class="file-row" data-file-row="${f.id}">
      <div class="file-icon">${["armatureSchedule","occhioSchedule"].includes(f.documentType)?"LIST":"PDF"}</div>
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
    const ok=await confirmDelete('Ta bort ritning?',`Vill du verkligen ta bort “${f.name}”? Ritningens sparade mätningar och markeringar tas också bort.`);
    if(!ok) return;
    const p=projectById(f.projectId);
    p.files=(p.files||[]).filter(x=>x!==id);
    delete state.meta.fileMeta[id];
    Object.keys(state.meta.measurements||{}).filter(k=>k.startsWith(id+":")).forEach(k=>delete state.meta.measurements[k]);
    Object.keys(state.meta.annotations||{}).filter(k=>k.startsWith(id+":")).forEach(k=>delete state.meta.annotations[k]);
    saveMeta(); await deleteBlob(id); renderProject(); renderProjects(); renderAllDrawings(); toast("Ritningen togs bort");
  }

  async function removeImportedDrawing(id){
    const f=fileMeta(id); if(!f)return;
    const p=projectById(f.projectId); if(p)p.files=(p.files||[]).filter(x=>x!==id);
    delete state.meta.fileMeta[id];
    Object.keys(state.meta.measurements||{}).filter(k=>k.startsWith(id+":")).forEach(k=>delete state.meta.measurements[k]);
    Object.keys(state.meta.annotations||{}).filter(k=>k.startsWith(id+":")).forEach(k=>delete state.meta.annotations[k]);
    await deleteBlob(id); saveMeta();
  }

  async function inspectIncomingPdf(blob, originalName, path=""){
    const hash=await sha256Blob(blob);
    const analysis=await analyzePdfBlob(blob,originalName);
    const temp={name:originalName,originalName,path,size:blob.size,category:analysis?.category||'Övrigt',plan:analysis?.plan||'',part:analysis?.part||'',documentType:analysis?.documentType||'drawing',drawingNumber:analysis?.drawingNumber||'',sourceDate:analysis?.sourceDate||''};
    return {blob,originalName,path,hash,analysis,temp};
  }

  async function addInspectedPdf(item){
    const p=currentProject(); if(!p)return null;
    const id=uid(), base=item.originalName.split('/').pop();
    await putBlob(id,item.blob);
    const f={id,projectId:p.id,name:base,originalName:base,path:item.path||'',size:item.blob.size,addedAt:Date.now(),scales:{},category:'Övrigt',contentHash:item.hash};
    state.meta.fileMeta[id]=f; p.files=p.files||[]; p.files.push(id);
    applyAnalysis(f,item.analysis); saveMeta(); return f;
  }

  async function processImportItems(rawItems, sourceLabel='filer'){
    const p=currentProject(); if(!p)return;
    const existing=(p.files||[]).map(fileMeta).filter(Boolean);
    let imported=0, skipped=0, duplicateCount=0, revisionCount=0;
    let duplicateBatch=null, revisionBatch=null;
    const prepared=[];
    $("#projectStatus").textContent=`Analyserar ${rawItems.length} PDF-filer…`;
    for(let i=0;i<rawItems.length;i++){
      $("#projectStatus").textContent=`Analyserar PDF… ${i+1}/${rawItems.length}`;
      try{prepared.push(await inspectIncomingPdf(rawItems[i].blob,rawItems[i].name,rawItems[i].path||''))}catch(err){console.warn('Importanalys misslyckades',rawItems[i].name,err);prepared.push({blob:rawItems[i].blob,originalName:rawItems[i].name,path:rawItems[i].path||'',hash:'',analysis:null,temp:{name:rawItems[i].name,originalName:rawItems[i].name,category:'Övrigt'}})}
    }
    for(let i=0;i<prepared.length;i++){
      const item=prepared[i]; $("#projectStatus").textContent=`Importerar… ${i+1}/${prepared.length}`;
      let exact=null;
      if(item.hash){for(const f of [...existing]){if(await ensureFileHash(f)===item.hash){exact=f;break}}}
      if(exact){
        duplicateCount++;
        let action=duplicateBatch;
        if(!action){action=await choiceModal('Identisk ritning hittad',`${item.originalName} är exakt identisk med en ritning som redan finns. (${duplicateCount} dubblett${duplicateCount===1?'':'er'} hittills)`,[
          {label:'Behåll befintlig',value:'skip'},{label:'Ersätt denna',value:'replace',primary:true},{label:'Behåll båda',value:'both'},{label:'Behåll alla befintliga',value:'skipAll'},{label:'Ersätt alla identiska',value:'replaceAll'}
        ])}
        if(action==='skipAll'){duplicateBatch='skip';action='skip'} if(action==='replaceAll'){duplicateBatch='replace';action='replace'}
        if(action===null||action==='skip'){skipped++;continue}
        if(action==='replace'){await removeImportedDrawing(exact.id);existing.splice(existing.indexOf(exact),1)}
      }else{
        const key=revisionKey(item.temp);
        const possible=existing.find(f=>revisionKey(f)===key && (!item.hash || f.contentHash!==item.hash));
        if(possible && key){
          revisionCount++;
          let action=revisionBatch;
          if(!action){action=await choiceModal('Möjlig revidering',`${revisionEvidence(possible,item.temp)}. Innehållet skiljer sig från befintlig ritning.`,[
            {label:'Ny revision',value:'revision',primary:true},{label:'Ersätt denna',value:'replace'},{label:'Behåll båda',value:'both'},{label:'Alla som nya revisioner',value:'revisionAll'},{label:'Ersätt alla möjliga',value:'replaceAll'}
          ])}
          if(action==='revisionAll'){revisionBatch='revision';action='revision'} if(action==='replaceAll'){revisionBatch='replace';action='replace'}
          if(action===null){skipped++;continue}
          if(action==='replace'){possible.revisionStatus='Tidigare revision';possible.replacedAt=Date.now();item.temp.replacesId=possible.id}
          if(action==='revision'){item.temp.replacesId=possible.id}
        }
      }
      const added=await addInspectedPdf(item); if(added){if(item.temp.replacesId)added.replacesId=item.temp.replacesId; existing.push(added); imported++}
    }
    saveMeta(); renderProject();renderProjects();renderAllDrawings();
    $("#projectStatus").textContent=`Import klar: ${imported} importerade · ${duplicateCount} identiska · ${revisionCount} möjliga revisioner${skipped?` · ${skipped} hoppades över`:''}.`;
    toast(`${imported} PDF importerade från ${sourceLabel}`);
  }

  async function importPdfs(fileList){
    const files=[...fileList].filter(f=>f.name.toLowerCase().endsWith('.pdf'));
    await processImportItems(files.map(f=>({blob:f,name:f.name,path:''})),`${files.length} PDF`);
  }

  async function importZips(fileList){
    if(!window.JSZip){toast('ZIP-modulen kunde inte laddas');return}
    const zips=[...fileList].filter(f=>f.name.toLowerCase().endsWith('.zip')); const raw=[]; let zipDone=0;
    try{
      for(const file of zips){
        $("#projectStatus").textContent=`Packar upp ${file.name}… (${zipDone+1}/${zips.length})`;
        const zip=await JSZip.loadAsync(file); const entries=Object.values(zip.files).filter(e=>!e.dir&&e.name.toLowerCase().endsWith('.pdf'));
        for(const e of entries){const blob=await e.async('blob');const parts=e.name.split('/');const name=parts.pop();raw.push({blob,name,path:parts.join('/'),zipName:file.name})}
        zipDone++;
      }
      if(!raw.length){$("#projectStatus").textContent='ZIP-filerna innehöll inga PDF-filer.';return}
      await processImportItems(raw,`${zips.length} ZIP`);
    }catch(err){console.error(err);$("#projectStatus").textContent='Kunde inte packa upp en eller flera ZIP-filer.'}
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
    const list=$("#todoList"); const today=new Date().toISOString().slice(0,10);
    let items=[...state.meta.todos];
    if(state.todoFilter==="open")items=items.filter(t=>!t.done);
    if(state.todoFilter==="today")items=items.filter(t=>!t.done && t.due===today);
    if(!items.length){list.innerHTML='<div class="empty">Inga punkter här.</div>';return}
    list.innerHTML=items.map(t=>{const p=projectById(t.projectId);return `<div class="todo-row ${t.done?"done":""}" data-todo="${t.id}"><input type="checkbox" ${t.done?"checked":""}><div class="todo-text"><strong>${esc(t.text)}</strong><div class="todo-meta"><span class="prio ${esc((t.priority||"Normal").toLowerCase())}">${esc(t.priority||"Normal")}</span>${t.due?`<span>📅 ${esc(t.due)}</span>`:""}${p?`<span>▦ ${esc(p.name)}</span>`:""}</div></div><button class="row-btn">×</button></div>`}).join("");
    list.querySelectorAll("[data-todo]").forEach(row=>{const id=row.dataset.todo,t=state.meta.todos.find(x=>x.id===id);row.querySelector("input").onchange=e=>{t.done=e.target.checked;saveMeta();renderTodos()};row.querySelector("button").onclick=async()=>{if(!await confirmDelete("Ta bort uppgift?",`Vill du verkligen ta bort “${t.text}”?`))return;state.meta.todos=state.meta.todos.filter(x=>x.id!==id);saveMeta();renderTodos()}});
  }

  function getAnnotations(){ const k=pageKey(); state.meta.annotations=state.meta.annotations||{}; return state.meta.annotations[k]||(state.meta.annotations[k]=[]); }
  function ataNumber(){ const nums=(state.meta.atas||[]).map(a=>Number(String(a.number||'').replace(/\D/g,''))||0); return `ÄTA-${String(Math.max(0,...nums)+1).padStart(3,'0')}`; }
  function ataHours(a){ return (a.sessions||[]).reduce((n,x)=>n+(Number(x.hours)||0),0); }
  function renderAtas(){
    const all=state.meta.atas||[], list=$('#ataList'); let items=[...all];
    if(state.ataFilter==='open')items=items.filter(a=>a.status!=='Utförd'); if(state.ataFilter==='ongoing')items=items.filter(a=>a.status==='Pågående'); if(state.ataFilter==='done')items=items.filter(a=>a.status==='Utförd');
    const total=all.reduce((n,a)=>n+ataHours(a),0), done=all.filter(a=>a.status==='Utförd').length, open=all.length-done;
    $('#ataSummary').innerHTML=`<div><small>Öppna</small><b>${open}</b></div><div><small>Utförda</small><b>${done}</b></div><div><small>Extra timmar</small><b>${total.toFixed(1)} h</b></div>`;
    $('#ataSelectedCount').textContent=state.ataSelected.size;
    if(!items.length){list.innerHTML='<div class="empty">Inga avvikelser här.</div>';return}
    list.innerHTML=items.map(a=>{const p=projectById(a.projectId);return `<div class="ata-card ${a.status==='Utförd'?'done':''}" data-ata="${a.id}"><div class="ata-top"><input class="ata-select" type="checkbox" ${state.ataSelected.has(a.id)?'checked':''}><div class="ata-main"><div class="ata-num">${esc(a.number)}</div><strong>${esc(a.title)}</strong><div class="ata-meta"><span class="ata-status ${a.status==='Utförd'?'done':''}">${esc(a.status)}</span><span>📅 ${esc(a.date||'')}</span><span>⏱ ${ataHours(a).toFixed(1)} h${a.estimate?` / est. ${Number(a.estimate).toFixed(1)} h`:''}</span>${p?`<span>▦ ${esc(p.name)}</span>`:''}</div>${a.description?`<p class="muted" style="margin-top:7px">${esc(a.description)}</p>`:''}${a.drawingNote?`<p class="muted" style="margin-top:5px">📍 ${esc(a.drawingNote)}</p>`:''}<div class="ata-photos">${(a.photos||[]).map(x=>`<img src="${x}" alt="ÄTA-bild">`).join('')}</div></div></div><div class="ata-card-actions"><button class="mini-btn ata-status-btn">${a.status==='Utförd'?'↺ Öppna':'✓ Utförd'}</button><button class="mini-btn ata-hours-btn">+ Timmar</button><button class="mini-btn ata-photo-btn">+ Bild</button><button class="mini-btn ata-mark-btn">⌖ Markera på ritning</button><button class="mini-btn ata-delete-btn">✕</button></div></div>`}).join('');
    list.querySelectorAll('[data-ata]').forEach(row=>{const a=all.find(x=>x.id===row.dataset.ata); row.querySelector('.ata-select').onchange=e=>{e.target.checked?state.ataSelected.add(a.id):state.ataSelected.delete(a.id);renderAtas()}; row.querySelector('.ata-status-btn').onclick=()=>{a.status=a.status==='Utförd'?'Pågående':'Utförd';if(a.status==='Utförd')a.completed=new Date().toISOString().slice(0,10);saveMeta();renderAtas()}; row.querySelector('.ata-hours-btn').onclick=async()=>{const h=Number(String(await promptModal('Lägg till timmar','Arbetade timmar för detta pass.','1.0','number')||'').replace(',','.'));if(h>0){a.sessions=a.sessions||[];a.sessions.push({date:new Date().toISOString().slice(0,10),hours:h});a.status='Pågående';saveMeta();renderAtas()}}; row.querySelector('.ata-photo-btn').onclick=()=>{state.ataPhotoTarget=a.id;$('#ataPhotoInput').click()}; row.querySelector('.ata-mark-btn').onclick=async()=>{state.currentProjectId=a.projectId||state.currentProjectId; const p=projectById(state.currentProjectId); const id=a.drawing?.fileId || p?.files?.[0]; if(!id){toast('Lägg först in en ritning i projektet');return} await openPdf(id); state.activeAtaMark=a.id; setTool('circle'); toast('Ringa in avvikelsen på ritningen')}; row.querySelector('.ata-delete-btn').onclick=async()=>{if(!await confirmDelete('Ta bort ÄTA?',`Vill du verkligen ta bort ${a.number} – ${a.title}?`))return;state.meta.atas=all.filter(x=>x.id!==a.id);state.ataSelected.delete(a.id);saveMeta();renderAtas()};});
  }
  async function createAta(){ const title=await promptModal('Ny ÄTA / Avvikelse','Beskriv extraarbetet kort.','');if(!title)return; const desc=await promptModal('Beskrivning','Orsak / vad som ska göras.',''); const est=Number(String(await promptModal('Beräknade timmar','Kan lämnas 0 om okänt.','0','number')||0).replace(',','.'))||0; const projectId=state.currentProjectId||state.meta.projects[0]?.id||null; state.meta.atas.unshift({id:uid(),number:ataNumber(),title,description:desc||'',date:new Date().toISOString().slice(0,10),status:'Ej påbörjad',estimate:est,sessions:[],photos:[],projectId});saveMeta();renderAtas(); }
  async function shareSelectedAtas(){ const items=(state.meta.atas||[]).filter(a=>state.ataSelected.has(a.id));if(!items.length){toast('Välj minst en ÄTA');return} if(!window.jspdf?.jsPDF){toast('PDF-modulen saknas');return} const {jsPDF}=window.jspdf, doc=new jsPDF();let y=18;doc.setFontSize(18);doc.text('EKIS FIELD – ÄTA / Avvikelser',14,y);y+=10;doc.setFontSize(10); for(const a of items){if(y>270){doc.addPage();y=18}doc.setFont(undefined,'bold');doc.text(`${a.number} – ${a.title}`,14,y);y+=6;doc.setFont(undefined,'normal');doc.text(`Status: ${a.status}   Datum: ${a.date}   Timmar: ${ataHours(a).toFixed(1)} h`,14,y);y+=5;if(a.description){const lines=doc.splitTextToSize(a.description,180);doc.text(lines,14,y);y+=lines.length*5}if(a.drawingNote){doc.text(`Ritning: ${a.drawingNote}`,14,y);y+=5}y+=5} const data=doc.output('datauristring'); const name=`EKIS_FIELD_ATA_${new Date().toISOString().slice(0,10)}.pdf`; if(window.Android?.shareBase64)Android.shareBase64(name,data,'application/pdf'); else downloadBlob(doc.output('blob'),name); }

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
      if(state.pendingArmatureTarget && ["armatureSchedule","occhioSchedule"].includes(f.documentType)){
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
    state.tool=tool; state.tempPoints=[]; state.distanceDraft=null;
    $$(".tool[data-tool]").forEach(b=>b.classList.toggle("active",b.dataset.tool===tool));
    $("#finishMeasureBtn").classList.toggle("hidden",!(tool==="route"||tool==="area"));
    $("#overlayCanvas").style.pointerEvents=tool==="pan"?"none":"auto";
    updateHint(); drawOverlay();
  }
  function updateHint(){
    const text={
      pan:"Nyp för zoom • tryck eller dubbeltryck nära en armaturbeteckning för info.",
      distance:"Tryck punkt A. Tryck sedan punkt B, dra till exakt läge och släpp. Måttet blir en rak linje.",
      route:"Tryck ut en kabelväg/sträcka. Tryck Slutför när du är klar.",
      area:"Markera hörnen runt en yta. Tryck Slutför när du är klar. Kalibrera gärna via en känd rumsarea först.",
      pen:"Rita direkt på ritningen. Markeringen sparas automatiskt.",text:"Tryck där texten ska ligga.",arrow:"Dra från start till pilspets.",circle:"Dra runt området som ska markeras."
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
    getMeasurements().forEach(m=>{
      if(m.type==="distance" && m.points?.length===2){
        const a=toPx(m.points[0]),b=toPx(m.points[1]);
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
        [a,b].forEach((q,i)=>{ctx.beginPath();ctx.arc(q.x,q.y,6,0,Math.PI*2);ctx.fill();ctx.fillStyle="rgba(11,11,12,.9)";ctx.fillRect(q.x+8,q.y-12,20,20);ctx.fillStyle="#ff6a00";ctx.fillText(i?"B":"A",q.x+13,q.y+3);ctx.fillStyle="#ff6a00";});
        const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;ctx.fillStyle="rgba(11,11,12,.9)";ctx.fillRect(mx+7,my-21,Math.max(74,m.label.length*7),23);ctx.fillStyle="#ff6a00";ctx.fillText(m.label,mx+12,my-6);
      } else drawPath(m.points,m.type==="area",m.label);
    });
    if(state.distanceDraft){
      const a=toPx(state.distanceDraft.a),b=toPx(state.distanceDraft.b);ctx.save();ctx.setLineDash([7,5]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);[a,b].forEach((q,i)=>{ctx.beginPath();ctx.arc(q.x,q.y,6,0,Math.PI*2);ctx.fill();ctx.fillStyle="rgba(11,11,12,.9)";ctx.fillRect(q.x+8,q.y-12,20,20);ctx.fillStyle="#ff6a00";ctx.fillText(i?"B":"A",q.x+13,q.y+3);ctx.fillStyle="#ff6a00";});ctx.restore();
    }
    const f=fileMeta(state.currentFileId);
    const refs=f?.syncRefs?.[state.pageNum] || [];
    const live=state.syncCapture?.fileId===state.currentFileId ? state.syncCapture.points : [];
    [...refs, ...live].forEach((p,i)=>{const q=toPx(p);ctx.beginPath();ctx.arc(q.x,q.y,7,0,Math.PI*2);ctx.stroke();ctx.fillStyle="rgba(11,11,12,.9)";ctx.fillRect(q.x+9,q.y-13,24,22);ctx.fillStyle="#ff6a00";ctx.fillText(i%2===0?"A":"B",q.x+15,q.y+3)});
    const hi=state.armatureHighlight;
    if(hi && hi.fileId===state.currentFileId && hi.page===state.pageNum){const e=hi.entry,q=toPx({x:e.x,y:e.y});const w=Math.max(42,(e.w||25)*state.renderScale),h=Math.max(26,(e.h||12)*state.renderScale);ctx.save();ctx.strokeStyle="#ff6a00";ctx.lineWidth=4;ctx.strokeRect(q.x-10,q.y-10,w+20,h+20);ctx.restore();}
    for(const a of getAnnotations()){
      ctx.save();ctx.strokeStyle=a.selected?'#ff4d4f':'#ff6a00';ctx.fillStyle='#ff6a00';ctx.lineWidth=a.selected?4:3;
      if(a.type==='pen'){ctx.beginPath();a.points.forEach((p,i)=>{const q=toPx(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke()}
      if(a.type==='arrow'){const p=toPx(a.points[0]),q=toPx(a.points[1]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();const an=Math.atan2(q.y-p.y,q.x-p.x);ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-16*Math.cos(an-.5),q.y-16*Math.sin(an-.5));ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-16*Math.cos(an+.5),q.y-16*Math.sin(an+.5));ctx.stroke()}
      if(a.type==='circle'){const p=toPx(a.points[0]),q=toPx(a.points[1]);ctx.beginPath();ctx.ellipse((p.x+q.x)/2,(p.y+q.y)/2,Math.abs(q.x-p.x)/2,Math.abs(q.y-p.y)/2,0,0,Math.PI*2);ctx.stroke()}
      if(a.type==='text'){const p=toPx(a.points[0]);ctx.font='bold 16px sans-serif';ctx.fillText(a.text,p.x,p.y)}ctx.restore();
    }
    if(state.tempPoints.length) drawPath(state.tempPoints,false,"");
  }

  function pointInPolygon(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];const cross=((a.y>p.y)!=(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/((b.y-a.y)||1e-9)+a.x);if(cross)inside=!inside;}return inside;}
  function areaLabelsInside(points){
    const vals=[]; for(const it of state.pageTextItems||[]){const m=String(it.str||"").match(/(\d+(?:[,.]\d+)?)\s*m(?:²|2)\b/i);if(!m)continue;const p={x:it.x+(it.w||0)/2,y:it.y+(it.h||0)/2};if(pointInPolygon(p,points))vals.push(Number(m[1].replace(",",".")));}return vals.filter(Number.isFinite);
  }
  async function applyAreaCalibration(points){
    const raw=polygonAreaPt2(points)*(1/72*0.0254)**2;if(!(raw>0))return false;
    const labels=areaLabelsInside(points);let known=labels.length===1?labels[0]:null;
    if(!known){const hint=labels.length?`Hittade ${labels.map(v=>v.toFixed(1)).join(" / ")} m². Ange rätt area.`:"Ange arean som står utskriven i rummet, t.ex. 5.4 m².";const v=await promptModal("Kalibrera via rumsarea",hint,labels[0]?String(labels[0]):"","number");known=Number(String(v||"").replace(",","."));}
    if(!(known>0))return false;const denom=Math.sqrt(known/raw);setScale(denom);toast(`Kalibrerad via ${known.toFixed(2)} m² → ca 1:${denom.toFixed(1)}`);return true;
  }

  async function finishTemp(){
    const pts=[...state.tempPoints]; if(!pts.length)return;
    if(state.calibrationMode==="area"){
      if(pts.length<3){toast("Markera minst tre hörn");return;}
      await applyAreaCalibration(pts);state.calibrationMode=null;state.tempPoints=[];setTool("pan");drawOverlay();return;
    }
    if(state.tool==="route"&&pts.length>=2){const m=ptToM(routeLength(pts));getMeasurements().push({id:uid(),type:"route",points:pts,label:formatLength(m)});$("#measureResult").textContent=formatLength(m);}
    else if(state.tool==="area"&&pts.length>=3){const m2=pt2ToM2(polygonAreaPt2(pts));getMeasurements().push({id:uid(),type:"area",points:pts,label:`${m2.toFixed(2)} m²`});$("#measureResult").textContent=`${m2.toFixed(2)} m²`;}
    state.tempPoints=[]; saveMeta(); drawOverlay();
  }

  function nearestOverlayObject(e){const p=pdfPointFromEvent(e),tol=18/(state.renderScale*state.viewZoom);let best=null,d=1e9;for(const m of getMeasurements()){for(const q of m.points||[]){const z=distancePt(p,q);if(z<d&&z<tol){best={kind:'measure',obj:m};d=z}}}for(const a of getAnnotations()){for(const q of a.points||[]){const z=distancePt(p,q);if(z<d&&z<tol){best={kind:'annotation',obj:a};d=z}}}return best}
  $('#overlayCanvas').addEventListener('pointerdown',e=>{if(!['pen','arrow','circle'].includes(state.tool))return;const p=pdfPointFromEvent(e);state.drawDraft={type:state.tool,points:[p],pointerId:e.pointerId};try{e.target.setPointerCapture(e.pointerId)}catch{}e.preventDefault()});
  $('#overlayCanvas').addEventListener('pointermove',e=>{const d=state.drawDraft;if(!d||d.pointerId!==e.pointerId)return;const p=pdfPointFromEvent(e);if(d.type==='pen')d.points.push(p);else d.points[1]=p;state.tempPoints=d.points;drawOverlay()});
  $('#overlayCanvas').addEventListener('pointerup',e=>{const d=state.drawDraft;if(!d||d.pointerId!==e.pointerId)return;const p=pdfPointFromEvent(e);if(d.type!=='pen')d.points[1]=p;if(d.points.length>1){const a={id:uid(),type:d.type,points:d.points};getAnnotations().push(a);if(state.activeAtaMark){const ata=(state.meta.atas||[]).find(x=>x.id===state.activeAtaMark);if(ata){ata.drawing={fileId:state.currentFileId,page:state.pageNum,view:captureViewState(),annotationId:a.id};ata.drawingNote=`${displayLabel(fileMeta(state.currentFileId))}, sida ${state.pageNum}`;}state.activeAtaMark=null}saveMeta()}state.drawDraft=null;state.tempPoints=[];setTool('pan');drawOverlay()});
  $('#overlayCanvas').addEventListener('click',async e=>{if(state.tool==='text'){const text=await promptModal('Text på ritning','Skriv texten som ska sparas på ritningen.','');if(text){getAnnotations().push({id:uid(),type:'text',points:[pdfPointFromEvent(e)],text});saveMeta();setTool('pan');drawOverlay()}return}});

  // Distance: first tap fixes A. Second press starts B; drag and release commits a straight A–B distance.
  $("#overlayCanvas").addEventListener("pointerdown",e=>{
    if(state.tool!=="distance")return;
    const p=pdfPointFromEvent(e);
    // Existing endpoint editing has priority.
    let best=null,d=Infinity;for(const m of getMeasurements())for(const h of screenMeasureHandles(m)){const q=Math.hypot(e.clientX-h.cx,e.clientY-h.cy);if(q<30&&q<d){best={m,h};d=q}}
    if(best){state.editMeasure=best;e.preventDefault();try{e.target.setPointerCapture(e.pointerId)}catch{}return;}
    if(!state.tempPoints.length){state.tempPoints=[p];state.distanceDraft=null;drawOverlay();e.preventDefault();return;}
    state.distanceDraft={a:state.tempPoints[0],b:p,pointerId:e.pointerId};e.preventDefault();try{e.target.setPointerCapture(e.pointerId)}catch{}drawOverlay();
  });
  $("#overlayCanvas").addEventListener("pointermove",e=>{
    if(state.editMeasure){const p=pdfPointFromEvent(e),m=state.editMeasure.m;if(state.editMeasure.h.kind==="a")m.points[0]=p;else m.points[1]=p;m.label=formatLength(ptToM(distancePt(m.points[0],m.points[1])));$("#measureResult").textContent=m.label;drawOverlay();return;}
    if(state.distanceDraft && (state.distanceDraft.pointerId==null||state.distanceDraft.pointerId===e.pointerId)){state.distanceDraft.b=pdfPointFromEvent(e);const m=ptToM(distancePt(state.distanceDraft.a,state.distanceDraft.b));$("#measureResult").textContent=formatLength(m);drawOverlay();}
  });
  $("#overlayCanvas").addEventListener("pointerup",e=>{
    if(state.editMeasure){saveMeta();state.editMeasure=null;drawOverlay();return;}
    if(state.tool==="distance"&&state.distanceDraft){
      const d=state.distanceDraft;d.b=pdfPointFromEvent(e);const rawPt=distancePt(d.a,d.b);const m=ptToM(rawPt);
      if(rawPt>1){
        if(state.calibrationMode==="distance"){
          const rawM=rawPt/72*0.0254;
          promptModal("Känt avstånd","Ange verkligt A–B-avstånd i meter.","3.00","number").then(v=>{
            const known=Number(String(v||"").replace(",","."));if(known>0){const denom=known/rawM;setScale(denom);toast(`Kalibrerad → ca 1:${denom.toFixed(1)}`);}state.calibrationMode=null;setTool("pan");
          });
        }else{getMeasurements().push({id:uid(),type:"distance",points:[d.a,d.b],label:formatLength(m)});$("#measureResult").textContent=formatLength(m);saveMeta();}
      }
      state.tempPoints=[];state.distanceDraft=null;drawOverlay();
    }
  });
  $("#overlayCanvas").addEventListener("pointercancel",()=>{if(state.editMeasure){state.editMeasure=null;}if(state.distanceDraft){state.distanceDraft=null;}drawOverlay();});
  $("#overlayCanvas").addEventListener("click",e=>{if(Date.now()<state.suppressClickUntil||state.tool==="pan"||state.tool==="distance")return;state.tempPoints.push(pdfPointFromEvent(e));drawOverlay();});

  function screenMeasureHandles(m){
    if(!m||m.type!=="distance"||m.points?.length!==2)return [];const sc=state.renderScale*state.viewZoom,r=$("#overlayCanvas").getBoundingClientRect();return [{kind:"a",p:m.points[0]},{kind:"b",p:m.points[1]}].map(h=>({...h,cx:r.left+h.p.x*sc,cy:r.top+h.p.y*sc}));
  }

  async function loadSmartHotspots(page,viewport){
    state.smartHotspots=[]; state.pageTextItems=[];
    const f=fileMeta(state.currentFileId); if(!f)return;
    const schedules=findArmatureSchedules(f.projectId);
    try{
      const tc=await page.getTextContent();
      for(const item of tc.items){
        const tx=pdfjsLib.Util.transform(viewport.transform,item.transform),h=Math.max(6,Math.hypot(tx[2],tx[3])),w=Math.max(8,(item.width||String(item.str||"").length*5)*state.renderScale);
        state.pageTextItems.push({str:String(item.str||""),x:tx[4]/state.renderScale,y:(tx[5]-h)/state.renderScale,w:w/state.renderScale,h:h/state.renderScale});
      }
      if(f.documentType!=="drawing"||!schedules.length)return;
      const index=new Map();
      for(const sch of schedules)for(const e0 of (sch.armatureIndex||[])){const e=enrichEntryWithOcchio(f.projectId,e0);index.set(cleanTag(e.tag),e);for(const a of(e.aliases||[]))index.set(cleanTag(a),e);}
      for(const it of state.pageTextItems){
        const tags=findTagOccurrences(it.str);let added=false;
        for(const tag of tags){const entry=index.get(cleanTag(tag));if(!entry)continue;state.smartHotspots.push({tag:entry.tag,entry,x:it.x,y:it.y,w:Math.max(it.w,18),h:Math.max(it.h,10)});added=true;}
        if(added)continue;
        const txt=normalizeProductText(it.str);if(txt.length<5)continue;
        let best=null,bestScore=0;
        for(const sch of schedules)for(const e0 of(sch.armatureIndex||[])){const e=enrichEntryWithOcchio(f.projectId,e0);const cand=normalizeProductText([e.type,e.brand,e.occhioMatch?.type].filter(Boolean).join(" "));if(!cand)continue;const a=new Set(txt.split(" ").filter(x=>x.length>=3)),b=new Set(cand.split(" ").filter(x=>x.length>=3));let c=0;for(const x of a)if(b.has(x))c++;const score=c/Math.max(2,Math.min(a.size,b.size));if(score>bestScore){bestScore=score;best=e;}}
        if(best&&bestScore>=.6)state.smartHotspots.push({tag:best.tag,entry:best,x:it.x,y:it.y,w:Math.max(it.w,24),h:Math.max(it.h,10)});
      }
    }catch(err){console.warn("Hotspot scan failed",err)}
  }

  function nearestSmartHotspot(clientX,clientY){
    if(!state.smartHotspots.length)return null;
    // Work in screen pixels. This lets the electrician double-tap the actual
    // fixture symbol, not only the tiny L13 text. We select the nearest known
    // armature tag within a generous but bounded radius.
    const r=$("#overlayCanvas").getBoundingClientRect();
    const scale=state.renderScale*state.viewZoom;
    let best=null,bestD=Infinity;
    for(const h of state.smartHotspots){
      const left=r.left+h.x*scale, top=r.top+h.y*scale;
      const right=left+h.w*scale, bottom=top+h.h*scale;
      const nx=Math.max(left,Math.min(clientX,right));
      const ny=Math.max(top,Math.min(clientY,bottom));
      const d=Math.hypot(clientX-nx,clientY-ny);
      if(d<bestD){best=h;bestD=d}
    }
    // 150 px at normal use is enough to hit the symbol next to its designation,
    // while avoiding jumps to a tag on the other side of the drawing.
    return bestD<=220 ? best : null;
  }

  function showArmatureCard(entry){
    state.selectedArmatureEntry=entry; state.activeArmatureEntry=entry;
    $("#armatureTitle").textContent=entry.tag;
    const o=entry.occhioMatch;
    const rows=[["Fabrikat",entry.brand],["Typ",entry.type],["Bestyckning",entry.lamp],["Montage",entry.montage],["Styrning",entry.control],...(o?[["Occhio position",o.tag],["Occhio produkt",o.type],["Occhio data",o.lamp],["Matchning",`${Math.round((entry.occhioConfidence||0)*100)}%`]]:[]),["Förteckning",`Sida ${entry.page}`]].filter(x=>x[1]);
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

  $("#pdfViewport").addEventListener("click",async e=>{
    if(state.tool!=="pan"||state.syncCapture||Date.now()<state.suppressClickUntil)return;
    const hit=nearestOverlayObject(e);
    state.selectedOverlay=hit;
    for(const a of getAnnotations())a.selected=hit?.kind==='annotation'&&hit.obj.id===a.id;
    $("#deleteSelectedBtn").classList.toggle("hidden",!hit);
    if(hit){drawOverlay();state.suppressClickUntil=Date.now()+250;return;}
    drawOverlay();
    if(await handleSmartDoubleTap(e.clientX,e.clientY)){state.suppressClickUntil=Date.now()+350;}
  });

  async function openSelectedArmatureInPdf(){
    const entry=state.selectedArmatureEntry; if(!entry)return;
    const source=fileMeta(state.currentFileId); if(!source)return;
    const targetEntry=entry.occhioMatch||entry;
    const schedule=findScheduleForEntry(source.projectId,targetEntry); if(!schedule){toast("Ingen armaturförteckning hittades i projektet");return}
    closeArmatureCard();
    state.armatureReturn={fileId:state.currentFileId,page:state.pageNum,viewState:captureViewState()};
    state.pendingArmatureTarget=targetEntry;
    await openPdf(schedule.id,{page:targetEntry.page});
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
    const show=!!state.armatureReturn && ["armatureSchedule","occhioSchedule"].includes(f?.documentType);
    $("#backToDrawingBtn").classList.toggle("hidden",!show);
  }

  async function returnToArmatureSource(){
    const r=state.armatureReturn;if(!r)return;
    state.armatureReturn=null; state.armatureHighlight=null;
    await openPdf(r.fileId,{page:r.page,viewState:r.viewState});
  }

  async function calibrate(){
    const mode=await promptModal("Kalibrera mätning","Skriv AREA för att kalibrera mot en rumsarea som står på ritningen, eller AVSTÅND för ett känt mått.","AREA");
    if(!mode)return;
    if(String(mode).trim().toUpperCase().startsWith("A") && !String(mode).trim().toUpperCase().startsWith("AVS")){
      state.calibrationMode="area";setTool("area");state.calibrationMode="area";state.tempPoints=[];$("#measureHint").textContent="AREA-KALIBRERING: markera rummets hörn runt en utskriven area (t.ex. 5,4 m²) och tryck Slutför. Appen försöker läsa arean automatiskt.";return;
    }
    setTool("distance");state.calibrationMode="distance";state.tempPoints=[];$("#measureHint").textContent="AVSTÅNDSKALIBRERING: tryck A, tryck B och dra till exakt läge. När du släpper anger du det verkliga avståndet.";
  }


  function clamp(v,min,max){return Math.max(min,Math.min(max,v))}

  function viewportInnerSize(){
    const viewport=$("#pdfViewport");
    const cs=getComputedStyle(viewport);
    const px=v=>Number.parseFloat(v)||0;
    // clientWidth/clientHeight include padding. Subtract it so “Passa” really
    // fits the complete PDF sheet inside the visible drawing area.
    const width=Math.max(1,viewport.clientWidth-px(cs.paddingLeft)-px(cs.paddingRight));
    const height=Math.max(1,viewport.clientHeight-px(cs.paddingTop)-px(cs.paddingBottom));
    return {width,height};
  }

  function computeFitZoom(){
    const viewport=$("#pdfViewport");
    if(!state.baseCanvasWidth || !state.baseCanvasHeight || !viewport.clientWidth || !viewport.clientHeight) return 1;
    const inner=viewportInnerSize();
    // Leave a tiny safety gutter for rounding/scrollbar differences in Android WebView.
    const safety=4;
    return Math.min(
      Math.max(.08,(inner.width-safety)/state.baseCanvasWidth),
      Math.max(.08,(inner.height-safety)/state.baseCanvasHeight),
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
      zoomRatio:state.fitZoom?state.viewZoom/state.fitZoom:1,
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
    const relative=Number.isFinite(v.zoomRatio) ? v.zoomRatio : (v.fitZoom? v.zoom/v.fitZoom : 1);
    if(mapped){
      targetCenter={x:mapped.x,y:mapped.y};
      // Locked view means the same visual zoom level on the next floor.
      targetZoom=clamp(state.fitZoom*relative,state.fitZoom,Math.max(6,state.fitZoom*10));
      $("#measureHint").textContent="Synkad vy: samma plats och zoom mellan våningsplan.";
    }else{
      const pdfW=state.baseCanvasWidth/state.renderScale;
      const pdfH=state.baseCanvasHeight/state.renderScale;
      targetCenter={x:(v.normX??.5)*pdfW,y:(v.normY??.5)*pdfH};
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

  async function openAdjacentFloor(dir){const f=fileMeta(state.currentFileId);if(!f)return;const p=projectById(f.projectId);const candidates=(p?.files||[]).map(fileMeta).filter(x=>x&&x.category===f.category&&String(x.part||'')===String(f.part||'')&&x.plan);const cur=Number(f.plan), target=candidates.filter(x=>dir>0?Number(x.plan)>cur:Number(x.plan)<cur).sort((a,b)=>dir>0?Number(a.plan)-Number(b.plan):Number(b.plan)-Number(a.plan))[0];if(!target){toast(dir>0?'Ingen våning ovanför':'Ingen våning under');return}await switchDrawingKeepView(target.id)}

  function adjacentFloorTarget(dir){
    const f=fileMeta(state.currentFileId);if(!f)return null;
    const p=projectById(f.projectId);
    const candidates=(p?.files||[]).map(fileMeta).filter(x=>x&&x.category===f.category&&String(x.part||'')===String(f.part||'')&&x.plan);
    const cur=Number(f.plan);
    return candidates.filter(x=>dir>0?Number(x.plan)>cur:Number(x.plan)<cur).sort((a,b)=>dir>0?Number(a.plan)-Number(b.plan):Number(b.plan)-Number(a.plan))[0]||null;
  }
  function syncRiserControls(){
    const nav=$("#riserNav"); if(!nav)return;
    nav.classList.toggle("hidden",!state.riserMode);
    $("#riserUpBtn").disabled=!state.riserMode||!adjacentFloorTarget(1);
    $("#riserDownBtn").disabled=!state.riserMode||!adjacentFloorTarget(-1);
  }
  function setRiserMode(on){
    state.riserMode=!!on;
    if(state.riserMode && !state.lockViewAcrossDrawings){
      state.lockViewAcrossDrawings=true;
      $("#lockViewBtn").classList.add("active");
      $("#lockViewBtn").textContent="🔒 Vy";
    }
    $("#riserBtn").classList.toggle("active",state.riserMode);
    $("#riserBtn").textContent=state.riserMode?'🔒 STIGARE':'⇅ Stigare';
    syncRiserControls();
    toast(state.riserMode?'Stigare aktiv – plats och zoom låses':'Stigare av');
  }

  function updateDrawingNav(){
    const ids=orderedProjectFiles(), i=ids.indexOf(state.currentFileId);
    $("#prevDrawingBtn").disabled=i<=0;
    $("#nextDrawingBtn").disabled=i<0||i>=ids.length-1;
    syncRiserControls();
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

  window.ekisBack=function(){const viewer=$("#viewerView");const active=!!(document.fullscreenElement||document.webkitFullscreenElement)||viewer.classList.contains("pseudo-fullscreen");if(active){toggleFullscreen();return true}if(state.currentView==="viewerView"){showView("projectView",false);renderProject();return true}return false};

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

      if(state.riserMode && state.tool==='pan' && dt<1100 && Math.max(Math.abs(dx),Math.abs(dy))>85){
        state.suppressClickUntil=Date.now()+400;
        if(Math.abs(dx)>Math.abs(dy)*1.15){await openAdjacentDrawing(dx<0?1:-1);return;}
        if(Math.abs(dy)>Math.abs(dx)*1.15){await openAdjacentFloor(dy<0?1:-1);return;}
      }

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
        if(state.tool==="pan" && dt<500){
          const now=Date.now();
          if(now-state.lastTapAt<520){
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
    folder.file("_EKIS_metadata.json",JSON.stringify({project:p,files:(p.files||[]).map(id=>fileMeta(id))},null,2));
    const out=await zip.generateAsync({type:"blob"});
    downloadBlob(out,`${p.name.replace(/[\\/:*?"<>|]/g,"_")}.zip`);
    $("#projectStatus").textContent="Projektet exporterades."; toast("Projekt ZIP skapad");
  }

  async function exportBackup(){
    if(!window.JSZip){toast("ZIP-modulen saknas");return}
    const zip=new JSZip(); zip.file("ekis-field-backup.json",JSON.stringify(state.meta,null,2));
    const folder=zip.folder("pdf");
    for(const id of Object.keys(state.meta.fileMeta)){const b=await getBlob(id);if(b)folder.file(id+".pdf",b)}
    const out=await zip.generateAsync({type:"blob"}); downloadBlob(out,"EKIS_FIELD_backup.zip"); toast("Backup skapad");
  }

  async function importBackup(file){
    if(!window.JSZip)return;
    try{
      const zip=await JSZip.loadAsync(file), mf=zip.file("ekis-field-backup.json")||zip.file("caanel-backup.json"); if(!mf)throw new Error("metadata missing");
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
  $$(".nav-btn").forEach(b=>b.onclick=()=>{showView(b.dataset.view); if(b.dataset.view==="projectsView")renderProjects(); if(b.dataset.view==="drawingsView")renderAllDrawings(); if(b.dataset.view==="todoView")renderTodos(); if(b.dataset.view==="ataView")renderAtas()});
  $("#brandBtn").onclick=()=>{renderProjects();showView("projectsView")};
  $("#newProjectBtn").onclick=async()=>{
    const name=await promptModal("Nytt projekt","Ge projektet ett namn.","Nytt projekt");
    if(!name)return; const p={id:uid(),name,files:[],createdAt:Date.now()};state.meta.projects.unshift(p);saveMeta();renderProjects();openProject(p.id);
  };
  $("#backProjectsBtn").onclick=()=>{renderProjects();showView("projectsView")};
  $("#renameProjectBtn").onclick=async()=>{const p=currentProject();const n=await promptModal("Byt projektnamn","",p.name);if(n){p.name=n;saveMeta();renderProject()}};
  $("#deleteProjectBtn").onclick=()=>{const p=currentProject();if(p)deleteProjectById(p.id)};
  $("#pdfInput").onchange=e=>{if(e.target.files.length)importPdfs(e.target.files);e.target.value=""};
  $("#zipInput").onchange=e=>{if(e.target.files.length)importZips(e.target.files);e.target.value=""};
  $("#projectSearch").oninput=renderProject; $("#sortSelect").onchange=renderProject; $("#drawingSearch").oninput=renderAllDrawings;
  $("#exportProjectBtn").onclick=exportProject; $("#exportBackupBtn").onclick=exportBackup; $("#backupInput").onchange=e=>{if(e.target.files[0])importBackup(e.target.files[0]);e.target.value=""};
  $('#newAtaBtn').onclick=createAta;
  $$('[data-ata-filter]').forEach(b=>b.onclick=()=>{state.ataFilter=b.dataset.ataFilter;$$('[data-ata-filter]').forEach(x=>x.classList.toggle('active',x===b));renderAtas()});
  $('#selectAllAtaBtn').onclick=()=>{const items=(state.meta.atas||[]).filter(a=>state.ataFilter==='all'||(state.ataFilter==='open'&&a.status!=='Utförd')||(state.ataFilter==='ongoing'&&a.status==='Pågående')||(state.ataFilter==='done'&&a.status==='Utförd'));items.forEach(a=>state.ataSelected.add(a.id));renderAtas()};
  $('#shareAtaBtn').onclick=shareSelectedAtas;
  $('#ataPhotoInput').onchange=e=>{const a=(state.meta.atas||[]).find(x=>x.id===state.ataPhotoTarget);if(!a)return;for(const f of [...e.target.files].slice(0,5)){const r=new FileReader();r.onload=()=>{a.photos=a.photos||[];a.photos.push(r.result);saveMeta();renderAtas()};r.readAsDataURL(f)}e.target.value=''};
  $('#deleteSelectedBtn').onclick=async()=>{const h=state.selectedOverlay;if(!h)return;if(!await confirmDelete('Ta bort från ritning?','Vill du verkligen ta bort den markerade mätningen/markeringen?'))return;if(h.kind==='measure'){const arr=getMeasurements(),i=arr.findIndex(x=>x.id===h.obj.id);if(i>=0)arr.splice(i,1)}else{const arr=getAnnotations(),i=arr.findIndex(x=>x.id===h.obj.id);if(i>=0)arr.splice(i,1)}state.selectedOverlay=null;$('#deleteSelectedBtn').classList.add('hidden');saveMeta();drawOverlay()};
  $('#riserBtn').onclick=()=>setRiserMode(!state.riserMode);
  $('#riserUpBtn').onclick=()=>openAdjacentFloor(1);
  $('#riserDownBtn').onclick=()=>openAdjacentFloor(-1);
  $("#newTodoBtn").onclick=async()=>{const t=await promptModal("Ny uppgift","Vad ska göras?","");if(!t)return;const pr=await promptModal("Prioritet","Skriv Normal, Viktig eller Akut.","Normal");const due=await promptModal("Deadline","Datum YYYY-MM-DD, eller lämna tomt.","");state.meta.todos.unshift({id:uid(),text:t,done:false,priority:["Normal","Viktig","Akut"].find(x=>x.toLowerCase()===String(pr||"").toLowerCase())||"Normal",due:/^\d{4}-\d{2}-\d{2}$/.test(due||"")?due:"",projectId:state.currentProjectId||null});saveMeta();renderTodos()};
  $$("[data-todo-filter]").forEach(b=>b.onclick=()=>{state.todoFilter=b.dataset.todoFilter;$$('[data-todo-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTodos()});
  $("#backFilesBtn").onclick=()=>{const f=fileMeta(state.currentFileId); state.armatureReturn=null; state.armatureHighlight=null; if(f){state.currentProjectId=f.projectId;renderProject();showView("projectView",false)}else showView("projectsView")};
  $("#backToDrawingBtn").onclick=returnToArmatureSource;
  $("#closeArmatureSheet").onclick=closeArmatureCard;
  $("#armatureSheet").onclick=e=>{if(e.target===$("#armatureSheet"))closeArmatureCard()};
  $("#linkOcchioBtn").onclick=async()=>{const e=state.activeArmatureEntry;if(!e){toast("Öppna först en armatur");return}const occ=findArmatureSchedules(fileMeta(state.currentFileId)?.projectId||state.currentProjectId).filter(x=>x.documentType==="occhioSchedule").flatMap(x=>x.armatureIndex||[]);if(!occ.length){toast("Ingen Occhio-förteckning hittad i projektet");return}const hint=occ.map(x=>`${x.tag}: ${x.type||''}`).join(" | ").slice(0,1200);const v=await promptModal("Koppla Occhio-position",hint,"POS 01");if(!v)return;const projectId=fileMeta(state.currentFileId)?.projectId||state.currentProjectId;state.meta.occhioLinks=state.meta.occhioLinks||{};state.meta.occhioLinks[projectId]=state.meta.occhioLinks[projectId]||{};state.meta.occhioLinks[projectId][cleanTag(e.tag)]=cleanTag(v);saveMeta();toast("Occhio-koppling sparad");$("#armatureSheet").classList.add("hidden")};
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
    if(!state.lockViewAcrossDrawings && state.riserMode)setRiserMode(false);
    else toast(state.lockViewAcrossDrawings?"Vy låst – plats och zoom följer med":"Vy-lås av");
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
  $("#clearMeasuresBtn").onclick=async()=>{const arr=getMeasurements();if(!arr.length){toast("Inga mätningar att rensa");return}if(!await confirmDelete("Rensa mätningar?",`Vill du verkligen ta bort alla ${arr.length} sparade mätningar på den här sidan?`))return;state.meta.measurements[pageKey()]=[];state.tempPoints=[];saveMeta();drawOverlay();$("#measureResult").textContent="Rensat"};

  // Install prompt
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();state.deferredInstall=e;$("#installBtn").classList.remove("hidden")});
  $("#installBtn").onclick=async()=>{if(!state.deferredInstall)return;state.deferredInstall.prompt();await state.deferredInstall.userChoice;state.deferredInstall=null;$("#installBtn").classList.add("hidden")};

  if("serviceWorker" in navigator && location.protocol!=="file:") navigator.serviceWorker.register("sw.js").catch(()=>{});

  installViewerGestures();
  renderProjects(); renderAllDrawings(); renderTodos();
})();
