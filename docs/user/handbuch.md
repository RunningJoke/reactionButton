# ReactPod-Handbuch

Für Trainerinnen und Trainer, Sportlerinnen und Sportler und alle, die mit ReactPods trainieren
wollen. Technisches Wissen ist nicht nötig. Die englische Fassung ist [manual.md](manual.md),
die bebilderte Kurzanleitung [anleitung.pdf](anleitung.pdf), die technischen Details der Spiele
stehen in [game-modes.md](game-modes.md). Einheiten planen: [Trainerleitfaden](trainerleitfaden.md).

> **Sicherheit:** ReactPods niemals unbeaufsichtigt laden. Sie werden beim Laden warm.

---

## 1. Was sind ReactPods?

ReactPods sind runde Trainingsleuchten zum Drücken. Jeder Pod hat einen Lichtring und unter
seiner Oberseite einen großen Taster. Du verteilst mehrere Pods um dich herum (Boden, Wand, Tisch,
Hütchen), startest ein Spiel und drückst die Pods so schnell wie möglich, sobald sie aufleuchten.
Die Pods messen, wie schnell du reagierst.

Typische Einsätze: Reaktions- und Lauftraining, Koordination, Aufwärmen, Teamspiele, Reha und
Spaß im Kindertraining.

Mehrere Pods, die zusammen spielen, heißen **Set**. Ein Pod des Sets leitet das Spiel, der
**Central**. Alle anderen sind **Ziele** (in den technischen Dokumenten: *Peripherals*).
Jeder Pod kann Central sein: Es kommt nur darauf an, wie du ihn einschaltest.

Die Pods sprechen per Funk miteinander. Für die mitgelieferten Spiele brauchst du kein Handy,
kein WLAN und keine Kabel. Die **ReactPod-App** ist optional: Damit änderst du Spiele, baust
eigene, probierst sie am Bildschirm aus und speicherst Ergebnisse.

---

## 2. Der Pod

![ReactPod](renderingBuzzer.png)

| Teil | Funktion |
|---|---|
| **Oberseite (Buzzer-Fläche)** | Drücken. Die ganze Oberseite ist der Taster. |
| **Lichtring** | 18 Lichter unter der Oberseite. Sie zeigen, was zu tun ist und was der Pod gerade macht. |
| **Ein/Aus-Schalter** | Aus, wenn der Schalter vom USB-Anschluss weg zeigt. |
| **USB-C-Anschluss** | Laden (und für Fortgeschrittene: Updates und die USB-Verbindung zum Computer). |

![Ein/Aus-Schalter](renderingOnOff.png)

### Laden

- Jedes übliche USB-C-Kabel und Ladegerät geht.
- **Der Pod muss zum Laden eingeschaltet sein.**
- Er wird beim Laden warm und leuchtet. Du kannst ihn weiter benutzen.
- Nie unbeaufsichtigt laden.

Eine Ladung reicht für etwa eine Stunde Spielzeit. Der Akkustand steht in der App (Seite Pod, ab Firmware 2.13) und
auf der Startanzeige (siehe unten). Am USB-Kabel misst der Pod die Ladespannung, deshalb zeigt er beim Laden fast voll.

### Akkustand und Akku leer

- **Einschalten:** 2 Sekunden lang füllt sich der Lichtring wie eine Anzeige: bis zum Ladestand des Akkus, in
  **Grün** über 50 %, **Gelb-Orange** von 20 bis 50 %, **Rot** unter 20 %. Der Stand wird gemessen, bevor die
  Lichter angehen. Die Oberseite in diesen 2 Sekunden gedrückt halten, um den Pod zum Central zu machen, wie bisher.
- **Unter 15 %:** ein Pod, der in seinem Set wartet (nicht im Spiel), blinkt einmal pro Sekunde **gelb-orange**.
  Bald laden.
- **Unter 5 %:** das Spiel startet nicht. Wenn du am Central bestätigst, blitzt sein Ring eine Sekunde **rot**.
  Zuerst den Pod (oder das Central) laden.

---

## 3. Dein erstes Spiel in zwei Minuten

Du brauchst: so viele Pods, wie das Spiel verlangt (siehe §6), ausgeschaltet.

1. **Ziel-Pods einschalten.** Jeder zeigt etwa 2 Sekunden ein blaues Lauflicht und leuchtet dann
   **gelb**: Er wartet auf einen Central.
2. **Central einschalten:** Einen weiteren Pod einschalten und **die Oberseite gedrückt halten,
   solange das blaue Lauflicht läuft**. Loslassen, wenn es erlischt. Ein kleines Lichtmuster zeigt
   jetzt das erste Spiel des **Programm-Menüs**.
3. **Spiel wählen:** Kurz drücken zeigt das nächste Spiel. Jedes Spiel hat sein eigenes
   Lichtmuster (siehe §6).
4. **Auswählen:** Gedrückt halten. Ein weißes Licht wird heller; wenn es erlischt (nach etwa
   2 Sekunden), loslassen.
5. **Auf die Ziele warten:** Der Central zeigt blaue Lichtpaare, ein Paar pro benötigtem Ziel.
   Die gelben Ziele gehen nacheinander aus, sobald sie dabei sind. Sind alle da, leuchtet der
   Central **grün**.
6. **Start:** Den Central einmal drücken. Los geht's!

Ein anderes Spiel: den Central aus- und wieder einschalten (dabei wie in Schritt 2 die Oberseite
während des blauen Lauflichts halten). Die Ziele können anbleiben; sie warten gelb und sind
gleich wieder dabei.

---

## 4. Während des Spiels

Die Spiele sagen dir alles mit Licht. Die wichtigsten Zeichen:

| Du siehst | Bedeutung |
|---|---|
| **Grüner** Pod | Drücken, so schnell du kannst. |
| **Roter** Pod | **Nicht** drücken. |
| **Dunkles** Ziel | Bereit, wartet auf seinen Einsatz. |
| **Cyan** am Central nach dem Drücken | Treffer, gut gemacht. |
| **Rot** am Central | Fehlstart (zu früh gedrückt) oder verpasst. |
| **Alles blau** für ein paar Sekunden | Eine Serie von Runden (ein *Durchgang*) ist vorbei; der nächste startet von selbst. |
| **Alles gelb** am Central | Ein Ziel ist weg (ausgeschaltet, außer Reichweite, Akku leer). Das Spiel wartet und läuft von selbst weiter, sobald es zurück ist. |

Wie viele Runden ein Durchgang hat, hängt vom Spiel ab (oft 12). Nach jedem Durchgang berechnen
die Pods deine beste, mittlere und schlechteste Reaktionszeit. Die Pods zeigen diese Zahlen nicht
selbst an; das macht die App (siehe §8.6).

---

## 5. Sets: Welche Pods spielen zusammen?

- Ein Ziel merkt sich den Central, mit dem es zuerst gespielt hat, und macht danach nur noch in
  **seinem eigenen Set** mit. So können zwei Gruppen in derselben Halle trainieren, ohne sich
  gegenseitig Pods zu „klauen“.
- Jeder Pod des Sets kann beim nächsten Mal der Central sein.
- **Einen Pod in ein anderes Set bringen:** Als Ziel einschalten. Solange er gelb ist, die Oberseite
  3 Sekunden halten, bis er weiß aufblitzt. Er hat sein Set vergessen und schließt sich dem
  nächsten Central an.
- In der App kannst du einem Set einen **Namen** geben (z. B. „Halle A“). Diesen Namen siehst du beim
  Verbinden per Bluetooth.

Bleibt ein Ziel gelb und macht nie mit, gehört es wahrscheinlich zu einem anderen Set. Dann wie
oben beschrieben zurücksetzen.

---

## 6. Die Spiele

Das Muster ist das, was der Central im Programm-Menü zeigt (Licht Nummer 0 ist oben, dann im
Uhrzeigersinn; am einfachsten siehst du es in der App auf der Seite **Menü**).

| Spiel | Pods | Muster | So läuft es |
|---|---|---|---|
| **Solo** | nur Central | ein blaues Licht | Blau = bereit machen. Nach einer zufälligen Wartezeit wird er grün: drücken. Zu früh gedrückt = rot (Fehlstart). |
| **Weiche** | Central + 2 | blau, gelb, blau | Central drücken, dann leuchtet zufällig eins der beiden Ziele, dann wieder der Central. |
| **Dreieck** | Central + 2 | drei blau | Einer der drei Pods leuchtet zufällig; der nächste, sobald du drückst. Nie zweimal derselbe hintereinander. 12 Runden. |
| **Quadrat** | Central + 3 | vier blau | Wie Dreieck mit vier Pods. |
| **Stern** | Central + 4 | blau, blau, gelb, blau, blau | Wie Weiche mit vier Zielen. |
| **Dreizack** | Central + 3 | gelb, drei blau | Wie Weiche mit drei Zielen. |
| **Run** | Central + 2 | drei cyan | Alle Pods leuchten im selben Moment. Alle drücken, kurze Pause, nächste Runde. |
| **Run5** | Central + 4 | cyan, rot, cyan, rot, cyan | Alle fünf leuchten gleichzeitig, zwei davon rot. Nur die grünen drücken; ein roter beendet die Runde. |
| **Duo** | Central + 1 | zwei blau | Central und Ziel wechseln sich nach einer kurzen zufälligen Pause ab. Nicht innerhalb von 5 s gedrückt = verpasst. 10 Runden. |
| **Effects** | Central + 1 | magenta + gelb | Zeigt die Lichteffekte: Ampel-Countdown, dann Ziel und Central rechtzeitig drücken. |
| **Charge** | Central + 1 | drei cyan | Taster halten, um den Ring „aufzuladen“, und im richtigen Moment loslassen. |
| **Release** | Central + 1 | zwei grün | Pod halten und loslassen, sobald er grün wird (Startreaktion wie beim Sprintstart). |
| **Domination** | Central + 2 | rot und blau | Teamspiel: Zwei Teams laufen herum und drücken Pods; jeder Druck färbt einen Pod rot oder blau. Nach 20 s gewinnt das Team mit mehr Pods. |

Das Menü auf deinen Pods kann anders aussehen: Mit der App kannst du Spiele hinzufügen, entfernen
und umsortieren.

---

## 7. Die App

Die ReactPod-App läuft im Webbrowser, auf Handy und Computer:

**https://runningjoke.github.io/reactionButton/**

- Am besten in **Chrome oder Edge** (Android, Windows, Mac, Linux). Bluetooth im Browser geht auf
  dem iPhone noch nicht.
- **Installieren** über das Browser-Menü („App installieren“ / „Zum Startbildschirm hinzufügen“). Dann
  öffnet sie sich wie eine normale App und funktioniert auch ohne Internet.
- Sprachen: Deutsch und Englisch (Einstellungen → Sprache).
- **Demo-Pod:** Du kannst alles ohne Pods ausprobieren. Beim Verbinden *Demo-Pod* wählen.

### 7.1 Mit den Pods verbinden

Oben auf den Verbindungs-Chip tippen, dann wählen:

| Auswahl | Wann |
|---|---|
| **Bluetooth** | Handy oder Computer. Der Central muss im **Programm-Menü** sein (§3, Schritt 2). In der Liste „ReactPod …“ wählen. |
| **USB-Kabel** | Computer mit Chrome oder Edge, jeder Pod. |
| **Demo-Pod** | Keine Pods zur Hand: ein in der App simulierter Pod. |

Ändern lässt sich nur der **Central im Programm-Menü**. Bis Firmware 2.11 schaltet sich
Bluetooth aus, sobald ein Spiel gewählt ist; verbinde dich also vorher. Ab Firmware 2.12 bleibt
die Verbindung auch während des Spiels bestehen (siehe §8.6).

Ist der Pod mit einer **PIN** geschützt, fragt die App danach, bevor du etwas änderst.

### 7.2 Die Seiten

| Seite | Was du dort machst |
|---|---|
| **Pod** | Das verbundene Set: Name, Firmware, welche Spiele drauf sind und ob sie zur App passen. Änderungen auf den Pod übertragen oder die Originalspiele wiederherstellen. Set umbenennen. |
| **Trainingsansicht** (von der Seite Pod aus) | Mehrere verbundene Sets nebeneinander, eine Karte je Set: wer trainiert, der letzte Bericht und, solange ein Spiel wartet, Weiter / Wiederholen / Stopp und die Werte für die nächste Runde. Spiel pausieren und fortsetzen (Firmware 2.12). Siehe §8.6. |
| **Programme** | Alle Spiele: die auf dem Pod, die mitgelieferten und deine eigenen. Öffnen, um zu sehen, wie ein Spiel abläuft; kopieren, importieren, exportieren. |
| **Editor** | Ein Spiel ändern oder Schritt für Schritt ein neues bauen (§8.3). |
| **Simulation** | Ein Spiel am Bildschirm spielen: virtuelle Pods antippen statt echter. Gut zum Prüfen eigener Spiele. |
| **Menü** | Welche Spiele im Menü des Pods stehen, in welcher Reihenfolge und mit welchem Lichtmuster. Über die Seite Pod erreichbar. |
| **Ergebnisse** | Sportler, Trainingseinheiten und ihre Reaktionszeiten; Statistik und CSV-Export. |
| **Einstellungen** (Zahnrad) | Sprache, Expertenmodus, Plattform-Anmeldung (Vorschau), erweiterte Werkzeuge. |

---

## 8. Alltägliche Aufgaben

### 8.1 Anzahl der Runden ändern

Das Spiel unter **Programme** öffnen, *Anpassen* tippen (oder im **Editor** öffnen) und die
Rundenzahl ändern. Beim Speichern entsteht deine eigene Kopie auf dem Handy; übertrage sie auf den
Pod (§8.4).

### 8.2 Reihenfolge im Menü ändern

**Pod → Menü**: Spiele nach oben oder unten schieben, nie gespielte entfernen, Lichtmuster wählen.
Dann auf den Pod übertragen (§8.4).

### 8.3 Ein eigenes Spiel bauen

Der Editor baut ein Spiel aus **Schritten**, wie ein Rezept: „Pod 2 grün“, „auf Drücken warten“,
„1 Sekunde warten“, „12-mal wiederholen“, „Bericht an die App“ und so weiter.

1. **Programme → Neues Programm**, oder ein mitgeliefertes Spiel kopieren, das deiner Idee nahekommt.
2. Der Spiel-Assistent stellt ein paar Fragen (wie viele Pods, was soll passieren) und baut eine
   erste Fassung (*Spiel bauen*).
3. Schritt hinzufügen: **+** tippen und sagen, was er tun soll (leuchten, warten, zufälligen Pod
   wählen, zählen, …). Jeder Schritt hat ein Blatt mit seinen Einstellungen.
4. Unter **Simulation** ausprobieren.
5. Ins Menü aufnehmen (§8.2) und auf den Pod übertragen (§8.4).

Alles geht ohne Ziehen und Ablegen. Wer alle technischen Details sehen will, schaltet
**Einstellungen → Expertenmodus** ein.

### 8.4 Änderungen auf den Pod übertragen

Mit dem Central verbinden (§7.1) und **Pod** öffnen. Die App zeigt, welche Spiele sich zwischen App
und Pod unterscheiden. **Auf den Pod** tippen. Die Ziele bekommen die neuen Spiele
automatisch: einmal ein beliebiges Spiel starten, während alle Pods des Sets eingeschaltet sind.

**Standard wiederherstellen** spielt die Originalspiele wieder auf.

### 8.5 Mehrere Gruppen in einer Halle

Jedem Set einen eigenen Namen geben (Pod → Set umbenennen) und die Sets getrennt halten (§5). Ein
Handy betreut derzeit ein Set; mehrere Sets gleichzeitig verfolgen ist geplant.

### 8.6 Ergebnisse und Sportler

Unter **Ergebnisse** legst du Sportler an (mit Einverständnis; bei Kindern dem der Eltern) und
siehst ihre Trainingseinheiten, Bestzeit, Mittelwert und jeden einzelnen Wert. Eine Einheit lässt
sich als Tabelle (CSV) exportieren.

Live-Ergebnisse brauchen Firmware 2.12 oder neuer auf dem Central:

- sie lässt Bluetooth während des Spiels an, und
- die mitgelieferten Spiele senden nach jedem Durchgang einen Bericht.

Damit bekommt die Seite **Pod** während des Spiels einen Bereich *Training*: wer gerade trainiert,
der letzte Bericht und die Knöpfe **Weiter**, **Wiederholen** (Durchgang noch einmal, das Ergebnis
zählt nicht) und **Stopp**. Bis dahin sagt die App, dass der Pod noch keine Ergebnisse sendet.

Die **Trainingsansicht** (auf der Seite Pod, unter dem Menü-Link) zeigt alle verbundenen Sets auf
einem Bildschirm, eine Karte je Set. Ein zweites Set verbindest du mit *Weiteres Set verbinden* im
Verbindungsdialog; ein Demo-Pod geht genauso. Eine Karte zeigt den Zustand des Sets (Menü, Suche,
läuft, pausiert, wartet auf dich), wer trainiert, den letzten Bericht und die Knöpfe dieses Sets.
Während ein Spiel wartet, bietet die Karte **Weiter**, **Wiederholen** und **Stopp** sowie je Wert,
den du für die nächste Runde ändern darfst, ein Zahlenfeld. **Pause** und **Weiter** (Spiel) brauchen
Firmware 2.12.

Lass die App beim Training offen. Der Bildschirm bleibt an, solange die Ansicht offen ist. Schläft
das Telefon oder geht die App in den Hintergrund, bricht aber die Bluetooth-Verbindung ab. Die App
verbindet sich dann, solange sie offen ist, selbst neu. Berichte, die inzwischen kamen, werden
nachgeholt und gespeichert.

Ergebnisse in ein Online-Sportlerprofil (Vereinsplattform) hochzuladen ist eine Vorschau-Funktion
unter Einstellungen.

---

## 9. Hilfe bei Problemen

| Problem | Versuch das |
|---|---|
| Ein Pod zeigt beim Einschalten nichts | Laden (eingeschaltet). Schalterstellung prüfen. |
| Der Central zeigt ein Spielmuster, aber kein Ziel macht mit | Ziele müssen an und gelb sein. Ein Ziel aus einem anderen Set bleibt gelb: zurücksetzen (gelb, 3 s halten, weißer Blitz). |
| Der Central bleibt bei blauen Paaren | Zu wenig Ziele für dieses Spiel: mehr Pods einschalten oder ein Spiel für weniger Pods wählen. |
| Alles gelb am Central während des Spiels | Ein Ziel ist weg (Akku, Reichweite, ausgeschaltet). Zurückholen; das Spiel läuft von selbst weiter. |
| Der Central blitzt rot beim Bestätigen | Ein Akku ist unter 5 %. Pods (und Central) laden und dann neu starten. |
| Der Central blinkt rot | Er hat keine Spiele oder ein Spiel ist kaputt. Mit der App verbinden und *Standard wiederherstellen*. |
| Die App findet den Pod per Bluetooth nicht | Der Central muss im Programm-Menü sein (mit gehaltener Oberseite einschalten). Chrome oder Edge verwenden. Am Computer hilft oft Bluetooth aus- und wieder einschalten. |
| „Der Pod ist beschäftigt“ in der App | Ein Spiel läuft. Central aus- und ins Menü wieder einschalten. |
| Die App fragt nach einer PIN | Das Set ist geschützt. Den Besitzer fragen oder die PIN über USB löschen. |
| Ich will ein anderes Spiel | Central aus- und wieder einschalten (Oberseite während des blauen Lauflichts halten) und neu wählen. |

---

## 10. Lichtzeichen auf einen Blick

| Pod | Licht | Bedeutung |
|---|---|---|
| jeder | blaues Lauflicht (2 s) | startet. Jetzt die Oberseite halten, um ihn zum Central zu machen |
| Ziel | gelb | wartet auf den Central seines Sets |
| jeder | Ring füllt sich 2 s: grün, gelb-orange oder rot | Akkustand (beim Einschalten). Oberseite halten, um ihn zum Central zu machen |
| Ziel | langsames gelb-oranges Blinken, einmal pro Sekunde | Akku unter 15 %, wartet im Set (nicht im Spiel) |
| Ziel | weißer Blitz | Set vergessen (gelb, 3 s gehalten) |
| Ziel | dunkel | bereit |
| Ziel | grün / rot | drücken / nicht drücken |
| Central | kleines Muster | Programm-Menü: kurz = nächstes Spiel, halten = auswählen |
| Central | weißes Licht wird heller | Auswahl läuft (weiter halten) |
| Central | blaue Paare | wartet auf die Ziele |
| Central | alles grün | bereit: drücken zum Start |
| Central | alles gelb | Pause, ein Ziel fehlt |
| Central | rot, langsam blinkend | Fehler: keine Spiele oder ein kaputtes Spiel |
| Central | rot, 1 s aufblitzen beim Bestätigen | das Spiel startet nicht: ein Akku ist unter 5 % |

---

## 11. Begriffe

| Begriff | Bedeutung |
|---|---|
| **Pod** | Ein ReactPod. |
| **Set** | Die Pods, die zusammen spielen. |
| **Central** | Der Pod, der das Spiel leitet (mit gehaltener Oberseite eingeschaltet). |
| **Ziel / Peripheral** | Jeder andere Pod des Sets. |
| **Spiel / Programm** | Was die Pods tun. Auf dem Central gespeichert. |
| **Programm-Menü** | Die Liste der Spiele auf dem Central, als Lichtmuster. |
| **Runde** | Eine Aufgabe, z. B. „den grünen Pod drücken“. |
| **Durchgang** | Eine Serie von Runden (z. B. 12), danach die Zusammenfassung. |
| **Bericht** | Die Ergebnisse eines Durchgangs, an die App gesendet. |
| **Demo-Pod** | Ein in der App simulierter Pod. |
