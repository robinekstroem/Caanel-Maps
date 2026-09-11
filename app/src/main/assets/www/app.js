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
    lastTapAt: 0, chromeTapTimer: null,
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
    crewFilter: null,
    editMeasure: null,
    distanceDraft: null, distanceFirstDraft: null, cableRun: null,
    pageTextItems: [],
    calibrationMode: null,
    ataFilter: "open", ataSelected: new Set(), ataPhotoTarget: null, activeAtaMark:null, ataMarkAnnotationId:null, ataMarkBaseIds:null, riserMode:false, selectedOverlay:null, drawDraft:null, counterSelected:new Set(), counterCategory:"Belysning", ataEditingId:null, ataHoursEditingId:null, scannerSession:null, scannerReview:null
  };

  function defaultMeta() {
    return { projects: [], todos: [], atas: [], crew: [], fileMeta: {}, measurements: {}, annotations: {}, theme: "dark", version: 6 };
  }
  function loadMeta() {
    try { return {...defaultMeta(), ...JSON.parse(localStorage.getItem(META_KEY) || "{}")}; }
    catch { return defaultMeta(); }
  }
  function saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(state.meta));
  }
  const THEMES={dark:"#0b0b0c",light:"#eef1f6",neon:"#050b06",sky:"#03101f",jul:"#08130e",cyber:"#07030f",aurora:"#02060f",amp:"#16161a"};
  function applyTheme(theme, persist=false){
    const next=THEMES[theme]?theme:"dark";
    state.meta.theme=next;
    document.documentElement.dataset.theme=next;
    const metaTheme=document.querySelector('meta[name="theme-color"]');
    if(metaTheme)metaTheme.setAttribute("content",THEMES[next]);
    document.querySelectorAll('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===next));
    // Markings drawn on the canvas are painted in JS, so they have to be told
    // about the theme change explicitly — otherwise measurements and annotations
    // would stay orange on the green theme.
    accentColor.cache=null;
    if(typeof drawOverlay==="function"&&state.currentFileId)try{drawOverlay()}catch{}
    try{applyEffects()}catch{}
    // A custom accent has to be re-stated after a theme switch: the theme sets
    // --orange from the stylesheet, and the user's colour is an inline override
    // that must sit on top of whatever the new theme just put there.
    try{applyAccent(state.meta.accent??null,false)}catch{}
    if(persist)saveMeta();
  }
  // Custom accent colour. hue is 0-360, or null to fall back to the theme's own
  // colour. Written as inline custom properties on :root so every existing
  // var(--orange) rule — all 108 of them — follows without being touched.
  // Relative luminance of hsl(h 100% 55%), used to choose readable label text.
  function accentIsLight(h){
    const c=.9, x=c*(1-Math.abs(((h/60)%2)-1)), m=.55-c/2;
    const seg=Math.floor(h/60)%6;
    const rgb=[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][seg].map(v=>v+m);
    const lin=rgb.map(v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4));
    return (.2126*lin[0]+.7152*lin[1]+.0722*lin[2])>.42;
  }
  function applyAccent(hue,persist=false){
    const root=document.documentElement;
    if(hue===null||hue===undefined||hue===""){
      state.meta.accent=null;
      delete root.dataset.accent;
      root.style.removeProperty("--orange");
      root.style.removeProperty("--orange2");
      root.style.removeProperty("--dark-glow");
      root.style.removeProperty("--on-accent");
    }else{
      const h=((+hue%360)+360)%360;
      state.meta.accent=h;
      root.dataset.accent="custom";
      root.style.setProperty("--orange",`hsl(${h} 100% 55%)`);
      root.style.setProperty("--orange2",`hsl(${h} 100% 67%)`);
      root.style.setProperty("--dark-glow",`0 0 15px hsl(${h} 100% 55% / .32)`);
      // Label colour has to follow the hue: yellow and cyan need dark text,
      // deep blue and violet need white, and picking one for all of them
      // leaves the button unreadable across half the slider.
      root.style.setProperty("--on-accent",accentIsLight(h)?"#12060a":"#ffffff");
    }
    const sl=document.getElementById("accentSlider");
    if(sl&&state.meta.accent!==null&&sl.value!=String(state.meta.accent))sl.value=state.meta.accent;
    accentColor.cache=null;
    if(typeof drawOverlay==="function"&&state.currentFileId)try{drawOverlay()}catch{}
    if(persist)saveMeta();
  }
  // Accent used for canvas drawing, read from the active theme's CSS variable.
  function accentColor(){
    if(!accentColor.cache){
      const v=getComputedStyle(document.documentElement).getPropertyValue("--orange").trim();
      accentColor.cache=v||"#ff6a00";
    }
    return accentColor.cache;
  }
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmtBytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
  const projectById = id => state.meta.projects.find(p => p.id === id);
  const currentProject = () => projectById(state.currentProjectId);
  const fileMeta = id => state.meta.fileMeta[id];


  const ANALYSIS_VERSION = 8;
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
    // Drawings that use an Occhio product overview label their fixtures
    // "<position>.<instance>" — e.g. 3.1 and 3.2 are the first and second unit
    // of position 03. Plain "POS 03" never appears on the drawing, which is why
    // tapping these fixtures previously did nothing at all. The dotted form is
    // specific enough to be safe: it occurs on the Occhio drawings and on no
    // other sheet in the project, unlike bare digits (room numbers, dimensions,
    // reference bubbles) which are far too common to match on.
    // Must be the WHOLE label, not a number embedded in other text: room areas
    // are written "A: 3.7 m2" and would otherwise be read as position 03.
    const dotted=t.trim().match(/^(\d{1,2})\.(\d{1,2})$/);
    if(dotted)out.push(`POS ${String(Number(dotted[1])).padStart(2,"0")}`);
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

  function titleBlockDrawingNumber(pages,originalName=""){
    const re=/\bE[-–]\d{3}[-–]\d[-–]\d{3,5}\b/i;
    let best=null,bestScore=-1;
    for(const pg of (pages||[])){
      const vw=Math.max(1,pg.viewport?.width||1), vh=Math.max(1,pg.viewport?.height||1);
      for(const it of (pg.items||[])){
        const m=String(it.str||'').match(re); if(!m)continue;
        const nx=(it.x||0)/vw, ny=(it.y||0)/vh;
        let score=nx*1.35+(1-ny)*1.15;
        if(nx>.62)score+=.55;if(ny<.38)score+=.55;
        if(score>bestScore){bestScore=score;best=m[0]}
      }
    }
    if(best&&bestScore>1.15)return normalizeDrawingRef(best);
    const fn=stripPdf(originalName).match(/E[-–]\d{3}[-–]\d[-–]\d{3,5}/i)?.[0]||'';
    return normalizeDrawingRef(fn);
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
          const earlyNo=titleBlockDrawingNumber(pages,originalName);
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
      const drawingNumber=titleBlockDrawingNumber(pages,originalName);
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
    // Pause the snow while a drawing is open so panning and zooming a PDF never
    // competes with decoration for frames.
    document.body.classList.toggle("in-viewer", id==="viewerView");
    try{ id==="viewerView"?snow.stop():snow.sync(); }catch{}
    if(nav) $$(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.view===id));
    window.scrollTo({top:0,behavior:"instant"});
  }

  // Dialogs and toasts live outside #viewerView, so in fullscreen they were
  // unreachable: in NATIVE fullscreen only the fullscreen element and its
  // descendants paint at all (the dialog opened invisibly — tapping delete or
  // the text tool appeared to do nothing), and in the pseudo-fullscreen
  // fallback the viewer's z-index:999 covered the dialog's z-index:100.
  // Re-parenting them into whatever element is currently fullscreen fixes both.
  function fullscreenHost(){
    return document.fullscreenElement||document.webkitFullscreenElement||
           (document.querySelector(".viewer-view.pseudo-fullscreen"))||null;
  }
  function hoistOverlays(){
    const host=fullscreenHost()||document.body;
    for(const id of ["modal","toast"]){
      const el=document.getElementById(id);
      if(el&&el.parentNode!==host)host.appendChild(el);
    }
  }

  function toast(msg) {
    hoistOverlays();
    const el=$("#toast"); el.textContent=msg; el.classList.remove("hidden");
    clearTimeout(el._t); el._t=setTimeout(()=>el.classList.add("hidden"),2400);
  }

  function promptModal(title, text, value="", type="text") {
    return new Promise(resolve=>{
      $("#modalTitle").textContent=title; $("#modalText").textContent=text || "";
      const input=$("#modalInput"); input.type=type; input.value=value; hoistOverlays(); $("#modal").classList.remove("hidden");
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
      hoistOverlays(); $("#modal").classList.remove("hidden");
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
    saveMeta(); renderProjects(); renderAllDrawings(); renderCrew(); renderTodos(); renderAtas(); showView('projectsView'); toast('Projektet togs bort');
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

  // Montörer på jobbet. Bara namn — listan är ledande montörens egen
  // planering på den här enheten, inte konton. Uppgifter pekar på id, så ett
  // namnbyte slår igenom överallt utan att någon punkt tappar sin montör.
  const crewList = () => state.meta.crew || (state.meta.crew = []);
  const crewById = id => crewList().find(m => m.id === id);

  function renderCrew(){
    const el=$("#crewFilters"); if(!el)return;
    const crew=crewList();
    el.innerHTML=
      `<button class="todo-filter ${state.crewFilter===null?"active":""}" data-crew-pick="">Alla</button>`+
      crew.map(m=>{
        const open=(state.meta.todos||[]).filter(t=>t.assignee===m.id&&!t.done).length;
        return `<button class="todo-filter ${state.crewFilter===m.id?"active":""}" data-crew-pick="${m.id}">${esc(m.name)}${open?`<b class="crew-count">${open}</b>`:""}<span class="crew-x" data-crew-del="${m.id}" role="button" aria-label="Ta bort montör">×</span></button>`;
      }).join("")+
      `<button class="todo-filter crew-add" data-crew-add="1">+ Montör</button>`;

    el.querySelectorAll("[data-crew-pick]").forEach(b=>b.onclick=e=>{
      if(e.target.closest("[data-crew-del]"))return;
      state.crewFilter=b.dataset.crewPick||null; renderCrew(); renderTodos();
    });
    el.querySelectorAll("[data-crew-del]").forEach(x=>x.onclick=async e=>{
      e.stopPropagation();
      const m=crewById(x.dataset.crewDel); if(!m)return;
      const open=(state.meta.todos||[]).filter(t=>t.assignee===m.id).length;
      if(!await confirmDelete("Ta bort montör?",`${m.name} tas bort. ${open?`${open} uppgift(er) blir kvar men utan montör.`:"Inga uppgifter påverkas."}`))return;
      // Uppgifterna behålls medvetet — de är utfört arbete som ska planeras om,
      // inte något som ska försvinna för att en montör lämnar jobbet.
      (state.meta.todos||[]).forEach(t=>{if(t.assignee===m.id)t.assignee=null});
      state.meta.crew=crew.filter(c=>c.id!==m.id);
      if(state.crewFilter===m.id)state.crewFilter=null;
      saveMeta(); renderCrew(); renderTodos(); toast("Montören togs bort");
    });
    const add=el.querySelector("[data-crew-add]");
    if(add)add.onclick=async()=>{
      const name=await promptModal("Ny montör","Vad heter montören?","");
      if(!name||!name.trim())return;
      const m={id:uid(),name:name.trim()};
      crewList().push(m); state.crewFilter=m.id;
      saveMeta(); renderCrew(); renderTodos(); toast(`${m.name} tillagd`);
    };
  }

  async function pickAssignee(current){
    const crew=crewList();
    if(!crew.length){toast("Lägg till en montör först");return undefined}
    const menu=crew.map((m,i)=>`${i+1}. ${m.name}`).join("\n");
    const cur=current?crewById(current):null;
    const ans=await promptModal("Montör",`Skriv siffran för montören, eller 0 för ingen.\n${menu}`,cur?String(crew.indexOf(cur)+1):"");
    if(ans===null)return undefined;
    const n=parseInt(String(ans).trim(),10);
    if(n===0)return null;
    return crew[n-1]?crew[n-1].id:undefined;
  }

  // "Klar 14:32" säger mer än ett ISO-datum när man står på bygget och ska
  // stämma av dagens arbete. Äldre punkter får datum i stället för klockslag.
  function doneLabel(iso){
    if(!iso)return "Klar";
    const d=new Date(iso); if(isNaN(d))return "Klar";
    const now=new Date();
    const day=x=>`${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    const hhmm=`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    if(day(d)===day(now))return `Klar ${hhmm}`;
    const igar=new Date(now); igar.setDate(now.getDate()-1);
    if(day(d)===day(igar))return `Klar igår ${hhmm}`;
    const man=["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];
    return `Klar ${d.getDate()} ${man[d.getMonth()]}`;
  }

  function renderTodos(){
    const list=$("#todoList"); const today=new Date().toISOString().slice(0,10);
    let items=[...state.meta.todos];
    if(state.todoFilter==="open")items=items.filter(t=>!t.done);
    if(state.todoFilter==="today")items=items.filter(t=>!t.done && t.due===today);
    if(state.todoFilter==="done"){
      items=items.filter(t=>t.done);
      // Senast avbockat överst: kvittensen läses bakåt i tiden, inte i den
      // ordning punkterna en gång skrevs in. Punkter avbockade före den här
      // versionen saknar doneAt och hamnar sist.
      items.sort((a,b)=>String(b.doneAt||"").localeCompare(String(a.doneAt||"")));
    }
    if(state.crewFilter)items=items.filter(t=>t.assignee===state.crewFilter);
    if(!items.length){list.innerHTML='<div class="empty">Inga punkter här.</div>';return}
    list.innerHTML=items.map(t=>{const p=projectById(t.projectId);return `<div class="todo-row ${t.done?"done":""}" data-todo="${t.id}"><input type="checkbox" ${t.done?"checked":""}><div class="todo-text"><strong>${esc(t.text)}</strong><div class="todo-meta"><span class="prio ${esc((t.priority||"Normal").toLowerCase())}">${esc(t.priority||"Normal")}</span>${t.due?`<span><svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/></svg> ${esc(t.due)}</span>`:""}${p?`<span>▦ ${esc(p.name)}</span>`:""}${t.done?`<span class="todo-done-at">✓ ${esc(doneLabel(t.doneAt))}</span>`:""}${(()=>{const m=t.assignee?crewById(t.assignee):null;return `<span class="todo-who" data-assign="${t.id}">${m?"👷 "+esc(m.name):"+ montör"}</span>`})()}</div></div><button class="row-btn">×</button></div>`}).join("");
    list.querySelectorAll("[data-todo]").forEach(row=>{const id=row.dataset.todo,t=state.meta.todos.find(x=>x.id===id);row.querySelector("input").onchange=e=>{t.done=e.target.checked;t.doneAt=t.done?new Date().toISOString():null;saveMeta();renderCrew();renderTodos()};const who=row.querySelector("[data-assign]");if(who)who.onclick=async e=>{e.stopPropagation();const a=await pickAssignee(t.assignee);if(a===undefined)return;t.assignee=a;saveMeta();renderCrew();renderTodos()};row.querySelector("button").onclick=async()=>{if(!await confirmDelete("Ta bort uppgift?",`Vill du verkligen ta bort “${t.text}”?`))return;state.meta.todos=state.meta.todos.filter(x=>x.id!==id);saveMeta();renderTodos()}});
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
      const body=editing?`<div class="ata-inline-edit"><label>Titel<input class="ata-inline-title" value="${esc(a.title||'')}"></label><label>Info ÄTA<textarea class="ata-inline-info" rows="5">${esc(a.description||'')}</textarea></label><div class="ata-inline-grid"><label>Datum<input class="ata-inline-date" type="date" value="${esc(a.date||'')}"></label><label>Est. timmar<input class="ata-inline-est" type="number" step="0.5" min="0" value="${Number(a.estimate||0)}"></label></div><div class="ata-inline-actions"><button class="btn primary ata-inline-save">Spara</button><button class="btn ata-inline-cancel">Avbryt</button></div></div>`:`<strong class="ata-title-direct" title="Tryck för att redigera">${esc(a.title)}</strong><div class="ata-meta"><span class="ata-status ${a.status==='Utförd'?'done':''}">${esc(a.status)}</span><span><svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/></svg> ${esc(a.date||'')}</span><span><svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l3 1.8"/></svg> ${ataHours(a).toFixed(1)} h${a.estimate?` / est. ${Number(a.estimate).toFixed(1)} h`:''}</span>${p?`<span>▦ ${esc(p.name)}</span>`:''}</div>${a.description?`<p class="muted ata-info-direct" title="Tryck för att redigera" style="margin-top:7px">${esc(a.description)}</p>`:'<p class="muted ata-info-direct" style="margin-top:7px">+ Lägg till info</p>'}`;
      const hours=hourEdit?`<div class="ata-hours-inline"><input class="ata-hours-value" type="number" min="0.1" step="0.25" placeholder="Timmar"><input class="ata-hours-date" type="date" value="${new Date().toISOString().slice(0,10)}"><input class="ata-hours-note" placeholder="Beskrivning"><button class="mini-btn ata-hours-save">Spara</button><button class="mini-btn ata-hours-cancel">Avbryt</button></div>`:'';
      return `<div class="ata-card ${a.status==='Utförd'?'done':''}" data-ata="${a.id}"><div class="ata-top"><input class="ata-select" type="checkbox" ${state.ataSelected.has(a.id)?'checked':''}><div class="ata-main"><div class="ata-num">${esc(a.number)}</div>${body}${a.drawingNote?`<p class="muted" style="margin-top:5px"><svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s6.5-6.1 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 14.9 12 21 12 21z"/><circle cx="12" cy="10.4" r="2.3"/></svg> ${esc(a.drawingNote)}</p>`:''}${(a.sessions||[]).length?`<div class="ata-sessions">${a.sessions.map((x,i)=>`<div class="ata-session"><span>${esc(x.date||'')} · <b>${Number(x.hours||0).toFixed(1)} h</b>${x.note?` · ${esc(x.note)}`:''}</span><button class="mini-btn ata-session-del" data-session="${i}">✕</button></div>`).join('')}</div>`:''}${hours}<div class="ata-photos">${(a.photos||[]).map((x,i)=>`<span class="ata-photo-wrap"><img src="${x}" alt="ÄTA-bild"><button class="ata-photo-del" data-photo="${i}">✕</button></span>`).join('')}</div></div></div>${editing?'':`<div class="ata-card-actions"><button class="mini-btn ata-edit-btn"><svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/></svg> Redigera</button><button class="mini-btn ata-status-btn">${a.status==='Utförd'?'↺ Öppna':'<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 10 18 19.5 6.5"/></svg> Utförd'}</button><button class="mini-btn ata-hours-btn"><svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg> Timmar</button><button class="mini-btn ata-camera-btn"><svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5h3.2l1.4-2.2h7.8l1.4 2.2h3.2v11H3.5z"/><circle cx="12" cy="14" r="3.6"/></svg> Ta foto</button><button class="mini-btn ata-photo-btn">🖼 Galleri</button><button class="mini-btn ata-mark-btn">⌖ Markera på ritning</button><button class="mini-btn ata-delete-btn">✕</button></div>`}</div>`}).join('');
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
    const items=(state.meta.atas||[]).filter(a=>state.ataSelected.has(a.id));
    if(!items.length){toast('Välj minst en ÄTA');return}
    if(!window.jspdf?.jsPDF){toast('PDF-modulen saknas');return}
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({unit:'mm',format:'a4',orientation:'portrait'});
    const W=210,H=297,M=14,CW=W-M*2,orange=[255,106,0],dark=[20,20,22],muted=[95,95,100];
    const addHeader=(a,p,pageNo,totalHint='')=>{
      doc.setTextColor(...dark);doc.setFont('helvetica','bold');doc.setFontSize(17);doc.text('EKIS',M,15);
      doc.setTextColor(...orange);doc.text('FIELD',M+27,15);
      doc.setTextColor(...dark);doc.setFontSize(12);doc.text('ÄTA / AVVIKELSE',W-M,14,{align:'right'});
      doc.setFontSize(8);doc.setFont('helvetica','normal');doc.text(a.number||'',W-M,19,{align:'right'});
      doc.setDrawColor(...orange);doc.setLineWidth(.45);doc.line(M,23,W-M,23);
      doc.setTextColor(...muted);doc.setFontSize(7.5);doc.text(`EKIS FIELD  |  ${p?.name||'Projekt'}  |  ${a.number||''}`,M,H-8);
      doc.text(`${a.date||''}   Sida ${pageNo}${totalHint}`,W-M,H-8,{align:'right'});
    };
    const addImageFit=async(dataUrl,x,y,maxW,maxH)=>{
      const size=await imageSize(dataUrl);if(!size)return 0;
      const r=Math.min(maxW/size.w,maxH/size.h),w=size.w*r,h=size.h*r;
      try{doc.addImage(dataUrl,'JPEG',x+(maxW-w)/2,y,w,h,undefined,'FAST')}catch(e){try{doc.addImage(dataUrl,'PNG',x+(maxW-w)/2,y,w,h,undefined,'FAST')}catch(_){return 0}}
      return h;
    };
    let firstDocPage=true;
    for(const a of items){
      const p=projectById(a.projectId); const f=a.drawing?.fileId?fileMeta(a.drawing.fileId):null;
      const snaps=(a.drawingSnapshots||[]).map(x=>x?.dataUrl||x).filter(Boolean), photos=(a.photos||[]).filter(Boolean), sessions=a.sessions||[];
      if(!firstDocPage)doc.addPage(); firstDocPage=false;
      addHeader(a,p,1);
      let y=31;
      doc.setTextColor(...dark);doc.setFont('helvetica','bold');doc.setFontSize(16);doc.text(a.title||'ÄTA / Avvikelse',M,y);y+=8;
      doc.setFillColor(247,247,248);doc.roundedRect(M,y,CW,24,2,2,'F');
      doc.setFontSize(8);doc.setTextColor(...muted);doc.setFont('helvetica','normal');
      const col=[M+4,M+50,M+96,M+140];
      doc.text('PROJEKT',col[0],y+6);doc.text('RITNING',col[1],y+6);doc.text('DATUM',col[2],y+6);doc.text('STATUS',col[3],y+6);
      doc.setTextColor(...dark);doc.setFont('helvetica','bold');doc.setFontSize(9);
      doc.text(p?.name||'-',col[0],y+13);doc.text(f?.drawingNumber||f?.displayName||'-',col[1],y+13);doc.text(a.date||'-',col[2],y+13);
      doc.setTextColor(...orange);doc.text(a.status||'-',col[3],y+13);y+=31;
      if(a.description){doc.setTextColor(...dark);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('Beskrivning',M,y);y+=5;doc.setFont('helvetica','normal');doc.setFontSize(9);const lines=doc.splitTextToSize(a.description,CW);doc.text(lines,M,y);y+=lines.length*4.2+5;}
      if(snaps.length){doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('Markerad ritning',M,y);y+=5;const maxH=Math.max(70,235-y);const h=await addImageFit(snaps[snaps.length-1],M,y,CW,maxH);y+=h+4;doc.setTextColor(...muted);doc.setFont('helvetica','italic');doc.setFontSize(7.5);doc.text(`Markerad ändring${f?.drawingNumber?' på '+f.drawingNumber:''}`,M,y);}
      else{doc.setDrawColor(220);doc.rect(M,y,CW,82);doc.setTextColor(...muted);doc.setFontSize(9);doc.text('Ingen ritningsmarkering sparad i denna ÄTA.',W/2,y+42,{align:'center'});}
      if(photos.length){
        doc.addPage();addHeader(a,p,2);doc.setTextColor(...dark);doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('Fotodokumentation',M,34);
        const gap=7,cellW=(CW-gap)/2,cellH=92;let py=43;
        for(let i=0;i<photos.length;i++){if(i>0&&i%4===0){doc.addPage();addHeader(a,p,2+Math.floor(i/4));py=34;doc.setFontSize(15);doc.text('Fotodokumentation',M,py);py=43}const coln=i%2,row=Math.floor((i%4)/2),x=M+coln*(cellW+gap),yy=py+row*112;await addImageFit(photos[i],x,yy,cellW,88);doc.setTextColor(...dark);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text(`Foto ${i+1}`,x,yy+94);doc.setFont('helvetica','normal');doc.setTextColor(...muted);doc.text(a.date||'',x,yy+99);}
      }
      if(sessions.length||a.estimate){
        doc.addPage();addHeader(a,p,photos.length?3:2);doc.setTextColor(...dark);doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('Tidsredovisning',M,34);
        let ty=43;doc.setFillColor(242,242,243);doc.rect(M,ty,CW,9,'F');doc.setFontSize(8);doc.text('Datum',M+3,ty+6);doc.text('Arbete',M+38,ty+6);doc.text('Tid (h)',W-M-22,ty+6);ty+=9;
        doc.setFont('helvetica','normal');for(const x of sessions){doc.setDrawColor(225);doc.line(M,ty+9,W-M,ty+9);doc.setTextColor(...dark);doc.text(x.date||'-',M+3,ty+6);doc.text(doc.splitTextToSize(x.note||'Arbete',105)[0],M+38,ty+6);doc.text(Number(x.hours||0).toFixed(1).replace('.',','),W-M-22,ty+6);ty+=10;}
        doc.setFont('helvetica','bold');doc.text('Totalt',M+38,ty+7);doc.text(ataHours(a).toFixed(1).replace('.',','),W-M-22,ty+7);ty+=18;
        doc.setFontSize(10);doc.text(`Bedömd tid: ${Number(a.estimate||0).toFixed(1).replace('.',',')} h`,M,ty);doc.text(`Utfall: ${ataHours(a).toFixed(1).replace('.',',')} h`,M+65,ty);
      }
    }
    const data=doc.output('datauristring');const name=`EKIS_FIELD_ATA_${new Date().toISOString().slice(0,10)}.pdf`;
    if(window.Android?.shareBase64)Android.shareBase64(name,data,'application/pdf');else downloadBlob(doc.output('blob'),name);
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
    syncScaleUI(); state.tempPoints=[]; state.cableRun=null; drawOverlay(); updateHint(); setTimeout(centerFullscreenDrawing,60);
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
    state.tool=tool; state.tempPoints=[]; state.distanceDraft=null; state.distanceFirstDraft=null;
    if(tool!=='cable')state.cableRun=null;
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
      pen:"Rita direkt på ritningen. Markeringen sparas automatiskt.",text:"Tryck där texten ska ligga.",arrow:"Dra från start till pilspets.",circle:"Dra runt området som ska markeras.",
      cable:"Tryck på en ledning – hela den sammanhängande dragningen markeras. Korsande linjer följer inte med."
    }[state.tool];
    $("#measureHint").textContent=text;
  }

  // Freehand strokes are drawn as quadratic curves through the midpoints of
  // consecutive samples, which removes the faceted/jagged look a raw lineTo
  // polyline gives at the sampling rate a finger produces.
  function strokeSmooth(ctx,q){
    if(!q||!q.length)return;
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    ctx.beginPath();
    if(q.length<3){
      ctx.moveTo(q[0].x,q[0].y);
      for(let i=1;i<q.length;i++)ctx.lineTo(q[i].x,q[i].y);
    }else{
      ctx.moveTo(q[0].x,q[0].y);
      for(let i=1;i<q.length-1;i++){
        const mx=(q[i].x+q[i+1].x)/2, my=(q[i].y+q[i+1].y)/2;
        ctx.quadraticCurveTo(q[i].x,q[i].y,mx,my);
      }
      ctx.quadraticCurveTo(q[q.length-2].x,q[q.length-2].y,q[q.length-1].x,q[q.length-1].y);
    }
    ctx.stroke();ctx.restore();
  }

  function roundRectPath(ctx,x,y,w,h,r){
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
  }
  // ---- Kabelmarkering ----
  // Trycker man på en ledning markeras hela den sammanhängande dragningen.
  // Nyckeln till att KORSANDE linjer inte dras med: två segment kopplas bara
  // ihop om deras ÄNDPUNKTER möts. En linje som korsar en annan skär den mitt
  // på sträckan och delar därför ingen ändpunkt — den hoppas över. Det är
  // samma sak i ritningen: en korsning är inte en förbindelse.
  const cable={cacheKey:null,segs:null,grid:null,dots:null,cell:6};

  function cableKeyFor(){ return `${state.currentFileId}|${state.pageNum}`; }

  async function ensureCableGraph(){
    const key=cableKeyFor();
    if(cable.cacheKey===key&&cable.segs)return true;
    const OPS=window.pdfjsLib&&window.pdfjsLib.OPS;
    if(!OPS||!state.pdfDoc)return false;
    const page=await state.pdfDoc.getPage(state.pageNum);
    const viewport=page.getViewport({scale:1});
    let ops; try{ops=await page.getOperatorList()}catch{return false}
    let paths; try{paths=scannerReadPaths(ops,viewport,OPS)}catch{return false}
    const STROKE=new Set([OPS.stroke,OPS.closeStroke]);
    const segs=[];
    // No colour threshold is applied when building the graph. A fixed cut-off
    // would be calibrated to one project's palette, and the greys differ from
    // drawing to drawing. Instead every stroke is kept and the colour is decided
    // at tap time: the run follows whatever colour the tapped line has. That is
    // self-calibrating — it works whether cables are black here and blue in the
    // next project, and it excludes the thick collection route and the greyed
    // architectural base automatically, because neither shares the cable's colour.
    for(const p of paths){
      if(!STROKE.has(p.paintOp)||p.npts<2)continue;
      // Multi-point paths are already a connected run; keep their internal order.
      for(let i=1;i<p.pts.length;i++){
        const a=p.pts[i-1],b=p.pts[i];
        const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
        if(len<0.4)continue;                    // hatching noise
        segs.push({a,b,len,lw:p.lw||1,col:p.col||"#000000"});
      }
    }
    if(!segs.length)return false;
    // Endpoint hash grid so joining is O(1) per endpoint instead of O(n²).
    const grid=new Map();
    const key2=(x,y)=>`${Math.round(x/cable.cell)},${Math.round(y/cable.cell)}`;
    segs.forEach((sg,i)=>{
      for(const q of [sg.a,sg.b]){
        const k=key2(q[0],q[1]);
        (grid.get(k)||grid.set(k,[]).get(k)).push(i);
      }
    });
    // Junction boxes are small filled dots. Where a cable passes through one it
    // genuinely continues; where two lines merely cross with no dot between them
    // they are unrelated and the run must stop. Collecting the dots lets the walk
    // tell those two cases apart instead of stopping at every meeting point.
    const FILL=new Set([OPS.fill,OPS.eoFill,OPS.fillStroke,OPS.eoFillStroke]);
    const dots=[];
    for(const p of paths){
      if(!FILL.has(p.paintOp))continue;
      const lo=Math.min(p.w,p.h), hi=Math.max(p.w,p.h);
      if(lo<0.8||hi>9||hi/Math.max(lo,.01)>1.7)continue;   // round-ish and small
      dots.push({x:p.cx,y:p.cy,r:hi/2});
    }
    cable.cacheKey=key; cable.segs=segs; cable.grid=grid; cable.dots=dots;
    return true;
  }

  function colorRgb(c){
    const m=/^#([0-9a-f]{6})$/i.exec(String(c||""));
    if(!m)return [0,0,0];
    const v=parseInt(m[1],16);
    return [(v>>16)&255,(v>>8)&255,v&255];
  }
  function sameColor(a,b){
    const x=colorRgb(a),y=colorRgb(b);
    // Small tolerance so a run drawn in two near-identical shades still joins,
    // while clearly different linework (grey architecture vs black cable) does not.
    return Math.abs(x[0]-y[0])+Math.abs(x[1]-y[1])+Math.abs(x[2]-y[2]) < 60;
  }

  function cableNeighbours(i,seedCol){
    const sg=cable.segs[i], out=[];
    const TOL=0.75;                              // endpoints must actually meet
    const key2=(x,y)=>`${Math.round(x/cable.cell)},${Math.round(y/cable.cell)}`;
    for(const q of [sg.a,sg.b]){
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
        const bucket=cable.grid.get(key2(q[0]+dx*cable.cell,q[1]+dy*cable.cell));
        if(!bucket)continue;
        for(const j of bucket){
          if(j===i)continue;
          const o=cable.segs[j];
          if(!(Math.hypot(o.a[0]-q[0],o.a[1]-q[1])<=TOL||Math.hypot(o.b[0]-q[0],o.b[1]-q[1])<=TOL))continue;
          // Line weight is only used to block joins between clearly different
          // kinds of linework. On the drawings tested nearly everything is the
          // same weight, so a tight ratio would have blocked legitimate runs
          // while gaining nothing — this stops only at a sharp change.
          const r=(o.lw||1)/(sg.lw||1);
          if(r<0.34||r>2.9)continue;
          if(seedCol&&!sameColor(o.col,seedCol))continue;
          out.push(j);
        }
      }
    }
    return out;
  }

  function pointToSegDist(p,a,b){
    const vx=b[0]-a[0],vy=b[1]-a[1];
    const L=vx*vx+vy*vy;
    let t=L?((p.x-a[0])*vx+(p.y-a[1])*vy)/L:0;
    t=Math.max(0,Math.min(1,t));
    return Math.hypot(p.x-(a[0]+vx*t),p.y-(a[1]+vy*t));
  }

  async function selectCableAt(pt){
    if(!await ensureCableGraph()){toast("Kunde inte läsa ritningens linjer");return}
    // Tolerance follows zoom so it stays a comfortable finger target on screen.
    const tol=Math.max(1.2,7/(state.renderScale*state.viewZoom||1));
    let best=-1,bd=Infinity;
    for(let i=0;i<cable.segs.length;i++){
      const d=pointToSegDist(pt,cable.segs[i].a,cable.segs[i].b);
      if(d<bd){bd=d;best=i}
    }
    if(best<0||bd>tol){state.cableRun=null;drawOverlay();toast("Ingen ledning där");return}
    // Tapping the already-marked run clears it. Without this the same run was
    // simply re-selected, so the only ways out were an empty tap, switching tool
    // or the back button — none of which is what a second tap should mean.
    if(state.cableRun&&state.cableRun.some(sg=>sg===cable.segs[best])){
      state.cableRun=null; drawOverlay(); return;
    }
    const seedCol=cable.segs[best].col;
    const seen=new Set([best]),stack=[best],run=[];
    const CAP=2000;
    // Every cable in a flat ultimately meets at the distribution point, so a
    // plain flood reaches the whole circuit network — which is why the marking
    // ran off along walls and other runs. A single cable is the stretch BETWEEN
    // branch points, so the walk stops at any junction: a point where three or
    // more segments meet. The junction itself is included, but nothing beyond it.
    while(stack.length&&run.length<CAP){
      const i=stack.pop(); run.push(cable.segs[i]);
      const nb=cableNeighbours(i,seedCol);
      const sg=cable.segs[i];
      const dirOf=(o,from)=>{
        // Direction of segment o leading away from the shared point `from`.
        const near=(Math.hypot(o.a[0]-from[0],o.a[1]-from[1])<=0.75)?o.a:o.b;
        const far=(near===o.a)?o.b:o.a;
        return Math.atan2(far[1]-near[1],far[0]-near[0])*180/Math.PI;
      };
      const sgDir=q=>{
        const far=(q===sg.a)?sg.b:sg.a;
        return Math.atan2(far[1]-q[1],far[0]-q[0])*180/Math.PI;
      };
      for(const q of [sg.a,sg.b]){
        let at=nb.filter(j=>{
          const o=cable.segs[j];
          return Math.hypot(o.a[0]-q[0],o.a[1]-q[1])<=0.75||Math.hypot(o.b[0]-q[0],o.b[1]-q[1])<=0.75;
        });
        // Door swings, furniture and other curved detail are drawn as chains of
        // very short segments; a cable is drawn as few long ones. Refusing to
        // walk into tiny segments removes those detours at the source.
        at=at.filter(j=>cable.segs[j].len>=1.5);
        // A cable also runs straight or turns square. Anything leaving at an
        // odd angle belongs to something else, so it is not followed.
        const inDir=sgDir(q);
        at=at.filter(j=>{
          let t=Math.abs(((dirOf(cable.segs[j],q)-inDir+180)%360+360)%360-180);
          t=Math.abs(180-t);                 // 0 = straight on, 90 = square turn
          return t<26||(t>62&&t<118);
        });
        // More than one continuation means the lines meet here. Pass through only
        // if a junction box sits at the point; otherwise this is a plain crossing
        // between unrelated runs and the walk stops.
        if(at.length>=2){
          const box=(cable.dots||[]).some(d=>Math.hypot(d.x-q[0],d.y-q[1])<=Math.max(2.5,d.r*2.2));
          if(!box)continue;
        }
        for(const j of at)if(!seen.has(j)){seen.add(j);stack.push(j)}
      }
    }
    let total=0; for(const sg of run)total+=sg.len;
    state.cableRun=run;
    drawOverlay();
    const m=ptToM(total);
    if(run.length>=CAP){
      // Architectural linework is all connected, so tapping a wall rather than a
      // cable can reach most of the sheet. Say so instead of presenting a length
      // that means nothing.
      toast(`Ovanligt lång sammanhängande dragning (${run.length}+ segment)`);
    }else{
      toast(`Ledning markerad · ${run.length} segment · ca ${formatLength(m)}`);
    }
  }

  // Draws a measurement the way a dimension is drawn on a technical drawing:
  // a thin line with short end ticks square to it, and the value on a compact
  // rounded chip. The previous version used fat filled dots, boxed A/B letters
  // and an oversized label — heavy on screen and unlike the drawing it sits on.
  function drawDimension(ctx,a,b,label,dashed){
    const acc=accentColor();
    const ang=Math.atan2(b.y-a.y,b.x-a.x);
    const nx=-Math.sin(ang), ny=Math.cos(ang), t=6;
    ctx.save();
    ctx.strokeStyle=acc; ctx.fillStyle=acc;
    ctx.lineWidth=1.8; ctx.lineCap="butt";
    if(dashed)ctx.setLineDash([6,4]);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    ctx.setLineDash([]);
    // end ticks
    for(const q of [a,b]){
      ctx.beginPath();
      ctx.moveTo(q.x-nx*t,q.y-ny*t); ctx.lineTo(q.x+nx*t,q.y+ny*t); ctx.stroke();
    }
    // small open endpoints so the exact point stays visible under the marker
    ctx.lineWidth=1.6;
    for(const q of [a,b]){
      ctx.beginPath(); ctx.arc(q.x,q.y,3.2,0,Math.PI*2);
      ctx.fillStyle="#fff"; ctx.fill(); ctx.strokeStyle=acc; ctx.stroke();
    }
    if(label){
      ctx.font="600 12px system-ui,-apple-system,sans-serif";
      const w=ctx.measureText(label).width, padX=7, padY=4, h=12+padY*2;
      // offset clear of the line, on its normal
      const mx=(a.x+b.x)/2+nx*14, my=(a.y+b.y)/2+ny*14;
      const x=mx-w/2-padX, y=my-h/2;
      ctx.fillStyle="rgba(14,14,16,.88)";
      roundRectPath(ctx,x,y,w+padX*2,h,6); ctx.fill();
      ctx.strokeStyle="rgba(255,255,255,.14)"; ctx.lineWidth=1; ctx.stroke();
      ctx.fillStyle=acc; ctx.textBaseline="middle";
      ctx.fillText(label,x+padX,my);
      ctx.textBaseline="alphabetic";
    }
    ctx.restore();
  }

  function drawOverlay(){
    const c=$("#overlayCanvas"), dpr=Math.min(window.devicePixelRatio||1,2), ctx=c.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,c.width/dpr,c.height/dpr);
    ctx.lineWidth=2.5;ctx.strokeStyle=accentColor();ctx.fillStyle=accentColor();ctx.font="700 13px system-ui";
    const toPx=p=>({x:p.x*state.renderScale,y:p.y*state.renderScale});
    // Highlighted cable run, drawn first so annotations stay on top of it.
    if(state.cableRun&&state.cableRun.length){
      ctx.save();
      const acc=accentColor();
      // One clean stroke. The wide soft pass under it read as a glow rather than
      // as a marked cable, and blurred where the line actually ran.
      ctx.strokeStyle=acc; ctx.globalAlpha=1;
      ctx.lineWidth=2.6; ctx.lineCap="round"; ctx.lineJoin="round";
      ctx.beginPath();
      for(const sg of state.cableRun){
        const a=toPx({x:sg.a[0],y:sg.a[1]}), b=toPx({x:sg.b[0],y:sg.b[1]});
        ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
      }
      ctx.stroke();
      ctx.restore();
    }
    function drawPath(points,closed=false,label=""){
      if(points.length<1)return; const q=points.map(toPx);ctx.beginPath();ctx.moveTo(q[0].x,q[0].y);
      q.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));if(closed&&q.length>2)ctx.closePath();ctx.stroke();
      // The pen samples many points per second; drawing a dot at each one is
      // what made a freehand stroke look like a trail of blobs. Vertex dots are
      // only meaningful for the click-per-point tools (sträcka/area).
      if(state.drawDraft?.type!=='pen'&&state.tool!=='pen')q.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill()});
      if(label&&q.length){const p=q[Math.floor(q.length/2)];ctx.fillStyle="rgba(11,11,12,.88)";ctx.fillRect(p.x+6,p.y-20,Math.max(70,label.length*7),22);ctx.fillStyle=accentColor();ctx.fillText(label,p.x+11,p.y-5)}
    }
    getMeasurements().forEach(m=>{
      if(m.type==="distance" && m.points?.length===2){
        drawDimension(ctx,toPx(m.points[0]),toPx(m.points[1]),m.label,false);
      } else drawPath(m.points,m.type==="area",m.label);
    });
    if(state.distanceDraft){
      const a=toPx(state.distanceDraft.a),b=toPx(state.distanceDraft.b);
      const live=formatLength(ptToM(distancePt(state.distanceDraft.a,state.distanceDraft.b)));
      drawDimension(ctx,a,b,live,true);
    }
    const f=fileMeta(state.currentFileId);
    const refs=f?.syncRefs?.[state.pageNum] || [];
    const live=state.syncCapture?.fileId===state.currentFileId ? state.syncCapture.points : [];
    [...refs, ...live].forEach((p,i)=>{const q=toPx(p);ctx.beginPath();ctx.arc(q.x,q.y,7,0,Math.PI*2);ctx.stroke();ctx.fillStyle="rgba(11,11,12,.9)";ctx.fillRect(q.x+9,q.y-13,24,22);ctx.fillStyle=accentColor();ctx.fillText(i%2===0?"A":"B",q.x+15,q.y+3)});
    const hi=state.armatureHighlight;
    if(hi && hi.fileId===state.currentFileId && hi.page===state.pageNum){const e=hi.entry,q=toPx({x:e.x,y:e.y});const w=Math.max(42,(e.w||25)*state.renderScale),h=Math.max(26,(e.h||12)*state.renderScale);ctx.save();ctx.strokeStyle=accentColor();ctx.lineWidth=4;ctx.strokeRect(q.x-10,q.y-10,w+20,h+20);ctx.restore();}
    for(const a of getAnnotations()){
      ctx.save();ctx.strokeStyle=a.selected?'#ff4d4f':accentColor();ctx.fillStyle=accentColor();ctx.lineWidth=a.selected?4:3;
      if(a.type==='pen'){strokeSmooth(ctx,a.points.map(toPx))}
      if(a.type==='arrow'){const p=toPx(a.points[0]),q=toPx(a.points[1]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();const an=Math.atan2(q.y-p.y,q.x-p.x);ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-16*Math.cos(an-.5),q.y-16*Math.sin(an-.5));ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-16*Math.cos(an+.5),q.y-16*Math.sin(an+.5));ctx.stroke()}
      if(a.type==='circle'){const p=toPx(a.points[0]),q=toPx(a.points[1]);ctx.beginPath();ctx.ellipse((p.x+q.x)/2,(p.y+q.y)/2,Math.abs(q.x-p.x)/2,Math.abs(q.y-p.y)/2,0,0,Math.PI*2);ctx.stroke()}
      if(a.selected&&['arrow','circle'].includes(a.type)&&a.points?.length===2){
        ctx.save();ctx.fillStyle='#ff4d4f';
        [a.points[0],a.points[1]].forEach(pt=>{const q=toPx(pt);ctx.beginPath();ctx.arc(q.x,q.y,6,0,Math.PI*2);ctx.fill()});
        ctx.restore();
      }
      if(a.type==='text'){
        const p=toPx(a.points[0]);const fs=Math.max(10,Math.min(64,Number(a.fontSize)||16));ctx.font=`bold ${fs}px system-ui,sans-serif`;
        // A thin light halo behind the orange fill keeps text readable over dark
        // linework or dense hatching, instead of flat color that can vanish into
        // whatever's underneath it.
        ctx.lineJoin='round';ctx.miterLimit=2;
        ctx.strokeStyle='rgba(255,255,255,.88)';ctx.lineWidth=Math.max(3,fs*.22);ctx.strokeText(a.text,p.x,p.y);
        ctx.fillStyle=a.selected?'#ff8a3d':accentColor();ctx.fillText(a.text,p.x,p.y);
        if(a.selected){
          const w=Math.max(44,String(a.text||'').length*fs*.62);
          ctx.save();ctx.strokeStyle='rgba(255,77,79,.9)';ctx.lineWidth=2;ctx.setLineDash([1,6]);ctx.lineCap='round';
          roundRectPath(ctx,p.x-9,p.y-fs-8,w+18,fs+18,10);ctx.stroke();
          ctx.restore();
        }
      }ctx.restore();
    }
    const review=state.scannerReview;
    if(review?.hits?.length){
      // Always recompute from the live file/page instead of trusting a cached
      // pageHits snapshot — that snapshot only gets refreshed when navigating via
      // the review bar's own prev/next. Any other navigation (swipe, floor
      // switcher, page arrows) left it stale, so markers from a previously
      // reviewed drawing kept showing up on whatever drawing you opened next.
      const pageHits=review.hits.filter(x=>x.fileId===state.currentFileId&&x.page===state.pageNum);
      if(pageHits.length){
        ctx.save();ctx.lineWidth=3;ctx.strokeStyle=accentColor();ctx.fillStyle="rgba(255,106,0,.15)";ctx.font="800 12px system-ui";
        pageHits.forEach((hit,i)=>{if(!Number.isFinite(hit.nx)||!Number.isFinite(hit.ny))return;const x=hit.nx*state.baseCanvasWidth,y=hit.ny*state.baseCanvasHeight,r=13;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=accentColor();ctx.fillText(String(i+1),x+r+4,y+4);ctx.fillStyle="rgba(255,106,0,.15)";});ctx.restore();
      }
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
    const tol=38;
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
  $('#overlayCanvas').addEventListener('pointerdown',e=>{
    if(state.tool==='cable'){ e.preventDefault(); selectCableAt(pdfPointFromEvent(e)); return; }
    if(!['pen','arrow','circle'].includes(state.tool))return;const p=pdfPointFromEvent(e);state.drawDraft={type:state.tool,points:[p],pointerId:e.pointerId};if(state.tool==='arrow')showMeasureMagnifier(e);try{e.target.setPointerCapture(e.pointerId)}catch{}e.preventDefault()});
  $('#overlayCanvas').addEventListener('pointermove',e=>{const d=state.drawDraft;if(!d||d.pointerId!==e.pointerId)return;const p=pdfPointFromEvent(e);
    if(d.type==='pen'){
      // Drop samples closer than ~1px on screen: finger jitter otherwise becomes
      // permanent geometry and makes the saved stroke look shaky.
      const last=d.points[d.points.length-1], sc=(state.renderScale*state.viewZoom)||1;
      if(!last||Math.hypot(p.x-last.x,p.y-last.y)*sc>1.1)d.points.push(p);
    }else d.points[1]=p;
    state.tempPoints=d.points;if(d.type==='arrow')showMeasureMagnifier(e);drawOverlay()});
  $('#overlayCanvas').addEventListener('pointerup',e=>{const d=state.drawDraft;if(!d||d.pointerId!==e.pointerId)return;if(d.type==='arrow')hideMeasureMagnifier();const p=pdfPointFromEvent(e);if(d.type!=='pen')d.points[1]=p;if(d.points.length>1){const a={id:uid(),type:d.type,points:d.points};getAnnotations().push(a);if(state.activeAtaMark){state.ataMarkAnnotationId=a.id; updateAtaMarkBar();}saveMeta()}state.drawDraft=null;state.tempPoints=[];setTool('pan');drawOverlay()});
  $('#overlayCanvas').addEventListener('pointercancel',()=>{if(state.drawDraft?.type==='arrow')hideMeasureMagnifier()});
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

  // Distance: first press starts A — drag while still pressed to fine-tune it (the
  // magnifier tracks this too, since a thumb usually covers the exact spot being
  // placed), release to fix it. Second press starts B the same way as before.
  $("#overlayCanvas").addEventListener("pointerdown",e=>{
    if(state.tool!=="distance")return;
    showMeasureMagnifier(e);
    const p=pdfPointFromEvent(e);
    // Existing endpoint editing has priority.
    let best=null,d=Infinity;for(const m of getMeasurements())for(const h of screenMeasureHandles(m)){const q=Math.hypot(e.clientX-h.cx,e.clientY-h.cy);if(q<30&&q<d){best={m,h};d=q}}
    if(best){state.editMeasure=best;e.preventDefault();try{e.target.setPointerCapture(e.pointerId)}catch{}return;}
    if(!state.tempPoints.length){state.distanceFirstDraft={p,pointerId:e.pointerId};state.tempPoints=[p];drawOverlay();e.preventDefault();try{e.target.setPointerCapture(e.pointerId)}catch{}return;}
    state.distanceDraft={a:state.tempPoints[0],b:p,pointerId:e.pointerId};e.preventDefault();try{e.target.setPointerCapture(e.pointerId)}catch{}drawOverlay();
  });
  $("#overlayCanvas").addEventListener("pointermove",e=>{
    if(state.tool==="distance"&&(state.distanceDraft||state.editMeasure||state.distanceFirstDraft))showMeasureMagnifier(e);
    if(state.editMeasure){const p=pdfPointFromEvent(e),m=state.editMeasure.m;if(state.editMeasure.h.kind==="a")m.points[0]=p;else m.points[1]=p;m.label=formatLength(ptToM(distancePt(m.points[0],m.points[1])));$("#measureResult").textContent=m.label;drawOverlay();return;}
    if(state.distanceFirstDraft && state.distanceFirstDraft.pointerId===e.pointerId){const p=pdfPointFromEvent(e);state.distanceFirstDraft.p=p;state.tempPoints=[p];drawOverlay();return;}
    if(state.distanceDraft && (state.distanceDraft.pointerId==null||state.distanceDraft.pointerId===e.pointerId)){state.distanceDraft.b=pdfPointFromEvent(e);const m=ptToM(distancePt(state.distanceDraft.a,state.distanceDraft.b));$("#measureResult").textContent=formatLength(m);drawOverlay();}
  });
  $("#overlayCanvas").addEventListener("pointerup",e=>{
    hideMeasureMagnifier();
    if(state.editMeasure){saveMeta();state.editMeasure=null;drawOverlay();return;}
    if(state.distanceFirstDraft && state.distanceFirstDraft.pointerId===e.pointerId){
      state.tempPoints=[state.distanceFirstDraft.p];state.distanceFirstDraft=null;drawOverlay();return;
    }
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
  $("#overlayCanvas").addEventListener("pointercancel",()=>{if(state.editMeasure){state.editMeasure=null;}if(state.distanceDraft){state.distanceDraft=null;}if(state.distanceFirstDraft){state.distanceFirstDraft=null;state.tempPoints=[];}drawOverlay();});
  $("#overlayCanvas").addEventListener("click",e=>{if(Date.now()<state.suppressClickUntil||["pan","distance","text","pen","arrow","circle","cable"].includes(state.tool))return;state.tempPoints.push(pdfPointFromEvent(e));drawOverlay();});

  function screenMeasureHandles(m){
    if(!m||m.type!=="distance"||m.points?.length!==2)return [];const sc=state.renderScale*state.viewZoom,r=$("#overlayCanvas").getBoundingClientRect();return [{kind:"a",p:m.points[0]},{kind:"b",p:m.points[1]}].map(h=>({...h,cx:r.left+h.p.x*sc,cy:r.top+h.p.y*sc}));
  }
  function screenAnnotationHandles(a){
    if(!a||!['arrow','circle'].includes(a.type)||(a.points||[]).length!==2)return [];
    const sc=state.renderScale*state.viewZoom,r=$("#overlayCanvas").getBoundingClientRect();
    return [{kind:'a',p:a.points[0]},{kind:'b',p:a.points[1]}].map(h=>({...h,cx:r.left+h.p.x*sc,cy:r.top+h.p.y*sc}));
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
        // Occhio schedules used to be excluded here, so an Occhio fixture could
        // only ever be reached indirectly via an enriched entry in the ordinary
        // armature schedule. Fixtures that exist ONLY in the Occhio overview
        // (this project has an apartment like that) were unreachable entirely.
        for(const sch of schedules)for(const e0 of(sch.armatureIndex||[])){const e=enrichEntryWithOcchio(f.projectId,e0);const cand=normalizeProductText([e.type,e.brand,e.occhioMatch?.type].filter(Boolean).join(" "));if(!cand)continue;const a=new Set(txt.split(" ").filter(x=>x.length>=3)),b=new Set(cand.split(" ").filter(x=>x.length>=3));let c=0;for(const x of a)if(b.has(x))c++;const score=c/Math.max(2,Math.min(a.size,b.size));if(score>bestScore){bestScore=score;best=e;}}
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
      // Only the verified identity extracted from the title block may match.
      // Visible references inside the plan and friendly display names are links, not identity.
      return normalizeDrawingRef(f.drawingNumber)===nr;
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
    // Convert the on-screen centre into CONTENT coordinates. When the drawing is
    // centred it sits at an offset inside the scroll area, so using raw scroll
    // coordinates made zoom drift sideways.
    const offX0=wrap.offsetLeft||0, offY0=wrap.offsetTop||0;
    const centerX=viewport.scrollLeft+viewport.clientWidth/2-offX0;
    const centerY=viewport.scrollTop+viewport.clientHeight/2-offY0;
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
        centerFullscreenDrawing();
        const offX=wrap.offsetLeft||0, offY=wrap.offsetTop||0;
        viewport.scrollLeft=Math.max(0,fx*w+offX-viewport.clientWidth/2);
        viewport.scrollTop=Math.max(0,fy*h+offY-viewport.clientHeight/2);
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
    const p=projectById(f.projectId);
    // Swiping/arrow-navigating between drawings must follow the same logical
    // order as the file browser (category → plan → del → revision), not
    // whatever order the files happened to be uploaded in — otherwise "Belysning
    // P18 Del 1" could swipe to an unrelated drawing instead of "... Del 2".
    return (p?.files||[]).filter(id=>fileMeta(id)).map(fileMeta).sort(smartSortFiles).map(x=>x.id);
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
    // applyZoom(false) already schedules its own requestAnimationFrame that calls
    // centerFullscreenDrawing() — when the target page happens to fit entirely in
    // the viewport at this zoom (very common right after "Vy låst" carries a
    // fit-level zoom over from the previous drawing), that function switches
    // canvasWrap to centered absolute positioning and turns off scrolling. Setting
    // scrollLeft/scrollTop in a SEPARATE, independently-scheduled frame right
    // after that raced against it — depending on ordering, it could fire between
    // centering's own size/position writes and leave the drawing sized correctly
    // but stuck uncentered in a corner. Waiting two frames guarantees centering
    // has already run, and skipping the manual scroll entirely in the fits case
    // (nothing meaningful to scroll to — the whole page is already visible)
    // removes the race instead of just narrowing it.
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(isFullyZoomedOut())return;
      viewport.scrollLeft=Math.max(0,targetCenter.x*state.renderScale*state.viewZoom-viewport.clientWidth/2);
      viewport.scrollTop=Math.max(0,targetCenter.y*state.renderScale*state.viewZoom-viewport.clientHeight/2);
    }));
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

  // Centring is done in CSS now (flexbox + margin:auto on #canvasWrap). This
  // used to measure the viewport and set absolute left/top on the wrap, which
  // fought a stack of `margin:0 auto !important` rules elsewhere in style.css
  // and broke whenever it measured before layout had settled — the drawing
  // ending up pinned to the top with dead space below it. Kept as a small
  // no-op-ish hook because several call sites still call it; it only clears any
  // stale inline positioning left over from older builds.
  function centerFullscreenDrawing(){
    const viewport=$("#pdfViewport"), wrap=$("#canvasWrap"); if(!viewport||!wrap)return;
    wrap.style.position=""; wrap.style.left=""; wrap.style.top=""; wrap.style.transform="none";
    // Horizontal centring is CSS (margin-inline:auto). Vertical centring is a top
    // margin — scroll-safe, unlike flex/grid centring which puts the overflowing
    // part on unreachable negative scroll.
    // It must only be applied when the viewport has a FIXED height that is taller
    // than the drawing (fullscreen). In the normal view the frame now sizes to
    // its content, so adding a margin there just pushes the drawing down AND
    // grows the frame by the same amount — the drawing ends up sitting low with
    // a tall empty box above it, instead of the frame hugging the sheet.
    const fs=$("#viewerView")?.classList.contains("fullscreen-ui");
    if(!fs){ wrap.style.marginTop=""; wrap.style.marginBottom=""; return; }
    const h=parseFloat(wrap.style.height)||wrap.getBoundingClientRect().height;
    const pad=Math.max(0,(viewport.clientHeight-h)/2);
    wrap.style.marginTop=pad+"px";
    wrap.style.marginBottom=pad+"px";
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
      viewer.classList.remove("fullscreen-ui","chrome-hidden"); clearTimeout(state.chromeTapTimer); $("#canvasWrap").style.marginTop=""; $("#canvasWrap").style.marginBottom=""; setTimeout(fitDrawing,120); return;
    }
    if(isPseudo){
      viewer.classList.remove("pseudo-fullscreen","fullscreen-ui","chrome-hidden");
      clearTimeout(state.chromeTapTimer);
      $("#canvasWrap").style.marginTop=""; $("#canvasWrap").style.marginBottom="";
      $("#fullscreenBtn").textContent="⛶"; setTimeout(fitDrawing,120); return;
    }
    try{
      if(viewer.requestFullscreen){await viewer.requestFullscreen();viewer.classList.add("fullscreen-ui")}
      else if(viewer.webkitRequestFullscreen){viewer.webkitRequestFullscreen();viewer.classList.add("fullscreen-ui")}
      else throw new Error("fullscreen unsupported");
    }catch(e){
      viewer.classList.add("pseudo-fullscreen","fullscreen-ui");
    }
    $("#fullscreenBtn").textContent="⤢";
    // Entering fullscreen changes the available viewport size dramatically (a
    // normal-mode pdf-viewport is capped well short of full height; fullscreen
    // gets the whole screen). Only re-centering here — without also recomputing
    // "fit" for that new, much larger viewport — left the drawing at whatever
    // zoom level was correct for the SMALL pre-fullscreen viewport, which reads
    // as "tiny in the corner" the instant fullscreen opens.
    // A single fixed delay before re-fitting turned out unreliable: on some
    // devices the browser's own fullscreen transition (or the WebView's own
    // relayout for the pseudo-fullscreen fallback) hadn't actually finished
    // resizing pdf-viewport yet at 120ms, so fitDrawing() computed against the
    // OLD, small dimensions and then never ran again — the drawing stayed
    // pinned small at the top with no further correction. Retrying at a few
    // increasing delays is self-correcting: whichever attempt lands after the
    // real layout has settled produces the right size, and repeating a correct
    // fit is harmless. A brief transition while these retries settle turns the
    // corrections into one smooth motion instead of a jarring snap — removed
    // again once they're done so it never slows down live pinch-zooming.
    viewer.classList.remove("chrome-hidden");
    $("#canvasWrap")?.classList.add("fs-settling");
    setTimeout(()=>$("#canvasWrap")?.classList.remove("fs-settling"),900);
    for(const delay of [80,200,400,700])setTimeout(fitDrawing,delay);
  }
  // Belt-and-braces: whenever the window itself resizes while a drawing is open
  // in fullscreen (the transition finishing, an orientation change, a
  // navigation-bar showing/hiding), re-fit once more rather than trusting any
  // single earlier timing guess.
  window.addEventListener("resize",()=>{
    if($("#viewerView")?.classList.contains("fullscreen-ui")&&state.currentFileId)fitDrawing();
  });

  function syncFullscreenUI(){
    const active=!!(document.fullscreenElement||document.webkitFullscreenElement)||$("#viewerView").classList.contains("pseudo-fullscreen");
    $("#fullscreenBtn").textContent=active?"⤢":"⛶";
    $("#viewerView").classList.toggle("fullscreen-ui",active); if(active)setTimeout(()=>{fitDrawing();centerFullscreenDrawing()},80);
  }

  function toggleFullscreenChrome(force){
    const viewer=$("#viewerView");
    if(!viewer||!viewer.classList.contains("fullscreen-ui"))return;
    const hidden=typeof force==="boolean"?force:!viewer.classList.contains("chrome-hidden");
    viewer.classList.toggle("chrome-hidden",hidden);
    // Hiding the rail gives back its 66px, so the sheet can grow into it.
    setTimeout(fitDrawing,300);
  }

  function clearOverlaySelection(){
    state.selectedOverlay=null;
    for(const a of getAnnotations())a.selected=false;
    $('#deleteSelectedBtn')?.classList.add('hidden');
    $('#textSmallerBtn')?.classList.add('hidden');
    $('#textLargerBtn')?.classList.add('hidden');
    $('#editSelectedTextBtn')?.classList.add('hidden');
    drawOverlay();
  }

  // Android's back button routes here. This used to handle only two cases
  // (fullscreen, and viewer→project) and returned false for everything else,
  // which meant back CLOSED THE WHOLE APP while a dialog was open or while a
  // sub-view was showing. Ordering matters: transient overlays first, then
  // in-view modes, then the view hierarchy, so back always undoes the most
  // recent thing rather than jumping straight out.
  window.ekisBack=function(){
    // 1. Modal dialogs — cancel them rather than exiting the app. The app
    // reuses one #modal element for both prompts and delete confirmations, so
    // clicking its cancel button is the correct "undo" for either.
    const modal=$("#modal");
    if(modal&&!modal.classList.contains("hidden")){ $("#modalCancel")?.click(); return true; }
    // 2. Transient overlays inside the viewer.
    if(state.scannerReview){ closeScannerReview(); return true; }
    if(document.querySelector('.drawing-text-editor')){ document.querySelector('.drawing-text-editor').remove(); return true; }
    // 3. Modes within the viewer: step out one layer at a time.
    const viewer=$("#viewerView");
    const fs=!!(document.fullscreenElement||document.webkitFullscreenElement)||viewer?.classList.contains("pseudo-fullscreen");
    if(fs){ toggleFullscreen(); return true; }
    if(state.currentView==="viewerView"){
      if(state.cableRun){ state.cableRun=null; drawOverlay(); return true; }
      if(state.selectedOverlay){ clearOverlaySelection(); return true; }
      if(state.tool&&state.tool!=="pan"){ setTool("pan"); return true; }
      if(state.riserMode){ setRiserMode(false); return true; }
      showView("projectView",false); renderProject(); return true;
    }
    // 4. View hierarchy: project detail → project list; any tab → home tab.
    if(state.currentView==="projectView"){ showView("projectsView"); renderProjects?.(); return true; }
    if(state.currentView&&state.currentView!=="projectsView"){ showView("projectsView"); renderProjects?.(); return true; }
    return false;
  };

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
        // If a text annotation is currently selected, a two-finger pinch resizes
        // that text instead of the whole drawing — select it with a tap first,
        // then pinch. Anything else selected (or nothing) pinch-zooms as usual.
        const sel=state.selectedOverlay;
        const selText=sel?.kind==='annotation'&&sel.obj.type==='text'?sel.obj:null;
        if(selText){
          state.touchState={mode:"textPinch",startDistance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),startFontSize:Number(selText.fontSize)||16,annotation:selText};
        }else{
          state.touchState={
            mode:"pinch",
            startDistance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),
            startZoom:state.viewZoom,
            midX:(a.clientX+b.clientX)/2,
            midY:(a.clientY+b.clientY)/2
          };
        }
        state.suppressClickUntil=Date.now()+450;
      }else if(e.touches.length===1){
        const t=e.touches[0];
        state.touchState={
          mode:"single",startX:t.clientX,startY:t.clientY,lastX:t.clientX,lastY:t.clientY,
          scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop,time:Date.now(),moved:false,longPressTimer:null,markupDrag:null,handleDrag:null
        };
        if(state.tool==="pan"){
          const ts=state.touchState;
          // If an arrow/circle is already selected, a touch starting right on one of
          // its two endpoint handles adjusts just that point instead of the whole
          // shape or re-selecting something else underneath.
          const sel=state.selectedOverlay;
          if(sel?.kind==='annotation' && ['arrow','circle'].includes(sel.obj.type)){
            let bestHandle=null,bestHd=Infinity;
            for(const h of screenAnnotationHandles(sel.obj)){
              const d=Math.hypot(t.clientX-h.cx,t.clientY-h.cy);
              if(d<34&&d<bestHd){bestHd=d;bestHandle=h}
            }
            if(bestHandle){
              ts.handleDrag={annotation:sel.obj,kind:bestHandle.kind};
              state.suppressClickUntil=Date.now()+700;
              return;
            }
          }
          const immediateHit=nearestOverlayObject({clientX:t.clientX,clientY:t.clientY});
          if(immediateHit){
            state.selectedOverlay=immediateHit;
            for(const a of getAnnotations())a.selected=immediateHit.kind==='annotation'&&immediateHit.obj.id===a.id;
            $("#deleteSelectedBtn").classList.remove("hidden");
            const isText=immediateHit.kind==='annotation'&&immediateHit.obj.type==='text';
            $("#textSmallerBtn").classList.toggle("hidden",!isText);$("#textLargerBtn").classList.toggle("hidden",!isText);$("#editSelectedTextBtn").classList.toggle("hidden",!isText);
            drawOverlay();
          }
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
        if(ts.mode!=="pinch"&&ts.mode!=="textPinch"){
          const sel=state.selectedOverlay;
          const selText=sel?.kind==='annotation'&&sel.obj.type==='text'?sel.obj:null;
          if(selText){ts.mode="textPinch";ts.startDistance=d;ts.startFontSize=Number(selText.fontSize)||16;ts.annotation=selText;}
          else{ts.mode="pinch";ts.startDistance=d;ts.startZoom=state.viewZoom;}
        }
        if(ts.mode==="textPinch"){
          if(ts.startDistance>4){
            ts.annotation.fontSize=Math.max(10,Math.min(64,Math.round(ts.startFontSize*(d/ts.startDistance))));
            drawOverlay();
          }
          state.suppressClickUntil=Date.now()+350;
          return;
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
        if(ts.handleDrag){
          const hd=ts.handleDrag, p=pdfPointFromEvent({clientX:t.clientX,clientY:t.clientY});
          hd.annotation.points=hd.annotation.points||[];
          hd.annotation.points[hd.kind==='a'?0:1]=p;
          ts.moved=true;drawOverlay();return;
        }
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
      if(ts.mode==="textPinch"){saveMeta();drawOverlay();toast(`Textstorlek ${ts.annotation.fontSize}px`);return;}
      if(ts.mode!=="single")return;
      if(ts.handleDrag){saveMeta();drawOverlay();state.suppressClickUntil=Date.now()+500;toast("Ändpunkten flyttad");return;}
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
            clearTimeout(state.chromeTapTimer);
            const smart=await handleSmartDoubleTap(cx,cy);
            if(!smart) await toggleFullscreen();
          }else{
            state.lastTapAt=now;
            // In fullscreen a lone tap on the sheet fades the chrome away.
            // Deferred past the double-tap window so it never fires on the
            // first half of a double-tap (which zooms / exits fullscreen).
            if($("#viewerView")?.classList.contains("fullscreen-ui")&&!state.selectedOverlay){
              clearTimeout(state.chromeTapTimer);
              state.chromeTapTimer=setTimeout(()=>{
                if(!state.selectedOverlay)toggleFullscreenChrome();
              },540);
            }
          }
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
    const status=$("#counterStatus"), btn=$("#runCounterBtn");
    const groups=counterSelectedSummary();
    const n=[...state.counterSelected].length;
    // The action button now states exactly what it will do and is disabled
    // until there is something to do, instead of sitting enabled in the header
    // and answering a tap with an error toast.
    if(btn){
      btn.disabled=!n;
      btn.textContent=n?`Scanna ${n} ritning${n===1?'':'ar'}`:'Scanna valda';
    }
    if(!status)return;
    if(!n){status.textContent='Markera minst en ritning nedan.';return}
    status.innerHTML=Object.entries(groups).map(([c,fs])=>`${esc(c)} ${fs.length}`).join(' · ');
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

  // ---- Symbol scanning v3: shape-profile classification, calibrated per project ----
  // A dome (uttag) and a circle (strömställare) both live in every project's own
  // FÖRKLARINGAR legend. Rather than hard-code a generic symbol's geometry (which
  // varies between projects and even between drawing categories in the SAME
  // project), we (1) measure the real pixel size of each from THIS drawing's own
  // legend, then (2) classify every candidate by its WIDTH-PROFILE shape at that
  // calibrated size: a dome tapers from full width at one end to near-nothing at
  // the other; a circle bulges wide in the middle and narrows at BOTH ends —
  // checked in two perpendicular cuts, because a single-cut check can't tell a
  // circle from the cross-section of an ordinary thick cable-route line.
  function buildIntegralImage(mask,w,h){
    const integral=new Int32Array((w+1)*(h+1));
    for(let y=0;y<h;y++){
      let rowSum=0;
      for(let x=0;x<w;x++){
        rowSum+=mask[y*w+x];
        integral[(y+1)*(w+1)+(x+1)]=integral[y*(w+1)+(x+1)]+rowSum;
      }
    }
    return integral;
  }
  function integralBoxDensity(integral,w,h,x0,y0,x1,y1){
    x0=Math.max(0,x0);y0=Math.max(0,y0);x1=Math.min(w-1,x1);y1=Math.min(h-1,y1);
    if(x1<x0||y1<y0)return 0;
    const W=w+1;
    const sum=integral[(y1+1)*W+(x1+1)]-integral[y0*W+(x1+1)]-integral[(y1+1)*W+x0]+integral[y0*W+x0];
    const area=(x1-x0+1)*(y1-y0+1);
    return area>0?sum/area:0;
  }
  function scannerRotatedDensity(mask,w,h,cx,cy,rect,rot,s=1){
    const [x0,y0,x1,y1]=rect;let hit=0,total=0;const c=Math.cos(rot),sn=Math.sin(rot);
    for(let v=y0;v<=y1;v++)for(let u=x0;u<=x1;u++){
      const xx=Math.round(cx+(u*c-v*sn)*s), yy=Math.round(cy+(u*sn+v*c)*s); if(xx<0||yy<0||xx>=w||yy>=h)continue;total++;if(mask[yy*w+xx])hit++;
    }return total?hit/total:0;
  }
  function scannerWidthProfile(mask,w,h,cx,cy,pw,ph,rot,bands=8,cols=10){
    const profile=[];
    for(let b=0;b<bands;b++){
      const y0=-ph/2+(b/bands)*ph, y1=-ph/2+((b+1)/bands)*ph;
      let filled=0;
      for(let c=0;c<cols;c++){
        const x0=-pw/2+(c/cols)*pw, x1=-pw/2+((c+1)/cols)*pw;
        if(scannerRotatedDensity(mask,w,h,cx,cy,[x0,y0,x1,y1],rot)>0.5)filled++;
      }
      profile.push(filled/cols);
    }
    return profile;
  }
  function scannerProfileShape(profile){
    const n=profile.length;
    const band=(a,b)=>{const i0=Math.round(a*n),i1=Math.max(i0+1,Math.round(b*n));const s=profile.slice(i0,i1);return s.reduce((x,y)=>x+y,0)/s.length};
    return {top:band(0,.28),mid:band(.36,.64),bot:band(.72,1)};
  }
  function scannerClassifyWindow(mask,w,h,cx,cy,pw,ph){
    const domeScores=[],circleScores=[];
    for(let r=0;r<4;r++){
      const rot=r*Math.PI/2;
      const s=scannerProfileShape(scannerWidthProfile(mask,w,h,cx,cy,pw,ph,rot));
      domeScores.push(Math.max(
        (s.top>.7&&s.bot<.35)?(s.top-s.bot):0,
        (s.bot>.7&&s.top<.35)?(s.bot-s.top):0
      ));
      const bulge=Math.min(s.mid-s.top,s.mid-s.bot);
      circleScores.push(bulge>.22?bulge:0);
    }
    // A circle bulges from every direction, including both members of a
    // perpendicular pair. A line only bulges when cut ACROSS its width — cut
    // along its length it reads as flat/full, so the paired min correctly
    // collapses to ~0 for a line but stays high for a genuine circle.
    const biaxialCircle=Math.max(
      Math.min(circleScores[0],circleScores[1]),
      Math.min(circleScores[1],circleScores[2]),
      Math.min(circleScores[2],circleScores[3]),
      Math.min(circleScores[3],circleScores[0])
    );
    return {domeScore:Math.max(...domeScores), circleScore:biaxialCircle};
  }
  function scannerHasArmStroke(mask,w,h,cx,cy,r){
    // A real switch's circle always has a short diagonal "toggle arm" stroke
    // touching or just outside it. Plain round dots elsewhere (floor-heating
    // sensor points, callout number bubbles) don't have this.
    for(let k=0;k<8;k++){
      const d=scannerRotatedDensity(mask,w,h,cx,cy,[r*1.15,-1.5,r*2.6,1.5],k*Math.PI/4);
      if(d>.18&&d<.75)return true;
    }
    return false;
  }
  function scannerLocalBlob(mask,w,h,sx,sy,visited,maxRadius){
    const startIdx=sy*w+sx; if(visited[startIdx])return null;
    const stack=[[sx,sy]]; visited[startIdx]=1;
    let minX=sx,maxX=sx,minY=sy,maxY=sy,count=0;
    while(stack.length){
      const [x,y]=stack.pop(); count++;
      const neigh=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
      for(const [nx,ny] of neigh){
        if(nx<0||ny<0||nx>=w||ny>=h)continue;
        if(Math.abs(nx-sx)>maxRadius||Math.abs(ny-sy)>maxRadius)continue;
        const ni=ny*w+nx; if(visited[ni]||!mask[ni])continue;
        visited[ni]=1;
        if(nx<minX)minX=nx; if(nx>maxX)maxX=nx; if(ny<minY)minY=ny; if(ny>maxY)maxY=ny;
        stack.push([nx,ny]);
      }
    }
    return {minX,maxX,minY,maxY,count};
  }
  function scannerCalibrateSize(mask,w,h,integral,textItems,viewport,legendBox,labelRegex,excludeRegex){
    const visited=new Uint8Array(w*h), sizes=[];
    const withPos=textItems.map(it=>{const p=viewport.convertToViewportPoint(it.transform[4],it.transform[5]);return {text:String(it.str||'').trim(),px:p[0],py:p[1]}}).filter(it=>it.text);
    for(const it0 of withPos){
      const text=it0.text; if(!labelRegex.test(text))continue;
      const px=it0.px,py=it0.py;
      if(legendBox&&(px<legendBox.x||px>legendBox.x+legendBox.w||py<legendBox.y||py>legendBox.y+legendBox.h))continue;
      const nearbyText=withPos.filter(o=>Math.abs(o.px-px)<40&&o.py>py-2&&o.py<py+40).map(o=>o.text).join(' ');
      if(excludeRegex&&excludeRegex.test(nearbyText))continue;
      let best=null;
      for(let y=Math.round(py-30);y<=Math.round(py+6);y+=2){
        for(let x=Math.round(px-90);x<=Math.round(px-4);x+=2){
          if(x<0||y<0||x>=w||y>=h||visited[y*w+x]||!mask[y*w+x])continue;
          if(integralBoxDensity(integral,w,h,x-2,y-2,x+2,y+2)<.85)continue;
          const blob=scannerLocalBlob(mask,w,h,x,y,visited,22);
          if(blob&&(!best||blob.count>best.count))best=blob;
        }
      }
      if(best)sizes.push({pw:best.maxX-best.minX+1,ph:best.maxY-best.minY+1});
    }
    return sizes;
  }
  function scannerMedian(nums){const s=[...nums].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:null}

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
      if(d>.42&&dens>.035&&dens<.34){
        // The diagonal-adjacency test above can't tell "many thin parallel hatch
        // lines" from "one thick straight/angled cable-route line" — a thick line
        // is solid enough that consecutive rows are both inked, which trivially
        // satisfies the same adjacency check. Genuine cross-hatch is PERIODIC:
        // cutting across it lands on several separate ink bands with gaps between
        // them; cutting across a single thick line lands on exactly one. Sampling
        // a short line through the cell center, perpendicular to each candidate
        // hatch angle, and requiring several ink/gap transitions is what actually
        // tells them apart — this is what let the false "switch" hits that used to
        // trace straight down cable runs (see conversation history) disappear
        // without touching the real hatched zones.
        const ccx=x0+cell/2, ccy=y0+cell/2;
        const bands=(ang)=>{const dx=Math.cos(ang),dy=Math.sin(ang);let prev=0,trans=0,n=0;for(let t=-cell*0.9;t<=cell*0.9;t++){const xx=Math.round(ccx+dx*t),yy=Math.round(ccy+dy*t);if(xx<0||yy<0||xx>=w||yy>=h)continue;const v=mask[yy*w+xx];n++;if(n>1&&v!==prev)trans++;prev=v}return trans};
        if(Math.max(bands(Math.PI/4),bands(-Math.PI/4))>=3)raw[cy*cols+cx]=1;
      }
    }
    // Keep only cells that belong to a sizeable vertical/2D run, avoiding furniture and tiny hatch symbols.
    const keep=new Uint8Array(raw.length);
    for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++)if(raw[cy*cols+cx]){
      let n=0;for(let yy=Math.max(0,cy-3);yy<=Math.min(rows-1,cy+3);yy++)for(let xx=Math.max(0,cx-2);xx<=Math.min(cols-1,cx+2);xx++)n+=raw[yy*cols+xx];
      if(n>=9)keep[cy*cols+cx]=1;
    }
    // NOTE: bridging small gaps (from a symbol sitting on the hatch) into a single
    // excluded bounding box was tried again this round — even a small FIXED-radius
    // "look nearby" check (not a flood fill) still ate real rooms, because
    // legitimate small hatch-like wall/insulation details are scattered all over
    // these drawings, not just inside the one big "other section" zone. There
    // isn't a safe radius that bridges a symbol-sized gap in the real hatch
    // without also spreading into ordinary rooms that happen to have their own
    // small hatch details nearby. A few real symbols sitting unexcluded right on
    // a hatched reference area is a smaller problem than silently dropping a
    // room's worth of real outlets, so this stays a plain per-cell test. Properly
    // fixing the original complaint would need a different signal entirely — e.g.
    // detecting the reference area's own drawn border/label — rather than
    // inferring it purely from hatch texture.
    return {cell,cols,rows,keep};
  }
  function scannerInHatch(x,y,hatch){
    const cx=Math.floor(x/hatch.cell),cy=Math.floor(y/hatch.cell);
    return cx>=0&&cy>=0&&cx<hatch.cols&&cy<hatch.rows&&!!hatch.keep[cy*hatch.cols+cx];
  }

  function scannerFindLegendBox(tc,viewport){
    for(const n of scannerTextNodes(tc)){
      if(!/FÖRKLARINGAR/i.test(n.text))continue;
      const p=viewport.convertToViewportPoint(n.x,n.y);
      const right=p[0]>viewport.width*.52;
      return {x:right?Math.max(0,p[0]-45):Math.max(0,p[0]-25),y:Math.max(0,p[1]-55),
        w:right?viewport.width-p[0]+45:Math.min(viewport.width*.42,620),
        h:Math.min(viewport.height-p[1]+55,viewport.height*.92)};
    }
    return null;
  }

  // ===== Vector symbol scanning =====
  // These drawings are vector PDFs: the file still contains the exact drawing
  // commands (~150k paths on a typical sheet, of which under 1000 are FILLED
  // shapes). Outlets and switches are filled shapes, so instead of rasterising
  // the page and guessing shapes back out of a 0/1 pixel mask — which throws
  // away everything about WHAT was drawn and is why hatching, thick cable runs
  // and symbols all end up looking alike — we read the geometry directly and get
  // exact positions and sizes. The pixel scanner below is kept as a fallback for
  // scanned/raster PDFs that genuinely have no vector content.
  const mtxMul=(m1,m2)=>[
    m1[0]*m2[0]+m1[2]*m2[1], m1[1]*m2[0]+m1[3]*m2[1],
    m1[0]*m2[2]+m1[2]*m2[3], m1[1]*m2[2]+m1[3]*m2[3],
    m1[0]*m2[4]+m1[2]*m2[5]+m1[4], m1[1]*m2[4]+m1[3]*m2[5]+m1[5]
  ];
  const mtxApply=(p,m)=>[m[0]*p[0]+m[2]*p[1]+m[4], m[1]*p[0]+m[3]*p[1]+m[5]];

  // pdf.js changed how constructPath reports its data between major versions:
  // v3 emits [subOpArray, flatCoordArray] and the paint operator arrives as a
  // SEPARATE following entry, while v5 emits [paintOp, subPathArrays, bbox].
  // Parsing both keeps this working whichever build of pdf.js is loaded, and if
  // neither shape parses we return null and let the pixel scanner take over.
  function scannerReadPaths(ops,viewport,OPS){
    let ctm=viewport.transform.slice(); const stack=[]; const out=[];
    let pendingPts=null, pendingCurves=0;
    // Stroke width is tracked as well: cable routes are drawn noticeably thicker
    // than building linework, which is what lets a cable run stop at a wall
    // instead of flooding into the whole floor plan.
    let lineWidth=1; const lwStack=[];
    // Stroke colour separates the electrical linework from the architectural
    // base drawing: on the sheets measured, the building is drawn in grey
    // (#ababab, ~85 000 paths) while the electrical lines are black (~3 000).
    let strokeCol="#000000"; const colStack=[];
    const V3=(a)=>Array.isArray(a[0]);
    const flush=(paintOp)=>{
      if(!pendingPts||!pendingPts.length){pendingPts=null;return}
      let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
      for(const q of pendingPts){if(q[0]<x0)x0=q[0];if(q[0]>x1)x1=q[0];if(q[1]<y0)y0=q[1];if(q[1]>y1)y1=q[1];}
      const sc=Math.hypot(ctm[0],ctm[1])||1;
      out.push({paintOp,x0,y0,x1,y1,w:x1-x0,h:y1-y0,cx:(x0+x1)/2,cy:(y0+y1)/2,npts:pendingPts.length,pts:pendingPts,curves:pendingCurves,lw:lineWidth*sc,col:strokeCol});
      pendingPts=null; pendingCurves=0;
    };
    for(let i=0;i<ops.fnArray.length;i++){
      const fn=ops.fnArray[i], args=ops.argsArray[i];
      if(fn===OPS.save){stack.push(ctm.slice());lwStack.push(lineWidth);colStack.push(strokeCol);continue}
      if(fn===OPS.restore){ctm=stack.pop()||viewport.transform.slice();lineWidth=lwStack.pop()??lineWidth;strokeCol=colStack.pop()??strokeCol;continue}
      if(fn===OPS.setStrokeRGBColor){strokeCol=String(args[0]||strokeCol);continue}
      if(fn===OPS.setLineWidth){lineWidth=Math.abs(Number(args[0])||1);continue}
      if(fn===OPS.transform){ctm=mtxMul(ctm,args);continue}
      if(fn===OPS.constructPath){
        const pts=[]; let curves=0;
        if(V3(args)){
          const sub=args[0], co=args[1]; let k=0;
          for(const op of sub){
            if(op===OPS.moveTo||op===OPS.lineTo){pts.push(mtxApply([co[k],co[k+1]],ctm));k+=2}
            else if(op===OPS.curveTo){pts.push(mtxApply([co[k],co[k+1]],ctm));pts.push(mtxApply([co[k+2],co[k+3]],ctm));pts.push(mtxApply([co[k+4],co[k+5]],ctm));curves++;k+=6}
            else if(op===OPS.curveTo2||op===OPS.curveTo3){pts.push(mtxApply([co[k],co[k+1]],ctm));pts.push(mtxApply([co[k+2],co[k+3]],ctm));curves++;k+=4}
            else if(op===OPS.rectangle){const x=co[k],y=co[k+1],rw=co[k+2],rh=co[k+3];
              pts.push(mtxApply([x,y],ctm),mtxApply([x+rw,y],ctm),mtxApply([x+rw,y+rh],ctm),mtxApply([x,y+rh],ctm));k+=4}
            else if(op===OPS.closePath){}
          }
          pendingPts=pts; pendingCurves=curves; // paint op arrives next in v3
        }else{
          const paths=args[1]||[];
          for(const p of paths){
            for(let k=0;k<p.length;){
              const c=p[k];
              if(c===0||c===1){pts.push(mtxApply([p[k+1],p[k+2]],ctm));k+=3}
              else if(c===2){pts.push(mtxApply([p[k+1],p[k+2]],ctm));pts.push(mtxApply([p[k+3],p[k+4]],ctm));curves++;k+=5}
              else if(c===3){pts.push(mtxApply([p[k+1],p[k+2]],ctm));pts.push(mtxApply([p[k+3],p[k+4]],ctm));pts.push(mtxApply([p[k+5],p[k+6]],ctm));curves++;k+=7}
              else k+=1;
            }
          }
          pendingPts=pts; pendingCurves=curves; flush(args[0]);
        }
        continue;
      }
      if(pendingPts&&(fn===OPS.fill||fn===OPS.eoFill||fn===OPS.fillStroke||fn===OPS.eoFillStroke||fn===OPS.closeFillStroke||fn===OPS.closeEOFillStroke||fn===OPS.stroke||fn===OPS.closeStroke||fn===OPS.endPath)){flush(fn);continue}
    }
    return out;
  }

  async function scannerVectorSymbols(page,tc,areas,types){
    const OPS=(window.pdfjsLib&&window.pdfjsLib.OPS)||null;
    if(!OPS)return null;
    let ops; try{ops=await page.getOperatorList()}catch{return null}
    if(!ops||!ops.fnArray||!ops.fnArray.length)return null;
    const viewport=page.getViewport({scale:1});
    let paths; try{paths=scannerReadPaths(ops,viewport,OPS)}catch{return null}
    if(!paths.length)return null;
    // Sanity check: mapped geometry must actually land on the page. If the
    // operator format wasn't understood, coordinates come out nonsensical and we
    // bail to the pixel scanner rather than reporting confident nonsense.
    let gx0=Infinity,gy0=Infinity,gx1=-Infinity,gy1=-Infinity;
    for(const p of paths){gx0=Math.min(gx0,p.x0);gy0=Math.min(gy0,p.y0);gx1=Math.max(gx1,p.x1);gy1=Math.max(gy1,p.y1)}
    const covW=(gx1-gx0)/viewport.width, covH=(gy1-gy0)/viewport.height;
    if(!(covW>0.35&&covW<1.6&&covH>0.35&&covH<1.6))return null;

    const FILL=new Set([OPS.fill,OPS.eoFill,OPS.fillStroke,OPS.eoFillStroke,OPS.closeFillStroke,OPS.closeEOFillStroke]);
    const fills=paths.filter(p=>FILL.has(p.paintOp)&&p.w>0.5&&p.h>0.5);
    if(fills.length<8)return null;

    const texts=(tc.items||[]).map(it=>{const p=viewport.convertToViewportPoint(it.transform[4],it.transform[5]);return {s:String(it.str||'').trim(),x:p[0],y:p[1]}}).filter(t=>t.s);
    let legend=null;
    for(const t of texts){
      if(!/FÖRKLARINGAR|FORKLARINGAR|SYMBOLFÖRKLARING/i.test(t.s))continue;
      const right=t.x>viewport.width*.52;
      legend={x:right?t.x-45:t.x-25,y:t.y-55,w:right?viewport.width-t.x+45:Math.min(viewport.width*.42,620),h:Math.min(viewport.height-t.y+55,viewport.height*.92)};
      break;
    }
    // Calibrate against THIS drawing's own legend so it adapts per project and
    // per category (Kraft and Belysning legends define different symbols).
    // `want` picks WHICH fill beside the legend label is the symbol: the outlet
    // row wants the widest shape, the switch row wants the roundest one. Taking
    // simply the largest fill picked the wrong glyph on the switch row, which
    // then gave both a wrong reference size and a failed self-check below.
    function legendFillNear(re,exclude,want){
      for(const t of texts){
        if(!re.test(t.s)||(exclude&&exclude.test(t.s)))continue;
        if(legend&&(t.x<legend.x||t.x>legend.x+legend.w||t.y<legend.y||t.y>legend.y+legend.h))continue;
        const near=fills.filter(f=>f.cx<t.x-2&&f.cx>t.x-60&&Math.abs(f.cy-t.y)<12&&f.w>2&&f.h>2);
        if(!near.length)continue;
        if(want==='round'){
          const round=near.filter(f=>Math.max(f.w,f.h)/Math.max(.01,Math.min(f.w,f.h))<1.35)
                          .sort((a,b)=>(b.w*b.h)-(a.w*a.h));
          if(round.length)return round[0];
          continue;
        }
        return near.sort((a,b)=>(b.w*b.h)-(a.w*a.h))[0];
      }
      return null;
    }
    const domeRef=legendFillNear(/UTTAG/i,/VÄGGUTTAG\.|GOLVVÄRME|KOMBINATION/i);
    const circRef=legendFillNear(/STRÖMSTÄLLARE|BRYTARE/i,/KOMBINATION/i,'round');
    if(!domeRef&&!circRef)return null;
    const domeLong=domeRef?Math.max(domeRef.w,domeRef.h):11.3;
    const domeShort=domeRef?Math.min(domeRef.w,domeRef.h):5.6;
    const circD=circRef?(circRef.w+circRef.h)/2:5.6;

    // Hatched "belongs to another part of the drawing" areas are, in vector
    // terms, a cluster of many long parallel diagonal lines — an exact signature,
    // unlike the pixel-texture guess this used to rely on.
    const diags=[];
    for(const p of paths){
      if(p.npts!==2)continue;
      const [a,b]=p.pts, len=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(len<80)continue;
      let ang=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI; if(ang<0)ang+=180;
      if(ang<20||ang>160||(ang>70&&ang<110))continue;
      diags.push(p);
    }
    const used=new Array(diags.length).fill(false), zones=[];
    for(let i=0;i<diags.length;i++){
      if(used[i])continue;
      const group=[i]; used[i]=true;
      for(let g=0;g<group.length;g++){
        const A=diags[group[g]];
        for(let j=0;j<diags.length;j++){
          if(used[j])continue; const B=diags[j];
          if(Math.abs(A.cx-B.cx)<90&&Math.abs(A.cy-B.cy)<90){used[j]=true;group.push(j)}
        }
      }
      if(group.length<12)continue;
      let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
      for(const k of group){const d=diags[k];x0=Math.min(x0,d.x0);y0=Math.min(y0,d.y0);x1=Math.max(x1,d.x1);y1=Math.max(y1,d.y1)}
      zones.push({x0,y0,x1,y1});
    }

    // Telling a switch from a junction box ("dosa") needs more than "there is a
    // line touching the dot" — a dosa is a filled dot WITH a wire running out of
    // it, which is exactly what that test accepted, so dosor were counted as
    // switches. In the vector data the real difference is precise: a switch is
    // circle + operating arm + a short tick stroke roughly PERPENDICULAR to the
    // arm at its far end (the legend's own symbol measures arm ≈2×Ø and tick
    // ≈0.8×Ø at 90° to it). A plain wire leaving a dosa has no such tick.
    const segs=[];
    for(const p of paths){
      if(p.npts!==2)continue;
      const [a,b]=p.pts, len=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(len<1.2||len>60)continue;
      segs.push({a,b,len,ang:Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI});
    }
    const angDiff=(u,v)=>{let d=Math.abs(u-v)%180;return d>90?180-d:d};
    const hasArm=f=>{
      const d=Math.max(f.w,f.h), r=d/2;
      for(const arm of segs){
        if(arm.len<d*1.15||arm.len>d*3.6)continue;
        // one end of the arm must touch the circle, the other must reach away
        let nearEnd=null,farEnd=null;
        for(const q of [arm.a,arm.b]){
          const dist=Math.hypot(q[0]-f.cx,q[1]-f.cy);
          if(dist<r*2.4)nearEnd=q; else farEnd=q;
        }
        if(!nearEnd||!farEnd)continue;
        // Requiring ONE tick square to the arm was not enough: cable routes are
        // drawn with right-angle bends, so "segment into the dot, then a
        // perpendicular segment at its far end" also describes an ordinary
        // corner in a wire — which is why junction boxes and HT dots kept being
        // counted. The legend's switch glyph actually carries TWO short strokes
        // there (the return-spring marker), near-parallel to each other. A wire
        // corner has only the one continuing segment, so demanding a pair is
        // what separates them.
        const ticks=[];
        for(const t of segs){
          if(t===arm)continue;
          if(t.len<d*0.35||t.len>d*1.35)continue;
          if(angDiff(t.ang,arm.ang)<45)continue;
          const closest=Math.min(
            Math.hypot(t.a[0]-farEnd[0],t.a[1]-farEnd[1]),
            Math.hypot(t.b[0]-farEnd[0],t.b[1]-farEnd[1]));
          if(closest<d*1.15)ticks.push(t);
        }
        for(let i=0;i<ticks.length;i++)for(let j=i+1;j<ticks.length;j++){
          if(angDiff(ticks[i].ang,ticks[j].ang)<22)return true;  // the paired marker
        }
      }
      return false;
    };

    // Self-check: the arm+tick rule describes the "circle with operating arm"
    // switch glyph. Some categories (Kraft here) draw switches as something else
    // entirely — dome plus diagonals plus two dots. Running the circle rule on
    // those drawings produced confident nonsense (ceiling-box leader arrows and
    // floor-heating sensor dots counted as switches). So the rule is validated
    // against the drawing's OWN legend symbol first: if the legend's switch icon
    // does not itself pass the test, this glyph is not what we can recognise and
    // no switches are reported for that sheet. Precision before count — a clear
    // zero is honest, an inflated number is not.
    const switchRuleValid=!!(circRef&&hasArm(circRef));

    const inLegend=f=>legend&&f.cx>=legend.x&&f.cx<=legend.x+legend.w&&f.cy>=legend.y&&f.cy<=legend.y+legend.h;
    const inHatch=f=>zones.some(z=>f.cx>=z.x0&&f.cx<=z.x1&&f.cy>=z.y0&&f.cy<=z.y1);
    const inTitle=f=>f.cx>viewport.width*.80&&f.cy>viewport.height*.68;
    const tol=.34, near=(v,ref)=>Math.abs(v-ref)<=ref*tol;
    // A symbol placed on an angled wall is drawn rotated, which fattens its
    // axis-aligned bounding box (a dome measuring 11.3x5.6 upright came out as
    // 10.9x7.9 tilted) and made a strict width/height match miss it. Polygon
    // AREA is unaffected by rotation, so it is used as the primary size test
    // with the bbox only sanity-checking the overall footprint.
    const polyArea=f=>{const q=f.pts;let a=0;for(let i=0,j=q.length-1;i<q.length;j=i++)a+=(q[j][0]+q[i][0])*(q[j][1]-q[i][1]);return Math.abs(a/2)};
    const domeArea=domeRef?polyArea(domeRef):0;
    const vpAreas=scannerToViewportAreas(areas,viewport);

    const hits=[];
    for(const f of fills){
      if(inLegend(f)||inHatch(f)||inTitle(f))continue;
      const lo=Math.min(f.w,f.h), hi=Math.max(f.w,f.h), ratio=hi/Math.max(lo,.01);
      let type=null;
      const ar=domeArea?polyArea(f)/domeArea:0;
      // The area test alone let thin bars through: a 13.2x3.2 sliver (a mitred
      // corner in the wall hatch, a length of trunking drawn solid) has both the
      // right polygon area and the right long side, and only its SHORT side gives
      // it away. The dome's short side is therefore checked as well.
      if(types.outlets&&domeRef&&ar>.62&&ar<1.62&&hi>domeLong*.6&&hi<domeLong*1.5&&near(lo,domeShort)&&ratio>1.15)type='outlet';
      else if(types.switches&&switchRuleValid&&near(hi,circD)&&near(lo,circD)&&ratio<1.45&&hasArm(f))type='switch';
      if(!type)continue;
      const nearArea=scannerNearestArea(f.cx,f.cy,vpAreas,viewport.width,viewport.height);
      hits.push({type,score:.95,x:f.cx,y:f.cy,nx:f.cx/viewport.width,ny:f.cy/viewport.height,area:nearArea?.area||null});
    }
    // Merge radius has to follow the symbol being merged. One radius derived from
    // the OUTLET size (~11pt) was applied to switches too, but a switch circle is
    // only about half that — so a 2- or 3-gang switch, whose circles sit roughly
    // one diameter apart, was collapsed into a single hit. Each type is now
    // deduplicated against its own size.
    const outletHits=scannerNms(hits.filter(h=>h.type==='outlet'),Math.max(domeLong,domeShort)*.7);
    const switchHits=scannerNms(hits.filter(h=>h.type==='switch'),Math.max(4,circD*.75));
    return outletHits.concat(switchHits);
  }

  async function scannerVisualSymbols(page,tc,areas,types){
    if(!types.outlets&&!types.switches)return [];
    // Vector geometry first — exact, and far faster than rasterising. Falls back
    // automatically for scanned/raster PDFs or an unrecognised operator format.
    try{
      const v=await scannerVectorSymbols(page,tc,areas,types);
      if(v&&v.length)return v;
    }catch(e){ /* fall through to pixel scanning */ }
    return scannerPixelSymbols(page,tc,areas,types);
  }

  async function scannerPixelSymbols(page,tc,areas,types){
    if(!types.outlets&&!types.switches)return [];
    const base=page.getViewport({scale:1});
    // Symbols are tiny on a full sheet — at the old 2600px cap a real symbol was
    // only ~13x7 source pixels, too coarse for any shape test to work reliably.
    const scanScale=Math.min(3.2,5200/Math.max(1,base.width));
    const viewport=page.getViewport({scale:scanScale});
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(viewport.width));canvas.height=Math.max(1,Math.round(viewport.height));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({canvasContext:ctx,viewport}).promise;
    const img=ctx.getImageData(0,0,canvas.width,canvas.height),d=img.data,w=canvas.width,h=canvas.height,mask=new Uint8Array(w*h);
    for(let i=0,j=0;i<d.length;i+=4,j++){const lum=(d[i]*3+d[i+1]*6+d[i+2])/10;mask[j]=lum<92?1:0}
    canvas.width=1;canvas.height=1;
    const integral=buildIntegralImage(mask,w,h);
    const boxes=scannerTextBoxes(tc,viewport), vpAreas=scannerToViewportAreas(areas,viewport), zones=scannerExclusionZones(tc,viewport), hatch=scannerHatchCells(mask,w,h);
    const legendBox=scannerFindLegendBox(tc,viewport);

    // Calibrate this drawing's own dome/circle pixel size from its own legend.
    // The fused "switch in combination with outlet" line is excluded from both —
    // it names both words together, so left in it would skew either size upward.
    const domeSizes=legendBox?scannerCalibrateSize(mask,w,h,integral,tc.items,viewport,legendBox,/UTTAG/i,/VÄGGUTTAG\.|GOLVVÄRME|KOMBINATION/i):[];
    const circleSizes=legendBox?scannerCalibrateSize(mask,w,h,integral,tc.items,viewport,legendBox,/STRÖMSTÄLLARE|BRYTARE/i,/KOMBINATION/i):[];
    const domePw=scannerMedian(domeSizes.map(s=>s.pw))||Math.round(13*scanScale/1.09);
    const domePh=scannerMedian(domeSizes.map(s=>s.ph))||Math.round(7*scanScale/1.09);
    const circleD=scannerMedian(circleSizes.map(s=>Math.min(s.pw,s.ph)))||Math.round(8*scanScale/1.09);

    const cand=[];
    let scanned=0;
    for(let y=6;y<h-6;y+=3){
      for(let x=6;x<w-6;x+=3){
        if(scannerInZone(x,y,zones)||scannerInHatch(x,y,hatch)||scannerPointInText(x,y,boxes))continue;
        if(integralBoxDensity(integral,w,h,x-2,y-2,x+2,y+2)<.75)continue;
        let isDome=false,isCircle=false,score=0;
        if(types.outlets){
          const cls=scannerClassifyWindow(mask,w,h,x,y,domePw*1.15,domePh*1.35);
          if(cls.domeScore>.42){isDome=true;score=cls.domeScore}
        }
        if(types.switches&&!isDome){
          const cls=scannerClassifyWindow(mask,w,h,x,y,circleD*1.5,circleD*1.5);
          if(cls.circleScore>.30&&scannerHasArmStroke(mask,w,h,x,y,circleD/2)){isCircle=true;score=cls.circleScore}
        }
        if(!isDome&&!isCircle)continue;
        const near=scannerNearestArea(x,y,vpAreas,w,h);
        cand.push({type:isDome?'outlet':'switch',score:score*(near?.area?(.90+.10*near.confidence):.86),x,y,nx:x/Math.max(1,w),ny:y/Math.max(1,h),area:near?.area||null});
      }
      scanned++;
      // Yield periodically so a large/dense sheet doesn't block the UI thread.
      if((scanned&15)===0) await new Promise(r=>setTimeout(r,0));
    }
    return scannerNms(cand,Math.max(domePw,domePh)*.7);
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
    // The hero shows totals across every selected drawing. It used to be headed
    // with the FIRST apartment's name while displaying those project-wide
    // totals, and its tiles opened a review filtered to that one apartment — so
    // the tile could read "72 st" and then circle four symbols. Totals are now
    // labelled as totals, and the tiles review every matching hit ("*").
    const areaCount=entries.filter(b=>b.name!=='Ej områdesbestämt').length;
    const hero=`<section class="counter-symbol-panel">
      <div class="counter-symbol-head"><div><small>Totalt – alla valda ritningar</small><h2>${areaCount} ${areaCount===1?'område':'områden'}</h2></div><span class="counter-scan-badge">${pages} sidor</span></div>
      <div class="counter-symbol-grid">
        <button class="counter-symbol-tile" data-review-area="*" data-review-symbol="Uttag"><span class="counter-symbol-icon">◉</span><span>Uttag totalt</span><strong>${outletTotal} st</strong></button>
        <button class="counter-symbol-tile" data-review-area="*" data-review-symbol="Strömställare"><span class="counter-symbol-icon">⌁</span><span>Strömställare totalt</span><strong>${switchTotal} st</strong></button>
        <div class="counter-symbol-tile static"><span class="counter-symbol-icon">✣</span><span>Armaturer totalt</span><strong>${armatureTotal} st</strong></div>
      </div>
      <p class="counter-hero-note muted">Fördelningen per lägenhet/område står i korten nedan.</p>
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
    const all=String(areaName)==='*';
    return (state.scannerSession?.hits||[]).filter(h=>
      (all||String(h.areaName)===String(areaName))&&
      String(h.symbol)===String(symbol)&&
      (!category||String(h.category)===String(category)));
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
    bar.querySelector('#scannerReviewTitle').textContent=`${r.areaName==='*'?'Alla områden':r.areaName} · ${r.symbol}`;
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
      // "Visa markeringar" should show everything found, not just whichever area
      // the first hit happened to belong to.
      const h=state.scannerSession?.hits?.[0];if(h)openScannerReview('*',h.symbol);else toast('Inga scannerträffar att visa');
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
    ctx.save();ctx.strokeStyle=accentColor();ctx.fillStyle=accentColor();ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
    if(a.type==='pen'&&a.points?.length){ctx.beginPath();a.points.forEach((p,i)=>{const q=px(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke()}
    if(a.type==='arrow'&&a.points?.length>=2){const p=px(a.points[0]),q=px(a.points[1]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();const an=Math.atan2(q.y-p.y,q.x-p.x);ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-10*Math.cos(an-.48),q.y-10*Math.sin(an-.48));ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-10*Math.cos(an+.48),q.y-10*Math.sin(an+.48));ctx.stroke()}
    if(a.type==='circle'&&a.points?.length>=2){const p=px(a.points[0]),q=px(a.points[1]);ctx.beginPath();ctx.ellipse((p.x+q.x)/2,(p.y+q.y)/2,Math.max(3,Math.abs(q.x-p.x)/2),Math.max(3,Math.abs(q.y-p.y)/2),0,0,Math.PI*2);ctx.stroke()}
    if(a.type==='text'&&a.points?.length){const p=px(a.points[0]);ctx.font='bold 18px Arial,sans-serif';ctx.lineWidth=4;ctx.strokeStyle='rgba(255,255,255,.92)';ctx.strokeText(a.text||'',p.x,p.y);ctx.fillStyle=accentColor();ctx.fillText(a.text||'',p.x,p.y)}
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
  function showMeasureMagnifier(e){const mag=$("#measureMagnifier"),base=$("#pdfCanvas"),over=$("#overlayCanvas"),vp=$("#pdfViewport");if(!mag||!base)return;mag.classList.remove("hidden");const vr=vp.getBoundingClientRect();mag.style.left=Math.max(8,Math.min(vp.clientWidth-160,e.clientX-vr.left-75))+"px";mag.style.top=Math.max(8,e.clientY-vr.top-190)+"px";const ctx=mag.getContext("2d"),r=over.getBoundingClientRect(),sx=(e.clientX-r.left)*(over.width/r.width),sy=(e.clientY-r.top)*(over.height/r.height),crop=45;ctx.clearRect(0,0,180,180);ctx.drawImage(base,sx-crop,sy-crop,crop*2,crop*2,0,0,180,180);ctx.strokeStyle=accentColor();ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(90,68);ctx.lineTo(90,112);ctx.moveTo(68,90);ctx.lineTo(112,90);ctx.stroke();}
  function hideMeasureMagnifier(){$("#measureMagnifier")?.classList.add("hidden")}
  $$(".nav-btn").forEach(b=>b.onclick=()=>{showView(b.dataset.view); if(b.dataset.view==="projectsView")renderProjects(); if(b.dataset.view==="drawingsView")renderAllDrawings(); if(b.dataset.view==="todoView"){renderCrew();renderTodos()} if(b.dataset.view==="ataView")renderAtas(); if(b.dataset.view==="counterView")renderCounter()});
  // Version history, shown in Inställningar → Om appen. Kept inline so it works
  // offline on site (no network on a building site) and stays in step with the
  // build it actually shipped with.
  const CHANGELOG=[
    {v:"9.3.0",d:"Avståndsmätningen ritas nu som en riktig måttsättning: tunn linje med ändstreck, öppna ändpunkter så själva punkten syns, och värdet på en kompakt bricka vid sidan av linjen. Tidigare feta prickar, boxade A/B-bokstäver och ett stort etikettblock är borta."},
    {v:"9.2.1",d:"Ledningsverktyget lämnade en lös mätpunkt vid varje tryck — klickhanteraren undantog alla verktyg utom det nya. Markeringen passerar nu även genom dosor till sista linjen, men stannar där linjer bara korsar varandra utan dosa."},
    {v:"9.2.0",d:"Effekterna går nu att slå av och på var för sig och kombineras fritt med vilket tema som helst — snö, scanlines, norrsken och rutnät. Valet sparas per tema. Versionshistoriken låg på två ställen och är samlad under Om EKIS FIELD."},
    {v:"9.1.1",d:"Startskärmen visade en ifylld rektangel i stället för EKIS-texten i Himmelsblå och Julafton. CSS-genvägen background nollställer background-clip, och i temaomgången sattes bara bakgrunden om utan att upprepa klippningen."},
    {v:"9.1.0",d:"Två nya teman med rörelse: \"Cyberpunk\" med magenta, cyan, scanlines och ett ljusband som sveper, och \"Norrsken\" med två slöjor som driver i olika takt över vinternatt. All animation pausas när en ritning är öppen och för den som valt reducerad rörelse."},
    {v:"9.0.2",d:"Ledningsmarkeringen gjorde avstick vid dörrar och möbler. De ritas som kedjor av mycket korta segment medan en kabel ritas med få långa, och de viker av i udda vinklar. Vandringen följer nu bara segment av kabellängd som fortsätter rakt fram eller svänger rätvinkligt."},
    {v:"9.0.1",d:"Ledningsmarkeringen: glöden borttagen, nu en ren linje. Markeringen stannar också vid förgreningar — alla kablar i en lägenhet möts ju vid centralen, så en fri spridning nådde hela kretsnätet och följde med längs väggar."},
    {v:"9.0.0",d:"Alla fyra teman genomgångna. Svart har fått djup, gradienter och glöd — det hade aldrig fått samma behandling som de nyare. Vit har svalare bas och riktiga skuggor så korten lyfter. Himmelsblå är klarare och mer neon. Julafton bär nu rött lika mycket som guld."},
    {v:"8.9.3",d:"Ett andra tryck på en markerad ledning släcker den nu. Tidigare markerades samma ledning bara om igen, och enda vägen ur var att trycka på tom yta, byta verktyg eller gå bakåt."},
    {v:"8.9.2",d:"Ledningsverktyget följer nu den tryckta linjens EGEN färg i stället för en fast tröskel. Färgerna skiljer sig mellan ritningar och projekt, så en inställd gräns skulle spricka på nästa jobb. Nu kalibrerar det sig självt."},
    {v:"8.9.1",d:"Ledningsverktyget följer nu bara el-linjerna. Den tjocka samlingsledningen visade sig vara en fylld grå form, inte en linje, och byggnadsritningen är grå streck — el är svart. Färgen skiljer dem, vilket tar bort 96 procent av geometrin och gör markeringen både korrekt och direkt."},
    {v:"8.9.0",d:"Nytt verktyg \"Ledning\": tryck på en kabel så markeras hela den sammanhängande dragningen i temats färg, med uppskattad längd. Korsande linjer följer inte med — två linjer kopplas bara ihop om deras ändpunkter faktiskt möts, precis som i ritningen."},
    {v:"8.8.0",d:"Nytt tema \"Julafton\": granmörk bas, varm guldaccent som levande ljus, och mjuk snö som faller bakom innehållet. Snön pausas automatiskt när en ritning är öppen, i bakgrunden, och för den som valt reducerad rörelse i systemet."},
    {v:"8.7.0",d:"Räknarvyn omgjord. Knappen satt inklämd i rubrikraden och krockade med texten; den ligger nu i en fast åtgärdsrad längst ned tillsammans med statusraden, visar hur många ritningar som ska scannas och är avstängd tills något är valt. De tre korten är numrerade steg."},
    {v:"8.6.0",d:"Flerpoliga strömställare räknas nu var för sig. Sammanslagningen av närliggande träffar utgick från uttagets storlek, som är ungefär dubbelt så stor som strömställarens — därför slogs en 2- eller 3-grupp ihop till en enda. Varje symboltyp jämförs nu mot sin egen storlek."},
    {v:"8.5.0",d:"AR-mätaren: hårkorset visar nu live om ytan under det är pålitlig, med avståndet utskrivet. En punkt kan bara sättas när avläsningen legat stilla en stund — ostadiga avläsningar var källan till de vilda måtten. Varnar också om spårningen tappats mellan punkterna. Himmelsblå har fått en klarare, ljusare blå ton."},
    {v:"8.4.0",d:"AR-mätaren har fått en diagnostikvy (knappen Diag) som visar spårningsstatus, antal plan, djupstöd, display-geometri och varje mätpunkts data. Appen säger nu också varför spårningen fallerar — t.ex. för mörkt i rummet, vilket gör alla mätningar opålitliga."},
    {v:"8.3.1",d:"Ritningen centreras nu vertikalt i helskärm — en CSS-regel med !important nollställde marginalen och slog ut centreringen. AR: display-geometrin nådde inte alltid ARCore, vilket gjorde att varje tryck träffade fel del av scenen. Mätsträckor över 15 m avvisas nu."},
    {v:"8.3.0",d:"AR-mätaren stabiliserad. Råa featurepunkter accepteras inte längre — de kan ligga på nästan vilket djup som helst och var orsaken till vilt fel mått. Gränssnittet uppdaterades 60 ggr/s vilket gav flimret; nu några gånger i sekunden och bara vid faktisk ändring. Måttet medianfiltreras."},
    {v:"8.2.2",d:"Dosor räknades fortfarande som strömställare. Kabelvägar ritas med räta vinklar, så \"ledning in i punkten + vinkelrätt segment i dess ände\" beskriver också en vanlig kabelböj. Strömställarens symbol har i själva verket TVÅ korta parallella streck där (återfjädringsmärket) — ett par krävs nu."},
    {v:"8.2.1",d:"Himmelsblå gick inte att välja — temat saknades i listan över giltiga teman, så valet föll tillbaka på mörkt. Ritningen trycktes också ned i ramen: den vertikala centreringen lades på även när ramen redan anpassar sig efter innehållet."},
    {v:"8.2.0",d:"Nytt tema \"Himmelsblå\": djup azurbas, ljus himmelsblå accent och mjuka molnslöjor i bakgrunden. Loggan och startskärmen får en himmelsgradient. Temat följer med hela vägen ut i AR-mätvyn."},
    {v:"8.1.0",d:"Strömställare skiljs nu från dosor. Testet krävde bara ett streck vid cirkeln — men en dosa är också en prick med en ledning. Nu krävs det korta tvärstrecket vinkelrätt mot manöverarmens yttre ände, som bara strömställaren har. Kalibreringen tar den runda symbolen ur legenden i stället för den största."},
    {v:"8.0.1",d:"AR-vyn följer nu temat fullt ut. Accentfärgen följde redan med, men bakgrunder, knappar och måttetikett var hårdkodade mörka och blev därför fel i Vit-temat."},
    {v:"8.0.0",d:"AR-mätning med kameran (ARCore). Sikta med hårkorset, tryck för punkt A, gå till punkt B och tryck igen — ARCore spårar rummet i 3D så punkterna sitter kvar i verkligheten och avståndet blir ett riktigt mått i meter. Knappen visas bara på telefoner som stödjer ARCore."},
    {v:"7.7.0",d:"Räknarens översta ruta visade projektets totalsumma men var rubricerad med en enda lägenhets namn, och trycket på den visade bara den lägenhetens markeringar. Totalen är nu tydligt märkt som total och visar alla träffar; fördelningen per lägenhet står i korten nedanför."},
    {v:"7.6.0",d:"Ramen runt ritningen hugger nu ritningen i stället för att fortsätta långt under den. Neon-temat omgjort till en djupare, mättad grönska. Kryssrutor och ÄTA-ikoner följer temat — de var systemblå respektive emoji."},
    {v:"7.5.0",d:"Panorering inzoomad når nu hela ritningen — den centrerade layouten lade vänsterkanten på negativ scrollposition som inte gick att nå. Neon-temat täcker nu hela appen inklusive loggan. Rutnätsbakgrunden finns i alla tre teman."},
    {v:"7.4.0",d:"Nytt tema \"Neon\" — svart och grönt med diskret glöd och rutnätsbakgrund. Markeringar och mått på ritningen följer nu temats färg i stället för att alltid vara orange. Versionshistoriken samlad: den äldre historiken från README-filerna är inflyttad hit."},
    {v:"7.3.0",d:"Armaturer från Occhio-förteckningen går nu att trycka på. Ritningar som använder Occhio märker armaturerna \"position.instans\" (t.ex. 3.1, 3.2) medan förteckningens poster hette \"POS 03\" — de kunde därför aldrig matcha varandra. Occhio-poster ingår nu även i produktnamnsmatchningen."},
    {v:"7.2.0",d:"Ritningen centreras nu korrekt (flexbox i stället för JS-mätning som motverkades av gamla CSS-regler). Dialogrutor fungerar i helskärm — tidigare öppnades de osynligt bakom helskärmsvyn, så radering och textverktyg verkade inte göra något. Pennan ritar mjuka linjer utan punktspår. Bläddringspilarna symmetriska. Roterade symboler hittas nu av räknaren."},
    {v:"7.1.0",d:"Helskärmsläget omgjort: tomma toppbaren borta, kompakt namn-pill, smal ikonrad och ett tryck på ritningen döljer all meny. Nya enhetliga verktygsikoner. Bakåtknappen stänger inte längre appen när en dialog är öppen."},
    {v:"7.0.0",d:"Räknaren ombyggd på vektorgeometri: läser ritningens faktiska ritkommandon i stället för att gissa former ur pixlar. Skrafferade referensytor exkluderas nu exakt. 3–4× snabbare."},
    {v:"6.5",  d:"Helskärmsläget räknar om anpassningen flera gånger tills layouten satt sig, i stället för en enda fast fördröjning."},
    {v:"6.4",  d:"Förstoringsglaset följer fingret redan vid första mätpunkten, och även när pilen dras. Ny startanimation. Skrafferingstest känner igen tjocka kablar."},
    {v:"6.3",  d:"Zoomen räknas om vid växling till helskärm."},
    {v:"6.2",  d:"Bläddring följer logisk ritningsordning. Nya bläddringspilar. Text med halo. Nyp med två fingrar ändrar textstorlek."},
    {v:"6.1",  d:"Räknarens träffmarkörer följer inte längre med till fel ritning."},
    {v:"6.0",  d:"Ny symbolklassificering, dubblad skanningsupplösning och kalibrering mot ritningens egen förklaring."},
    {v:"5.1.5",d:"Centrering av ritningen även i normalläget. Pilens ändpunkter kan justeras separat."},
    {v:"4",    d:"Ritningen öppnas i Passa-läge. Swipe byter ritning endast utzoomad. Synka plan: två referenspunkter kompenserar för förskjutning, skala och rotation mellan våningsplan."},
    {v:"3.1",  d:"Rak A–B-mätning. Automatisk skala från SKALA 1:xx. Area-kalibrering mot utskriven rumsarea. Smart armaturmatchning mot Occhio-översikt."},
    {v:"3",    d:"Pinch-zoom direkt på ritningsytan. Våningsväljare och Lås vy. Ritningsanalys med plan och del. Armaturförteckningar som smarta dokument. Att göra-lista."},
    {v:"2",    d:"Nyp/zoom med två fingrar, panorering, swipe mellan ritningar, helskärm och zoomindikator."},
    {v:"1",    d:"Projekt, PDF- och ZIP-import, skala per sida, kalibrering, avstånd, sträcka och area, export och backup."}
  ];
  // The release list lives in one place only: Inställningar → Om EKIS FIELD.
  // It used to be duplicated in a second card, so newer entries appeared in one
  // spot and the older ones in another.
  (function renderChangelog(){
    const box=$("#changelogAuto"); if(!box)return;
    box.innerHTML=CHANGELOG.map((c,i)=>
      `<details class="release-note"${i===0?' open':''}><summary><span><b>${esc(c.v)}</b></span>${i===0?'<em>Senaste</em>':''}</summary><p>${esc(c.d)}</p></details>`
    ).join("");
  })();

  // ---- AR-mätning (ARCore) ----
  // Only shown where it can actually work: the native bridge reports whether
  // this device supports ARCore. On anything else (or in a plain browser) the
  // button stays hidden rather than offering a feature that would fail.
  (function initArMeasure(){
    const row=$("#arMeasureRow"), btn=$("#arMeasureBtn");
    if(!row||!btn)return;
    let available=false;
    try{available=!!(window.Android&&typeof Android.arMeasureAvailable==="function"&&Android.arMeasureAvailable())}catch{available=false}
    row.classList.toggle("hidden",!available);
    if(!available)return;
    btn.addEventListener("click",()=>{
      try{Android.startArMeasure(accentColor(),state.meta.theme||"dark")}
      catch(e){toast("Kunde inte starta AR-mätning")}
    });
  })();

  // Called from the native measure view when the user accepts a measurement.
  window.ekisArMeasureResult=function(meters){
    const m=Number(meters);
    if(!isFinite(m)||m<=0)return;
    state.lastArMeasure=m;
    const txt=m<1?`${Math.round(m*1000)} mm`:`${m.toFixed(2)} m`;
    const res=$("#measureResult"); if(res)res.textContent=txt;
    toast(`Uppmätt: ${txt}`);
  };
  window.ekisArMeasureCancelled=function(){};

  // ---- Snö (endast Julafton-temat) ----
  // Ritas på en egen canvas bakom innehållet. En canvas i stället för många
  // DOM-element håller kostnaden nere, och slingan stoppas helt när temat inte
  // är aktivt, när appen ligger i bakgrunden, eller när en ritning är öppen —
  // panorering och zoom av en PDF ska aldrig behöva konkurrera med dekoration.
  const snow=(function(){
    let canvas=null,ctx=null,flakes=[],raf=null,w=0,h=0,dpr=1;
    const reduced=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function ensure(){
      if(canvas)return;
      canvas=document.createElement("canvas");
      canvas.id="snowLayer";
      canvas.setAttribute("aria-hidden","true");
      document.body.appendChild(canvas);
      ctx=canvas.getContext("2d");
      resize();
      window.addEventListener("resize",resize);
    }
    function resize(){
      if(!canvas)return;
      dpr=Math.min(2,window.devicePixelRatio||1);
      w=window.innerWidth; h=window.innerHeight;
      canvas.width=Math.round(w*dpr); canvas.height=Math.round(h*dpr);
      canvas.style.width=w+"px"; canvas.style.height=h+"px";
      ctx.setTransform(dpr,0,0,dpr,0,0);
      build();
    }
    function build(){
      // Density scales with the viewport so a tablet does not get a blizzard
      // and a phone a drizzle.
      const n=Math.round(Math.min(70,Math.max(26,(w*h)/26000)));
      flakes=[];
      for(let i=0;i<n;i++)flakes.push(seed(true));
    }
    function seed(anywhere){
      const r=0.7+Math.random()*2.1;
      return {
        x:Math.random()*w,
        y:anywhere?Math.random()*h:-8-Math.random()*40,
        r,
        // Bigger flakes fall a little faster and are a little brighter: a cheap
        // depth cue that stops the snow looking like uniform static.
        vy:(6+r*7)/60,
        drift:(Math.random()*0.5-0.25),
        phase:Math.random()*Math.PI*2,
        sway:0.25+Math.random()*0.5,
        alpha:0.18+ (r/2.8)*0.42
      };
    }
    function frame(){
      raf=null;
      if(!ctx)return;
      ctx.clearRect(0,0,w,h);
      for(const f of flakes){
        f.y+=f.vy;
        f.phase+=0.008;
        f.x+=f.drift+Math.sin(f.phase)*f.sway*0.35;
        if(f.y-f.r>h||f.x<-20||f.x>w+20)Object.assign(f,seed(false));
        ctx.beginPath();
        ctx.fillStyle=`rgba(255,252,244,${f.alpha})`;
        ctx.arc(f.x,f.y,f.r,0,Math.PI*2);
        ctx.fill();
      }
      schedule();
    }
    function schedule(){ if(!raf&&running())raf=requestAnimationFrame(frame); }
    function running(){
      return document.body.classList.contains("fx-snow") && !document.hidden && state.currentView!=="viewerView" && !reduced;
    }
    function sync(){
      if(!document.body.classList.contains("fx-snow")){ stop(); return; }
      ensure();
      if(reduced){ // static, gentle scatter for users who asked for less motion
        if(ctx){ ctx.clearRect(0,0,w,h);
          for(const f of flakes){ctx.beginPath();ctx.fillStyle=`rgba(255,252,244,${f.alpha*0.8})`;ctx.arc(f.x,f.y,f.r,0,Math.PI*2);ctx.fill()} }
        return;
      }
      schedule();
    }
    function stop(){
      if(raf){cancelAnimationFrame(raf);raf=null}
      if(ctx&&canvas)ctx.clearRect(0,0,w,h);
    }
    document.addEventListener("visibilitychange",()=>{ document.hidden?stop():sync(); });
    return {sync,stop};
  })();

  // Effects are independent of the theme: each theme merely supplies the
  // defaults, and any effect can then be turned on or off and combined freely.
  const FX_DEFAULTS={
    dark:{snow:false,scan:false,aurora:false,grid:true,glow:false,eq:false},
    light:{snow:false,scan:false,aurora:false,grid:true,glow:false,eq:false},
    neon:{snow:false,scan:false,aurora:false,grid:true,glow:false,eq:false},
    sky:{snow:false,scan:false,aurora:false,grid:true,glow:false,eq:false},
    jul:{snow:true,scan:false,aurora:false,grid:true,glow:false,eq:false},
    cyber:{snow:false,scan:true,aurora:false,grid:true,glow:false,eq:false},
    aurora:{snow:false,scan:false,aurora:true,grid:true,glow:false,eq:false},
    amp:{snow:false,scan:false,aurora:false,grid:false,glow:true,eq:true}
  };
  function effectsFor(theme){
    const base=FX_DEFAULTS[theme]||FX_DEFAULTS.dark;
    const saved=(state.meta.fx&&state.meta.fx[theme])||null;
    return Object.assign({},base,saved||{});
  }
  function applyEffects(){
    const t=state.meta.theme||"dark", fx=effectsFor(t);
    const b=document.body.classList;
    b.toggle("fx-snow",!!fx.snow);
    b.toggle("fx-scan",!!fx.scan);
    b.toggle("fx-aurora",!!fx.aurora);
    b.toggle("fx-grid",!!fx.grid);
    b.toggle("fx-glow",!!fx.glow);
    b.toggle("fx-eq",!!fx.eq);
    document.querySelectorAll("[data-fx]").forEach(cb=>{cb.checked=!!fx[cb.dataset.fx]});
    try{snow.sync()}catch{}
  }

  $$("[data-fx]").forEach(cb=>cb.onchange=()=>{
    const t=state.meta.theme||"dark";
    state.meta.fx=state.meta.fx||{};
    state.meta.fx[t]=Object.assign({},effectsFor(t),{[cb.dataset.fx]:cb.checked});
    saveMeta(); applyEffects();
  });

  const THEME_NAMES={dark:'Svart',light:'Vit',neon:'Neon',sky:'Himmelsblå',jul:'Julafton',cyber:'Cyberpunk',aurora:'Norrsken',amp:'Retroamp'};
  $$('[data-theme-choice]').forEach(b=>b.onclick=()=>{const t=b.dataset.themeChoice;applyTheme(t,true);toast(`${THEME_NAMES[t]||'Tema'} aktiverat`)});
  const accentSlider=$("#accentSlider");
  if(accentSlider){
    accentSlider.oninput=()=>applyAccent(accentSlider.value,false);
    accentSlider.onchange=()=>{applyAccent(accentSlider.value,true);toast('Accentfärg sparad')};
  }
  const accentResetBtn=$("#accentResetBtn");
  if(accentResetBtn)accentResetBtn.onclick=()=>{applyAccent(null,true);toast('Temats egen färg återställd')};
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
  $('#textLargerBtn').onclick=()=>{const a=selectedText();if(!a)return;a.fontSize=Math.min(64,(Number(a.fontSize)||16)+2);saveMeta();drawOverlay()};
  $('#editSelectedTextBtn').onclick=()=>{const a=selectedText();if(!a)return;const r=$('#overlayCanvas').getBoundingClientRect(),sc=state.renderScale*state.viewZoom,p=a.points[0];openDirectTextEditor(r.left+p.x*sc,r.top+p.y*sc,p,a)};
  $('#deleteSelectedBtn').onclick=async()=>{const h=state.selectedOverlay;if(!h)return;if(!await confirmDelete('Ta bort från ritning?','Vill du verkligen ta bort den markerade mätningen/markeringen?'))return;if(h.kind==='measure'){const arr=getMeasurements(),i=arr.findIndex(x=>x.id===h.obj.id);if(i>=0)arr.splice(i,1)}else{const arr=getAnnotations(),i=arr.findIndex(x=>x.id===h.obj.id);if(i>=0)arr.splice(i,1)}state.selectedOverlay=null;$('#deleteSelectedBtn').classList.add('hidden');$('#textSmallerBtn').classList.add('hidden');$('#textLargerBtn').classList.add('hidden');$('#editSelectedTextBtn').classList.add('hidden');saveMeta();drawOverlay()};
  $('#riserBtn').onclick=()=>setRiserMode(!state.riserMode);
  $('#riserUpBtn').onclick=()=>openAdjacentFloor(1);
  $('#riserDownBtn').onclick=()=>openAdjacentFloor(-1);
  $("#newTodoBtn").onclick=async()=>{const t=await promptModal("Ny uppgift","Vad ska göras?","");if(!t)return;const pr=await promptModal("Prioritet","Skriv Normal, Viktig eller Akut.","Normal");const due=await promptModal("Deadline","Datum YYYY-MM-DD, eller lämna tomt.","");state.meta.todos.unshift({id:uid(),text:t,done:false,priority:["Normal","Viktig","Akut"].find(x=>x.toLowerCase()===String(pr||"").toLowerCase())||"Normal",due:/^\d{4}-\d{2}-\d{2}$/.test(due||"")?due:"",projectId:state.currentProjectId||null,assignee:state.crewFilter||null});saveMeta();renderCrew();renderTodos()};
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
  $("#counterSelectAllBtn").onclick=()=>{const boxes=$$("[data-counter-file]");const all=boxes.length&&boxes.every(x=>x.checked);boxes.forEach(x=>{x.checked=!all;!all?state.counterSelected.add(x.dataset.counterFile):state.counterSelected.delete(x.dataset.counterFile)});renderCounterSelectionBadge();};
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
  (function installViewportResizeHandler(){
    let raf=null;
    const recompute=()=>{
      raf=null;
      if(state.currentView!=="viewerView"||!state.baseCanvasWidth||!state.baseCanvasHeight)return;
      const wasFit=isFullyZoomedOut();
      state.fitZoom=computeFitZoom();
      if(wasFit)state.viewZoom=state.fitZoom;
      else state.viewZoom=clamp(state.viewZoom,state.fitZoom,Math.max(6,state.fitZoom*10));
      applyZoom(false);
    };
    const schedule=()=>{if(raf)cancelAnimationFrame(raf);raf=requestAnimationFrame(recompute)};
    window.addEventListener("resize",schedule);
    window.addEventListener("orientationchange",()=>setTimeout(schedule,150));
  })();
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
  applyAccent(state.meta.accent??null,false);
  try{applyEffects()}catch{}
  installViewerGestures();
  renderProjects(); renderAllDrawings(); renderCrew(); renderTodos();
})();
