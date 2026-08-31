CAANEL FIELD v2

FILER
- index.html
- style.css
- app.js
- manifest.webmanifest
- sw.js
- logo.png
- icon-192.png
- icon-512.png

PUBLICERING PÅ GITHUB PAGES
1. Packa upp ZIP-filen.
2. Lägg alla filer i roten på ditt GitHub-repository.
3. Commit/pusha filerna.
4. Aktivera GitHub Pages på samma sätt som för din tidigare webbapp.
5. Öppna sidan på mobilen. På Android/Chrome kan appen installeras på hemskärmen.

FUNKTIONER
- Skapa projekt
- Importera en/flera PDF-filer
- Importera ZIP och extrahera alla PDF-filer
- Behåller mappväg från ZIP
- Byt visningsnamn utan att förstöra originalfilnamnet
- Sök och sortera
- Öppna flersidiga PDF-ritningar
- Skala per PDF-sida
- Kalibrering mot känt mått
- Avståndsmätning
- Sammanhängande sträcka/kabelväg
- Area
- Projekt-export som ZIP
- Full lokal backup och återställning
- Enkel att-göra-lista
- PWA-stöd

VIKTIGT
PDF-filer och projektdata sparas lokalt i webbläsaren via IndexedDB/localStorage.
Om webbläsarens webbplatsdata rensas kan lokala projekt försvinna. Använd därför backup-funktionen.
PDF.js och JSZip laddas från CDN första gången, så internet krävs för de biblioteken i denna v1.


NYTT I v2
- Nyp/zoom med två fingrar i ritningen
- Dra runt ritningen med ett finger när den är inzoomad
- Swipe vänster/höger mellan PDF-ritningar i samma projekt när ritningen är vid 100 %
- Föregående/nästa-knappar som reserv
- Dubbeltryck/dubbelklick på ritningen växlar helskärm
- Dubbeltryck igen lämnar helskärm
- Separat helskärmsknapp
- Zoomindikator och återställning till 100 %

GESTLOGIK
- Vid 100 %: swipe vänster/höger byter ritning
- Vid zoom >100 %: samma rörelse panorerar ritningen istället, så du inte råkar byta fil
- Mätverktygen fortsätter använda PDF-koordinater och påverkas inte av zoomnivån


NYTT I v3
- Separat touch-implementation för Android/Samsung: tvåfingers pinch-zoom fungerar direkt på ritningsytan.
- När ritningen är helt utzoomad byter horisontell swipe ritning.
- När ritningen är inzoomad panorerar samma fingerrörelse i ritningen istället.
- Ny Våning/ritning-väljare i ritningsvyn.
- 'Lås vy' är på som standard: zoomnivå och samma relativa område följer med när du byter våningsritning.
  Exempel: zooma in på ett trapphus på plan 1 och välj plan 2; plan 2 öppnas på motsvarande område.
- Dubbeltryck växlar helskärm på/av.

OBS:
Vy-lås använder ritningarnas relativa PDF-position. Det blir exakt när våningsritningarna har samma sidformat och är registrerade på samma plats.
För ritningar som är förskjutna i PDF:en behövs en framtida referenspunkts-/ritningsregistrering för pixel-exakt våningsbyte.


NYTT I v4
- Fixad touch-hantering särskilt för Android/Samsung Chrome.
- Ritningen öppnas nu automatiskt i 'Passa'-läge: hela sidan syns.
- Swipe vänster/höger byter ritning ENDAST när ritningen är helt utzoomad.
- När du zoomat in används ett finger för att panorera utan att byta ritning av misstag.
- Pinch-zoom med två fingrar har dynamisk minzoom och upp till kraftig detaljzoom.
- Våningsväljaren fungerar och 'Lås vy' behåller samma område vid ritningsbyte.
- Ny 'Synka plan'-funktion:
  1. Öppna plan 1 och tryck Synka plan.
  2. Markera två gemensamma referenspunkter A och B, t.ex. två hörn i samma trapphus.
  3. Öppna plan 2 och markera SAMMA fysiska A- och B-punkter.
  4. Därefter kan appen korrigera för förskjutning, skala och rotation mellan ritningarna.
  5. Zooma in på en kabel/trapphus på plan 1 och byt plan – motsvarande fysiska område centreras på plan 2.
- Dubbeltryck/dubbelklick växlar helskärm på/av.
- Service worker uppdaterad så nya versioner ersätter gammal cache bättre.

TIPS
Använd tydliga referenspunkter A och B som ligger en bit ifrån varandra. Då blir våningssynkningen stabilare.
