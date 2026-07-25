# Immediate job mail

Minimalny plan uruchomienia prywatnej skrzynki `szymon@szymondlugolecki.com` do bezpiecznego prowadzenia korespondencji rekrutacyjnej przed wznowieniem pełnego [planu firmowej poczty](PLAN-FIRMOWEJ-POCZTY.md).

## Status

- Ostatnia aktualizacja: 2026-07-25
- Stan: `IN PROGRESS`
- Aktualne zadanie: `JOB-REPLY-002` authorized reply target and UI
- Następne zadanie: `JOB-REPLY-003` immutable outbound threading snapshot
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
- Każda nowa storage mutation jest addytywna, audytowana, replay-safe i fail-closed.
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
- [ ] JOB-REPLY-002 Dodać autoryzowaną projekcję reply target oraz UI Reply. Odbiorcą jest `Reply-To`, a w jego braku `From`; subject otrzymuje pojedyncze `Re:`. Reply nie kopiuje starych załączników i używa bieżącego singleton primary sendera.
- [ ] JOB-REPLY-003 Zamrozić `In-Reply-To` i bounded `References` w immutable outbound snapshot przed dispatch. Nie generować, nie zamrażać i nigdy nie próbować ustawiać własnego `Message-ID`: Cloudflare Email Service kontroluje ten nagłówek i odrzuca próbę override jako `E_HEADER_NOT_ALLOWED` ([oficjalne ograniczenie providera](https://developers.cloudflare.com/email-service/reference/headers/#platform-controlled-headers)).
- [ ] JOB-REPLY-004 Przekazać allowlistowane `In-Reply-To` i `References` do Cloudflare Email Sending i przetestować provider rejection. Po acceptance zapisać zwrócony provider `messageId` wyłącznie jako kandydata na RFC `Message-ID`; datowane live staging evidence musi potwierdzić jego dokładną równość z `Message-ID` rzeczywiście dostarczonego RFC oraz poprawne grupowanie odpowiedzi w Gmail i Outlook. Bez takiego dowodu nie traktować provider result jako autorytatywnego delivered RFC `Message-ID` i nie próbować custom `Message-ID`.

Lokalne evidence `JOB-REPLY-001` z 2026-07-25 na bazie `ee2c78a`: PostalMime parsuje wszystkie poprawne mailboxy i grupy `Reply-To` przez istniejący `MailAddress`, odrzuca niepoprawne adresy z manifestu i liczy wszystkie raw mailboxy `Reply-To` do wspólnego limitu. Nowe MIME `Message-ID`, `In-Reply-To` i `References` używają jawnie konserwatywnego, provider-safe profilu, a nie pełnej gramatyki RFC 5322: wymagają pojedynczego tokenu `<id-left@id-right>` bez whitespace, controls i zagnieżdżonych bracketów, z ASCII dot-atom-like id-left, LDH/dotted id-right i limitem 998 UTF-8 bytes; comments, garbage i niepoprawne tokeny są pomijane, persisted `RfcMessageId` zachowuje kompatybilność starych danych, a limit `References` wynosi dokładnie 100. Opcjonalne pole V1 zachowuje decode starych manifestów, a generacje Workflow v3/v4 zapobiegają porównaniu cached manifestu bez `replyTo` z nową reparsą. Addytywna migracja MailboxDO v13 zachowuje rows v12 jako null; column CHECK wymusza nullable, poprawną, niepustą tablicę JSON o maksymalnie 256 elementach, a natywne `BEFORE INSERT/UPDATE` triggers walidują każdy element jako obiekt z dokładnie dozwolonym `address` i opcjonalnym tekstowym `displayName` oraz konserwatywnym SQLite odpowiednikiem ASCII dot-atom + DNS `EmailAddress`. Runtime corruption zwraca fail-closed typed `invalid-state`, nie defect. Inbound commit zapisuje `replyTo` atomowo i obejmuje canonical idempotency key; `MessageDetail`, `GetMessage`, `GetThread` i protokół DO je hydratują, natomiast list/search summary nie ujawniają go jeszcze przeglądarce. Nowy outbound snapshot pozostawia pole null, a resend kopiuje istniejący snapshot. Restore decoder przyjmuje wspierane artifacts/evidence v12 i v13: v13 zachowuje pełne exact digest i closure checks, natomiast v12 jest najpierw dokładnie weryfikowane, następnie migrowane produkcyjną migracją 13 i publikowane jako zdrowe v13 z niezmienionym mailbox ID oraz null `reply_to_json` dla legacy rows. Retry po utracie odpowiedzi wyprowadza niezależny oczekiwany efekt migracji 13 z immutable v12 archive, normalizuje wyłącznie niedeterministyczny ledger `applied_at`, dokładnie weryfikuje istniejący target i zwraca `already-restored`; foreign, partial lub tampered target nadal failuje bez clobber. Focused tests `97/97`, restore rehearsal `20/20`, pełny `bun run test` `154/154` files i `1808/1808` tests, a także `bun run typecheck`, `bun run check`, `bun run build` i `git diff --check` zakończyły się powodzeniem.

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
