# EKIS FIELD – Versionshistorik

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
