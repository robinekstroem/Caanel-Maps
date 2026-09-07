# EKIS FIELD – Versionshistorik

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
