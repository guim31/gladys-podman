# Podman

Diese Integration bringt die **Container einer Podman-Maschine** in Gladys:
ein Gerät pro gewähltem Container, mit seinem Zustand (läuft oder nicht),
seiner Gesundheit, wenn er einen Healthcheck hat, und seinen Neustarts, dazu
ein Gerät für die Maschine selbst. Ein Container-Gerät ist ein Schalter:
ausgeschaltet stoppt er den Container, eingeschaltet startet er ihn. Szenen
können reagieren, wenn ein Container stoppt, ohne dass Gladys es verlangt hat,
oder fehlerhaft wird, und einen Container starten, stoppen oder neu starten;
ein Dashboard-Widget listet die Container auf, Probleme zuerst.

Die Integration spricht mit der **REST-API von Podman** in deinem lokalen Netzwerk; nichts
läuft über die Cloud.

Getestet mit einem echten Podman 6.2 (Image `quay.io/podman/stable`, als
root): die Liste, der Schalter, die Aktionen, ein hinter dem Rücken von Gladys
beendeter Container, ein fehlschlagender Healthcheck, ein Container in einem
Pod, ein unbekannter Container und ein gestoppter API-Dienst. Ohne echte
Gladys-Instanz entwickelt: Rückmeldungen sind willkommen in
[den Issues](https://github.com/guim31/gladys-podman/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Eine Linux-Maschine mit Podman 4.0 oder neuer, von der Gladys-Maschine aus
  erreichbar.
- Einmalig eine Shell auf dieser Maschine, um den Podman-API-Dienst zu
  starten.

## Erste Schritte

### 1. Den Podman-API-Dienst starten

Gladys führt die Integration in einer Sandbox aus: Die Integration erreicht den
Unix-Socket von Podman nicht, nur einen TCP-Port. Lege auf der Podman-Maschine
mit dem Konto, dem die Container gehören (dein Benutzer für rootless
Container, root für die anderen),
`~/.config/systemd/user/podman-gladys.service` (rootless) oder
`/etc/systemd/system/podman-gladys.service` (root) an und ersetze
`192.168.1.20` durch die Adresse der Maschine:

```ini
[Unit]
Description=Podman API service for Gladys
After=network-online.target

[Service]
ExecStart=/usr/bin/podman system service --time=0 tcp:192.168.1.20:8888
Restart=on-failure

[Install]
WantedBy=default.target
```

Dann `systemctl --user enable --now podman-gladys` (rootless, dazu
`loginctl enable-linger`, damit er ohne offene Sitzung läuft) oder
`sudo systemctl enable --now podman-gladys`. Zum Ausprobieren starte einfach
`podman system service --time=0 tcp:192.168.1.20:8888` in einem Terminal.

### 2. Den Port schützen

**Dieser Dienst hat kein Passwort**: Wer den Port erreicht, steuert Podman —
startet beliebige Container, bindet beliebige Ordner ein — und bei einem
root-Dienst die ganze Maschine. Gib ihn nie ins Internet frei und öffne ihn
nur für die Gladys-Maschine (hier `192.168.1.10`):

```sh
# firewalld (Fedora, RHEL, CentOS)
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.10" port port="8888" protocol="tcp" accept'
sudo firewall-cmd --reload
# ufw (Debian, Ubuntu)
sudo ufw allow from 192.168.1.10 to any port 8888 proto tcp
```

Mit nftables oder einer anderen Firewall gilt dieselbe Regel: Port 8888, nur
Gladys. Bevorzuge einen rootless Dienst: Er sieht nur die Container seines
Benutzers.

### 3. Die Integration konfigurieren

In Gladys unter **Integrationen → Podman → Konfiguration**:

- **Adresse der Podman-API**: `192.168.1.20:8888` (IP oder Name der
  Maschine; Port 8888, wenn er fehlt, `tcp://…` und `http://…` werden
  akzeptiert);
- **Name der Maschine** (optional): wird im Gerätenamen, im Widget und in den
  Nachrichten angezeigt;
- **Aktualisierungsintervall**: standardmäßig 30 Sekunden;
- **Sprache der Namen**: die Sprache der Funktionsnamen und der
  Aktionsmeldungen.

**Verbindung testen** liest Podman und sagt, was gefunden wurde.

### 4. Die Geräte hinzufügen

Füge im Tab **Entdecken** die Maschine und die zu verfolgenden Container
hinzu. Ein Container wird über seinen **Namen** erkannt: Unter demselben Namen
neu erstellt (neues Image, Quadlet, podman-compose, Auto-Update), behält er
sein Gerät und seinen Verlauf.

## Die Geräte

### Die Maschine

- **Erreichbar**: 1, solange Podman antwortet;
- **Podman-Version**;
- **Laufende Container**, **Container** (insgesamt), **Fehlerhafte Container**.

### Container

- **Läuft**: ein Schalter; aus stoppt den Container (Podman sendet SIGTERM und
  wartet 10 Sekunden vor SIGKILL), an startet ihn;
- **Gesund**: für einen Container mit Healthcheck 1, wenn gesund, 0, wenn
  fehlerhaft (kein Wert beim Start oder im gestoppten Zustand);
- **Neustarts**: die Neustarts durch die Neustart-Richtlinie.

Ein von der Maschine entfernter Container erscheint als nicht erreichbar.

## Dashboard

Das Widget **Podman-Container** zeigt die laufenden Container von der
Gesamtzahl, die fehlerhaften und die Liste der Container: die hinzugefügten
(alle, wenn keiner hinzugefügt ist), Probleme zuerst. Wähle in seinen
Einstellungen einen Container, um die Schaltflächen **Starten** oder
**Stoppen** und **Neu starten** zu erhalten; **Aktualisieren** liest Podman
neu. Die Liste und jede Schaltfläche lassen sich ausblenden.

## Szenen

### Auslöser

- **Container unerwartet gestoppt**: Ein laufender Container wurde gestoppt
  (Absturz, Speicher erschöpft, `podman stop` von Hand) oder von seiner
  Neustart-Richtlinie neu gestartet, ohne dass Gladys es verlangt hat. Ein von
  Gladys verlangtes Stoppen (Schalter, Aktion, Widget, Szene) löst nichts aus.
  Variablen: Container, Zustand, Exit-Code, Neustarts.
- **Container fehlerhaft**: Der Healthcheck eines Containers schlägt fehl
  (Podman markiert ihn nach seinen Versuchen als unhealthy); erneut gemeldet
  nach Erholung oder Neustart.
- **Podman nicht erreichbar**: Der API-Dienst antwortet nicht mehr (zwei
  Lesevorgänge in Folge, im Abstand von 15 Sekunden); einmal pro Ausfall
  gemeldet.

Die ersten beiden lassen sich auf ein Container-Gerät beschränken.

### Aktionen

- **Container starten**, **Container stoppen**, **Container neu starten**: Der
  Container wird unter den Container-Geräten gewählt; die Ausgaben sind sein
  Name und ob er danach läuft. Dieselben drei sind auch Schaltflächen der
  Konfigurationsseite, neben **Verbindung testen**.

### Szenen-Ideen

- Benachrichtige mich mit dem Exit-Code, wenn der Datenbank-Container
  unerwartet stoppt.
- Starte den Container des Medienservers jede Nacht um 4 Uhr neu.
- Starte den Container des Spieleservers, wenn ich am Freitagabend nach Hause
  komme, und stoppe ihn um Mitternacht.

## Fehlerbehebung

- **Der Dienst antwortet nicht**: Prüfe, dass er läuft
  (`systemctl --user status podman-gladys`), dass er auf der Adresse der
  Maschine lauscht und nicht auf `127.0.0.1`, und die Firewall-Regel.
- **Keine Podman-API unter dieser Adresse**: Die Adresse führt woandershin —
  eine Docker-Engine wird nicht unterstützt, nutze ihre eigene Integration.
- **Ein rootless Dienst listet keinen Container**: Er sieht nur die Container
  des Benutzers, der ihn startet; starte ihn mit diesem Benutzer.
- **Keine Gesundheit**: Podman führt Healthchecks über systemd-Timer aus; ein
  Container ohne Healthcheck oder eine Maschine ohne systemd hat keine.
- **Protokolle**: Setze `LOG_LEVEL=debug` an der Integration, um jeden
  Lesevorgang zu sehen.

## Grenzen

- Eine Podman-Maschine pro Integration.
- Pods sind keine Geräte: ihre Container sind es, einer nach dem anderen.
- Keine Prozessor- oder Speicherwerte: Diese hängen von den cgroups jeder
  Maschine ab.
- Der Podman-API-Dienst hat keine Authentifizierung: Schütze seinen Port
  (siehe oben).
- Nicht verbunden mit dem Podman-Projekt oder Red Hat.
