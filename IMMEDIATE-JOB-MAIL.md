# Immediate job mail

Minimalny plan uruchomienia prywatnej skrzynki `szymon@szymondlugolecki.com` do bezpiecznego prowadzenia korespondencji rekrutacyjnej przed wznowieniem pełnego [planu firmowej poczty](PLAN-FIRMOWEJ-POCZTY.md).

## Status

- Ostatnia aktualizacja: 2026-07-25
- Stan: `IN PROGRESS`
- Aktualne zadanie: `JOB-ARCH-001` private verified archive recipient configuration
- Następne zadanie: `JOB-ARCH-002` dual-path inbound archive delivery
- Docelowy tryb: private single-owner beta
- Adres pocztowy: `szymon@szymondlugolecki.com`
- Website origin: `https://mail.szymondlugolecki.com`
- Mailbox: immutable singleton `primary`
- Recovery i awaryjne archiwum: oddzielny, zweryfikowany adres Gmail
- Główny plan: wstrzymany na `ORG-015`, bez zmiany jego kolejności

## Cel

Launch gate jest spełniony, gdy z produkcyjnej aplikacji można:

1. Zalogować się i odzyskać dostęp bez zależności od zarządzanego adresu.
2. Wysłać z `szymon@szymondlugolecki.com` prostą wiadomość i PDF.
3. Odebrać i bezpiecznie przeczytać wiadomość tekstową lub HTML.
4. Pobrać otrzymany załącznik i zweryfikować jego dokładne bajty.
5. Odpowiedzieć do MIME `Reply-To`, a przy jego braku do MIME `From`.
6. Zachować poprawne `Message-ID`, `In-Reply-To` i `References`.
7. Zachować niezależną kopię przychodzącej i wychodzącej korespondencji w Gmailu.
8. Przejść datowany live smoke test z Gmail i Outlook oraz sprawdzenie SPF, DKIM i DMARC.

Launch gate pozostaje zablokowany przez live część `JOB-REPLY-004` oraz zadania archiwum i Cloudflare: lokalna Phase A nie dowodzi jeszcze exact equality zwróconego provider `messageId` z dostarczonym RFC `Message-ID` ani poprawnego grupowania `In-Reply-To`/`References` w Gmailu i Outlooku.

Do przejścia całego gate'a nie wysyłamy prawdziwych aplikacji o pracę z tej skrzynki.

## Granice

### W zakresie

- Jeden właściciel, jedna organizacja, jeden mailbox i jeden adres.
- Exact route wyłącznie dla `szymon@szymondlugolecki.com`.
- Compose, draft, outbound attachment i istniejący undo-send.
- Inbound, odczyt, pojedyncze Reply i pobieranie załączników.
- Zewnętrzny login/recovery oraz niezależne archiwum Gmail.
- Ręczny, kontrolowany deployment i live acceptance evidence.

### Poza zakresem

- Catch-all, aliasy, wiele mailboxów i wielu użytkowników.
- Reply all, forward i alias-preserving send identity.
- Transfery adresów, invitations, organization administration i mailbox lifecycle.
- Rozbudowa AI i automatyzacji.
- Destrukcyjne migracje, contraction i usuwanie compatibility artifacts.
- Pełne zamknięcie `SAFE-005`; Gmail jest niezależnym archiwum korespondencji, a nie backupem całego D1, MailboxDO, Workflow i konfiguracji aplikacji.

## Zasady bezpieczeństwa

- Login i recovery używają zewnętrznego adresu, nigdy wyłącznie `szymon@szymondlugolecki.com`.
- Publiczny password signup i generic first-password enrollment pozostają wyłączone.
- Email proof nie staje się ogólnym `control-plane-sensitive` step-up.
- Każda nowa security/control-plane storage mutation jest addytywna, audit/receipt-bound, replay-safe i fail-closed. Normalne mutacje treści mailboxa używają transakcyjnego `mailbox_operation` receipt/idempotency, chyba że zadanie jawnie wymaga audytu.
- Backend pozostaje prywatny i dostępny wyłącznie przez service binding.
- Wiadomości, adresy, tokeny, sekrety, hashe i raw MIME nie trafiają do telemetry.
- Produkcja pozostaje przypięta do zaakceptowanego commita; rozwój głównego planu nie jest automatycznie wdrażany.
- Nie wykonujemy destrukcyjnej migracji przed live backup/restore `SAFE-005`.

## Zadania

### Plan i baseline

- [x] JOB-PLAN-001 Zapisać osobny immediate plan, launch gate, zakres odłożony, zależności i model ograniczonego ryzyka.
- [ ] JOB-PLAN-002 Przed pierwszym deploymentem uruchomić pełny gate release commit: `bun run check`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:mailbox-restore` oraz `git diff --check`.
- [ ] JOB-PLAN-003 Uzyskać pozytywny live GitHub CI run, przypiąć release commit i wyłączyć automatyczny production deploy z bieżącego `main`.

### First-owner enrollment

- [x] JOB-BOOT-001 Dodać kontrakt jednorazowego first-owner password enrollment. Istniejący magic link lub email OTP tworzy verified effect-auth usera. Nowa operacja przyjmuje wyłącznie `{operationId,password}` i nie przyjmuje emaila, user ID, organization ID ani mailbox ID od klienta. Dopuszcza tylko unrestricted, token-bound session z maksymalnie pięciominutowym matching email proof, dokładnie jednym adresem w `MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST`, pustym deploymentem i brakiem wcześniejszego credential/recovery/owner state.
- [x] JOB-BOOT-002 Dodać forward-only storage seal, immutable receipt, metadata-only audit i jedną atomiczną D1 batch tworzącą password credential. Exact replay zwraca receipt, changed intent jest konfliktem, unknown commit wykonuje receipt readback, a równoległe próby mogą utworzyć dokładnie jeden credential i singleton seal.
- [x] JOB-BOOT-003 Dodać prywatny `no-store` endpoint i UI prowadzące przez: magic link/OTP, pierwsze hasło, istniejący password step-up, external recovery, UV passkey, recovery codes i istniejący mailbox bootstrap. Hasło nie jest zapisywane w local storage i jest czyszczone po step-up.
- [x] JOB-BOOT-004 Udowodnić testami, że publiczny signup, generic password set, nieallowlistowany lub managed-domain login, stale/wrong proof, drugi właściciel, session race, receipt/audit collision i częściowy zapis pozostają odrzucone.

Lokalne evidence `JOB-BOOT-004` z 2026-07-25: focused matrix `49/49`, pełny `bun run test` `152/152` files i `1769/1769` tests, a także `bun run typecheck`, `bun run check`, `bun run build` i `git diff --check` zakończone powodzeniem. Macierz obejmuje public signup/generic set denial, exact allowlist i managed-domain policy, magic-link oraz email-OTP proof, granice czasu wraz z stale/wrong/future evidence, sequential/cross-actor claim, token-bound session i identity races, receipt/audit collision, unknown outcome, rollback po audit/receipt/final-cleanup failure oraz HTTP auth/origin/sanitization i Website `no-store`. Testy D1 używają kanonicznych `auth_user`, verified `auth_user_identity`, `auth_session` i authentication-event rows, czyli dokładnego persisted contract konsumowanego po istniejącym magic-link lub email-OTP completion; nie duplikują wewnętrznej implementacji effect-auth registration. To jest evidence lokalne, nie zamyka `JOB-CF-005` ani live acceptance.

### Otrzymane załączniki

- [x] JOB-ATT-001 Dodać osobny, autoryzowany use case pobierania zwykłego inbound attachment. Nie rozluźniać endpointu inline CID images.
- [x] JOB-ATT-002 Dodać Backend i Website GET route z exact mailbox/message/attachment binding, `attachment.read`, zweryfikowanym R2 metadata/size/hash, bezpiecznym `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` oraz `Cache-Control: private, no-store`.
- [x] JOB-ATT-003 Dodać przycisk pobrania i testy exact bytes, hostile filename, cross-mailbox ID, brak sesji, storage mismatch i nieistniejący attachment.

Lokalne evidence `JOB-ATT-001/002/003` z 2026-07-25 na bazie `f97357b`: osobny ordinary inbound use case i locator zachowują niezmienione ograniczenia inline CID. Nowa polityka download wymaga zawsze mailbox `attachment.read` oraz dodatkowo mailbox `message.read` albo matching `folder.read`; testy pokrywają folder-only denial, folder plus attachment allow i message plus attachment allow. Use case zachowuje folder/label/message ancestry i limit 10 MiB. SQLite testy dopuszczają ready committed inbound attachment oraz odrzucają pre-ready, failed, deleted message, deleted attachment, outbound i uncommitted rows. R2 testy używają ordinary `InboundAttachmentBlobLocation` bez `contentId` i pokrywają exact bytes, missing object oraz mismatch custom metadata, MIME, object size, object hash i downloaded-content hash. Backend test bez cookie zwraca 401. Website waliduje bounded `Content-Length`, content type i `Content-Disposition`, odrzuca invalid metadata oraz null body, po czym przekazuje Backend `ReadableStream` bez ponownego buforowania; route kopiuje tylko allowlistowane bezpieczne nagłówki i testuje exact browser bytes. Hostile/non-ASCII filename, cross-site fetch, cross-mailbox/message/attachment/folder IDs, nagłówki, ThreadView action i regresja inline CID również są pokryte. Focused matrix przeszła `177/177`, pełny `bun run test` zakończył się wynikiem `154/154` files i `1796/1796` tests, a `bun run typecheck`, `bun run check`, `bun run build` oraz `git diff --check` zakończyły się powodzeniem. To jest evidence lokalne; nie zastępuje live acceptance.

### Pojedyncze Reply

- [x] JOB-REPLY-001 Parsować i przechowywać inbound MIME `Reply-To` oraz bounded RFC threading metadata. Migracja MailboxDO jest addytywna i zachowuje stare rows.
- [x] JOB-REPLY-002 Dodać autoryzowaną projekcję reply target oraz UI Reply. Odbiorcą jest `Reply-To`, a w jego braku `From`; subject otrzymuje pojedyncze `Re:`. Reply nie kopiuje starych załączników i używa bieżącego singleton primary sendera.
- [x] JOB-REPLY-003 Zamrozić `In-Reply-To` i bounded `References` w immutable outbound snapshot przed dispatch. Nie generować, nie zamrażać i nigdy nie próbować ustawiać własnego `Message-ID`: Cloudflare Email Service kontroluje ten nagłówek i odrzuca próbę override jako `E_HEADER_NOT_ALLOWED` ([oficjalne ograniczenie providera](https://developers.cloudflare.com/email-service/reference/headers/#platform-controlled-headers)).
- [ ] JOB-REPLY-004 Przekazać allowlistowane `In-Reply-To` i `References` do Cloudflare Email Sending i przetestować provider rejection. Local Phase A complete; live equality/threading evidence required. Po acceptance zapisać zwrócony provider `messageId` wyłącznie jako kandydata na RFC `Message-ID`; datowane live staging evidence musi potwierdzić jego dokładną równość z `Message-ID` rzeczywiście dostarczonego RFC oraz poprawne grupowanie odpowiedzi w Gmail i Outlook. Bez takiego dowodu nie traktować provider result jako autorytatywnego delivered RFC `Message-ID` i nie próbować custom `Message-ID`.

Lokalne evidence `JOB-REPLY-001` z 2026-07-25 na bazie `ee2c78a`: PostalMime parsuje wszystkie poprawne mailboxy i grupy `Reply-To` przez istniejący `MailAddress`, odrzuca niepoprawne adresy z manifestu i liczy wszystkie raw mailboxy `Reply-To` do wspólnego limitu. Nowe MIME `Message-ID`, `In-Reply-To` i `References` używają jawnie konserwatywnego, provider-safe profilu, a nie pełnej gramatyki RFC 5322: wymagają pojedynczego tokenu `<id-left@id-right>` bez whitespace, controls i zagnieżdżonych bracketów, z ASCII dot-atom-like id-left, LDH/dotted id-right i limitem 998 UTF-8 bytes; comments, garbage i niepoprawne tokeny są pomijane, persisted `RfcMessageId` zachowuje kompatybilność starych danych, a limit `References` wynosi dokładnie 100. Opcjonalne pole V1 zachowuje decode starych manifestów, a generacje Workflow v3/v4 zapobiegają porównaniu cached manifestu bez `replyTo` z nową reparsą. Addytywna migracja MailboxDO v13 zachowuje rows v12 jako null; column CHECK wymusza nullable, poprawną, niepustą tablicę JSON o maksymalnie 256 elementach, a natywne `BEFORE INSERT/UPDATE` triggers walidują każdy element jako obiekt z dokładnie dozwolonym `address` i opcjonalnym tekstowym `displayName` oraz konserwatywnym SQLite odpowiednikiem ASCII dot-atom + DNS `EmailAddress`. Runtime corruption zwraca fail-closed typed `invalid-state`, nie defect. Inbound commit zapisuje `replyTo` atomowo i obejmuje canonical idempotency key; `MessageDetail`, `GetMessage`, `GetThread` i protokół DO je hydratują, natomiast list/search summary nie ujawniają go jeszcze przeglądarce. Nowy outbound snapshot pozostawia pole null, a resend kopiuje istniejący snapshot. Restore decoder przyjmuje wspierane artifacts/evidence v12 i v13: v13 zachowuje pełne exact digest i closure checks, natomiast v12 jest najpierw dokładnie weryfikowane, następnie migrowane produkcyjną migracją 13 i publikowane jako zdrowe v13 z niezmienionym mailbox ID oraz null `reply_to_json` dla legacy rows. Retry po utracie odpowiedzi wyprowadza niezależny oczekiwany efekt migracji 13 z immutable v12 archive, normalizuje wyłącznie niedeterministyczny ledger `applied_at`, dokładnie weryfikuje istniejący target i zwraca `already-restored`; foreign, partial lub tampered target nadal failuje bez clobber. Focused tests `97/97`, restore rehearsal `20/20`, pełny `bun run test` `154/154` files i `1808/1808` tests, a także `bun run typecheck`, `bun run check`, `bun run build` i `git diff --check` zakończyły się powodzeniem.

Lokalne evidence `JOB-REPLY-002` z 2026-07-25 na bazie `91a4e97`: osobna komenda Reply wiąże wyłącznie mailbox, aktualny Folder/Label, target message/thread i stabilny operation ID; nie przyjmuje sendera, odbiorców ani ukrytego ancestry. Mailbox-level `draft.create` jest wymagane przed jakimkolwiek operation readback, więc użytkownik bez tej kompetencji nie odróżni conflict od absence. Po autoryzacji Backend wykonuje exact readback `mailbox_operation` po canonical command key: committed unknown outcome zwraca ten sam draft także po move/delete targetu, autoryzuje istniejący wynik przez matching draft edit, changed intent pozostaje konfliktem, a miss dopiero wtedy wymaga matching message read i live target validation. Transakcyjna operacja MailboxDO hydratuje istniejący `MessageDetail` i odrzuca missing, outbound oraz cross-thread/folder/label ancestry. Odbiorcy są wyprowadzani ze wszystkich `Reply-To`, deduplikowani z zachowaniem kolejności i semantyki case-sensitive local part/case-insensitive domain, z fallbackiem do `From`, fail-closed bez celu i typed rejection powyżej 50 deduplikowanych adresów. Draft ma dokładnie jeden `Re:`, puste body, brak załączników i server-set `threadId`/`inReplyToMessageId`; istniejący generic update nadal zachowuje hidden ancestry. Endpoint, session matrix, Website proxy/server function i UI nie przenoszą sender authority. Per-message eligibility wymaga inbound direction i exact selected Folder/Label ancestry. Bounded 16-entry TTL/LRU-like, schema-validated same-origin `sessionStorage` przechowuje wyłącznie pending command/operation ID pod exact mailbox/thread/message/Folder-or-Label context: uncertain network/500/502 zachowuje niezależne operacje także podczas pracy z innym targetem, definitive 4xx/conflict, success, expiry i capacity eviction usuwają tylko właściwe entry. In-memory retry porównuje pełny context, a keyed pane odrzuca stale React state po zmianie selection/thread. Sender nie jest częścią Reply i jest rozwiązywany z bieżącego primary identity dopiero przy send. Content draft creation nie dodaje content audit logów: używa istniejącego transakcyjnego `mailbox_operation` receipt/idempotency; nowe security/control-plane mutations pozostają audit/receipt-bound, a normalna content mutation wymaga audytu tylko wtedy, gdy zadanie mówi to jawnie. Focused matrix przeszła `236/236`, pełny `bun run test` zakończył się wynikiem `156/156` files i `1839/1839` tests, a `bun run typecheck`, `bun run check`, `bun run build` oraz `git diff --check` zakończyły się powodzeniem.

Lokalne, niecommitted evidence `JOB-REPLY-003` oraz Phase A `JOB-REPLY-004` z 2026-07-25 na bazie `1ff2703`: fresh atomic schedule ładuje exact parent wyłącznie ze scoped MailboxDO, wymaga zgodnego threadu i inbound direction oraz failuje typed `invalid-state` dla missing, cross-thread, outbound, usuniętego lub skorumpowanego parenta. Same-mailbox ancestry wynika architektonicznie z mailbox-scoped MailboxDO/storage isolation; lokalna macierz nie symuluje dwóch mailboxów i nie jest bezpośrednim cross-mailbox testem. Parent RFC ID oraz wyłącznie wybrany ancestry source muszą przejść konserwatywny provider-safe profil: niepuste `parent.references` ma pierwszeństwo i nieużywany malformed legacy `parent.inReplyTo` nie blokuje schedule, natomiast przy pustym `parent.references` opcjonalny `parent.inReplyTo` jest walidowany i używany. `In-Reply-To` jest exact parent RFC ID. `References` deduplikuje wybrane ancestry z zachowaniem kolejności, usuwa wszystkie wcześniejsze wystąpienia parent ID, dopisuje parent dokładnie raz jako ostatni element i usuwa najstarsze ancestry do maksymalnie 2048 UTF-8 bytes bez usunięcia parenta. Ordinary compose nadal zapisuje null/`[]`. Snapshot powstaje przed usunięciem draftu w tej samej transakcji, operation replay nie czyta zmienionego parenta, a późniejsza zmiana parenta nie wpływa na dispatch; jawny resend kopiuje threading snapshot, zeruje lokalny `rfc_message_id` i tworzy nowe application message/delivery IDs. Dispatch store ponownie dekoduje i waliduje snapshot; bezpośrednia macierz obejmuje malformed `inReplyTo`, malformed element `References`, non-array JSON, brak parent ID w `References`, wartość ponad 2048 UTF-8 bytes, `References` z null `inReplyTo` oraz ordinary compose bez threading metadata. Wąski provider contract przenosi tylko opcjonalne typed threading metadata, a Cloudflare adapter przed transportem ponownie waliduje pełną wiadomość, emituje dokładnie `In-Reply-To` i `References` wyłącznie dla Reply oraz nigdy `Message-ID`. Provider header rejection evidence jest wyłącznie syntetycznym testem mapowania błędów adaptera, nie live Cloudflare rejection. Malformed acceptance i nieznany transport/provider outcome pozostają `indeterminate`. Provider acceptance `messageId` pozostaje wyłącznie nieufnym kandydatem w `outbound_delivery.provider_message_id` i nigdy nie zasila lokalnego `message.rfc_message_id`; jego limit decode 1-998 znaków jest jawnym konserwatywnym lokalnym założeniem oczekującym na live equality evidence. Aktywacja live wymaga nadal datowanego dowodu exact equality provider `messageId` z dostarczonym RFC `Message-ID` oraz poprawnego threadingu Gmail/Outlook; dlatego `JOB-REPLY-004` i launch gate pozostają otwarte. Counts poniżej są wyłącznie lokalnym evidence bieżącego worktree, nie release/CI/live evidence.

Lokalny, niecommitted review gate: wcześniejszy pełny `bun run test` przeszedł `156/156` files i `1858/1858` tests wraz z `bun run build`; finalna korekta medium przeszła focused matrix `87/87`, `bun run typecheck`, `bun run check` oraz `git diff --check`. Shared threading schema, niezależnie od scheduler construction, wymaga provider-safe i unikalnych `References` z `inReplyTo` dokładnie jako ostatnim, a więc występującym dokładnie raz, oraz zachowuje limit 2048 UTF-8 bytes. Nie zmienia to otwartego live statusu `JOB-REPLY-004`.

### Limit wysyłki Cloudflare

- [x] JOB-SEND-001 Local-complete heuristic: przed utworzeniem snapshotu i wywołaniem providera wymusić konserwatywny limit 5 MiB oszacowanego całego outbound message dla Cloudflare Email Sending. Estymator ma failować przed schedule dla sumy UTF-8 bodies, base64 expansion i line folding załączników, zakodowanych filenames/MIME metadata, recipients/threading headers oraz stałego bezpiecznego overheadu. Istniejące limity upload/storage 10/20 MiB mogą pozostać limitami przechowywania, ale nie mogą pozwolić utworzyć niewysyłalnego snapshotu. Local-complete oznacza ukończoną implementację i testy lokalne, nie dowód zgodności rozmiaru finalnej serializacji Cloudflare.

Formuła `JOB-SEND-001` używa jednego czystego kontraktu dla admission i adaptera Cloudflare: każdy tekst jest liczony z rzeczywistych bajtów UTF-8, a następnie z pesymistycznym trzykrotnym Q-encoding, małymi encoded-word chunks i foldingiem; body dolicza quoted-printable soft breaks; każdy załącznik dolicza `4 * ceil(bytes / 3)` oraz CRLF co 76 znaków; osobno liczone są zakodowane filenames w obu parametrach MIME, content type, disposition, Content-ID, wszystkie adresy/display names, recipients, subject, `In-Reply-To` i `References`. Każde dodawanie, mnożenie i ceil division używa checked safe-integer arithmetic; malformed length lub overflow failuje closed. Znane provider-generated składniki są estymowane i checked osobno: `Date`, `Message-ID`, DKIM, liczba MIME boundaries oraz stała struktura wiadomości. Ponad nimi w limicie 5 MiB zawsze pozostaje dodatkowa stała rezerwa 1 MiB na nieznane różnice serializacji. To celowo restrykcyjna heurystyka, ponieważ Cloudflare nie publikuje dokładnych granic ani formuły swojego serializera. Atomic schedule i explicit resend odrzucają typed `message-too-large` przed message/delivery/operation writes, ale exact replay wcześniej zatwierdzonego operation result pozostaje niezmieniony; stary oversized snapshot nie może utworzyć nowego resendu. Korupcja sendera, recipients, threading albo attachment metadata starego snapshotu jest `invalid-state`, nie `message-too-large`. Adapter ponownie liczy rzeczywiste `Uint8Array.byteLength` i dokładne outgoing fields bezpośrednio przed `client.send`, bez transportu przy lokalnym odrzuceniu. To jest konserwatywna bramka lokalna, nie zamiennik walidacji i nie może dowieść rozmiaru finalnej serializacji: live Cloudflare nadal autorytatywnie waliduje wiadomość.

Lokalne evidence `JOB-SEND-001` po korektach review z 2026-07-25 na bazie `e0a6293`: focused matrix przeszła `145/145`; pełny `bun run test` przeszedł `157/157` files i `1885/1885` tests; restore rehearsal przeszedł `20/20`; `bun run typecheck`, `bun run check`, `bun run build` i `git diff --check` zakończyły się powodzeniem. Macierz obejmuje sąsiednie wartości body oraz attachment-driven tuż pod/nad limitem, exact base64/folding i praktyczne przyrosty filename/Content-ID/threading, Unicode, wiele załączników, overflow i malformed lengths, ordinary i Reply schedule, resend starego oversized snapshotu, exact replay starego accepted result, klasyfikację corrupt sender/recipients/references/attachment metadata jako `invalid-state`, brak `mailbox_operation`/message/delivery write'ów i provider invocation przy odrzuceniu, publiczne mapowanie błędu i renderowany komunikat UI. Produkcyjny reader R2 wcześniej odrzuca metadata/size/hash drift; dodatkowy syntetyczny full dispatch/provider test omija ten integrity guard i potwierdza, że actual-byte mismatch nadal kończy się lokalnym `message-too-large` bez wywołania klienta Cloudflare. To evidence lokalne potwierdza implementację heurystyki, lecz nie może dowieść finalnego rozmiaru serializacji Cloudflare; wymagane live evidence pozostaje w `JOB-LIVE-008`.

### Niezależne archiwum Gmail

- [ ] JOB-ARCH-001 Dodać prywatną konfigurację jednego verified archive recipient. Adres nie może należeć do managed domain i nie może być zwracany przez API ani logi.
- [ ] JOB-ARCH-002 Dla inboundu zapisać raw MIME w aplikacji i przekazać tę samą wiadomość do Gmaila przez Cloudflare Email Worker. Live spike musi potwierdzić zachowanie streamu i `forward()`; event nie może zostać uznany za sukces przed potwierdzeniem obu wymaganych ścieżek. Awaria ma prowadzić do kontrolowanego SMTP reject/retry, nie cichej utraty.
- [ ] JOB-ARCH-003 Dla outboundu atomowo dodać archive recipient jako ukryty BCC do immutable send snapshot. Gmail BCC jest kopią bezpieczeństwa, nie rekordem Sent w naszej aplikacji. Konflikt z adresem docelowym jest deduplikowany.
- [ ] JOB-ARCH-004 Przetestować kopie treści i załączników, brak ujawnienia BCC, retry/indeterminate behavior oraz awarię ścieżki aplikacji i archiwum.

### Cloudflare production

- [ ] JOB-CF-001 Utworzyć production resources przez Alchemy: Website, prywatny Backend, D1, R2, MailboxDO, auth rate-limit DO, Workflows i Email Sending bindings.
- [ ] JOB-CF-002 Skonfigurować `https://mail.szymondlugolecki.com`, exact `PUBLIC_ORIGIN`, trzy różne high-entropy auth secrets, zewnętrzny owner allowlist, `MAILBOX_INITIAL_ADDRESS=szymon@szymondlugolecki.com` i Gmail archive recipient.
- [ ] JOB-CF-003 Włączyć Email Routing dla domeny, dodać exact route do Backend email Workera i nie włączać catch-all.
- [ ] JOB-CF-004 Skonfigurować provider-generated MX, SPF i DKIM. Uruchomić DMARC początkowo w reporting mode i zaostrzyć dopiero po live evidence.
- [ ] JOB-CF-005 Przejść health/startup preflight, wykonać first-owner enrollment, założyć co najmniej dwa UV passkeys, zweryfikować external recovery, zapisać recovery codes offline i utworzyć mailbox `primary` z exact initial address.

### Launch acceptance

- [ ] JOB-LIVE-001 Gmail i Outlook wysyłają do `szymon@szymondlugolecki.com` plain text, HTML, inline image oraz PDF; wszystkie wiadomości są widoczne w aplikacji i archiwum Gmail.
- [ ] JOB-LIVE-002 Otrzymany PDF pobiera dokładne bajty, a skopiowany URL bez sesji oraz cross-resource ID nie ujawniają danych.
- [ ] JOB-LIVE-003 Reply bez `Reply-To` i z innym `Reply-To` trafia do właściwego odbiorcy, ma poprawne nagłówki i tworzy wątek w Gmail oraz Outlook.
- [ ] JOB-LIVE-004 Nowy mail i Reply z nowym PDF-em wychodzą z `szymon@szymondlugolecki.com`, docierają do odbiorcy i do ukrytego archiwum.
- [ ] JOB-LIVE-005 Sprawdzić Gmail/Outlook Authentication-Results dla SPF, DKIM i DMARC oraz zapisać datowane, content-free evidence z deployment version.
- [ ] JOB-LIVE-006 Sprawdzić unknown recipient, inbound >10 MiB, outbound failed, `indeterminate`, Workflow retry, auth denial i brak automatycznego resend przy nieznanym provider outcome.
- [ ] JOB-LIVE-007 Uruchomić końcowy pełny gate, niezależne security/reliability review i dopiero wtedy oznaczyć private beta jako gotową do wysyłania CV.
- [ ] JOB-LIVE-008 Wykonać datowany live Cloudflare size smoke z reprezentatywnym tekstem/PDF i kontrolowanymi wartościami blisko lokalnego progu po obu stronach. Zapisać content-free evidence rozmiarów wejściowych, decyzji lokalnej i wyniku providera; potwierdzić bezpieczny margines albo skorygować heurystykę przed private beta. Lokalne testy estymatora nie zamykają tego wymagania.

## Tryb po uruchomieniu

- Produkcja używa przypiętego release commita i nie śledzi automatycznie `main`.
- Główny plan jest rozwijany lokalnie lub na osobnym staging environment.
- Production update wymaga compatibility check, pełnego gate i jawnej promocji.
- Codziennie sprawdzamy Email Routing rejects, Worker/Workflow errors oraz outbound `failed` i `indeterminate`.
- Awaria archiwum, unexplained routing, brak R2 bytes lub authorization anomaly zatrzymują wysyłanie aplikacji do czasu wyjaśnienia.
- Gmail pozostaje awaryjnym archiwum co najmniej do zamknięcia live `SAFE-005`.

## Ryzyko rezydualne

Ten plan nie daje absolutnej gwarancji braku utraty. Minimalizuje ryzyko przez dwa niezależne miejsca przechowywania korespondencji, R2-before-Workflow, retry/replay, immutable outbound snapshot i SMTP rejection przy znanej awarii admission. Nadal możliwe są awarie wspólnego dostawcy, błędy operatora, provider `indeterminate`, opóźnienia lub odrzucenie przez odbiorcę. Gmail archive pozwala odzyskać treść i załączniki, ale nie odtwarza folderów, draftów, reguł ani pełnego stanu aplikacji.

## Szacunek

| Obszar                             |       Szacunek |
| ---------------------------------- | -------------: |
| First-owner enrollment             |        2-4 dni |
| Received attachment download       |        1-2 dni |
| Pojedyncze Reply                   |        2-3 dni |
| Gmail archive                      |        1-2 dni |
| Cloudflare deployment i onboarding |        1-2 dni |
| Live acceptance i poprawki         |        1-3 dni |
| Łącznie                            | 8-16 dni pracy |

Szacunek nie obejmuje pełnego `SAFE-005` ani nieprzewidzianych ograniczeń live Cloudflare Email Service. Pracę grupujemy w kilka spójnych commitów, używamy focused tests podczas implementacji oraz pełnego gate i jednego niezależnego review na końcu milestone, aby ograniczyć koszt bez obniżania launch gate.

## Changelog

- 2026-07-25: Utworzono immediate plan dla prywatnej skrzynki rekrutacyjnej, zamrożono single-owner/single-address scope, wybrano Gmail jako niezależne archiwum korespondencji i wstrzymano główny plan na `ORG-015`.
- 2026-07-25: Ukończono nieosiągalny jeszcze z HTTP fundament `JOB-BOOT-001/002`: jednorazowy command bez caller authority, forward-only singleton seal, fresh email proof i unrestricted token-bound session, atomiczny password credential, immutable receipt, metadata-only audit, exact replay i unknown-commit readback. Storage odrzuca wcześniejsze credentials, API keys, recovery/passkey history, organization authority, managed-domain ownera, races i direct-write proof forgery. Pełny gate objął 150 plików i 1753 testy; niezależne review nie pozostawiło high/medium findings.
