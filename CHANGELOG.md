# EKIS FIELD – Versionshistorik

---

## 9.0.2 (build 72)

**Inga avstick vid dörrar och möbler**
- Markeringen vek av in i dörrslag och annan ritningsdetalj som råkade dela ändpunkt med kabeln. Två egenskaper skiljer dem åt, och båda används nu:
  - **Segmentlängd.** Dörrslag, möbler och andra kurvor ritas som kedjor av mycket korta segment; en kabel ritas med få långa. Vandringen går inte in i korta segment.
  - **Riktning.** En kabel fortsätter rakt fram eller svänger rätvinkligt. Ett segment som lämnar i en udda vinkel hör till något annat och följs inte.
- Tillsammans med förgreningsstoppet från 9.0.1 gör det att markeringen håller sig till den kabel man faktiskt tryckte på.

---

## 9.0.1 (build 71)

**Ledningsmarkeringen följer bara sin egen kabel**
- Glöden är borttagen. Den breda mjuka linjen under läste som ett sken snarare än som en markerad kabel, och gjorde det otydligt var ledningen faktiskt gick. Nu en ren linje i temats färg.
- Markeringen spred sig tidigare långt utanför kabeln. Orsaken var inte filtreringen utan elen själv: **alla kablar i en lägenhet möts vid centralen**, så en fri spridning från en kabel når hela kretsnätet — och därmed även linjer som visuellt ser ut att höra till något annat.
- En enskild kabel är sträckan **mellan förgreningar**. Vandringen stannar nu vid varje punkt där tre eller fler segment möts. Själva förgreningen ingår, men inget bortom den.
- Taket sänkt från 6000 till 2000 segment, eftersom en enskild dragning aldrig är i den storleksordningen.

---

## 9.0.0 (build 70)

**Alla fyra teman genomgångna**

*Svart*
- Standardtemat hade aldrig fått samma behandling som de nyare — platta ytor, ingen glöd, ingen gradient. Nu ett varmt orange sken uppifrån, mörkare botten, panelgradienter med inre kantljus och glöd på aktiva element. Ser ut som en medveten mörk yta i stället för bara frånvaro av ljus.

*Vit*
- Var i praktiken grått på vitt. Nu en svalare blågrå bas med riktiga skuggor, så korten lyfter från underlaget i stället för att ligga i det. Orange accent med gradient och mjuk skugga, och ett svagt orange/blått sken i bakgrunden.

*Himmelsblå*
- Klarare och mer neon: djupare bas, ljusare cyanblå accent och kraftigare glöd. Loggan och startskärmen följer med.

*Julafton*
- Guld ensamt läste mer "lyx" än "jul". Rött bär nu lika mycket som guldet: rött sken vid sidan av det gyllene, röd rubriktext, röda stegsiffror, och en logga som går från guld ner i djupt rött — som gran med kulor.

Temaväljarens miniatyrer, statusfältets färg och AR-mätvyns färger följer alla med.

---

## 8.9.3 (build 69)

**Andra trycket släcker ledningen**
- Ett tryck på en redan markerad ledning markerade bara samma ledning om igen. Enda vägen ur var att trycka på tom yta, byta verktyg eller gå bakåt — inget av det är vad ett andra tryck rimligen ska betyda.
- Trycker man nu på den markerade dragningen släcks den. Trycker man på en annan ledning byter markeringen dit som förut.

---

## 8.9.2 (build 68)

**Ledningsverktyget kalibrerar sig självt**
- Färgfiltret i 8.9.1 byggde på en fast luminansgräns, kalibrerad mot de ritningar som fanns till hands. Färgerna skiljer sig mellan ritningar och projekt, så den gränsen skulle förr eller senare hamna fel.
- Markeringen följer nu **den tryckta linjens egen färg**. Ingen tröskel behövs: trycker du på en svart ledning följs svart, ritar ett annat projekt sina kablar i blått följs blått.
- Den tjocka samlingsledningen och den gråtonade byggnadsritningen utesluts automatiskt, eftersom ingen av dem delar kabelns färg — inte för att någon gräns är inställd.
- En liten tolerans tillåts, så en dragning ritad i två närmast identiska nyanser ändå hänger ihop.
- Verifierat på P9: ett tryck på en svart ledning kan nå högst 2 479 segment och aldrig de 53 286 gråa arkitekturlinjerna.

---

## 8.9.1 (build 67)

**Ledningsverktyget följer bara el-linjerna**
- Undersökningen av P9 gav två svar som ingen av oss förutsåg:
  - Den tjocka **samlingsledningen är ingen linje alls** utan en *fylld* grå bandform (`#646464`). Den ingick därför aldrig i markeringen — verktyget följer bara streck.
  - Byggnadsritningen under är ritad med **gråa** streck (`#ababab`, ca 85 000 stycken) medan el-linjerna är **svarta** (ca 3 000). Det var arkitekturen som riskerade att svälla ut markeringen, inte huvudledningen.
- Grafen bygger nu bara på mörka streck. Ett luminanstest används i stället för exakt färgmatchning, så en ritning med en något annan grå ton fortfarande separeras rätt.
- Effekt: från 56 035 till 2 479 segment på P9, och 76 200 till 5 743 på P18. Markeringen blir både korrekt avgränsad och omedelbar.
- Linjebredd visade sig sakna signal i dessa ritningar (allt ritas 0,24pt, och `setGState` förekommer inte), så färgen är den bärande skillnaden.

---

## 8.9.0 (build 66)

**Nytt verktyg: Ledning**
- Tryck på en kabel i ritningen så markeras hela den sammanhängande dragningen i temats accentfärg, tillsammans med en uppskattad längd i vald skala.
- **Korsande linjer följer inte med.** Två segment kopplas bara ihop om deras *ändpunkter* möts. En linje som korsar en annan skär den mitt på sträckan och delar därför ingen ändpunkt — precis som i verkligheten är en korsning inte en förbindelse.
- Bygger på samma vektorutdrag som räknaren: ritningens faktiska linjegeometri, inte pixlar. Linjerna läses in första gången verktyget används på en ritning och sparas sedan i minnet.
- Markeringen ritas som ett brett mjukt sken under en tunn heldragen linje, så originalritningen förblir läsbar under.
- Bakåtknappen och byte av verktyg rensar markeringen.

**Känd begränsning**
- Byggnadslinjer hänger ihop över hela ritningen. Trycker man på en vägg i stället för en kabel kan markeringen därför bli mycket stor — då visas ett meddelande om det i stället för en längd som inte betyder något.
- Linjebredd används för att stoppa vid tydligt olika linjevikter, men i de testade ritningarna är nästan all geometri ritad med samma bredd, så den signalen hjälper lite här.

---

## 8.8.0 (build 65)

**Nytt tema: Julafton**
- Femte temat. Granmörk bas med en varm guldaccent som ett levande ljus, och varmvit text — dämpat och mysigt snarare än rött och grönt julpynt. Rött används sparsamt, som på en riktig gran.
- Ett varmt sken uppifrån och en mörkare botten ger rummet djup.
- Loggan och startskärmen får en guldgradient.

**Snö**
- Mjuk snö faller bakom innehållet, i samma djup som rutnätet, så den aldrig lägger sig över en ritning eller fångar tryck.
- Ritad på en egen canvas i stället för många DOM-element, vilket håller kostnaden nere. Större flingor faller något snabbare och ljusare än små — en enkel djupkänsla som gör att det inte ser ut som brus.
- **Pausas helt** när en ritning är öppen, när appen ligger i bakgrunden, och när temat inte är valt. Panorering och zoom av en PDF ska aldrig behöva konkurrera med dekoration om bildrutorna.
- För den som valt reducerad rörelse i systeminställningarna ritas snön stilla i stället för att falla.
- Antalet flingor skalas efter skärmytan, så en surfplatta inte får snöstorm och en telefon duggregn.

---

## 8.7.0 (build 64)

**Räknarvyn omgjord**
- Den primära knappen satt inklämd uppe till höger i rubrikraden, där den krockade med beskrivningstexten som bröt runt den. Statusraden låg samtidigt löst längst ned utan koppling till åtgärden, och de tre korten låg som likvärdiga block utan inbördes ordning.
- Knappen ligger nu i en **fast åtgärdsrad längst ned** tillsammans med statusraden, så den är nåbar oavsett hur lång ritningslistan är.
- Knappen är **kontextuell**: den skriver ut hur många ritningar som ska scannas och är avstängd tills något är valt — i stället för att vara aktiv och svara på ett tryck med ett felmeddelande.
- Korten är nu **numrerade steg** (1 Kategori, 2 Vad ska räknas, 3 Ritningar) så ordningen framgår.
- Rubriktexten är kortad, och förklaringen om att kategorin bara styr vilka ritningar som listas ligger nu vid kategorivalet där den hör hemma.
- "Markera alla" uppdaterar nu också knappen och statusraden, vilket den inte gjorde.

---

## 8.6.0 (build 63)

**Flerpoliga strömställare räknas var för sig**
- Efter symbolsökningen slås närliggande träffar ihop så att samma symbol inte räknas två gånger. Radien för den sammanslagningen räknades ut från **uttagets** storlek och användes även för strömställare — men en strömställarcirkel är ungefär hälften så stor. En 2- eller 3-grupp, där cirklarna sitter ungefär en diameter isär, hamnade därför innanför radien och blev en enda träff.
- Varje symboltyp jämförs nu mot sin egen storlek.
- Verifierat mot gruppen märkt d/l/k på Belysning P18 Del 1: räknas nu som 3 strömställare i stället för 1. Totalen på den ritningen gick från 26 till 33, och på P17 Del 1 från 50 till 66.

---

## 8.5.0 (build 62)

**AR-mätaren: se innan du trycker**
- Grundproblemet har varit att en punkts kvalitet bara gick att bedöma *efter* att den satts — en dålig djupavläsning blev därmed direkt ett dåligt mått. Ytan under hårkorset utvärderas nu varje bildruta.
- Hårkorset visar läget: nedtonat när spårning saknas, tunn ring medan avläsningen fortfarande vandrar, och kraftig ring med fylld mitt när den ligger stabilt. Avståndet till ytan skrivs ut under hårkorset hela tiden.
- **En punkt kan bara sättas när avläsningen legat stilla** — inom ett par centimeter över flera bildrutor i följd. Ett djup som hoppar mellan bildrutor är själva signaturen för en dålig träff, och det var vad som blev orimliga mått.
- Varnar nu om spårningen tappats mellan punkt A och B. Punkter satta på var sin sida av ett spårningsavbrott hamnar i praktiken i olika referensramar, och avståndet mellan dem går inte att lita på.
- Diagnostikvyn visar även förhandsvisningens avstånd och om den bedöms stabil.

**Himmelsblå ljusare**
- Klarare och mer mättad himmelsblå accent mot en djupare bas, samma grepp som neon-grönt använder. Moln, rutnät, panelfärger, temaväljarens miniatyr och AR-vyns färger följer med.

---

## 8.4.0 (build 61)

**AR-mätaren: diagnostik i stället för fler gissningar**
- Fyra rättningar har gjorts utifrån enbart kodläsning, utan möjlighet att köra koden. I stället för en femte gissning visas nu de värden ARCore faktiskt arbetar med, via knappen **Diag** i mätvyn:
  - spårningsstatus och orsak när den fallerar
  - antal upptäckta plan, och hur många som spåras
  - om telefonen stödjer djupdata
  - vilken display-geometri ARCore fått, och om den hunnit sättas
  - senaste träffens typ och avstånd, samt senaste avvisade träff med skäl
  - varje mätpunkts spårningsstatus, avstånd från kameran och världskoordinater
  - rått kontra medianfiltrerat mått
- Skicka en skärmdump av den panelen vid ett felaktigt mått, så går det att se var det brister i stället för att anta.

**Appen säger varför spårningen fallerar**
- I stället för det generella "rör telefonen långsamt" visas nu den faktiska orsaken: för mörkt i rummet, för snabb rörelse, för kal yta, eller upptagen kamera.
- Ljuset är värt att notera särskilt: ARCore tappar spårningen snabbt i dåligt ljus, och en mätning gjord under sådana förhållanden blir opålitlig oavsett vad koden gör efteråt.

---

## 8.3.1 (build 60)

**Ritningen centreras i helskärm**
- Fixen i 8.2.1 satte centreringen som en inline margin-top, men en CSS-regel längre ned i filen nollställde marginalen med `!important` — och `!important` i CSS vinner över inline-stilar. Centreringen räknades alltså ut korrekt och kastades sedan bort. Regeln styr nu bara sidmarginalerna.

**AR-mätaren: trolig grundorsak till de vilda måtten**
- ARCore måste få veta ytans geometri innan en träffkontroll betyder något — `hitTest()` tolkar sina koordinater i den geometri ARCore senast fick. Den sattes bara från `onSurfaceChanged`, som körs på GL-tråden och kan hinna före att sessionen finns (t.ex. första starten, när ARCore installeras). Då sattes den aldrig igen, ARCore behöll sin standardgeometri, och varje tryck träffade fel del av scenen — vilket ger punkter på i praktiken godtyckligt djup.
- Värdena sparas nu och läggs på så snart sessionen finns, och igen om geometrin ändras.
- Rimlighetskontrollen gällde bara avståndet från kameran till punkten. Själva mätsträckan kontrolleras nu också: över 15 m avvisas med en förklaring, eftersom ingenting som mäts inomhus spänner så långt.

---

## 8.3.0 (build 59)

**AR-mätaren stabiliserad**

*Felaktiga mått (t.ex. 24,5 m i ett kök):*
- Råa featurepunkter godtogs som sista utväg när ingen yta hittades. En featurepunkt kan ligga på nästan vilket djup som helst, och var därför den enskilt största orsaken till vilt fel mått. Endast ytor ARCore är säker på accepteras nu: en kartlagd plan yta, eller en djupdatapunkt på telefoner som stödjer det.
- Träffar under 5 cm eller över 12 m avvisas som spårningsartefakter med ett tydligt meddelande i stället för att bli en mätpunkt.
- Punkterna förankras nu i själva ytan i stället för fritt i sessionen, så de ligger kvar när ARCore förfinar sin kartläggning.

*Flimret:*
- Hela textpanelen skrevs om vid varje bildruta — 60 uppdateringar i sekunden av text, synlighet och knapplägen. Överlägget går fortfarande i full bildfrekvens, men panelen uppdateras nu några gånger i sekunden och bara när innehållet faktiskt ändrats.

*Hoppande siffror:*
- Avståndet medianfiltreras över de senaste mätningarna. ARCore justerar löpande sina punkter, så råvärdet rör sig centimetervis varje bildruta; medianen dämpar det och slänger dessutom enstaka kraftiga avvikare.

*Övrigt:*
- Knappraden hamnade delvis bakom systemets navigeringsrad. Den tar nu hänsyn till systemets marginaler.
- "Ångra" nollställer även mätvärdet, som annars låg kvar.
- Tryck medan spårningen inte låst ger nu ett meddelande i stället för att tyst ignoreras.

---

## 8.2.2 (build 58)

**Dosor räknas inte längre som strömställare**
- Kravet från 8.1.0 — arm in i punkten plus ett vinkelrätt streck i armens yttre ände — visade sig beskriva även en helt vanlig **kabelböj**. Kabelvägar ritas med räta vinklar, så varje dosa med en ledning som svänger fick en "arm" och ett "tvärstreck". Därför fortsatte HT-dosor och kopplingspunkter att räknas.
- Strömställarens symbol har i själva verket **två** korta, nära parallella streck där (återfjädringsmärket). En kabelböj har bara det ena fortsättande segmentet. Ett par krävs nu, vilket skiljer dem åt.
- Verifierat mot de punkter som räknades fel: samtliga HT3- och HT-dosor är nu uteslutna, medan riktiga strömställare är kvar.

---

## 8.2.1 (build 57)

**Himmelsblå gick inte att välja**
- Temat fanns i CSS och i väljaren, men saknades i kodens lista över giltiga teman. Okända värden faller tillbaka på mörkt, så knappen såg ut att inte göra någonting.
- Orsaken var en tidigare textersättning som aldrig träffade, eftersom neon-färgen ändrats efteråt och mönstret därför inte matchade. Bekräftelserutan namnger nu också temat korrekt i stället för att bara säga "Mörkt tema aktiverat".

**Ritningen låg för långt ned i ramen**
- Sedan 7.6 anpassar ramen sin höjd efter ritningen. Den vertikala centreringen lades ändå på som marginal — vilket både tryckte ned ritningen och fick ramen att växa lika mycket, så ritningen hamnade lågt med en hög tom yta över.
- Marginalen läggs nu bara på i helskärm, där ytan har fast höjd. I den vanliga vyn ligger ramen tätt om ritningen.

---

## 8.2.0 (build 56)

**Nytt tema: Himmelsblå**
- Fjärde temat vid sidan av Svart, Vit och Neon. Djup azurblå bas i stället för svart, ljus himmelsblå accent och vitt.
- Mjuka molnslöjor ligger som ett eget lager i bakgrunden — tre olika stora, suddiga ljus högt upp i bilden, tillsammans med rutnätet. De ligger under innehållet och kan aldrig lägga sig över en ritning.
- Loggan och startskärmens EKIS-text får en himmelsgradient från vitt genom ljusblått ner i djupblått, i stället för en platt färg.
- Panelerna har en svag molnljusning uppifrån och inre kantljus, knapparna en gradient.
- Temat följer med hela vägen ut i AR-mätvyn, som sedan 8.0.1 hämtar sina färger från appens tema.
- Ritningen lämnas som i övriga teman orörd, svart på vitt — bara ramen och ritningsytans bakgrund färgas.

---

## 8.1.0 (build 55)

**Strömställare skiljs från dosor (Belysning)**
- Testet krävde bara "ett streck som rör cirkeln". En dosa är också en fylld prick — med en ledning ut ur sig — och passerade därför som strömställare.
- I vektordatan är skillnaden exakt: strömställaren har en manöverarm (≈2× symbolens diameter) och ett kort **tvärstreck vinkelrätt mot armens yttre ände** (≈0,8× diametern). En ledning från en dosa saknar det tvärstrecket. Kravet är nu ställt på just det.
- Kalibreringen väljer den **runda** symbolen vid legendens brytar-rad i stället för den största fyllningen. Tidigare kunde fel glyf plockas, vilket gav både fel referensstorlek och fel resultat.

**Känd begränsning: Kraft-ritningar**
- Kraft använder en annan brytarsymbol (kupa + diagonaler + två prickar), inte cirkel med arm. Regeln ovan gäller den symbolen och överräknar på Kraft-ritningar — bland annat ringas pilar vid "ANSL. TAKDOSA" och GV-punkter in.
- Kraft-symbolen behöver mätas upp separat på samma sätt som gjordes för Belysning. Räkna tills vidare strömställare på Belysningsritningarna.

---

## 8.0.1 (build 54)

**AR-vyn följer temat fullt ut**
- Accentfärgen följde redan med sedan 8.0.0 (mätpunkter, linje, hårkors och "Använd mått").
- Bakgrunder, hintrad, sekundärknappar och måttetikett var däremot hårdkodade mörka. I Svart och Neon syntes det inte, men i Vit-temat blev AR-vyn fortfarande mörk. De härleds nu ur temat, som skickas med när vyn startas.
- Texten på accentknappen väljer svart eller vitt efter accentfärgens ljushet, så den är läsbar på både den orange och den ljusgröna.

---

## 8.0.0 (build 53)

**AR-mätning med kameran**
- Ny knapp i ritningsvyn: **Mät med kameran**. Sikta med hårkorset, tryck för punkt A, gå till punkt B och tryck igen. Avståndet visas direkt och kan tas in i appen.
- Bygger på ARCore, som spårar rummet i 3D med kameran och rörelsesensorerna tillsammans. Punkterna får därför verkliga koordinater och sitter kvar när telefonen rör sig — det är den avgörande skillnaden mot ett foto, som saknar egen skala.
- Punkterna sätts i första hand mot ytor ARCore kartlagt (plan eller djupdata där telefonen stödjer det) och bara i sista hand mot enstaka featurepunkter, eftersom de senare är betydligt ostadigare på en kal vägg.
- Träffen sätts vid hårkorset i mitten, inte vid fingret, så tummen aldrig skymmer punkten — samma princip som förstoringsglaset vid mätning på ritning.
- Vyn följer appens tema: accentfärgen skickas in till AR-vyn.
- Knappen visas bara på telefoner som faktiskt stödjer ARCore. Övriga enheter ser den inte alls i stället för att mötas av ett fel. AR är märkt som valfri funktion i manifestet, så appen installeras och fungerar som vanligt utan den.

**Notering om iPhone:** ARCore är Android-specifikt. Motsvarande på iOS kräver ARKit och därmed en nativ iOS-app, som inte finns ännu.

---

## 7.7.0 (build 52)

**Räknaren: total kontra per lägenhet**
- Den stora rutan högst upp visade summan för *alla* valda ritningar, men var rubricerad med den första lägenhetens namn. Trycket på den öppnade dessutom en granskning filtrerad till just den lägenheten — så rutan kunde stå på "72 st" och sedan ringa in en handfull symboler. Det var samma orsak bakom både "uttagen ringas inte in" och "antalet per lägenhet stämmer inte".
- Totalen är nu märkt som total, visar antal områden, och trycket på den visar *alla* träffar.
- Fördelningen per lägenhet/område ligger som tidigare i korten under, nu med en rad som pekar dit.
- "Visa markeringar" visar också allt i stället för bara första träffens område.

---

## 7.6.0 (build 51)

**Ramen runt ritningen hugger ritningen**
- Viewporten hade fast höjd (min 320px, max 68vh) plus 110px bottenpadding som låg kvar från när verktygsraden satt längst ned. En liggande ritning fyllde bara en del av höjden, så ramen fortsatte långt under den.
- Höjden växer nu med innehållet upp till ett tak. Ramen ligger tätt om ritningen, och först när man zoomar in fylls ytan och scrollningen tar vid.
- Rättade också en `margin:0 auto !important` som blockerade den vertikala centreringen.

**Neon-temat omgjort**
- Djupare och mer mättad grönska i stället för mintgrönt: mörkgrön bas med gräsgrön accent.
- Panelerna har fått en svag gradient och inre kantljus, och rubrikytorna en grön glödvinjett, så gränssnittet känns tyngre än en platt neonyta.

**Färger som inte följde temat**
- Kryssrutor och reglage ritades i systemets blå färg. De använder nu temats accentfärg.
- Ikonerna i ÄTA-korten (redigera, foto, galleri, datum, timmar, platsmarkering) var emoji och renderades därför i systemets egna färger, olika på olika Android-versioner. De är nu SVG som ärver textfärgen.

---

## 7.5.0 (build 50)

**Panorering når hela ritningen igen**
- Inzoomad gick det inte att panorera hela vägen ut till vänsterkanten — det tog stopp mot en osynlig vägg. Orsaken var centreringen som infördes i 7.2: en centrerad flex-item i en scrollcontainer kan inte scrollas till sin egen startkant, eftersom överskottet hamnar på negativ scrollposition och `scrollLeft` aldrig kan bli mindre än noll.
- Centreringen görs nu med blocklayout: `margin-inline:auto` horisontellt (blir automatiskt 0 när ritningen är bredare än ytan, så den börjar vid scroll 0) och margin-top vertikalt. Ritningen är fortfarande centrerad när den får plats, men varje del går att nå när den är inzoomad.
- Zoomankaret räknar nu med centreringens offset, så inzoomning inte glider i sidled.

**Neon-temat utökat**
- Loggan "EKIS FIELD" är nu grön. PNG:n är vit och går inte att färga med filter, så den används som mask och färgas av bakgrunden.
- Startskärmens EKIS-text, linjer och glöd följer temat.
- Knappar, fält, listor, dialoger, fokusramar, markeringar och statusrader som tidigare behöll den mörka standardpaletten är nu gröna.

**Rutnätet i alla teman**
- Bakgrundsrutnätet låg bara i Neon. Det finns nu i Svart, Vit och Neon, med färg efter temat (vitt, mörkt respektive grönt) och uttonat mot kanterna.

---

## 7.4.0 (build 49)

**Nytt tema: Neon (svart & grönt)**
- Tredje temat vid sidan av Svart och Vit. Djup svart bakgrund med grön ton, neongrön accent och diskret glöd på det som är i fokus — aktivt verktyg, rubriker, notiser och helskärmens flytande paneler.
- Ett svagt lysande rutnät ligger i bakgrunden, uttonat mot kanterna.
- Själva ritningen lämnas orörd (svart på vitt som i PDF:en) — bara ramen får en grön kantlinje, så läsbarheten på plats påverkas inte.

**Ritningsmarkeringar följer temat**
- Mått, markeringar och räknarens träffar ritades tidigare alltid i orange, hårdkodat på 15 ställen i koden, eftersom de målas på canvas och inte påverkas av CSS. De läser nu temats accentfärg och ritas om direkt när temat byts.

**Versionshistoriken samlad**
- Den äldre historiken låg utspridd i `README_ANDROID.txt` och `www/README.txt`. Den är nu inflyttad hit och finns även i appen under Inställningar → Om appen.

---

## 7.3.0 (build 48)

**Occhio-armaturer går att trycka på**
- Ritningar som använder en Occhio-produktförteckning märker armaturerna med `position.instans` — t.ex. `3.1` och `3.2` för första och andra enheten av position 03. Förteckningens poster indexerades däremot bara som `POS 03` / `POSITION 03`, vilket aldrig förekommer på ritningen. De två kunde alltså aldrig matcha varandra.
- Matchningen förstår nu den punktnotationen. Verifierat mot projektets ritningar: 13 träffar på Plan 17 Del 3 (positionerna 02, 03 och 07) och noll på övriga ritningar.
- Notationen matchas bara när den utgör hela etiketten. Rumsareor skrivs `A: 3.7 m²` och lästes annars som position 03.
- Occhio-poster var dessutom uttryckligen undantagna från produktnamnsmatchningen, så armaturer som *bara* finns i Occhio-förteckningen (som i den lägenheten) var helt oåtkomliga. De ingår nu.

---

## 7.2.0 (build 47)

**Ritningen centreras korrekt**
- Centreringen gjordes i JS genom att mäta ytan och sätta absolut position på ritningen. Det motverkades av flera `margin:0 auto !important`-regler längre ned i CSS-filen, och gick även fel när mätningen skedde innan layouten satt sig. Resultatet var en ritning klistrad högst upp med svart yta under.
- Ersatt med flexbox + `margin:auto`, vilket webbläsaren håller synkat automatiskt: centrerat när ritningen får plats, fullt scrollbart när den inte gör det.

**Dialogrutor fungerar i helskärm**
- I äkta helskärm ritas bara helskärmselementet och dess innehåll. Dialogrutorna ligger utanför ritningsvyn och öppnades därför *osynligt* — att trycka på X för att radera, eller på textverktyget, såg ut att inte göra någonting alls. I reservläget (pseudo-helskärm) låg vyn dessutom över dialogen i z-ordningen.
- Dialoger och notiser flyttas nu automatiskt in i helskärmselementet när de visas.

**Pennan**
- Ritade tidigare en 4px-punkt vid varje sampelpunkt under draget, vilket gav ett spår av prickar i stället för en linje.
- Ritar nu mjuka kurvor (kvadratiska bézier genom sampelpunkternas mittpunkter) och filtrerar bort skakningar under ~1px.

**Räknaren**
- Symboler som sitter på sneda väggar ritas roterade, vilket gör deras rätvinkliga ram bredare (11,3×5,6 upprätt blev 10,9×7,9 lutad) och gjorde att storlekstestet missade dem. Storleken mäts nu främst på ytan, som är oberoende av rotation.

**Övrigt**
- Bläddringspilarna sitter symmetriskt i båda nedre hörnen.
- Tydligare ikoner för Avstånd, Sträcka, Area och Rensa.

---

## 7.1.0 (build 46)

**Helskärmsläget omgjort**
- Den tomma grå listen längst upp är borta. Ersatt med en kompakt pill i mitten som visar ritningens namn plus bara tillbaka- och helskärmsknappen.
- Verktygsraden är nu en smal, rundad ikonrad centrerad vertikalt på höger sida.
- **Ett tryck på ritningen tonar bort all meny** så bara ritningen syns. Tryck igen för att få tillbaka den. När menyn är dold används hela skärmbredden.
- Städade upp 13 motstridiga CSS-regler för helskärmsvyns marginaler som staplats på varandra i tidigare byggen (paddings på 14/18/24/28px, bottenmarginaler upp till 110px, tre olika höjdregler). Det var en direkt orsak till att ritningen hamnade för högt upp med dött utrymme under.

**Nya ikoner**
- Alla verktygsikoner ersatta med en enhetlig SVG-uppsättning. Tidigare var det en blandning av emoji (✋📏) och typografiska tecken (⌁ ▱ ✎ ➜ ⌫) som renderades i olika storlek och tjocklek – och olika på varje Android-version, eftersom emoji kommer från systemets teckensnitt.

**Bakåtknappen fixad**
- Hanterade tidigare bara två fall och returnerade "ohanterat" för allt annat, vilket innebar att bakåt **stängde hela appen** när en dialog var öppen eller när man var i en undervy.
- Nu i rätt ordning: öppen dialog → textredigerare → granskningsläge → helskärm → markerat objekt → aktivt verktyg → stigarläge → ritningsvy → projektvy → projektlista.

---

## 7.0.0 – Räknaren ombyggd på vektorgeometri

Räknaren läser nu PDF:ens faktiska ritkommandon istället för att gissa former ur en pixelbild.

- Tidigare renderades sidan till en bild där varje pixel blev 1 eller 0. All information om *vad* som ritats kastades bort, vilket är anledningen till att kupor, linjehörn och skraffering såg likadana ut för algoritmen.
- En typisk ritning innehåller ~150 000 vektorvägar, varav under 1 000 är *fyllda* former. Uttag och strömställare är fyllda former, så nu granskas ~800 exakta objekt med kända koordinater istället för miljontals pixlar.
- **Skrafferade referensytor** ("tillhör annan del av ritningen") identifieras nu exakt som grupper av långa parallella diagonallinjer. Detta problem gick inte att lösa på pixelnivå – två tidigare försök fick återställas eftersom de riskerade utesluta hela rum med riktiga uttag.
- **Armtestet** för strömställare är nu exakt geometri, vilket filtrerar bort fyllda punkter som inte är strömställare (t.ex. rörutlopp för handdukstork).
- Legend och titelblock exkluderas på exakta koordinater.
- Storlekskalibrering per ritning kvar: mått läses ur varje ritnings egen FÖRKLARINGAR, så Kraft och Belysning hanteras automatiskt var för sig.
- **3–4× snabbare** (2–3 sek/sida mot tidigare 8–12).
- Pixelmotorn finns kvar som automatisk reserv för inskannade ritningar utan vektordata, och om vektorformatet inte känns igen.

---

## 6.5 – Helskärm, stabilitet
- Helskärmsläget räknar nu om anpassningen flera gånger (80/200/400/700 ms) plus vid varje `resize`, istället för en enda fast fördröjning som inte alltid räckte innan webbläsarens övergång var klar.
- Mjuk övergång medan storleken sätter sig.

## 6.4 – Mätning, pil, skanner
- Förstoringsglaset följer nu fingret redan vid **första** mätpunkten (visades tidigare bara efter att första punkten släppts).
- Samma förstoringsglas när pilen dras ut.
- Splash-animationen omgjord: mjuk inzoomning, orange glöd, utritade linjer.
- Skrafferingsdetektorn fastnade på tjocka kabeldragningslinjer, vilket felaktigt uteslöt riktiga uttag som satt nära kablar. Löst med periodicitetstest (riktig skraffering ger flera parallella linjer, en kabel bara en).

## 6.3 – Helskärmszoom
- Zoomen räknades inte om vid växling till helskärm, vilket gav en liten ritning i hörnet.

## 6.2 – Navigering, text
- Bläddring med pilar/svep följde filernas uppladdningsordning istället för logisk ordning (kategori → plan → del → revision).
- Bläddringspilarna omdesignade till runda knappar i nedre hörnen; åtta motstridiga positionsregler från tidigare byggen rensade.
- Text har nu ljus halo för läsbarhet mot mörk linjeritning.
- **Nyp med två fingrar** ändrar storlek på markerad text.

## 6.1 – Räknarmarkörer
- Orange träffmarkörer följde med till fel ritning vid svep/våningsbyte; de räknas nu alltid om mot den ritning som faktiskt visas.

## 6.0 – Symbolklassificering
- Formanalys via breddprofil ersatte fasta pixelmallar.
- Skanningsupplösning fördubblad (2600 → 5200 px); en symbol var tidigare bara 13×7 pixlar, för grovt för formanalys.
- Kalibrering mot ritningens egen legend.
- Krav på utbuktning i **två vinkelräta riktningar** för cirklar – ett tvärsnitt av en rak tjock linje ser annars identiskt ut med en cirkel.

## 5.1.5 – Vy och verktyg
- Centrering av ritningen fungerade bara i helskärm; i normalläget fanns ett tidigt avbrott som hoppade över centreringen helt, vilket gav svart tomrum under utzoomade ritningar.
- Omräkning vid skärmrotation och när tangentbordet öppnas/stängs.
- Pilens start- och slutpunkt kan justeras separat.
- Skannern pausar periodiskt så gränssnittet inte fryser på stora ritningar.

---

## Tidigare versioner

Historiken nedan är sammanförd från `README_ANDROID.txt` och `www/README.txt`, där den låg utspridd innan den här filen fanns.

### 4
- Åtgärdad touch-hantering särskilt för Android/Samsung Chrome.
- Ritningen öppnas automatiskt i "Passa"-läge så hela sidan syns.
- Swipe vänster/höger byter ritning endast när ritningen är helt utzoomad; inzoomad panorerar samma rörelse i stället.
- Pinch-zoom med dynamisk minzoom och kraftig detaljzoom.
- Våningsväljare med "Lås vy" som behåller samma område vid ritningsbyte.
- Ny **Synka plan**: markera två gemensamma referenspunkter A och B på två plan, varefter appen kompenserar för förskjutning, skala och rotation mellan ritningarna. Använd punkter som ligger en bit isär för stabilare synkning.
- Service worker uppdaterad så nya versioner ersätter gammal cache bättre.

### 3.1
- Rak A–B-mätning: A låses, B dras och släpps. Ingen böjd måttlinje.
- Automatisk PDF-skala läses från "SKALA 1:xx" när den finns.
- Area-kalibrering kan använda utskriven rumsarea (m²) som referens.
- Smart armaturmatchning söker taggar även inuti PDF-text och korslänkar vanlig armaturförteckning mot Occhio produktöversikt med försiktig matchningspoäng.
- Armaturinfo öppnas med enkel- eller dubbeltryck nära matchad beteckning.
- Splash använder transparent, beskuren logga på exakt appbakgrund.

### 3
- Separat touch-implementation för Android/Samsung: tvåfingers pinch-zoom direkt på ritningsytan.
- Utzoomad ritning: horisontell swipe byter ritning. Inzoomad: samma rörelse panorerar.
- Ny Våning/ritning-väljare i ritningsvyn.
- "Lås vy" på som standard — zoomnivå och relativt område följer med vid våningsbyte.
- Dubbeltryck växlar helskärm.
- EKIS FIELD-logga och appnamn, animerad startskärm, immersive Android-läge.
- Ritningsanalys med Pxx + Del 1/2/3 ur ritningshuvud eller filnummer.
- Vanlig armaturförteckning och Occhio product overview kan indexeras som smarta dokument.
- Att göra-lista med prioritet, deadline och filter.

### 2
- Nyp/zoom med två fingrar; dra runt ritningen med ett finger när den är inzoomad.
- Swipe mellan ritningar i samma projekt vid 100 %.
- Föregående/nästa-knappar som reserv.
- Dubbeltryck växlar helskärm; separat helskärmsknapp.
- Zoomindikator och återställning till 100 %.

### 1
- Skapa projekt; importera PDF eller ZIP (behåller mappväg).
- Byt visningsnamn utan att förstöra originalfilnamnet.
- Sök och sortera; flersidiga PDF-ritningar; skala per sida.
- Kalibrering mot känt mått, avståndsmätning, sträcka/kabelväg, area.
- Projektexport som ZIP, full lokal backup och återställning.
- Att-göra-lista, PWA-stöd.

**Notera:** projektdata och PDF-filer sparas lokalt på enheten. Rensas webbläsarens/appens data kan lokala projekt försvinna — använd backup-funktionen.
