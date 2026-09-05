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
    drawingRefHotspots: [],
    drawingRefHistory: [],
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
    ataFilter: "open", ataSelected: new Set(), ataPhotoTarget: null, activeAtaMark:null, ataMarkAnnotationId:null, ataMarkBaseIds:null, riserMode:false, selectedOverlay:null, drawDraft:null, counterSelected:new Set(), counterCategory:"Belysning", ataEditingId:null, ataHoursEditingId:null, scannerSession:null, scannerReview:null
  };

  function defaultMeta() {
    return { projects: [], todos: [], atas: [], fileMeta: {}, measurements: {}, annotations: {}, theme: "dark", version: 6 };
  }
  function loadMeta() {
    try { return {...defaultMeta(), ...JSON.parse(localStorage.getItem(META_KEY) || "{}")}; }
    catch { return defaultMeta(); }
  }
  function saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(state.meta));
  }
  function applyTheme(theme, persist=false){
    const next=theme==="light"?"light":"dark";
    state.meta.theme=next;
    document.documentElement.dataset.theme=next;
    const metaTheme=document.querySelector('meta[name="theme-color"]');
    if(metaTheme)metaTheme.setAttribute("content",next==="light"?"#f3f4f6":"#0b0b0c");
    document.querySelectorAll('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===next));
    if(persist)saveMeta();
  }
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmtBytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
  const projectById = id => state.meta.projects.find(p => p.id === id);
  const currentProject = () => projectById(state.currentProjectId);
  const fileMeta = id => state.meta.fileMeta[id];


  const ANALYSIS_VERSION = 7;
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
    if(/KANALISATION|KANALISERING/.test(u)) return "Kanalisation";
    if(/BELYSNING|LJUSPLAN|ARMATURPLAN/.test(u)) return "Belysning";
    if(/\bKRAFT\b|KRAFTPLAN/.test(u)) return "Kraft";
    if(/\bTELE\b|DATA\/TELE|TELEPLAN/.test(u)) return "Tele";
    if(/\bBRAND\b|BRANDLARM/.test(u)) return "Brand";
    if(/PASSAGE|PASSERSYSTEM|PASSER/.test(u)) return "Passage";
    return "Övrigt";
  }

  // Kategori i ritningshuvudet är facit. Ord ute i själva planbilden får aldrig
  // skriva över ett tydligt kategoriord nere till höger i titelblocket.
  function titleBlockCategory(pages){
    const defs=[
      {category:"Kanalisation",re:/KANALISATION|KANALISERING/i},
      {category:"Belysning",re:/BELYSNING|LJUSPLAN|ARMATURPLAN/i},
      {category:"Kraft",re:/\bKRAFT\b|KRAFTPLAN/i},
      {category:"Tele",re:/\bTELE\b|DATA\/TELE|TELEPLAN/i},
      {category:"Brand",re:/\bBRAND\b|BRANDLARM/i},
      {category:"Passage",re:/PASSAGE|PASSERSYSTEM|PASSER/i}
    ];
    let best=null;
    for(const pg of (pages||[]).slice(0,3)){
      const W=pg.viewport?.width||1,H=pg.viewport?.height||1;
      for(const item of pg.items||[]){
        const cx=(item.x+(item.w||0)/2)/W, cy=(item.y+(item.h||0)/2)/H;
        for(const d of defs){
          if(!d.re.test(String(item.str||"")))continue;
          let score=1;
          if(cx>=.62)score+=3;
          if(cy>=.72)score+=3;
          if(cx>=.78&&cy>=.82)score+=10;
          if(cx>=.84&&cy>=.88)score+=6;
          const exact=String(item.str||"").trim().toUpperCase();
          if(["KANALISATION","BELYSNING","KRAFT","TELE","BRAND","PASSAGE"].includes(exact))score+=3;
          if(!best||score>best.score)best={category:d.category,score,text:item.str,x:cx,y:cy};
        }
      }
    }
    return best&&best.score>=10?best:null;
  }

  function drawingSeriesCategory(drawingNumber,originalName=""){
    const t=`${drawingNumber||""} ${originalName||""}`.toUpperCase();
    // Verifierat mot det importerade Skimra-paketet. Används bara när
    // titelblocket inte lämnar ett explicit kategoriord.
    if(/\bE[-–]61[01][-–]/.test(t))return "Kanalisation";
    if(/\bE[-–]631[-–]/.test(t))return "Belysning";
    if(/\bE[-–]632[-–]/.test(t))return "Kraft";
    if(/\bE[-–]640[-–]/.test(t))return "Tele";
    if(/\bE[-–]642[-–]/.test(t))return "Passage";
    return "Övrigt";
  }
  function extractPlan(text){
    const m=String(text||"").match(/\bPLAN\s*0*(\d{1,3})\b/i);
    return m ? String(Number(m[1])) : "";
  }
  function extractTitlePlanPart(text){
    const t=String(text||"").replace(/\s+/g," ");
    const hits=[...t.matchAll(/\bPLAN\s*0*(\d{1,3})\s*[,;:\-]?\s*DEL\s*0*(\d{1,2})\b/ig)];
    const m=hits[hits.length-1];
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

  function drawingSortMeta(f){
    const text=`${displayLabel(f)} ${f.originalName||''} ${f.path||''}`;
    const pm=text.match(/(?:\bP|\bPLAN\s*)(\d{1,2})\b/i);
    const dm=text.match(/(?:\bDEL\s*|[-_.](?:D)?)([123])(?:\b|[-_.])/i);
    const plan=Number(f.plan||pm?.[1]||9999);
    const part=Number(f.part||dm?.[1]||0);
    const rev=String(f.revisionStatus||'').toLowerCase()==='ny'?0:String(f.revisionStatus||'').toLowerCase()==='gammal'?1:0;
    return {plan,part,rev};
  }
  function smartSortFiles(a,b){
    const ca=CATEGORY_ORDER.indexOf(a.category||"Övrigt"), cb=CATEGORY_ORDER.indexOf(b.category||"Övrigt");
    if(ca!==cb) return (ca<0?99:ca)-(cb<0?99:cb);
    const A=drawingSortMeta(a), B=drawingSortMeta(b);
    if(A.plan!==B.plan)return A.plan-B.plan;
    if(A.part!==B.part)return A.part-B.part;
    if(A.rev!==B.rev)return A.rev-B.rev; // aktuell/ny före gammal inom samma plan+del
    const ri=(b.revisionIndex||0)-(a.revisionIndex||0); if(ri)return ri;
    return displayLabel(a).localeCompare(displayLabel(b),"sv",{numeric:true,sensitivity:'base'});
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
      let categorySource=isSchedule?"armatureSchedule":"unverified";
      let categoryVerified=!!isSchedule;
      if(!isSchedule){
        const titleHit=titleBlockCategory(pages);
        if(titleHit){
          category=titleHit.category; categorySource="titleBlock"; categoryVerified=true;
        } else {
          // Läs ritningsnummer tidigt för säker serie-fallback. Vi använder inte
          // plantextens lösa BELYSNING/TELE-ord som kategori eftersom de ofta är hänvisningar.
          const earlyNo=(allText.match(/\bE[-–]\d{3}[-–]\d[-–]\d{3,5}\b/i)||[])[0]||stripPdf(originalName).match(/E[-–]\d{3}[-–]\d[-–]\d{3,5}/i)?.[0]||"";
          const series=drawingSeriesCategory(earlyNo,originalName);
          if(series!=="Övrigt"){category=series;categorySource="drawingSeries";categoryVerified=true;}
          else {category="Övrigt";categorySource="unverified";categoryVerified=false;}
        }
      }
      // Title block wins over orientation figures and other PLAN references on the sheet.
      const titlePlanPart=extractTitlePlanPart(tailText)||extractTitlePlanPart(first.join(" "))||extractTitlePlanPart(allText);
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
      const result={analysisVersion:ANALYSIS_VERSION,documentType:isOcchio?"occhioSchedule":(isSchedule?"armatureSchedule":"drawing"),category,categorySource,categoryVerified,plan,part,displayName,armatureIndex,pages:doc.numPages,detectedScales,drawingNumber,sourceDate};
      try{await doc.destroy()}catch(_e){}
      return result;
    }catch(err){console.warn("PDF analysis failed",originalName,err);return null}
  }

  function applyAnalysis(f,a){
    if(!f||!a)return;
    f.analysisVersion=ANALYSIS_VERSION; f.documentType=a.documentType; f.category=a.category; f.categorySource=a.categorySource||"unverified"; f.categoryVerified=!!a.categoryVerified; f.plan=a.plan; f.part=a.part||""; f.armatureIndex=a.armatureIndex||[]; f.pageCount=a.pages||1; f.drawingNumber=a.drawingNumber||f.drawingNumber||""; f.sourceDate=a.sourceDate||f.sourceDate||"";
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
        if(state.currentProjectId===projectId) $("#projectStatus").textContent=`Verifierar ritningshuvud… ${i+1}/${ids.length}`;
        applyAnalysis(f,await analyzePdfBlob(blob,f.originalName));
      }
      state.meta.version=ANALYSIS_VERSION; saveMeta();
      if(state.currentProjectId===projectId){$("#projectStatus").textContent="Ritningskategorier verifierade.";renderProject()}
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
    $("#projectQuickActions")?.classList.toggle("hidden",(p.files||[]).length>0);
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

  function refreshRevisionLabels(project){
    if(!project)return;
    const groups=new Map();
    for(const id of project.files||[]){const f=fileMeta(id);if(!f)continue;const k=revisionKey(f);if(!k)continue;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f)}
    for(const arr of groups.values()){
      if(arr.length<2)continue;
      arr.sort((a,b)=>String(a.sourceDate||'').localeCompare(String(b.sourceDate||'')) || (a.addedAt||0)-(b.addedAt||0));
      arr.forEach((f,i)=>{
        const base=(f.category&&f.category!=='Övrigt')?`${f.category}${f.plan?` – P${f.plan}`:''}${f.part?` – Del ${f.part}`:''}`:stripPdf(f.originalName||f.name);
        f.revisionIndex=i+1; f.revisionCount=arr.length; f.revisionStatus=i===arr.length-1?'Ny':'Gammal';
        f.name=`${base} · ${f.revisionStatus}.pdf`; f.autoNamed=true;
      });
    }
  }

  async function processImportItems(rawItems, sourceLabel='filer'){
    const p=currentProject(); if(!p)return;
    const existing=(p.files||[]).map(fileMeta).filter(Boolean);
    let imported=0, duplicateCount=0, revisionCount=0;
    const prepared=[];
    $("#projectStatus").textContent=`Analyserar ${rawItems.length} PDF-filer…`;
    for(let i=0;i<rawItems.length;i++){
      $("#projectStatus").textContent=`Analyserar PDF… ${i+1}/${rawItems.length}`;
      try{prepared.push(await inspectIncomingPdf(rawItems[i].blob,rawItems[i].name,rawItems[i].path||''))}catch(err){console.warn('Importanalys misslyckades',rawItems[i].name,err);prepared.push({blob:rawItems[i].blob,originalName:rawItems[i].name,path:rawItems[i].path||'',hash:'',analysis:null,temp:{name:rawItems[i].name,originalName:rawItems[i].name,category:'Övrigt'}})}
    }
    for(let i=0;i<prepared.length;i++){
      const item=prepared[i]; $("#projectStatus").textContent=`Importerar… ${i+1}/${prepared.length}`;
      let exact=null;
      if(item.hash){for(const f of existing){if(await ensureFileHash(f)===item.hash){exact=f;break}}}
      if(exact){duplicateCount++;continue;} // identiska filer läggs inte dubbelt
      const key=revisionKey(item.temp);
      if(key && existing.some(f=>revisionKey(f)===key)) revisionCount++;
      const added=await addInspectedPdf(item); if(added){existing.push(added);imported++}
    }
    refreshRevisionLabels(p); saveMeta(); renderProject();renderProjects();renderAllDrawings();
    $("#projectStatus").textContent=`Import klar: ${imported} importerade${revisionCount?` · ${revisionCount} revisioner grupperade`:''}${duplicateCount?` · ${duplicateCount} identiska hoppades över`:''}.`;
    toast(`${imported} PDF importerade från ${sourceLabel}`);
  }

  async function importPdfs(fileList){
    const files=[...fileList].filter(f=>f.name.toLowerCase().endsWith('.pdf'));
    await processImportItems(files.map(f=>({blob:f,name:f.name,path:''})),`${files.length} PDF`);
  }

  async function importZips(fileList){
    if(!window.JSZip){toast('ZIP-modulen kunde inte laddas');return}
    const zips=[...fileList].filter(f=>f.name.toLowerCase().endsWith('.zip')); let totalImported=0;
    try{
      for(let zi=0;zi<zips.length;zi++){
        const file=zips[zi]; $("#projectStatus").textContent=`ZIP ${zi+1}/${zips.length}: packar upp ${file.name}…`;
        let zip=await JSZip.loadAsync(file); const entries=Object.values(zip.files).filter(e=>!e.dir&&e.name.toLowerCase().endsWith('.pdf'));
        for(let pi=0;pi<entries.length;pi++){
          const e=entries[pi]; $("#projectStatus").textContent=`ZIP ${zi+1}/${zips.length} · PDF ${pi+1}/${entries.length}: analyserar ${e.name.split('/').pop()}`;
          const blob=await e.async('blob'); const parts=e.name.split('/'); const name=parts.pop();
          await processImportItems([{blob,name,path:parts.join('/'),zipName:file.name}],`${file.name} · ${pi+1}/${entries.length}`);
          totalImported++; await new Promise(r=>setTimeout(r,0));
        }
        zip=null;
      }
      $("#projectStatus").textContent=`Import klar · ${zips.length} ZIP behandlade · ${totalImported} PDF lästa.`;
    }catch(err){console.error(err);$("#projectStatus").textContent='Importen avbröts vid analys. Prova igen – redan sparade PDF:er ligger kvar.'}
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
    list.innerHTML=items.map(a=>{const p=projectById(a.projectId), editing=state.ataEditingId===a.id, hourEdit=state.ataHoursEditingId===a.id;
      const body=editing?`<div class="ata-inline-edit"><label>Titel<input class="ata-inline-title" value="${esc(a.title||'')}"></label><label>Info ÄTA<textarea class="ata-inline-info" rows="5">${esc(a.description||'')}</textarea></label><div class="ata-inline-grid"><label>Datum<input class="ata-inline-date" type="date" value="${esc(a.date||'')}"></label><label>Est. timmar<input class="ata-inline-est" type="number" step="0.5" min="0" value="${Number(a.estimate||0)}"></label></div><div class="ata-inline-actions"><button class="btn primary ata-inline-save">Spara</button><button class="btn ata-inline-cancel">Avbryt</button></div></div>`:`<strong class="ata-title-direct" title="Tryck för att redigera">${esc(a.title)}</strong><div class="ata-meta"><span class="ata-status ${a.status==='Utförd'?'done':''}">${esc(a.status)}</span><span>📅 ${esc(a.date||'')}</span><span>⏱ ${ataHours(a).toFixed(1)} h${a.estimate?` / est. ${Number(a.estimate).toFixed(1)} h`:''}</span>${p?`<span>▦ ${esc(p.name)}</span>`:''}</div>${a.description?`<p class="muted ata-info-direct" title="Tryck för att redigera" style="margin-top:7px">${esc(a.description)}</p>`:'<p class="muted ata-info-direct" style="margin-top:7px">+ Lägg till info</p>'}`;
      const hours=hourEdit?`<div class="ata-hours-inline"><input class="ata-hours-value" type="number" min="0.1" step="0.25" placeholder="Timmar"><input class="ata-hours-date" type="date" value="${new Date().toISOString().slice(0,10)}"><input class="ata-hours-note" placeholder="Beskrivning"><button class="mini-btn ata-hours-save">Spara</button><button class="mini-btn ata-hours-cancel">Avbryt</button></div>`:'';
      return `<div class="ata-card ${a.status==='Utförd'?'done':''}" data-ata="${a.id}"><div class="ata-top"><input class="ata-select" type="checkbox" ${state.ataSelected.has(a.id)?'checked':''}><div class="ata-main"><div class="ata-num">${esc(a.number)}</div>${body}${a.drawingNote?`<p class="muted" style="margin-top:5px">📍 ${esc(a.drawingNote)}</p>`:''}${(a.sessions||[]).length?`<div class="ata-sessions">${a.sessions.map((x,i)=>`<div class="ata-session"><span>${esc(x.date||'')} · <b>${Number(x.hours||0).toFixed(1)} h</b>${x.note?` · ${esc(x.note)}`:''}</span><button class="mini-btn ata-session-del" data-session="${i}">✕</button></div>`).join('')}</div>`:''}${hours}<div class="ata-photos">${(a.photos||[]).map((x,i)=>`<span class="ata-photo-wrap"><img src="${x}" alt="ÄTA-bild"><button class="ata-photo-del" data-photo="${i}">✕</button></span>`).join('')}</div></div></div>${editing?'':`<div class="ata-card-actions"><button class="mini-btn ata-edit-btn">✏️ Redigera</button><button class="mini-btn ata-status-btn">${a.status==='Utförd'?'↺ Öppna':'✓ Utförd'}</button><button class="mini-btn ata-hours-btn">+ Timmar</button><button class="mini-btn ata-camera-btn">📷 Ta foto</button><button class="mini-btn ata-photo-btn">🖼 Galleri</button><button class="mini-btn ata-mark-btn">⌖ Markera på ritning</button><button class="mini-btn ata-delete-btn">✕</button></div>`}</div>`}).join('');
    list.querySelectorAll('[data-ata]').forEach(row=>{const a=all.find(x=>x.id===row.dataset.ata); const q=x=>row.querySelector(x);
      q('.ata-select').onchange=e=>{e.target.checked?state.ataSelected.add(a.id):state.ataSelected.delete(a.id);renderAtas()};
      q('.ata-edit-btn')?.addEventListener('click',()=>{state.ataEditingId=a.id;renderAtas()}); q('.ata-title-direct')?.addEventListener('click',()=>{state.ataEditingId=a.id;renderAtas()}); q('.ata-info-direct')?.addEventListener('click',()=>{state.ataEditingId=a.id;renderAtas()});
      q('.ata-inline-cancel')?.addEventListener('click',()=>{state.ataEditingId=null;renderAtas()}); q('.ata-inline-save')?.addEventListener('click',()=>{const title=q('.ata-inline-title').value.trim();if(!title){toast('Titel behövs');return}a.title=title;a.description=q('.ata-inline-info').value;a.date=q('.ata-inline-date').value||a.date;a.estimate=Number(q('.ata-inline-est').value)||0;state.ataEditingId=null;saveMeta();renderAtas();toast(`${a.number} sparad`)});
      q('.ata-status-btn')?.addEventListener('click',()=>{a.status=a.status==='Utförd'?'Pågående':'Utförd';if(a.status==='Utförd')a.completed=new Date().toISOString().slice(0,10);saveMeta();renderAtas()});
      q('.ata-hours-btn')?.addEventListener('click',()=>{state.ataHoursEditingId=a.id;renderAtas()}); q('.ata-hours-cancel')?.addEventListener('click',()=>{state.ataHoursEditingId=null;renderAtas()}); q('.ata-hours-save')?.addEventListener('click',()=>{const h=Number(String(q('.ata-hours-value').value).replace(',','.'));if(!(h>0)){toast('Ange timmar');return}a.sessions=a.sessions||[];a.sessions.push({id:uid(),date:q('.ata-hours-date').value||new Date().toISOString().slice(0,10),hours:h,note:q('.ata-hours-note').value.trim()});a.status='Pågående';state.ataHoursEditingId=null;saveMeta();renderAtas();toast('Extra timmar sparade')});
      q('.ata-camera-btn')?.addEventListener('click',()=>{state.ataPhotoTarget=a.id;if(window.Android?.capturePhoto){Android.capturePhoto()}else{$('#ataCameraInput').click()}}); q('.ata-photo-btn')?.addEventListener('click',()=>{state.ataPhotoTarget=a.id;$('#ataPhotoInput').click()});
      row.querySelectorAll('.ata-session-del').forEach(btn=>btn.onclick=async()=>{const i=Number(btn.dataset.session);if(!await confirmDelete('Ta bort timmar?','Vill du verkligen ta bort detta arbetspass?'))return;a.sessions.splice(i,1);saveMeta();renderAtas()}); row.querySelectorAll('.ata-photo-del').forEach(btn=>btn.onclick=async()=>{const i=Number(btn.dataset.photo);if(!await confirmDelete('Ta bort foto?','Vill du verkligen ta bort detta?'))return;a.photos.splice(i,1);saveMeta();renderAtas()});
      q('.ata-mark-btn')?.addEventListener('click',async()=>{state.currentProjectId=a.projectId||state.currentProjectId; const p=projectById(state.currentProjectId); const id=a.drawing?.fileId || p?.files?.[0]; if(!id){toast('Lägg först in en ritning i projektet');return} state.activeAtaMark=a.id; state.ataMarkAnnotationId=null; await openPdf(id,{page:a.drawing?.page||1,viewState:a.drawing?.view||null}); state.ataMarkBaseIds=new Set(getAnnotations().map(x=>x.id)); setTool('pen'); updateAtaMarkBar(); toast('Rita, skriv, använd pil eller ring. Tryck sedan Spara till ÄTA')});
      q('.ata-delete-btn')?.addEventListener('click',async()=>{if(!await confirmDelete('Ta bort ÄTA?',`Vill du verkligen ta bort ${a.number} – ${a.title}?`))return;state.meta.atas=all.filter(x=>x.id!==a.id);state.ataSelected.delete(a.id);saveMeta();renderAtas()});
    });
  }
  async function createAta(){ const title=await promptModal('Ny ÄTA / Avvikelse','Beskriv extraarbetet kort.','');if(!title)return; const desc=await promptModal('Beskrivning','Orsak / vad som ska göras.',''); const est=Number(String(await promptModal('Beräknade timmar','Kan lämnas 0 om okänt.','0','number')||0).replace(',','.'))||0; const projectId=state.currentProjectId||state.meta.projects[0]?.id||null; state.meta.atas.unshift({id:uid(),number:ataNumber(),title,description:desc||'',date:new Date().toISOString().slice(0,10),status:'Ej påbörjad',estimate:est,sessions:[],photos:[],projectId});saveMeta();renderAtas(); }
  function editAta(a){ if(!a)return; state.ataEditingId=a.id; renderAtas(); }
  function imageSize(dataUrl){return new Promise(resolve=>{const im=new Image();im.onload=()=>resolve({w:im.naturalWidth||im.width,h:im.naturalHeight||im.height});im.onerror=()=>resolve(null);im.src=dataUrl})}
  async function shareSelectedAtas(){
    const items=(state.meta.atas||[]).filter(a=>state.ataSelected.has(a.id));if(!items.length){toast('Välj minst en ÄTA');return} if(!window.jspdf?.jsPDF){toast('PDF-modulen saknas');return}
    const {jsPDF}=window.jspdf, doc=new jsPDF(); const pageH=297, margin=14, contentW=182; let y=18;
    const newPage=()=>{doc.addPage();y=18}; const ensure=h=>{if(y+h>pageH-18)newPage()};
    doc.setFontSize(18);doc.setFont(undefined,'bold');doc.text('EKIS FIELD – ÄTA / Avvikelser',margin,y);y+=7;doc.setFontSize(8);doc.setFont(undefined,'normal');doc.text('© 2026 Robin Ekström. Alla rättigheter förbehållna.',margin,y);y+=10;
    for(let ai=0;ai<items.length;ai++){
      const a=items[ai]; if(ai>0){newPage()}
      doc.setFontSize(14);doc.setFont(undefined,'bold');doc.text(`${a.number} – ${a.title}`,margin,y);y+=7;
      doc.setFontSize(9);doc.setFont(undefined,'normal');doc.text(`Status: ${a.status}   Datum: ${a.date||'-'}   Timmar: ${ataHours(a).toFixed(1)} h   Est: ${Number(a.estimate||0).toFixed(1)} h`,margin,y);y+=6;
      const p=projectById(a.projectId); if(p){doc.text(`Projekt: ${p.name}`,margin,y);y+=5}
      if(a.description){const lines=doc.splitTextToSize(a.description,contentW);ensure(lines.length*4.5+3);doc.text(lines,margin,y);y+=lines.length*4.5+3}
      if(a.drawingNote){ensure(7);doc.text(`Placering: ${a.drawingNote}`,margin,y);y+=7}
      const snapshots=(a.drawingSnapshots||[]).map(x=>x?.dataUrl||x).filter(Boolean);
      if(snapshots.length){ensure(10);doc.setFont(undefined,'bold');doc.text(`Markering på ritning (${snapshots.length})`,margin,y);doc.setFont(undefined,'normal');y+=6;
        for(const dataUrl of snapshots){
          const size=await imageSize(dataUrl); if(!size)continue;
          const maxW=contentW,maxH=118,ratio=Math.min(maxW/size.w,maxH/size.h),w=size.w*ratio,h=size.h*ratio;ensure(h+8);
          try{doc.addImage(dataUrl,'JPEG',margin,y,w,h,undefined,'FAST')}catch(e){try{doc.addImage(dataUrl,'PNG',margin,y,w,h,undefined,'FAST')}catch(_){}}
          y+=h+7;
        }
      }
      const photos=a.photos||[];
      if(photos.length){ensure(10);doc.setFont(undefined,'bold');doc.text(`Fotodokumentation (${photos.length})`,margin,y);doc.setFont(undefined,'normal');y+=6;
        for(const dataUrl of photos){
          const size=await imageSize(dataUrl); if(!size)continue;
          const maxW=contentW, maxH=105; const ratio=Math.min(maxW/size.w,maxH/size.h); const w=size.w*ratio,h=size.h*ratio; ensure(h+8);
          try{doc.addImage(dataUrl,'JPEG',margin,y,w,h,undefined,'FAST')}catch(e){try{doc.addImage(dataUrl,'PNG',margin,y,w,h,undefined,'FAST')}catch(_){} }
          y+=h+7;
        }
      }
    }
    const data=doc.output('datauristring'); const name=`EKIS_FIELD_ATA_${new Date().toISOString().slice(0,10)}.pdf`; if(window.Android?.shareBase64)Android.shareBase64(name,data,'application/pdf'); else downloadBlob(doc.output('blob'),name);
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
    syncScaleUI(); state.tempPoints=[]; drawOverlay(); updateHint(); setTimeout(centerFullscreenDrawing,60);
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
    $$('[data-ata-tool]').forEach(b=>b.classList.toggle('active',b.dataset.ataTool===tool));
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
      if(a.type==='text'){const p=toPx(a.points[0]);const fs=Math.max(10,Math.min(48,Number(a.fontSize)||16));ctx.font=`bold ${fs}px sans-serif`;ctx.fillText(a.text,p.x,p.y);if(a.selected){const w=Math.max(44,String(a.text||'').length*fs*.62);ctx.save();ctx.strokeStyle='#ff4d4f';ctx.setLineDash([5,4]);ctx.strokeRect(p.x-5,p.y-fs-5,w+10,fs+12);ctx.restore()}}ctx.restore();
    }
    const review=state.scannerReview;
    if(review?.pageHits?.length){
      ctx.save();ctx.lineWidth=3;ctx.strokeStyle="#ff6a00";ctx.fillStyle="rgba(255,106,0,.15)";ctx.font="800 12px system-ui";
      review.pageHits.forEach((hit,i)=>{if(!Number.isFinite(hit.nx)||!Number.isFinite(hit.ny))return;const x=hit.nx*state.baseCanvasWidth,y=hit.ny*state.baseCanvasHeight,r=13;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle="#ff6a00";ctx.fillText(String(i+1),x+r+4,y+4);ctx.fillStyle="rgba(255,106,0,.15)";});ctx.restore();
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

  function nearestOverlayObject(e){
    // Hit-test in screen pixels so *all* visible markup can be selected for deletion,
    // including the body of text, freehand strokes, arrows and circles — not only
    // their anchor/control points.
    const r=$("#overlayCanvas").getBoundingClientRect();
    const sc=state.renderScale*state.viewZoom;
    const x=e.clientX-r.left, y=e.clientY-r.top;
    const tol=26;
    const sp=p=>({x:p.x*sc,y:p.y*sc});
    const pointDist=p=>Math.hypot(x-p.x,y-p.y);
    const segDist=(p,a,b)=>{
      const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y;
      const vv=vx*vx+vy*vy||1;
      const t=Math.max(0,Math.min(1,(wx*vx+wy*vy)/vv));
      return Math.hypot(p.x-(a.x+t*vx),p.y-(a.y+t*vy));
    };
    let best=null,bestD=Infinity;
    const take=(kind,obj,d)=>{if(d<=tol&&d<bestD){best={kind,obj};bestD=d}};

    for(const m of getMeasurements()){
      const pts=(m.points||[]).map(sp);
      for(const q of pts)take('measure',m,pointDist(q));
      for(let i=1;i<pts.length;i++)take('measure',m,segDist({x,y},pts[i-1],pts[i]));
      if(m.type==='area'&&pts.length>2)take('measure',m,segDist({x,y},pts[pts.length-1],pts[0]));
    }

    for(const a of getAnnotations()){
      const pts=(a.points||[]).map(sp);
      if(a.type==='text'&&pts[0]){
        const q=pts[0], text=String(a.text||'');
        const fs=Math.max(10,Math.min(48,Number(a.fontSize)||16));
        const w=Math.max(44,text.length*fs*.62), h=fs+16;
        const left=q.x-8,right=q.x+w+8,top=q.y-h,bottom=q.y+10;
        const nx=Math.max(left,Math.min(x,right)),ny=Math.max(top,Math.min(y,bottom));
        take('annotation',a,Math.hypot(x-nx,y-ny));
        continue;
      }
      if(a.type==='circle'&&pts.length>=2){
        const p=pts[0],q=pts[1],cx=(p.x+q.x)/2,cy=(p.y+q.y)/2;
        const rx=Math.max(2,Math.abs(q.x-p.x)/2),ry=Math.max(2,Math.abs(q.y-p.y)/2);
        const ang=Math.atan2(y-cy,x-cx);
        const ex=cx+rx*Math.cos(ang),ey=cy+ry*Math.sin(ang);
        take('annotation',a,Math.hypot(x-ex,y-ey));
        // Also allow tapping inside a small/skinny ring.
        const inside=((x-cx)*(x-cx))/(rx*rx)+((y-cy)*(y-cy))/(ry*ry)<=1;
        if(inside&&rx<55&&ry<55)take('annotation',a,0);
        continue;
      }
      for(const q of pts)take('annotation',a,pointDist(q));
      for(let i=1;i<pts.length;i++)take('annotation',a,segDist({x,y},pts[i-1],pts[i]));
    }
    return best;
  }
  $('#overlayCanvas').addEventListener('pointerdown',e=>{if(!['pen','arrow','circle'].includes(state.tool))return;const p=pdfPointFromEvent(e);state.drawDraft={type:state.tool,points:[p],pointerId:e.pointerId};try{e.target.setPointerCapture(e.pointerId)}catch{}e.preventDefault()});
  $('#overlayCanvas').addEventListener('pointermove',e=>{const d=state.drawDraft;if(!d||d.pointerId!==e.pointerId)return;const p=pdfPointFromEvent(e);if(d.type==='pen')d.points.push(p);else d.points[1]=p;state.tempPoints=d.points;drawOverlay()});
  $('#overlayCanvas').addEventListener('pointerup',e=>{const d=state.drawDraft;if(!d||d.pointerId!==e.pointerId)return;const p=pdfPointFromEvent(e);if(d.type!=='pen')d.points[1]=p;if(d.points.length>1){const a={id:uid(),type:d.type,points:d.points};getAnnotations().push(a);if(state.activeAtaMark){state.ataMarkAnnotationId=a.id; updateAtaMarkBar();}saveMeta()}state.drawDraft=null;state.tempPoints=[];setTool('pan');drawOverlay()});
  function openDirectTextEditor(clientX,clientY,pdfPoint,existing=null){
    const old=document.querySelector('.drawing-text-editor');if(old)old.remove();
    const input=document.createElement('input');input.type='text';input.className='drawing-text-editor';
    input.value=existing?.text||'';input.placeholder='Skriv text…';
    Object.assign(input.style,{position:'fixed',left:`${Math.max(8,Math.min(clientX,window.innerWidth-250))}px`,top:`${Math.max(8,clientY-24)}px`,zIndex:'9999',width:'230px',padding:'10px 12px',border:'2px solid #ff6a00',borderRadius:'10px',background:'#111',color:'#fff',font:'700 16px system-ui',outline:'none'});
    document.body.appendChild(input);let done=false;
    const commit=()=>{if(done)return;done=true;const text=input.value.trim();input.remove();if(text){if(existing){existing.text=text}else{getAnnotations().push({id:uid(),type:'text',points:[pdfPoint],text,fontSize:16})}saveMeta();}setTool('pan');drawOverlay();};
    input.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();commit()}else if(ev.key==='Escape'){done=true;input.remove();setTool('pan');drawOverlay()}});
    input.addEventListener('blur',()=>setTimeout(commit,40));setTimeout(()=>{input.focus();input.select()},30);
  }
  $('#overlayCanvas').addEventListener('click',e=>{if(state.tool!=='text')return;e.preventDefault();e.stopImmediatePropagation();openDirectTextEditor(e.clientX,e.clientY,pdfPointFromEvent(e));});

  // Distance: first tap fixes A. Second press starts B; drag and release commits a straight A–B distance.
  $("#overlayCanvas").addEventListener("pointerdown",e=>{
    if(state.tool!=="distance")return;
    showMeasureMagnifier(e);
    const p=pdfPointFromEvent(e);
    // Existing endpoint editing has priority.
    let best=null,d=Infinity;for(const m of getMeasurements())for(const h of screenMeasureHandles(m)){const q=Math.hypot(e.clientX-h.cx,e.clientY-h.cy);if(q<30&&q<d){best={m,h};d=q}}
    if(best){state.editMeasure=best;e.preventDefault();try{e.target.setPointerCapture(e.pointerId)}catch{}return;}
    if(!state.tempPoints.length){state.tempPoints=[p];state.distanceDraft=null;drawOverlay();e.preventDefault();return;}
    state.distanceDraft={a:state.tempPoints[0],b:p,pointerId:e.pointerId};e.preventDefault();try{e.target.setPointerCapture(e.pointerId)}catch{}drawOverlay();
  });
  $("#overlayCanvas").addEventListener("pointermove",e=>{
    if(state.tool==="distance"&&(state.distanceDraft||state.editMeasure))showMeasureMagnifier(e);
    if(state.editMeasure){const p=pdfPointFromEvent(e),m=state.editMeasure.m;if(state.editMeasure.h.kind==="a")m.points[0]=p;else m.points[1]=p;m.label=formatLength(ptToM(distancePt(m.points[0],m.points[1])));$("#measureResult").textContent=m.label;drawOverlay();return;}
    if(state.distanceDraft && (state.distanceDraft.pointerId==null||state.distanceDraft.pointerId===e.pointerId)){state.distanceDraft.b=pdfPointFromEvent(e);const m=ptToM(distancePt(state.distanceDraft.a,state.distanceDraft.b));$("#measureResult").textContent=formatLength(m);drawOverlay();}
  });
  $("#overlayCanvas").addEventListener("pointerup",e=>{
    hideMeasureMagnifier();
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
  $("#overlayCanvas").addEventListener("click",e=>{if(Date.now()<state.suppressClickUntil||["pan","distance","text","pen","arrow","circle"].includes(state.tool))return;state.tempPoints.push(pdfPointFromEvent(e));drawOverlay();});

  function screenMeasureHandles(m){
    if(!m||m.type!=="distance"||m.points?.length!==2)return [];const sc=state.renderScale*state.viewZoom,r=$("#overlayCanvas").getBoundingClientRect();return [{kind:"a",p:m.points[0]},{kind:"b",p:m.points[1]}].map(h=>({...h,cx:r.left+h.p.x*sc,cy:r.top+h.p.y*sc}));
  }

  async function loadSmartHotspots(page,viewport){
    state.smartHotspots=[]; state.drawingRefHotspots=[]; state.pageTextItems=[];
    const f=fileMeta(state.currentFileId); if(!f)return;
    const schedules=findArmatureSchedules(f.projectId);
    try{
      const tc=await page.getTextContent();
      for(const item of tc.items){
        const tx=pdfjsLib.Util.transform(viewport.transform,item.transform),h=Math.max(6,Math.hypot(tx[2],tx[3])),w=Math.max(8,(item.width||String(item.str||"").length*5)*state.renderScale);
        state.pageTextItems.push({str:String(item.str||""),x:tx[4]/state.renderScale,y:(tx[5]-h)/state.renderScale,w:w/state.renderScale,h:h/state.renderScale});
      }
      // Interna ritningshänvisningar, t.ex. SE “E-600-1-001”. De fungerar även
      // när ingen armaturförteckning finns i projektet.
      const refRe=/\bE\s*[-–]\s*\d{3}\s*[-–]\s*\d\s*[-–]\s*\d{3,5}\b/ig;
      for(const it of state.pageTextItems){
        const text=String(it.str||""); let mm;
        while((mm=refRe.exec(text))){
          const ref=normalizeDrawingRef(mm[0]);
          if(!ref)continue;
          state.drawingRefHotspots.push({ref,x:it.x,y:it.y,w:Math.max(it.w,42),h:Math.max(it.h,12)});
        }
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
        for(const sch of schedules.filter(x=>x.documentType!=="occhioSchedule"))for(const e0 of(sch.armatureIndex||[])){const e=enrichEntryWithOcchio(f.projectId,e0);const cand=normalizeProductText([e.type,e.brand,e.occhioMatch?.type].filter(Boolean).join(" "));if(!cand)continue;const a=new Set(txt.split(" ").filter(x=>x.length>=3)),b=new Set(cand.split(" ").filter(x=>x.length>=3));let c=0;for(const x of a)if(b.has(x))c++;const score=c/Math.max(2,Math.min(a.size,b.size));if(score>bestScore){bestScore=score;best=e;}}
        if(best&&bestScore>=.6)state.smartHotspots.push({tag:best.tag,entry:best,x:it.x,y:it.y,w:Math.max(it.w,24),h:Math.max(it.h,10)});
      }
    }catch(err){console.warn("Hotspot scan failed",err)}
  }

  function normalizeDrawingRef(v){
    const m=String(v||"").toUpperCase().replace(/[–—]/g,"-").replace(/\s+/g,"").match(/E-?(\d{3})-?(\d)-?(\d{3,5})/);
    return m?`E-${m[1]}-${m[2]}-${m[3]}`:"";
  }

  function findDrawingByReference(projectId,ref){
    const nr=normalizeDrawingRef(ref); if(!nr)return null;
    const p=projectById(projectId); if(!p)return null;
    const c=(p.files||[]).map(id=>fileMeta(id)).filter(Boolean).filter(f=>{
      const nums=[f.drawingNumber,f.originalName,f.name].map(normalizeDrawingRef).filter(Boolean);
      return nums.includes(nr);
    });
    if(!c.length)return null;
    c.sort((a,b)=>{
      const ar=String(a.revisionStatus||'').toLowerCase(),br=String(b.revisionStatus||'').toLowerCase();
      const ap=ar==='ny'?0:ar==='gammal'?2:1,bp=br==='ny'?0:br==='gammal'?2:1;
      if(ap!==bp)return ap-bp;
      return (b.revisionIndex||0)-(a.revisionIndex||0);
    });
    return c[0];
  }

  function nearestDrawingRefHotspot(clientX,clientY){
    if(!state.drawingRefHotspots.length)return null;
    const r=$("#overlayCanvas").getBoundingClientRect(),scale=state.renderScale*state.viewZoom;
    let best=null,bestD=Infinity;
    for(const h of state.drawingRefHotspots){
      const left=r.left+h.x*scale,top=r.top+h.y*scale,right=left+h.w*scale,bottom=top+h.h*scale;
      const nx=Math.max(left,Math.min(clientX,right)),ny=Math.max(top,Math.min(clientY,bottom));
      const d=Math.hypot(clientX-nx,clientY-ny); if(d<bestD){best=h;bestD=d}
    }
    // Ritningsnummer ska tryckas ganska exakt; undviker hopp från vanlig dubbeltryckszoom.
    return bestD<=Math.max(24,28*state.viewZoom)?best:null;
  }

  async function openDrawingReference(ref){
    const source=fileMeta(state.currentFileId); if(!source)return false;
    const target=findDrawingByReference(source.projectId,ref);
    if(!target){toast(`${ref} finns inte i projektet`);return true}
    if(target.id===state.currentFileId){toast(`${ref} är den här ritningen`);return true}
    state.drawingRefHistory.push({fileId:state.currentFileId,page:state.pageNum,viewState:captureViewState()});
    if(state.drawingRefHistory.length>12)state.drawingRefHistory.shift();
    toast(`Öppnar ${ref}`);
    await openPdf(target.id,{page:1});
    return true;
  }

  async function returnFromDrawingReference(){
    const r=state.drawingRefHistory.pop(); if(!r)return false;
    await openPdf(r.fileId,{page:r.page,viewState:r.viewState});
    return true;
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
    const refHit=nearestDrawingRefHotspot(clientX,clientY);
    if(refHit)return openDrawingReference(refHit.ref);
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
    const isText=hit?.kind==='annotation'&&hit.obj.type==='text';
    $("#textSmallerBtn").classList.toggle("hidden",!isText);$("#textLargerBtn").classList.toggle("hidden",!isText);$("#editSelectedTextBtn").classList.toggle("hidden",!isText);
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
        centerFullscreenDrawing();
      });
    }else requestAnimationFrame(centerFullscreenDrawing);
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

  function centerFullscreenDrawing(){
    const viewer=$("#viewerView"), viewport=$("#pdfViewport"), wrap=$("#canvasWrap");
    if(!viewer||!viewport||!wrap||!viewer.classList.contains("fullscreen-ui"))return;
    const rail=64, topSafe=56, bottomSafe=10;
    const w=parseFloat(wrap.style.width)||wrap.getBoundingClientRect().width, h=parseFloat(wrap.style.height)||wrap.getBoundingClientRect().height;
    const availW=Math.max(80,viewport.clientWidth-rail), availH=Math.max(80,viewport.clientHeight-topSafe-bottomSafe);
    const fits=w<=availW+1&&h<=availH+1;
    wrap.style.margin="0";wrap.style.transform="none";
    if(fits){
      // When the whole sheet fits, take it out of normal document flow and place its centre
      // in the actual usable fullscreen rectangle. This avoids historical margin/flex conflicts.
      const x=Math.max(0,(availW-w)/2), y=Math.max(topSafe,topSafe+(availH-h)/2);
      wrap.style.position="absolute";wrap.style.left=x+"px";wrap.style.top=y+"px";
      viewport.style.overflow="hidden";viewport.scrollLeft=0;viewport.scrollTop=0;
    }else{
      // Zoomed drawings stay in normal scroll flow so every edge remains reachable.
      wrap.style.position="relative";wrap.style.left="0px";wrap.style.top="0px";
      viewport.style.overflow="auto";
    }
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
      viewer.classList.remove("fullscreen-ui"); $("#canvasWrap").style.marginTop=""; $("#canvasWrap").style.marginBottom=""; return;
    }
    if(isPseudo){
      viewer.classList.remove("pseudo-fullscreen","fullscreen-ui");
      $("#canvasWrap").style.marginTop=""; $("#canvasWrap").style.marginBottom="";
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
    setTimeout(centerFullscreenDrawing,120);
  }

  function syncFullscreenUI(){
    const active=!!(document.fullscreenElement||document.webkitFullscreenElement)||$("#viewerView").classList.contains("pseudo-fullscreen");
    $("#fullscreenBtn").textContent=active?"⤢":"⛶";
    $("#viewerView").classList.toggle("fullscreen-ui",active); if(active)setTimeout(()=>{fitDrawing();centerFullscreenDrawing()},80);
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
        const dir=dx<0?1:-1;
        if(dir>0 && state.pageNum<state.pageCount){state.pageNum++;await renderPdfPage();return;}
        if(dir<0 && state.pageNum>1){state.pageNum--;await renderPdfPage();return;}
        await openAdjacentDrawing(dir); return;
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
          scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop,time:Date.now(),moved:false,longPressTimer:null,markupDrag:null
        };
        if(state.tool==="pan"){
          const ts=state.touchState;
          ts.longPressTimer=setTimeout(()=>{
            if(!state.touchState||state.touchState!==ts||ts.moved)return;
            const hit=nearestOverlayObject({clientX:ts.startX,clientY:ts.startY});
            if(hit?.kind!=="annotation")return;
            const a=hit.obj; ts.markupDrag={annotation:a,lastX:ts.startX,lastY:ts.startY};
            state.selectedOverlay=hit; a.selected=true; $("#deleteSelectedBtn").classList.remove("hidden");
            state.suppressClickUntil=Date.now()+700; drawOverlay(); toast("Flytta markeringen och släpp");
          },480);
        }
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
        if(ts.markupDrag){
          const md=ts.markupDrag, sc=state.renderScale*state.viewZoom||1;
          const ddx=(t.clientX-md.lastX)/sc, ddy=(t.clientY-md.lastY)/sc;
          md.annotation.points=(md.annotation.points||[]).map(p=>({x:p.x+ddx,y:p.y+ddy}));
          md.lastX=t.clientX;md.lastY=t.clientY;ts.moved=true;drawOverlay();return;
        }
        if(Math.abs(dx)>7||Math.abs(dy)>7){ts.moved=true;if(ts.longPressTimer){clearTimeout(ts.longPressTimer);ts.longPressTimer=null;}}

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
      if(ts.longPressTimer)clearTimeout(ts.longPressTimer);
      if(ts.mode!=="single")return;
      if(ts.markupDrag){saveMeta();drawOverlay();state.suppressClickUntil=Date.now()+500;toast("Markeringen flyttad");return;}
      const dx=ts.lastX-ts.startX,dy=ts.lastY-ts.startY,dt=Date.now()-ts.time;

      if(state.riserMode && state.tool==='pan' && dt<1100 && Math.max(Math.abs(dx),Math.abs(dy))>85){
        state.suppressClickUntil=Date.now()+400;
        if(Math.abs(dx)>Math.abs(dy)*1.15){await openAdjacentDrawing(dx<0?1:-1);return;}
        if(Math.abs(dy)>Math.abs(dx)*1.15){await openAdjacentFloor(dy<0?1:-1);return;}
      }

      if(isFullyZoomedOut() && state.tool==="pan" && dt<850 && Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.2){
        state.suppressClickUntil=Date.now()+400;
        const dir=dx<0?1:-1;
        // v5: flersidig PDF bläddras först. Ritningsbyte sker först vid dokumentets kant.
        if(dir>0 && state.pageNum<state.pageCount){state.pageNum++;state.armatureHighlight=null;await renderPdfPage();return;}
        if(dir<0 && state.pageNum>1){state.pageNum--;state.armatureHighlight=null;await renderPdfPage();return;}
        await openAdjacentDrawing(dir);
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

  function renderCounter(){
    const list=$("#counterDrawingList"); if(!list)return;
    const cat=state.counterCategory||'Belysning';
    $$('[data-counter-category]').forEach(b=>b.classList.toggle('active',b.dataset.counterCategory===cat));
    const files=(state.meta.projects||[]).flatMap(p=>(p.files||[]).map(id=>fileMeta(id))).filter(f=>f&&f.documentType!=="armatureSchedule"&&f.documentType!=="occhioSchedule"&&f.category===cat).sort(smartSortFiles);
    list.innerHTML=files.length?files.map(f=>`<label class="counter-drawing"><input type="checkbox" data-counter-file="${f.id}" ${state.counterSelected.has(f.id)?'checked':''}><span><strong>${esc(displayLabel(f))}</strong><small class="muted">${esc(projectById(f.projectId)?.name||'')} · ${f.pageCount||1} sida${(f.pageCount||1)===1?'':'or'}</small></span></label>`).join(''):`<div class="empty">Inga ${esc(cat.toLowerCase())}-ritningar.</div>`;
    list.querySelectorAll('[data-counter-file]').forEach(cb=>cb.onchange=e=>{e.target.checked?state.counterSelected.add(e.target.dataset.counterFile):state.counterSelected.delete(e.target.dataset.counterFile);renderCounterSelectionBadge()});
    renderCounterSelectionBadge();
  }

  function renderCounterSelectionBadge(){
    const status=$("#counterStatus"); if(!status)return;
    const groups=counterSelectedSummary();
    const n=[...state.counterSelected].length;
    if(!n){status.textContent='Inga ritningar markerade.';return}
    status.innerHTML=`${n} ritningar valda · `+Object.entries(groups).map(([c,fs])=>`${esc(c)} ${fs.length}`).join(' · ');
  }

  function scannerTextNodes(tc){
    return (tc.items||[]).map((it,i)=>({
      i,text:String(it.str||'').replace(/\s+/g,' ').trim(),
      x:+(it.transform?.[4]||0),y:+(it.transform?.[5]||0),
      w:Math.max(1,+it.width||0),h:Math.max(5,Math.abs(+(it.height||it.transform?.[0]||8)))
    })).filter(n=>n.text);
  }

  function scannerNormalizeApartment(text){
    const t=String(text||'').toUpperCase().replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ');
    let m=t.match(/\bB\s*[- ]?\s*(\d{3,5})\b/); return m?`B${m[1]}`:'';
  }

  function counterLocationBlocks(tc){
    const items=scannerTextNodes(tc), found=[];
    // 1) Bxxxx is strongest. Handle both one text item and split "B" + "1701".
    for(const a of items){
      const id=scannerNormalizeApartment(a.text); if(id)found.push({name:id,kind:'apartment',x:a.x+a.w/2,y:a.y,confidence:.995});
    }
    for(const a of items){
      if(!/^B[.:\-]?$/i.test(a.text))continue;
      const near=items.filter(b=>/^\d{3,5}$/.test(b.text)&&Math.abs(b.y-a.y)<Math.max(18,a.h*2.2)&&b.x>a.x-5&&b.x<a.x+110)
        .sort((u,v)=>Math.hypot(u.x-a.x,u.y-a.y)-Math.hypot(v.x-a.x,v.y-a.y))[0];
      if(near)found.push({name:`B${near.text}`,kind:'apartment',x:(a.x+near.x)/2,y:(a.y+near.y)/2,confidence:.985});
    }
    // 2) Room needs spatial evidence: RUM/ROOM + nearby number. An m² line raises confidence.
    for(const a of items){
      if(!/^(RUM|ROOM)\b/i.test(a.text))continue;
      let m=a.text.match(/^(?:RUM|ROOM)\s*[:.-]?\s*([A-Z]?\d{1,5}[A-Z]?)\b/i);
      let numNode=null, num='';
      if(m)num=m[1].toUpperCase();
      else{
        numNode=items.filter(b=>b!==a&&/^[A-Z]?\d{1,5}[A-Z]?$/i.test(b.text)&&Math.abs(b.y-a.y)<Math.max(24,a.h*3.1)&&Math.abs(b.x-a.x)<150)
          .sort((u,v)=>Math.hypot(u.x-(a.x+a.w),u.y-a.y)-Math.hypot(v.x-(a.x+a.w),v.y-a.y))[0];
        if(numNode)num=numNode.text.toUpperCase();
      }
      if(!num)continue;
      const cx=numNode?(a.x+numNode.x)/2:a.x+a.w/2, cy=numNode?(a.y+numNode.y)/2:a.y;
      const areaEvidence=items.some(c=>/(?:\d+[,.]\d+|\d+)\s*m(?:²|2)\b/i.test(c.text)&&Math.abs(c.y-cy)<65&&Math.abs(c.x-cx)<210);
      const roomNameEvidence=items.some(c=>/^(KÖK|KOK|SOV|SOVRUM|VARDAGSRUM|BAD|BADRUM|WC|HALL|ENTR[EÉ]|TEKNIK|FÖRRÅD|FORRAD|KONTOR|MÖTE|MOTE)$/i.test(c.text)&&Math.abs(c.y-cy)<90&&Math.abs(c.x-cx)<230);
      found.push({name:`Rum ${num}`,kind:'room',x:cx,y:cy,confidence:areaEvidence ? .985 : (roomNameEvidence ? .95 : .88)});
    }
    // Remove duplicates within the same label. Prefer the strongest observation.
    const uniq=new Map(); for(const x of found){const k=x.name.toUpperCase();if(!uniq.has(k)||uniq.get(k).confidence<x.confidence)uniq.set(k,x)}
    const all=[...uniq.values()];
    // If apartment IDs exist, they are the primary grouping on that page. Rooms remain as fallback metadata only.
    const apartments=all.filter(x=>x.kind==='apartment'); return apartments.length?apartments:all.filter(x=>x.kind==='room');
  }

  function counterSelectedSummary(){
    const m={};for(const id of state.counterSelected){const f=fileMeta(id);if(!f)continue;(m[f.category]||(m[f.category]=[])).push(f)}return m;
  }

  function counterRequestedTypes(){
    const on=t=>!!document.querySelector(`[data-count-type="${t}"]`)?.checked;
    return {lights:on('lights'),switches:on('switches'),outlets:on('outlets')};
  }

  function scannerToViewportAreas(blocks,viewport){
    return blocks.map(b=>{const pt=viewport.convertToViewportPoint(b.x,b.y);return {...b,px:pt[0],py:pt[1]}});
  }

  function scannerTextBoxes(tc,viewport){
    const scale=Math.hypot(viewport.transform?.[0]||1,viewport.transform?.[1]||0)||1;
    return scannerTextNodes(tc).map(n=>{const p=viewport.convertToViewportPoint(n.x,n.y);const w=Math.max(3,n.w*scale),h=Math.max(4,n.h*scale);return {x:p[0]-2,y:p[1]-h-2,w:w+4,h:h+5,text:n.text}});
  }

  function scannerPointInText(x,y,boxes){
    for(const b of boxes){if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h)return true}return false;
  }

  function scannerNearestArea(x,y,areas,w,h){
    if(!areas.length)return null;
    let best=null,bd=Infinity; for(const a of areas){const dx=x-a.px,dy=y-a.py,d=Math.hypot(dx,dy);if(d<bd){bd=d;best=a}}
    const max=Math.hypot(w,h)*.48; return bd<=max?{area:best,distance:bd,confidence:Math.max(.55,1-bd/max)}:null;
  }

  function scannerArmatureCandidates(tc,viewport,areas){
    const scale=Math.hypot(viewport.transform?.[0]||1,viewport.transform?.[1]||0)||1, out=[];
    const seen=new Set();
    for(const n of scannerTextNodes(tc)){
      const raw=splitArmatureTag(n.text)?.tag; if(!raw||!/^(?:ARM\s*\d+|L\d+[A-Z]?|N\d+[A-Z]?|K\d+[A-Z]?|BL)$/i.test(raw))continue;
      const p=viewport.convertToViewportPoint(n.x,n.y),x=p[0],y=p[1];
      // Legend/title block is the biggest source of false armature counts. Keep the drawing field only.
      if((x>viewport.width*.80)||(x>viewport.width*.70&&y>viewport.height*.70)||(y>viewport.height*.94))continue;
      const key=`${raw.toUpperCase().replace(/\s+/g,'')}:${Math.round(x/4)}:${Math.round(y/4)}`;if(seen.has(key))continue;seen.add(key);
      const near=scannerNearestArea(x,y,areas,viewport.width,viewport.height);
      out.push({type:'light',subtype:raw.toUpperCase().replace(/\s+/g,''),x,y,nx:x/Math.max(1,viewport.width),ny:y/Math.max(1,viewport.height),score:near?.area?Math.min(.97,.78+(near.confidence*.18)):.72,area:near?.area||null});
    }
    return out;
  }

  function scannerRegionDensity(mask,w,h,cx,cy,x0,y0,x1,y1,s=1){
    let hit=0,total=0; const ax=Math.round(cx+x0*s),ay=Math.round(cy+y0*s),bx=Math.round(cx+x1*s),by=Math.round(cy+y1*s);
    for(let y=Math.max(0,ay);y<=Math.min(h-1,by);y++)for(let x=Math.max(0,ax);x<=Math.min(w-1,bx);x++){total++;if(mask[y*w+x])hit++}
    return total?hit/total:0;
  }

  function scannerRotatedDensity(mask,w,h,cx,cy,rect,rot,s=1){
    const [x0,y0,x1,y1]=rect;let hit=0,total=0;const c=Math.cos(rot),sn=Math.sin(rot);
    for(let v=y0;v<=y1;v++)for(let u=x0;u<=x1;u++){
      const xx=Math.round(cx+(u*c-v*sn)*s), yy=Math.round(cy+(u*sn+v*c)*s); if(xx<0||yy<0||xx>=w||yy>=h)continue;total++;if(mask[yy*w+xx])hit++;
    }return total?hit/total:0;
  }

  function scannerClassifyAnchor(mask,w,h,cx,cy){
    let outletBest=null,switchBest=null;
    const scales=[.72,1,1.28];
    for(const sc of scales)for(let r=0;r<4;r++){
      const rot=r*Math.PI/2;
      // UTTAG: hela symbolen måste finnas samtidigt: mörk halvkopp, baslinje och kort stam.
      const cap=scannerRotatedDensity(mask,w,h,cx,cy,[-7,-7,7,-3],rot,sc);
      const base=scannerRotatedDensity(mask,w,h,cx,cy,[-9,-2,9,1],rot,sc);
      const stem=scannerRotatedDensity(mask,w,h,cx,cy,[-1,1,1,9],rot,sc);
      const lowerL=scannerRotatedDensity(mask,w,h,cx,cy,[-8,3,-3,8],rot,sc);
      const lowerR=scannerRotatedDensity(mask,w,h,cx,cy,[3,3,8,8],rot,sc);
      const emptyBelow=1-Math.min(1,(lowerL+lowerR)/2);
      const outletScore=cap*.40+base*.28+stem*.24+emptyBelow*.08;
      const outletValid=cap>.34&&base>.24&&stem>.20&&outletScore>.62;
      if(outletValid&&(!outletBest||outletScore>outletBest.score))outletBest={score:outletScore,cap,base,stem};

      // STRÖMSTÄLLARE: fylld pivot + diagonal manöverarm + ändmarkering.
      const pivot=scannerRotatedDensity(mask,w,h,cx,cy,[-3,-3,3,3],rot,sc);
      const ray=scannerRotatedDensity(mask,w,h,cx,cy,[3,-2,13,1],rot-Math.PI/4,sc);
      const endMark=scannerRotatedDensity(mask,w,h,cx,cy,[11,-4,16,4],rot-Math.PI/4,sc);
      const opposite=scannerRotatedDensity(mask,w,h,cx,cy,[-13,-2,-4,2],rot-Math.PI/4,sc);
      const switchScore=pivot*.50+ray*.32+endMark*.20-opposite*.08;
      const switchValid=pivot>.34&&ray>.18&&endMark>.12&&switchScore>.61;
      if(switchValid&&(!switchBest||switchScore>switchBest.score))switchBest={score:switchScore,pivot,ray,endMark};
    }
    const o=outletBest?.score||0,sw=switchBest?.score||0;
    // Tveksam symbol = ingen träff. Precision prioriteras framför antal.
    if(o>.64&&o>sw+.12)return {type:'outlet',score:Math.min(.99,o)};
    if(sw>.64&&sw>o+.10)return {type:'switch',score:Math.min(.98,sw)};
    return null;
  }

  function scannerNms(cands,radius=14){
    const out=[]; for(const c of cands.sort((a,b)=>b.score-a.score)){if(out.some(o=>o.type===c.type&&Math.hypot(o.x-c.x,o.y-c.y)<radius))continue;out.push(c)}return out;
  }

  function scannerExclusionZones(tc,viewport){
    const nodes=scannerTextNodes(tc), scale=Math.hypot(viewport.transform?.[0]||1,viewport.transform?.[1]||0)||1, zones=[];
    const pt=n=>{const p=viewport.convertToViewportPoint(n.x,n.y);return {x:p[0],y:p[1]}};
    // Legend is useful as semantic context, but every symbol inside it is forbidden from quantity counts.
    for(const n of nodes){
      if(!/FÖRKLARINGAR|FORKLARINGAR|SYMBOLFÖRKLARING|SYMBOLFOR[KL]{1,2}ARING/i.test(n.text))continue;
      const q=pt(n); const right=q.x>viewport.width*.52;
      zones.push({kind:'legend',x:right?Math.max(0,q.x-45):Math.max(0,q.x-25),y:Math.max(0,q.y-55),w:right?viewport.width-q.x+45:Math.min(viewport.width*.42,620*scale),h:Math.min(viewport.height-q.y+55,viewport.height*.78)});
    }
    // Title/revision blocks: never quantity-bearing.
    zones.push({kind:'title',x:viewport.width*.80,y:viewport.height*.68,w:viewport.width*.20,h:viewport.height*.32});
    return zones;
  }

  function scannerInZone(x,y,zones){return zones.some(z=>x>=z.x&&x<=z.x+z.w&&y>=z.y&&y<=z.y+z.h)}

  function scannerHatchCells(mask,w,h){
    // Detect large diagonal-hatched reference areas (other drawing parts). Small local hatching is not enough.
    const cell=28, cols=Math.ceil(w/cell), rows=Math.ceil(h/cell), raw=new Uint8Array(cols*rows);
    for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){
      let ink=0,diag=0,opp=0,total=0; const x0=cx*cell,y0=cy*cell,x1=Math.min(w-2,x0+cell),y1=Math.min(h-2,y0+cell);
      for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){const a=mask[y*w+x];ink+=a;total++; if(a&&mask[(y+1)*w+x+1])diag++; if(a&&x>0&&mask[(y+1)*w+x-1])opp++;}
      const dens=ink/Math.max(1,total), d=(diag+opp)/Math.max(1,ink);
      if(d>.42&&dens>.035&&dens<.34)raw[cy*cols+cx]=1;
    }
    // Keep only cells that belong to a sizeable vertical/2D run, avoiding furniture and tiny hatch symbols.
    const keep=new Uint8Array(raw.length);
    for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++)if(raw[cy*cols+cx]){
      let n=0;for(let yy=Math.max(0,cy-3);yy<=Math.min(rows-1,cy+3);yy++)for(let xx=Math.max(0,cx-2);xx<=Math.min(cols-1,cx+2);xx++)n+=raw[yy*cols+xx];
      if(n>=9)keep[cy*cols+cx]=1;
    }
    return {cell,cols,rows,keep};
  }
  function scannerInHatch(x,y,hatch){const cx=Math.floor(x/hatch.cell),cy=Math.floor(y/hatch.cell);return cx>=0&&cy>=0&&cx<hatch.cols&&cy<hatch.rows&&!!hatch.keep[cy*hatch.cols+cx]}

  async function scannerVisualSymbols(page,tc,areas,types){
    if(!types.outlets&&!types.switches)return [];
    const base=page.getViewport({scale:1}); const scanScale=Math.min(1.35,2600/Math.max(1,base.width));
    const viewport=page.getViewport({scale:scanScale});
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(viewport.width));canvas.height=Math.max(1,Math.round(viewport.height));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({canvasContext:ctx,viewport}).promise;
    const img=ctx.getImageData(0,0,canvas.width,canvas.height),d=img.data,w=canvas.width,h=canvas.height,mask=new Uint8Array(w*h);
    for(let i=0,j=0;i<d.length;i+=4,j++){const lum=(d[i]*3+d[i+1]*6+d[i+2])/10;mask[j]=lum<92?1:0}
    const boxes=scannerTextBoxes(tc,viewport), vpAreas=scannerToViewportAreas(areas,viewport), zones=scannerExclusionZones(tc,viewport), hatch=scannerHatchCells(mask,w,h), cand=[];
    // Dense-anchor search. Text boxes and title/legend field are suppressed before classification.
    for(let y=10;y<h-10;y+=2)for(let x=10;x<w-10;x+=2){
      if(scannerInZone(x,y,zones)||scannerInHatch(x,y,hatch)||scannerPointInText(x,y,boxes))continue;
      const core=scannerRegionDensity(mask,w,h,x,y,-3,-3,3,3,1); if(core<.16)continue;
      const cls=scannerClassifyAnchor(mask,w,h,x,y); if(!cls)continue;
      if(cls.type==='outlet'&&!types.outlets)continue;if(cls.type==='switch'&&!types.switches)continue;
      const near=scannerNearestArea(x,y,vpAreas,w,h); cand.push({...cls,x,y,nx:x/Math.max(1,w),ny:y/Math.max(1,h),area:near?.area||null,score:cls.score*(near?.area?(.90+.10*near.confidence):.86)});
    }
    canvas.width=1;canvas.height=1;
    return scannerNms(cand,10);
  }

  function scannerBucket(map,name,kind='area',confidence=.8){
    const key=(name||'Ej områdesbestämt').toUpperCase(); if(!map.has(key))map.set(key,{name:name||'Ej områdesbestämt',kind,confidence,counts:new Map(),categoryCounts:new Map(),sources:new Set(),hits:0,scoreSum:0});return map.get(key);
  }

  function scannerAddHit(map,hit,f,pageNo){
    const label=hit.area?.name||'Ej områdesbestämt', bucket=scannerBucket(map,label,hit.area?.kind||'unknown',hit.area?.confidence||.60);
    let key=hit.type==='light'?hit.subtype:(hit.type==='outlet'?'Uttag':'Strömställare');bucket.counts.set(key,(bucket.counts.get(key)||0)+1);const ck=`${key}@@${f.category||'Övrigt'}`;bucket.categoryCounts.set(ck,(bucket.categoryCounts.get(ck)||0)+1);bucket.sources.add(`${displayLabel(f)} · s${pageNo}`);bucket.hits++;bucket.scoreSum+=hit.score||.6;
  }

  function scannerAreaSort(a,b){
    const pa=/^B(\d+)/i.exec(a.name),pb=/^B(\d+)/i.exec(b.name);if(pa&&pb)return Number(pa[1])-Number(pb[1]);if(pa)return -1;if(pb)return 1;
    const ra=/RUM\s*([A-Z]?\d+)/i.exec(a.name),rb=/RUM\s*([A-Z]?\d+)/i.exec(b.name);if(ra&&rb)return String(ra[1]).localeCompare(String(rb[1]),'sv',{numeric:true});return a.name.localeCompare(b.name,'sv',{numeric:true});
  }

  function scannerResultHtml(buckets,totalCounts,groups,pages){
    const selection=Object.entries(groups).map(([c,fs])=>`<span class="counter-chip"><b>${esc(c)}</b> ${fs.length}</span>`).join('');
    const entries=[...buckets.values()].filter(b=>b.hits||b.name!=='Ej områdesbestämt').sort(scannerAreaSort);
    let outletTotal=0,switchTotal=0,armatureTotal=0;
    for(const [k,n] of totalCounts.entries()){
      if(k==='Uttag')outletTotal+=n;
      else if(k==='Strömställare')switchTotal+=n;
      else armatureTotal+=n;
    }
    const mainArea=entries.find(b=>/^B\d+/i.test(b.name))?.name||entries[0]?.name||'Alla valda';
    const hero=`<section class="counter-symbol-panel">
      <div class="counter-symbol-head"><div><small>Räknare – symboler</small><h2>${esc(mainArea)}</h2></div><span class="counter-scan-badge">${pages} sidor</span></div>
      <div class="counter-symbol-grid">
        <button class="counter-symbol-tile" data-review-area="${esc(mainArea)}" data-review-symbol="Uttag"><span class="counter-symbol-icon">◉</span><span>Uttag</span><strong>${outletTotal} st</strong></button>
        <button class="counter-symbol-tile" data-review-area="${esc(mainArea)}" data-review-symbol="Strömställare"><span class="counter-symbol-icon">⌁</span><span>Strömställare</span><strong>${switchTotal} st</strong></button>
        <div class="counter-symbol-tile static"><span class="counter-symbol-icon">✣</span><span>Armaturer</span><strong>${armatureTotal} st</strong></div>
      </div>
      <div class="counter-symbol-actions"><button type="button" id="counterShowHits">◎ Visa markeringar</button><button type="button" id="counterZoomHits">⌖ Kontrollera i ritning</button></div>
    </section>`;
    const cards=entries.map(b=>{
      const confidence=b.hits?Math.round((b.scoreSum/b.hits)*100):Math.round((b.confidence||.7)*100);
      const rows=[...b.counts.entries()].sort((a,b)=>a[0].localeCompare(b[0],'sv',{numeric:true})).map(([k,n])=>{
        const cats=[...b.categoryCounts.entries()].filter(([ck])=>ck.startsWith(k+'@@')).map(([ck,cn])=>[ck.split('@@')[1],cn]).sort((a,b)=>a[0].localeCompare(b[0],'sv'));
        const catHtml=cats.map(([cat,cn])=>`<button class="counter-source-chip" type="button" data-review-area="${esc(b.name)}" data-review-symbol="${esc(k)}" data-review-category="${esc(cat)}">${esc(cat)} ${cn}</button>`).join('');
        return `<div class="counter-result-group"><button class="counter-result-row" type="button" data-review-area="${esc(b.name)}" data-review-symbol="${esc(k)}"><span>${esc(k)}<small>Tryck för att visa träffarna i ritningen</small></span><strong>${n} st</strong></button>${catHtml?`<div class="counter-source-chips">${catHtml}</div>`:''}</div>`;
      }).join('');
      return `<article class="counter-area-card"><div class="counter-area-title"><div><h3>${esc(b.name)}</h3><small>${b.sources.size} ritningssidor</small></div><span class="counter-confidence ${confidence>=88?'good':confidence>=72?'mid':'low'}">${confidence}%</span></div><div class="counter-area-counts">${rows||'<span class="muted">Inga säkra symbolträffar.</span>'}</div></article>`;
    }).join('');
    const totals=[...totalCounts.entries()].sort((a,b)=>a[0].localeCompare(b[0],'sv',{numeric:true})).map(([k,n])=>`<div class="counter-total-row"><span>${esc(k)}</span><strong>${n} st</strong></div>`).join('');
    return `${hero}<div class="counter-selection-summary">${selection}</div><div class="counter-smart-banner"><strong>EKIS Scanner</strong><span>${Object.values(groups).reduce((n,a)=>n+a.length,0)} ritningar analyserade. Tryck på ett resultat för att se exakt vad som räknats.</span></div>${cards||'<div class="counter-card"><h3>Inga säkra områdesresultat ännu</h3><p class="muted">Scannern hittade inte tillräckligt säkra symbolträffar.</p></div>'}<div class="counter-total-card"><h3>Totalt för markerade ritningar</h3>${totals||'<p class="muted">Inga tillräckligt säkra symbolträffar ännu.</p>'}</div><div class="counter-warning"><strong>Kontrollera före beställning</strong><br>Scannern markerar sina träffar i ritningen så att du snabbt kan verifiera mängden. Legend, titelblock och skrafferade referensytor ska inte räknas.</div>`;
  }

  async function counterPreAnalyze(){
    const ids=[...state.counterSelected]; if(!ids.length){toast('Markera minst en ritning');return}
    const status=$("#counterStatus"), out=$("#counterResults"); out.innerHTML='';
    const groups=counterSelectedSummary(),types=counterRequestedTypes(), buckets=new Map(),totalCounts=new Map(); let pages=0; state.scannerSession={createdAt:Date.now(),hits:[],groups:{}};
    status.textContent=`Smart Scanner analyserar ${ids.length} ritningar…`;
    for(let fi=0;fi<ids.length;fi++){
      const id=ids[fi],f=fileMeta(id),blob=await getBlob(id);if(!f||!blob)continue;
      try{
        const doc=await pdfjsLib.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;
        for(let pg=1;pg<=doc.numPages;pg++){
          pages++;status.textContent=`Scannar ${fi+1}/${ids.length} · ${displayLabel(f)} · sida ${pg}/${doc.numPages}`;
          const page=await doc.getPage(pg),tc=await page.getTextContent(),baseVp=page.getViewport({scale:1}),areas=counterLocationBlocks(tc),vpAreas=scannerToViewportAreas(areas,baseVp);
          // Keep detected areas even before a symbol is found, so B1801 etc. is visible as scanner context.
          for(const a of areas)scannerBucket(buckets,a.name,a.kind,a.confidence).sources.add(`${displayLabel(f)} · s${pg}`);
          const hits=[];
          if(types.lights)hits.push(...scannerArmatureCandidates(tc,baseVp,vpAreas));
          try{hits.push(...await scannerVisualSymbols(page,tc,areas,types))}catch(e){console.warn('Visual scanner page failed',e)}
          for(const hit of hits){const key=hit.type==='light'?hit.subtype:(hit.type==='outlet'?'Uttag':'Strömställare');const areaName=hit.area?.name||'Ej områdesbestämt';const rec={...hit,fileId:f.id||id,page:pg,symbol:key,areaName,display:displayLabel(f),category:f.category||'Övrigt'};state.scannerSession.hits.push(rec);scannerAddHit(buckets,hit,f,pg);totalCounts.set(key,(totalCounts.get(key)||0)+1)}
          await new Promise(r=>setTimeout(r,0));
        }
        try{await doc.destroy()}catch(_e){}
      }catch(e){console.warn('Counter scan failed',e)}
    }
    status.textContent=`${ids.length} ritningar · ${pages} sidor scannade`;
    out.innerHTML=scannerResultHtml(buckets,totalCounts,groups,pages);
  }


  function scannerReviewBar(){
    let bar=document.getElementById('scannerReviewBar');
    if(bar)return bar;
    bar=document.createElement('div');bar.id='scannerReviewBar';bar.className='scanner-review-bar hidden';
    bar.innerHTML='<button type="button" id="scannerReviewPrev" aria-label="Föregående scannerträff">‹</button><div class="scanner-review-copy"><strong id="scannerReviewTitle">Scannerträffar</strong><small id="scannerReviewMeta"></small></div><button type="button" id="scannerReviewNext" aria-label="Nästa scannerträff">›</button><button type="button" id="scannerReviewClose" class="scanner-review-close" aria-label="Stäng scannerträffar">×</button>';
    document.getElementById('viewerView')?.appendChild(bar);
    bar.querySelector('#scannerReviewPrev')?.addEventListener('click',()=>scannerReviewStep(-1));
    bar.querySelector('#scannerReviewNext')?.addEventListener('click',()=>scannerReviewStep(1));
    bar.querySelector('#scannerReviewClose')?.addEventListener('click',closeScannerReview);
    return bar;
  }

  function scannerReviewMatching(areaName,symbol,category=''){
    return (state.scannerSession?.hits||[]).filter(h=>String(h.areaName)===String(areaName)&&String(h.symbol)===String(symbol)&&(!category||String(h.category)===String(category)));
  }

  async function openScannerReview(areaName,symbol,category=''){
    const hits=scannerReviewMatching(areaName,symbol,category); if(!hits.length){toast('Inga sparade scannerträffar för raden');return}
    state.scannerReview={areaName,symbol,category,hits,index:0};
    await scannerReviewShowCurrent(true);
  }

  async function scannerReviewShowCurrent(forceOpen=false){
    const r=state.scannerReview;if(!r||!r.hits.length)return;
    r.index=Math.max(0,Math.min(r.hits.length-1,r.index));const h=r.hits[r.index];
    const needsOpen=forceOpen||state.currentFileId!==h.fileId||state.pageNum!==h.page;
    if(needsOpen)await openPdf(h.fileId,{page:h.page});
    const samePage=r.hits.filter(x=>x.fileId===h.fileId&&x.page===h.page);
    state.scannerReview.pageHits=samePage;
    const bar=scannerReviewBar();bar.classList.remove('hidden');
    bar.querySelector('#scannerReviewTitle').textContent=`${r.areaName} · ${r.symbol}`;
    const pageNo=[...new Set(r.hits.map(x=>`${x.fileId}:${x.page}`))].indexOf(`${h.fileId}:${h.page}`)+1;
    const pageCount=new Set(r.hits.map(x=>`${x.fileId}:${x.page}`)).size;
    bar.querySelector('#scannerReviewMeta').textContent=`${r.hits.length} träffar · visar ${samePage.length} på denna sida · ${pageNo}/${pageCount}`;
    drawOverlay();
    const first=samePage[0];if(first&&Number.isFinite(first.nx)&&Number.isFinite(first.ny)){
      requestAnimationFrame(()=>{
        const vp=document.getElementById('pdfViewport'),wrap=document.getElementById('canvasWrap');if(!vp||!wrap)return;
        const x=first.nx*wrap.getBoundingClientRect().width,y=first.ny*wrap.getBoundingClientRect().height;
        if(wrap.getBoundingClientRect().width>vp.clientWidth||wrap.getBoundingClientRect().height>vp.clientHeight){vp.scrollTo({left:Math.max(0,x-vp.clientWidth/2),top:Math.max(0,y-vp.clientHeight/2),behavior:'smooth'})}
      });
    }
  }

  async function scannerReviewStep(dir){
    const r=state.scannerReview;if(!r)return;
    const pages=[];for(const h of r.hits){const k=`${h.fileId}:${h.page}`;if(!pages.some(x=>x.k===k))pages.push({k,fileId:h.fileId,page:h.page})}
    const cur=r.hits[r.index],ck=`${cur.fileId}:${cur.page}`;let pi=Math.max(0,pages.findIndex(x=>x.k===ck));pi=(pi+dir+pages.length)%pages.length;
    const target=pages[pi];r.index=Math.max(0,r.hits.findIndex(x=>x.fileId===target.fileId&&x.page===target.page));await scannerReviewShowCurrent(true);
  }

  function closeScannerReview(){state.scannerReview=null;document.getElementById('scannerReviewBar')?.classList.add('hidden');drawOverlay()}

  document.getElementById('counterResults')?.addEventListener('click',e=>{
    const row=e.target.closest('[data-review-area][data-review-symbol]');
    if(row){openScannerReview(row.dataset.reviewArea,row.dataset.reviewSymbol,row.dataset.reviewCategory||'');return}
    if(e.target.closest('#counterShowHits')||e.target.closest('#counterZoomHits')){
      const h=state.scannerSession?.hits?.[0];if(h)openScannerReview(h.areaName,h.symbol);else toast('Inga scannerträffar att visa');
    }
  });

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
  // Keep startup wiring resilient: removed/renamed controls must never abort the rest of the app.
  function ataNewAnnotations(){
    const base=state.ataMarkBaseIds instanceof Set?state.ataMarkBaseIds:new Set();
    return getAnnotations().filter(a=>!base.has(a.id));
  }
  function drawAtaAnnotationSnapshot(ctx,a,scale){
    const px=p=>({x:p.x*scale,y:p.y*scale});
    ctx.save();ctx.strokeStyle='#ff6a00';ctx.fillStyle='#ff6a00';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
    if(a.type==='pen'&&a.points?.length){ctx.beginPath();a.points.forEach((p,i)=>{const q=px(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke()}
    if(a.type==='arrow'&&a.points?.length>=2){const p=px(a.points[0]),q=px(a.points[1]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();const an=Math.atan2(q.y-p.y,q.x-p.x);ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-18*Math.cos(an-.5),q.y-18*Math.sin(an-.5));ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-18*Math.cos(an+.5),q.y-18*Math.sin(an+.5));ctx.stroke()}
    if(a.type==='circle'&&a.points?.length>=2){const p=px(a.points[0]),q=px(a.points[1]);ctx.beginPath();ctx.ellipse((p.x+q.x)/2,(p.y+q.y)/2,Math.max(3,Math.abs(q.x-p.x)/2),Math.max(3,Math.abs(q.y-p.y)/2),0,0,Math.PI*2);ctx.stroke()}
    if(a.type==='text'&&a.points?.length){const p=px(a.points[0]);ctx.font='bold 18px Arial,sans-serif';ctx.lineWidth=4;ctx.strokeStyle='rgba(255,255,255,.92)';ctx.strokeText(a.text||'',p.x,p.y);ctx.fillStyle='#ff6a00';ctx.fillText(a.text||'',p.x,p.y)}
    ctx.restore();
  }
  function captureAtaMarkSnapshot(annotations){
    const base=$('#pdfCanvas');if(!base||!annotations?.length)return null;
    const pts=annotations.flatMap(a=>a.points||[]);if(!pts.length)return null;
    const scale=state.renderScale;
    let minX=Math.min(...pts.map(p=>p.x*scale)),maxX=Math.max(...pts.map(p=>p.x*scale));
    let minY=Math.min(...pts.map(p=>p.y*scale)),maxY=Math.max(...pts.map(p=>p.y*scale));
    const pad=95;minX-=pad;maxX+=pad;minY-=pad;maxY+=pad;
    const minW=Math.min(620,state.baseCanvasWidth),minH=Math.min(430,state.baseCanvasHeight);
    if(maxX-minX<minW){const c=(minX+maxX)/2;minX=c-minW/2;maxX=c+minW/2}
    if(maxY-minY<minH){const c=(minY+maxY)/2;minY=c-minH/2;maxY=c+minH/2}
    minX=Math.max(0,minX);minY=Math.max(0,minY);maxX=Math.min(state.baseCanvasWidth,maxX);maxY=Math.min(state.baseCanvasHeight,maxY);
    if(maxX-minX<minW&&state.baseCanvasWidth>=minW){minX=Math.max(0,Math.min(minX,state.baseCanvasWidth-minW));maxX=minX+minW}
    if(maxY-minY<minH&&state.baseCanvasHeight>=minH){minY=Math.max(0,Math.min(minY,state.baseCanvasHeight-minH));maxY=minY+minH}
    const cropW=Math.max(1,maxX-minX),cropH=Math.max(1,maxY-minY);
    const outScale=Math.max(1,Math.min(2,1600/Math.max(cropW,cropH)));
    const out=document.createElement('canvas');out.width=Math.round(cropW*outScale);out.height=Math.round(cropH*outScale);
    const ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);
    const srcScale=base.width/state.baseCanvasWidth;
    ctx.drawImage(base,minX*srcScale,minY*srcScale,cropW*srcScale,cropH*srcScale,0,0,out.width,out.height);
    ctx.setTransform(outScale,0,0,outScale,-minX*outScale,-minY*outScale);
    annotations.forEach(a=>drawAtaAnnotationSnapshot(ctx,a,scale));
    ctx.setTransform(1,0,0,1,0,0);
    return out.toDataURL('image/jpeg',.9);
  }
  function updateAtaMarkBar(){
    let bar=$('#ataMarkBar');
    if(!bar){bar=document.createElement('div');bar.id='ataMarkBar';bar.className='ata-actions hidden';bar.innerHTML='<strong>ÄTA-markering</strong><div class="ata-mark-tools"><button class="mini-btn" data-ata-tool="pen">✎ Penna</button><button class="mini-btn" data-ata-tool="text">T Text</button><button class="mini-btn" data-ata-tool="arrow">➜ Pil</button><button class="mini-btn" data-ata-tool="circle">◯ Ring</button></div><button id="saveAtaMarkBtn" class="btn primary">Spara till ÄTA</button><button id="cancelAtaMarkBtn" class="btn">Avbryt</button>';$('#viewerView .viewer-head').after(bar);
      $('#saveAtaMarkBtn').onclick=saveAtaMark;$('#cancelAtaMarkBtn').onclick=cancelAtaMark;$$('[data-ata-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.ataTool));}
    bar.classList.toggle('hidden',!state.activeAtaMark);$$('[data-ata-tool]').forEach(b=>b.classList.toggle('active',b.dataset.ataTool===state.tool));
  }
  function returnToAta(id){showView('ataView',false);renderAtas();setTimeout(()=>document.querySelector(`[data-ata="${id}"]`)?.scrollIntoView({block:'center'}),70)}
  async function saveAtaMark(){
    const id=state.activeAtaMark,a=(state.meta.atas||[]).find(x=>x.id===id);if(!a)return;
    const annotations=ataNewAnnotations();if(!annotations.length){toast('Rita, skriv, använd pil eller ring först');return}
    const snapshot=captureAtaMarkSnapshot(annotations);if(!snapshot){toast('Kunde inte skapa ritningsbilden');return}
    a.drawing={fileId:state.currentFileId,page:state.pageNum,view:captureViewState(),annotationIds:annotations.map(x=>x.id)};
    a.drawingNote=`${displayLabel(fileMeta(state.currentFileId))}, sida ${state.pageNum}`;
    a.drawingSnapshots=a.drawingSnapshots||[];a.drawingSnapshots.push({id:uid(),dataUrl:snapshot,fileId:state.currentFileId,page:state.pageNum,createdAt:new Date().toISOString(),annotationIds:annotations.map(x=>x.id)});
    saveMeta();returnToAta(id);state.activeAtaMark=null;state.ataMarkAnnotationId=null;state.ataMarkBaseIds=null;updateAtaMarkBar();toast('Ritningsmarkeringen sparades som bild i ÄTA');
  }
  function cancelAtaMark(){
    const id=state.activeAtaMark,base=state.ataMarkBaseIds instanceof Set?state.ataMarkBaseIds:new Set();
    state.meta.annotations[pageKey()]=getAnnotations().filter(a=>base.has(a.id));saveMeta();returnToAta(id);state.activeAtaMark=null;state.ataMarkAnnotationId=null;state.ataMarkBaseIds=null;updateAtaMarkBar();
  }
  function showMeasureMagnifier(e){if(state.tool!=="distance")return;const mag=$("#measureMagnifier"),base=$("#pdfCanvas"),over=$("#overlayCanvas"),vp=$("#pdfViewport");if(!mag||!base)return;mag.classList.remove("hidden");const vr=vp.getBoundingClientRect();mag.style.left=Math.max(8,Math.min(vp.clientWidth-160,e.clientX-vr.left-75))+"px";mag.style.top=Math.max(8,e.clientY-vr.top-190)+"px";const ctx=mag.getContext("2d"),r=over.getBoundingClientRect(),sx=(e.clientX-r.left)*(over.width/r.width),sy=(e.clientY-r.top)*(over.height/r.height),crop=45;ctx.clearRect(0,0,180,180);ctx.drawImage(base,sx-crop,sy-crop,crop*2,crop*2,0,0,180,180);ctx.strokeStyle="#ff6a00";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(90,68);ctx.lineTo(90,112);ctx.moveTo(68,90);ctx.lineTo(112,90);ctx.stroke();}
  function hideMeasureMagnifier(){$("#measureMagnifier")?.classList.add("hidden")}
  $$(".nav-btn").forEach(b=>b.onclick=()=>{showView(b.dataset.view); if(b.dataset.view==="projectsView")renderProjects(); if(b.dataset.view==="drawingsView")renderAllDrawings(); if(b.dataset.view==="todoView")renderTodos(); if(b.dataset.view==="ataView")renderAtas(); if(b.dataset.view==="counterView")renderCounter()});
  $$('[data-theme-choice]').forEach(b=>b.onclick=()=>{applyTheme(b.dataset.themeChoice,true);toast(b.dataset.themeChoice==='light'?'Ljust tema aktiverat':'Mörkt tema aktiverat')});
  $("#brandBtn").onclick=()=>{renderProjects();showView("projectsView")};
  $("#newProjectBtn").onclick=async()=>{
    const name=await promptModal("Nytt projekt","Ge projektet ett namn.","Nytt projekt");
    if(!name)return; const p={id:uid(),name,files:[],createdAt:Date.now()};state.meta.projects.unshift(p);saveMeta();renderProjects();openProject(p.id);
  };
  $("#backProjectsBtn").onclick=()=>{renderProjects();showView("projectsView")};
  $("#projectMenuBtn").onclick=()=>$("#projectMenu").classList.remove("hidden"); $("#menuCloseProject").onclick=()=>$("#projectMenu").classList.add("hidden");
  $("#menuSearchProject").onclick=()=>{$("#projectMenu").classList.add("hidden");$("#projectSearchModal").classList.remove("hidden");setTimeout(()=>$("#projectSearch").focus(),40)};
  $("#projectSearchClose").onclick=()=>$("#projectSearchModal").classList.add("hidden");
  $("#menuAddPdf").onclick=()=>{$("#projectMenu").classList.add("hidden");$("#pdfInput").click()}; $("#menuAddZip").onclick=()=>{$("#projectMenu").classList.add("hidden");$("#zipInput").click()}; $("#menuExportProject").onclick=()=>{$("#projectMenu").classList.add("hidden");$("#exportProjectBtn").click()};
  const renameCurrentProject=async()=>{const p=currentProject();if(!p)return;const n=await promptModal("Byt projektnamn","",p.name);if(n){p.name=n;saveMeta();renderProject()}};
  const deleteCurrentProject=async()=>{const p=currentProject();if(p)await deleteProjectById(p.id)};
  $("#menuRenameProject").onclick=()=>{$("#projectMenu").classList.add("hidden");renameCurrentProject()};
  $("#menuDeleteProject").onclick=()=>{$("#projectMenu").classList.add("hidden");deleteCurrentProject()};
  $("#pdfInput").onchange=e=>{if(e.target.files.length)importPdfs(e.target.files);e.target.value=""};
  $("#zipInput").onchange=e=>{if(e.target.files.length)importZips(e.target.files);e.target.value=""};
  $("#projectSearch").oninput=renderProject; $("#sortSelect").onchange=renderProject; $("#drawingSearch").oninput=renderAllDrawings;
  $("#exportProjectBtn").onclick=exportProject; $("#exportBackupBtn").onclick=exportBackup; $("#backupInput").onchange=e=>{if(e.target.files[0])importBackup(e.target.files[0]);e.target.value=""};
  $('#newAtaBtn').onclick=createAta;
  $$('[data-ata-filter]').forEach(b=>b.onclick=()=>{state.ataFilter=b.dataset.ataFilter;$$('[data-ata-filter]').forEach(x=>x.classList.toggle('active',x===b));renderAtas()});
  $('#selectAllAtaBtn').onclick=()=>{const items=(state.meta.atas||[]).filter(a=>state.ataFilter==='all'||(state.ataFilter==='open'&&a.status!=='Utförd')||(state.ataFilter==='ongoing'&&a.status==='Pågående')||(state.ataFilter==='done'&&a.status==='Utförd'));items.forEach(a=>state.ataSelected.add(a.id));renderAtas()};
  $('#shareAtaBtn').onclick=shareSelectedAtas;
  window.ekisCameraPhoto=dataUrl=>{
    const a=(state.meta.atas||[]).find(x=>x.id===state.ataPhotoTarget);
    if(!a||!dataUrl)return;
    a.photos=a.photos||[];a.photos.push(dataUrl);saveMeta();renderAtas();toast('Fotot lades till i ÄTA');
    state.ataPhotoTarget=null;
  };
  window.ekisCameraCancelled=()=>{state.ataPhotoTarget=null};

  $('#ataCameraInput').onchange=e=>{const a=(state.meta.atas||[]).find(x=>x.id===state.ataPhotoTarget);if(!a)return;const f=e.target.files?.[0];if(f){const r=new FileReader();r.onload=()=>{a.photos=a.photos||[];a.photos.push(r.result);saveMeta();renderAtas();toast('Fotot lades till i ÄTA')};r.readAsDataURL(f)}e.target.value=''};
  $('#ataPhotoInput').onchange=e=>{const a=(state.meta.atas||[]).find(x=>x.id===state.ataPhotoTarget);if(!a)return;for(const f of [...e.target.files].slice(0,5)){const r=new FileReader();r.onload=()=>{a.photos=a.photos||[];a.photos.push(r.result);saveMeta();renderAtas()};r.readAsDataURL(f)}e.target.value=''};
  function selectedText(){const h=state.selectedOverlay;return h?.kind==='annotation'&&h.obj.type==='text'?h.obj:null}
  $('#textSmallerBtn').onclick=()=>{const a=selectedText();if(!a)return;a.fontSize=Math.max(10,(Number(a.fontSize)||16)-2);saveMeta();drawOverlay()};
  $('#textLargerBtn').onclick=()=>{const a=selectedText();if(!a)return;a.fontSize=Math.min(48,(Number(a.fontSize)||16)+2);saveMeta();drawOverlay()};
  $('#editSelectedTextBtn').onclick=()=>{const a=selectedText();if(!a)return;const r=$('#overlayCanvas').getBoundingClientRect(),sc=state.renderScale*state.viewZoom,p=a.points[0];openDirectTextEditor(r.left+p.x*sc,r.top+p.y*sc,p,a)};
  $('#deleteSelectedBtn').onclick=async()=>{const h=state.selectedOverlay;if(!h)return;if(!await confirmDelete('Ta bort från ritning?','Vill du verkligen ta bort den markerade mätningen/markeringen?'))return;if(h.kind==='measure'){const arr=getMeasurements(),i=arr.findIndex(x=>x.id===h.obj.id);if(i>=0)arr.splice(i,1)}else{const arr=getAnnotations(),i=arr.findIndex(x=>x.id===h.obj.id);if(i>=0)arr.splice(i,1)}state.selectedOverlay=null;$('#deleteSelectedBtn').classList.add('hidden');$('#textSmallerBtn').classList.add('hidden');$('#textLargerBtn').classList.add('hidden');$('#editSelectedTextBtn').classList.add('hidden');saveMeta();drawOverlay()};
  $('#riserBtn').onclick=()=>setRiserMode(!state.riserMode);
  $('#riserUpBtn').onclick=()=>openAdjacentFloor(1);
  $('#riserDownBtn').onclick=()=>openAdjacentFloor(-1);
  $("#newTodoBtn").onclick=async()=>{const t=await promptModal("Ny uppgift","Vad ska göras?","");if(!t)return;const pr=await promptModal("Prioritet","Skriv Normal, Viktig eller Akut.","Normal");const due=await promptModal("Deadline","Datum YYYY-MM-DD, eller lämna tomt.","");state.meta.todos.unshift({id:uid(),text:t,done:false,priority:["Normal","Viktig","Akut"].find(x=>x.toLowerCase()===String(pr||"").toLowerCase())||"Normal",due:/^\d{4}-\d{2}-\d{2}$/.test(due||"")?due:"",projectId:state.currentProjectId||null});saveMeta();renderTodos()};
  $$("[data-todo-filter]").forEach(b=>b.onclick=()=>{state.todoFilter=b.dataset.todoFilter;$$('[data-todo-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTodos()});
  $("#backFilesBtn").onclick=async()=>{if(await returnFromDrawingReference())return;const f=fileMeta(state.currentFileId); state.armatureReturn=null; state.armatureHighlight=null; if(f){state.currentProjectId=f.projectId;renderProject();showView("projectView",false)}else showView("projectsView")};
  $("#backToDrawingBtn").onclick=returnToArmatureSource;
  $("#closeArmatureSheet").onclick=closeArmatureCard;
  $("#armatureSheet").onclick=e=>{if(e.target===$("#armatureSheet"))closeArmatureCard()};
  $("#linkOcchioBtn").onclick=async()=>{const e=state.activeArmatureEntry;if(!e){toast("Öppna först en armatur");return}const occ=findArmatureSchedules(fileMeta(state.currentFileId)?.projectId||state.currentProjectId).filter(x=>x.documentType==="occhioSchedule").flatMap(x=>x.armatureIndex||[]);if(!occ.length){toast("Ingen Occhio-förteckning hittad i projektet");return}const hint=occ.map(x=>`${x.tag}: ${x.type||''}`).join(" | ").slice(0,1200);const v=await promptModal("Koppla Occhio-position",hint,"POS 01");if(!v)return;const projectId=fileMeta(state.currentFileId)?.projectId||state.currentProjectId;state.meta.occhioLinks=state.meta.occhioLinks||{};state.meta.occhioLinks[projectId]=state.meta.occhioLinks[projectId]||{};state.meta.occhioLinks[projectId][cleanTag(e.tag)]=cleanTag(v);saveMeta();toast("Occhio-koppling sparad");$("#armatureSheet").classList.add("hidden")};
  $("#showArmaturePdfBtn").onclick=openSelectedArmatureInPdf;
  $("#renameDrawingBtn").onclick=()=>renameFile(state.currentFileId);
  $("#prevDrawingBtn").onclick=()=>openAdjacentDrawing(-1);
  $("#nextDrawingBtn").onclick=()=>openAdjacentDrawing(1);
  $("#floatingPrevDrawing").onclick=()=>openAdjacentDrawing(-1);
  $("#floatingNextDrawing").onclick=()=>openAdjacentDrawing(1);
  $$(`[data-counter-category]`).forEach(b=>b.onclick=()=>{state.counterCategory=b.dataset.counterCategory;renderCounter();});
  $("#runCounterBtn").onclick=counterPreAnalyze;
  $("#counterSelectAllBtn").onclick=()=>{const boxes=$$("[data-counter-file]");const all=boxes.length&&boxes.every(x=>x.checked);boxes.forEach(x=>{x.checked=!all;!all?state.counterSelected.add(x.dataset.counterFile):state.counterSelected.delete(x.dataset.counterFile)});};
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

  applyTheme(state.meta.theme||'dark',false);
  installViewerGestures();
  renderProjects(); renderAllDrawings(); renderTodos();
})();
