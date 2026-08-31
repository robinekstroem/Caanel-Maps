CAANEL FIELD – ANDROID

Detta är den riktiga Android-versionen av CAANEL Field.

Ingår:
- CAANEL Field v4 i en Android WebView-app
- PDF/ZIP-filväljare från telefonens filer
- LocalStorage + IndexedDB för projekt och PDF-filer
- Pinch-zoom, swipe, helskärm och synkade våningsplan från v4
- Export/backup sparas till Hämtade filer / CAANEL Field
- GitHub Actions-fil som bygger CAANEL-Field.apk
- Byggsteget hämtar PDF.js + JSZip och packar dem lokalt i APK:n för offline-användning

BYGG VIA GITHUB:
1. Lägg projektfilerna i ett eget GitHub-repository.
2. Öppna fliken Actions.
3. Välj "Build CAANEL Field APK".
4. Kör workflow.
5. När bygget är grönt: öppna körningen och ladda ner artifact "CAANEL-Field-APK".
6. Packa upp artifact ZIP på telefonen och installera CAANEL-Field.apk.
   Android kan fråga om tillåtelse att installera okända appar från webbläsaren/filer.

OBS:
Debug-APK:n är installerbar direkt och bra för test.
När appen är färdig för skarp användning/Play Store bör en signerad release-nyckel läggas till.


CAANEL FIELD v2.0 - SMART PDF
=============================
Nytt i denna version:
- Automatisk analys av PDF vid import.
- Ritningshuvud används för namn, kategori och plan när texten finns i PDF:en.
- Exempel: E-640-1-118.pdf -> Tele - Plan 18.
- Fasta kategoriflikar: Alla, Belysning, Kraft, Tele, Kanalisation, Brand, Passage, Övrigt.
- Automatisk sortering på kategori och plan.
- Armaturförteckningar identifieras och indexeras (L1, L13, L4A, N1, ARM 1 osv.).
- På belysningsritning: dubbeltryck på en matchande armaturbeteckning för snabbinfo.
- Knappen "Visa i armaturförteckning" öppnar rätt sida och markerar posten.
- "Tillbaka till ritningen" återställer tidigare ritning, sida, zoom och position.
- Befintliga PDF:er från äldre version analyseras automatiskt när projektet öppnas.
- Manuell namnändring skrivs inte över av automatiken.
- Kategori kan korrigeras manuellt genom att trycka på kategorichippen på en filrad.
