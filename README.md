# FamilieSinning

Private Einladungswebsite mit GitHub Pages als öffentlicher Oberfläche und Cloudflare Workers + D1 für den geschützten Zugang und die Antworten.

## Aktueller Stand

Die Dateien sind vorbereitet. Die Website ist **noch nicht veröffentlicht**. `config.js` enthält absichtlich noch keine API-Adresse. Es gibt noch keine persönlichen Einladungslinks. Die Anmeldedaten der Kinder und die Veranstaltungsdetails werden erst nach Bereitstellung in die geschützte Datenbank eingetragen.

## Veröffentlichung im kostenlosen Tarif

1. Im GitHub-Konto `edzartsinning-ui` ein **öffentliches** Repository `FamilieSinning` anlegen. GitHub Pages unter **Settings → Pages → Deploy from a branch → main / (root)** aktivieren. GitHub Pages ist für öffentliche Repositories im Free-Tarif verfügbar.
2. Ein Cloudflare-Konto im **Workers Free** Tarif anlegen. Keinen Paid-Tarif wählen. Eine D1-Datenbank `familiesinning` anlegen. Ihre Datenbank-ID in `worker/wrangler.toml` einsetzen.
3. `worker/schema.sql` auf der D1-Datenbank ausführen und `worker/src.js` als Worker bereitstellen. Die drei Werte `ADMIN_PASSWORD` und `TOKEN_SECRET` als **Secrets** beim Worker hinterlegen. `TOKEN_SECRET` muss eine lange zufällige Zeichenfolge sein. Die Werte dürfen nie ins Repository oder in `config.js`.
4. Die öffentliche Worker-Adresse in `config.js` als `FAMILIE_API_URL` eintragen. Die vorhandene `ALLOWED_ORIGIN`-Angabe passt zur geplanten GitHub-Pages-Adresse.
5. Im Elternbereich anmelden, die Veranstaltung sowie die neun eingeladenen Namen eintragen und für jeden Namen einen persönlichen Link erzeugen. Die Namen aus der Einladung gehören nur in die geschützte Datenbank, nicht in das GitHub-Repository.
6. Erst nach erfolgreichem Test der Anmeldung die individuellen Links als QR-Codes in die jeweiligen Einladungskarten einsetzen und die Karten neu ausgeben.

Die voraussichtliche GitHub-Pages-Adresse lautet `https://edzartsinning-ui.github.io/FamilieSinning/`; sie ist erst nach der Veröffentlichung gültig.

## Test vor dem Teilen

- Ohne Code dürfen keine Veranstaltungsdaten und Namen erscheinen.
- Jeder persönliche Link zeigt die Details und genau den zugehörigen Namen.
- Eine Zu- und eine Absage testen und im Elternbereich prüfen. Danach Testantworten aus D1 entfernen.
- Export prüfen.
- Ungültigen persönlichen Link und falsches Elternpasswort testen.
- Öffnen, Schließen und Ruhemodus über die Datumsgrenzen prüfen.

Anmeldeschluss ist der 16.01.2027 einschließlich. Vom 17. bis 23.01.2027 bleiben die Infos für eingeladene Gäste sichtbar, Antworten sind geschlossen. Ab 24.01.2027 ist Ruhemodus. Die offizielle [funXperience-Seite zu Cube Challenges Kassel](https://www.funxperience.de/kassel/cube-challenges/) ist verlinkt.

## Kosten

Es sind ausschließlich kostenlose Tarife vorgesehen. Im Cloudflare Free-Tarif werden Anfragen beim Erreichen der Limits begrenzt. Ein kostenpflichtiger Tarif wird nicht benötigt.
