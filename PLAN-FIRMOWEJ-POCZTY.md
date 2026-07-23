# Plan firmowej poczty

Kompletny plan przejścia z jednej skrzynki do modelu organizacji, wielu izolowanych skrzynek, współdzielonych skrzynek, aliasów, adresów pracowników i precyzyjnych uprawnień.

## Status

- Ostatnia aktualizacja: 2026-07-23
- Stan: `IN PROGRESS`
- Aktualny etap: `1. Fundament bezpieczeństwa i operacji`
- Aktualne zadanie: `SAFE-006` wspólny kontrakt mutacji control plane wymagany do domknięcia `SAFE-002`
- Następne zadanie: `SAFE-002` domknięcie bezpośrednich testów i zależnego Definition of Done
- Zakres pierwszego wydania: jedna organizacja i jedna domena na wdrożenie, ale model danych od początku tenant-aware
- Migracja układu źródeł i zależności: `DONE` zgodnie z [Architecture Migration Guide](docs/architecture-migration-guide.md); nie oznacza to ukończenia produktu organization/multi-mailbox
- Źródło prawdy dla istniejącego v1: `TODO.md`
- Źródło prawdy dla rozbudowy firmowej: ten dokument

| Etap | Nazwa | Status | Główna zależność |
| --- | --- | --- | --- |
| 0 | Decyzje i kontrakt produktu | DONE | Brak |
| 1 | Fundament bezpieczeństwa i operacji | CURRENT | Etap 0 |
| 2 | Organizacja, członkostwo i domena | NOT STARTED | Etap 1 |
| 3 | Uprawnienia, assignments i bramy izolacji | NOT STARTED | Etap 2 |
| 4 | Wiele skrzynek i jawna nawigacja | NOT STARTED | Etap 3 |
| 5 | Stabilne adresy i routing | NOT STARTED | Etap 2-4 |
| 6 | Inbound dla wielu skrzynek i aliasów | NOT STARTED | Etap 5 |
| 7 | Tożsamości nadawcy, wysyłka i reply | NOT STARTED | Etap 5-6 |
| 8 | Zaproszenia, skrzynki osobiste i offboarding | NOT STARTED | Etap 4-7 |
| 9 | UI organizacji, skrzynek i adresów | NOT STARTED | Etap 3-8 |
| 10 | Produkcyjna gotowość Cloudflare Email Service | NOT STARTED | Etap 5-7 |
| 11 | Audit, observability i reconciliation | NOT STARTED | Etap 1-10 |
| 12 | Testy przekrojowe i hardening | NOT STARTED | Etap 1-11 |
| 13 | Migracja, rollout i odbiór produkcyjny | NOT STARTED | Etap 1-12 |
| 14 | Wiele organizacji w jednym SaaS | DEFERRED | Stabilne pierwsze wydanie |

### Zasady śledzenia

- Każde zadanie ma stabilny identyfikator. Nie zmieniamy identyfikatorów po rozpoczęciu implementacji.
- `[x]` oznacza zadanie ukończone zgodnie z Definition of Done właściwym dla jego typu.
- `[ ]` oznacza zadanie oczekujące. Rozpoczęta praca nadal pozostaje niezaznaczona.
- Dokładnie jeden etap może mieć status `CURRENT`.
- Etap przechodzi na `DONE` dopiero po spełnieniu jego kryteriów wyjścia.
- Checkboxy są źródłem prawdy. Nie utrzymujemy ręcznego globalnego licznika, aby nie tworzyć rozbieżności.
- Zmiana kontraktu produktu wymaga dopisania decyzji w sekcji 0, a nie cichej zmiany implementacji.
- Zadanie implementacyjne kończymy dopiero po testach pozytywnych, testach odmowy dostępu, wymaganej migracji i telemetrii; decyzje, infrastruktura i operacje mają własne Definition of Done.
- Przed rozpoczęciem implementacji porządkujemy nakładające się zadania z `TODO.md`. Jedno deliverable może mieć tylko jeden kanoniczny checkbox; drugi dokument zawiera wtedy wyłącznie odnośnik.
- `TEST-*` i `ACCEPT-*` są bramami weryfikacji przekrojowej, a nie drugim właścicielem implementacji już przypisanej do zadań etapowych.
- `ROLL-016` zbiera wyłącznie datowane evidence wykonania scenariuszy `ACCEPT-*`; nie duplikuje ich implementacji ani testów.

### Zaakceptowane ADR-y

- [ADR 0001: Organization and mailbox boundaries](docs/adr/0001-organization-and-mailbox-boundaries.md)
- [ADR 0002: Address routing and sending](docs/adr/0002-address-routing-and-sending.md)
- [ADR 0003: Authentication and mailbox authorization](docs/adr/0003-authentication-and-mailbox-authorization.md)
- [ADR 0004: Address quarantine and mailbox archive](docs/adr/0004-address-quarantine-and-mailbox-archive.md)

## 1. Cel i uzasadnienie

Chcemy obsłużyć dwa scenariusze jednym spójnym modelem:

1. Wiele izolowanych skrzynek, np. `hr@domena.com`, `support@domena.com` i `accounting@domena.com`, z osobnymi wiadomościami, folderami, regułami i uprawnieniami.
2. Wiele adresów prowadzących do tej samej skrzynki, np. `hr@domena.com`, `kadry@domena.com` i `rekrutacja@domena.com` prowadzące do skrzynki HR.

Nie tworzymy dwóch osobnych systemów. Skrzynka jest granicą danych i autoryzacji, a adres jest stabilną tożsamością pocztową, której aktywny routing wskazuje skrzynkę docelową.

```text
Organization
  -> OrganizationMember
  -> MailDomain
       -> MailAddress
            -> InboundRouteAssignment -> Mailbox
            -> MailboxSendIdentity     -> Mailbox
  -> Mailbox
       -> MailboxAssignment
       -> scoped roles and permissions
       -> isolated MailboxDO
```

Takie rozdzielenie pozwala zmieniać routing adresu bez przenoszenia historii wiadomości, nadawać dostęp niezależnie od adresów oraz zachować fizyczną izolację danych między skrzynkami.

Model produktu powyżej opisuje własność i zachowanie, nie mapowanie jeden-do-jednego na katalogi kodu. Ownership implementacji pozostaje bounded-context-first zgodnie z [Architecture Migration Guide](docs/architecture-migration-guide.md); wspólna baza D1 ani relacja produktu nie przenosi automatycznie kodu do kontekstu `organization`.

## 2. Stan obecny i elementy do ponownego użycia

Obecny system jest funkcjonalnym v1 dla jednego właściciela i jednej skrzynki. Migracja źródeł do bounded contexts jest ukończona, ale produkt organization/multi-mailbox nie jest. Aktualne bounded contexts to `account-security`, `address-routing`, `administrative-audit`, `ai`, `authorization`, `automation`, `mailbox` i `organization`; runtime roots to `backend-worker`, `website`, `mailbox-do`, `inbound-workflow` i `async-rule-workflow`. Ich dokładne ownership, dozwolone zależności i lifetimes definiuje [Architecture Migration Guide](docs/architecture-migration-guide.md).

Aktualny control plane w D1 zawiera:

- `app_mailbox` ze statusami `active | suspended | deleting | deleted`, ale `app_mailbox_singleton_idx` nadal wymusza najwyżej jeden rekord globalnie.
- `app_mailbox_member` jako projekcję discovery, bez kanonicznego organization membership lub wersjonowanego `MailboxAssignment`.
- `app_user_preference.defaultMailboxId` per użytkownik, jeszcze bez organization scope i bez użycia w nawigacji.
- `app_mailbox_address` jako mailbox-owned adres z globalnie unikalnym `normalized_address`, flagami `enabled` i `is_primary`; nie jest to jeszcze stabilny `MailAddress` z historią route.
- Role i permission grants zakresowane do mailboxa lub kwalifikowanego folderu; membership nie zastępuje exact authorization.
- Guarded D1 batches dla obecnych mutacji owner bootstrap i rename oraz append-only administracyjny audit, ale nie wspólny, kompletny kontrakt wszystkich przyszłych mutacji.

Dokładne blokady produktu na `HEAD 9d6f786`:

- Bootstrap tworzy wyłącznie mailbox `primary`; singleton index i logika komendy odrzucają drugi mailbox.
- `MAILBOX_OWNER_EMAIL` pełni trzy przejściowe role: allowlisty claimującego ownera, źródła początkowego adresu mailboxa oraz źródła zarządzanej domeny dla recovery-safe policy.
- Nawigacja filtruje aktywne membership i mailbox, po czym wybiera nieuporządkowany wynik przez `limit(1)`; nie ma stabilnej trasy z organization/mailbox ID ani switchera.
- Nie istnieją `Organization`, `MailDomain`, `OrganizationMember`, kanoniczny `MailboxAssignment`, stabilna historia `InboundRouteAssignment` ani `MailboxSendIdentity`.
- Nie ma organization/domain ownership, assignment lifecycle, stabilnych route revisions, jawnej send identity ani tenant-aware URL/cache modelu.
- Produkcyjne catch-all, sender-domain onboarding i readiness nie są zarządzane end-to-end przez repozytorium.

Aktualne możliwości i brakujące gwarancje data plane:

- Inbound ufa wyłącznie SMTP envelope recipient, normalizuje domenę i rozwiązuje enabled `app_mailbox_address` wskazujący aktywny mailbox. Raw MIME jest trwale i append-only zapisywany do prywatnego R2 przed uruchomieniem Workflow; Workflow parsuje, zapisuje attachmenty i atomowo commituje wynik do SQLite właściwego `MailboxDO` z retry/replay semantics.
- Przed zapisem raw do R2 istnieje walidacja nieujemnego integer `rawSize`, ale nie ma maksymalnego limitu pre-R2. Nie ma też stabilnego address/assignment/revision snapshotu ani fencing dla zmiany route.
- Outbound ma drafty, undo window, immutable send snapshot, idempotentny dispatch i rozróżnienie `accepted` od `delivered`/`indeterminate`, ale zawsze rozwiązuje bieżący enabled primary mailbox address. Nie ma jawnego `fromIdentityId`, niezależnej send identity/revision, `Send As`, reply/reply-all ani transfer fencing/dispatch permits.
- D1 pozostaje control plane, jeden `MailboxDO` i jego SQLite są data plane dla jednego mailbox ID, a R2 jest wspólnym prywatnym blob store z mailbox-scoped kluczami i metadanymi, nie osobnym bucketem per mailbox. Inbound i async-rule Workflows mają lifetime pojedynczej instancji workflow. Każdy AI run dostaje świeży run-scoped budget/capability layer; nie jest process-global ani trwałym zasobem per mailbox.

`TODO.md` nadal opisuje i śledzi bazowe v1. Zadania z tego dokumentu nie mogą obniżyć istniejących gwarancji opisanych w `README.md`.

## 3. Zakres pierwszego wydania

Pierwsze wydanie firmowej poczty obejmuje:

- Jedną organizację i jedną zweryfikowaną domenę na wdrożenie.
- Tenant-aware model, w którym `organizationId` jest przechowywane, wyprowadzane i walidowane zgodnie z inwentarzem granic, zamiast mechanicznie duplikowane w każdym rekordzie i payloadzie.
- Wiele skrzynek osobistych i współdzielonych.
- Wiele adresów kierujących do jednej skrzynki.
- Dokładnie jedną aktywną skrzynkę docelową dla aktywnego adresu odbiorczego; adres zawieszony lub wycofany może nie mieć aktywnego targetu.
- Jawne role użytkowników per skrzynka.
- Oddzielne uprawnienia organizacyjne i mailboxowe.
- Zarządzanie adresami, członkami i rolami w UI.
- Domyślną tożsamość nadawcy oraz kontrolowane `Send As`.
- Poprawne reply z adresu, przez który wiadomość została odebrana.
- Zaproszenia, zawieszanie użytkowników i pełny offboarding.
- Audit wszystkich zmian administracyjnych.
- Catch-all domeny kierujący do Workera oraz dokładny routing w D1.

Poza pierwszym wydaniem:

- Wiele firm w jednym publicznym SaaS.
- Zewnętrzny forwarding bez lokalnej kopii.
- Distribution groups, czyli jeden adres dostarczający do wielu skrzynek.
- Dynamiczne reguły catch-all tworzące adresy przy pierwszym mailu.
- Per-message ACL.
- Edytowalne przez tenantów niestandardowe definicje ról.
- Legal hold, eDiscovery i automatyczne polityki retencji klasy enterprise.
- Natywne aplikacje mobilne oraz IMAP/SMTP dla zewnętrznych klientów.

## 4. Docelowy model produktu

### Organization

Organizacja jest granicą właścicielską dla domen, skrzynek i pracowników. Pierwsza wersja tworzy jedną organizację podczas bootstrapu, ale żaden nowy model nie może zakładać globalnego singletona organizacji.

Administrator organizacji może zarządzać domeną, skrzynkami, adresami i członkami, ale nie otrzymuje automatycznie prawa czytania poczty.

### MailDomain

Domena należy wyłącznie do jednej aktywnej organizacji. Musi przejść weryfikację własności i mieć jawne statusy routingu, wysyłki oraz DNS.

Przykładowe statusy:

```text
pending_verification -> verified -> active -> suspended -> retired
```

Adres można utworzyć tylko pod aktywną domeną należącą do bieżącej organizacji. Klient przekazuje `domainId` i local-part, nigdy autorytatywny pełny adres.

### Mailbox

Mailbox jest granicą:

- fizycznego magazynu wiadomości w `MailboxDO`,
- folderów, reguł, draftów i wysyłek,
- członkostwa i uprawnień,
- cache oraz nawigacji.

Nowy `mailboxId` jest globalnie unikalnym, nieprzewidywalnym i nigdy ponownie nieużywanym identyfikatorem. Adres ani nazwa skrzynki nie są jej identyfikatorem. Istniejące ID `primary` jest trwałym wyjątkiem migracyjnym i nie może zostać zmienione, ponieważ wskazuje istniejący `MailboxDO`.

Technicznie istnieje jeden model mailboxa z dwoma szablonami UX:

- `personal`: domyślnie jeden wskazany pracownik i prywatne uprawnienia,
- `shared`: wielu jawnie przypisanych członków i role zespołowe.

Szablon ustawia bezpieczne wartości domyślne. Nie tworzymy dwóch niezależnych implementacji przechowywania poczty.

Lifecycle mailboxa ma przejścia `active <-> suspended`, `active -> archiving -> archived` oraz `archived -> active`. `suspended` jest odwracalną blokadą operacyjną: mailbox pozostaje widoczny dla jawnie autoryzowanych użytkowników i pozwala na read, search, attachment access oraz export, ale nie przyjmuje nowych route assignments ani inboundu, nie wysyła i nie pozwala na mutacje wiadomości, folderów, reguł lub draftów. Powrót do `active` wymaga audytowanej operacji z ponowną walidacją dostępu i readiness.

Archiwizacja jest workflowem, nie pojedynczą zmianą statusu. Przed jej zakończeniem każdy aktywny adres musi zostać przeniesiony do aktywnego mailboxa albo poddany kwarantannie, wszystkie nowe wysyłki są blokowane, a in-flight inboundy sprzed cutoveru są drenowane. `archiving` nie jest normalnym kontekstem nawigacji i dopuszcza wyłącznie kontrolowane operacje workflow oraz rozstrzyganie in-flight pracy.

Archived mailbox zachowuje dane w tym samym `MailboxDO` i pozwala wyłącznie na jawnie autoryzowane read, search, attachment access oraz export. Nie przyjmuje nowych wiadomości, nie wysyła, nie pozwala na mutacje wiadomości, folderów, reguł ani draftów i nie daje Organization Admin automatycznego dostępu. Restore do `active` jest audytowanym workflowem walidującym assignments, grants, domenę, routes i send identities. Hard delete nie jest częścią pierwszego wydania.

### MailAddress

Adres jest stabilną tożsamością pod zweryfikowaną domeną, np. `magdalena.gdyba@domena.com`. Nie posiada wiadomości ani użytkowników.

Adres zachowuje:

- oryginalny local-part do prezentacji,
- kanoniczny local-part do routingu i unikalności,
- domenę,
- status,
- wersję kanonikalizacji,
- historię administracyjną.

Wycofanie adresu z `active` lub `suspended` prowadzi przez co najmniej 180 dni `quarantined`, a następnie do `retired`, który oznacza wyłącznie eligible for manual reuse. Adres pozostaje zarezerwowany, nie ma aktywnego route ani send identity, odrzuca inbound i nie wpada do catch-all. Koniec kwarantanny nie powoduje automatycznego ponownego użycia; ręczna decyzja Organization Owner/Admin z ostrzeżeniem i step-up reaktywuje ten sam stabilny rekord, ID oraz historię, zamiast tworzyć nową tożsamość adresu. Świadomy, audytowany pełny transfer do aktywnego mailboxa może ominąć kwarantannę.

### InboundRouteAssignment

Aktywne przypisanie routingu łączy jeden adres z jedną skrzynką. Historia przypisań jest niemutowalna.

Zmiana targetu:

- zamyka stare przypisanie,
- otwiera nowe przypisanie w tej samej atomowej mutacji,
- nie przenosi historycznych wiadomości,
- wpływa tylko na routing rozstrzygnięty po zmianie,
- zapisuje aktora, przyczynę, wersję i czas.

### MailboxSendIdentity

Tożsamość nadawcy łączy adres ze skrzynką niezależnie od inbound routingu. Stan odbioru wynika wyłącznie z aktywnego `InboundRouteAssignment`; send identity przechowuje tylko możliwość wysyłania i status domyślnego `From`.

Skrzynka wysyłająca ma dokładnie jedną domyślną aktywną tożsamość nadawcy. Skrzynka receive-only może nie mieć żadnej.

### OrganizationMember i MailboxAssignment

Użytkownik globalny może należeć do organizacji. Aktywne członkostwo organizacyjne nie daje dostępu do żadnej wiadomości.

Każda operacja na skrzynce wymaga jednocześnie:

```text
ważna i nieograniczona sesja
AND aktywny użytkownik
AND aktywne członkostwo w organizacji
AND aktywne przypisanie do mailboxa
AND dokładne efektywne uprawnienie
AND aktywna organizacja
AND stan mailboxa dozwolony przez wersjonowaną macierz tej konkretnej operacji
```

`MailboxAssignment` odpowiada za discovery i lifecycle. Role oraz permission grants pozostają źródłem autoryzacji działań. Stan `active` dopuszcza operacje wynikające z uprawnień; `suspended` i `archived` dopuszczają tylko jawnie wymienione read/search/attachment/export oraz właściwe operacje administracyjne resume/restore. Stan nie zastępuje permission checku i permission nie omija state matrix.

### AuthenticationIdentity

Login i recovery użytkownika są oddzielone od adresów routowanych do współdzielonych skrzynek. Shared alias nie może być dowodem tożsamości użytkownika.

Docelowe metody logowania dla pracowników to passkey, SSO lub hasło z zewnętrznym recovery i recovery codes. Nie wolno tworzyć obiegu, w którym dostęp do skrzynki wymaga magic linku dostarczonego do tej samej niedostępnej skrzynki.

## 5. Relacje i niezmienniki danych

Docelowe relacje:

```text
Organization 1---N OrganizationMember
Organization 1---N MailDomain
Organization 1---N Mailbox
MailDomain   1---N MailAddress
MailAddress  1---N InboundRouteAssignment history
Mailbox      1---N InboundRouteAssignment history
Mailbox      1---N MailboxSendIdentity
Mailbox      1---N MailboxAssignment
User         1---N OrganizationMember
User         1---N MailboxAssignment
```

Wymagane niezmienniki:

- Kanoniczna domena jest globalnie unikalna wśród aktywnych i oczekujących claimów.
- Kanoniczny adres jest globalnie unikalny i nie zależy od mailboxa.
- Aktywny adres odbiorczy ma dokładnie jedno active inbound route assignment; pozostałe statusy mają najwyżej jedno.
- Skrzynka z włączoną wysyłką ma dokładnie jedną aktywną domyślną send identity; skrzynka receive-only ma zero.
- Domyślna send identity zawsze jest aktywna i send-enabled. Legacy `is_primary` zostaje zmapowane na route oraz default send identity, a następnie wycofane.
- Address route i send identity muszą wskazywać zasoby tej samej organizacji.
- Personal mailbox ma dokładnie jednego aktywnego personal assignee, dopóki nie przejdzie w stan offboardingu.
- Członek mailboxa musi być aktywnym członkiem tej samej organizacji.
- ID mailboxa nigdy nie jest używane ponownie. Manual reuse adresu reaktywuje ten sam rekord i ID; żadnego historycznego ID adresu nie wolno przypisać nowemu rekordowi lub innej tożsamości.
- Usunięcie skrzynki nie może kaskadowo zniszczyć historii adresu, routingu ani audytu.
- Globalne granty mailowe i globalne role mailowe są zabronione.
- Grant folderu zawsze zawiera mailbox ancestry.
- `createdBy` jest informacją audytową, a nie dowodem bieżącej własności.

### Inwentarz granic tenantowych

Przed migracją tworzymy tabelę inwentarzową określającą, czy `organizationId` jest przechowywane, wyprowadzane i walidowane w każdym miejscu. Nie duplikujemy go wszędzie: przechowujemy przy źródle prawdy i w immutable snapshots wymaganych przez retry/audit, wyprowadzamy z kanonicznego ancestry, a na każdej granicy zaufania walidujemy spójność:

| Obszar | Docelowa strategia |
| --- | --- |
| D1 control plane | Przechowywać i walidować przez foreign keys oraz guarded queries |
| Permission scopes | Wyprowadzać przez canonical mailbox/address ancestry; nigdy z klienta |
| MailboxDO | Wyprowadzać z aktywnego registry przed wyborem DO i sprawdzać mailbox identity |
| R2 raw i attachment metadata | Przechowywać organization oraz mailbox snapshot dla defense in depth |
| Workflow payloads | Przechowywać immutable organization/mailbox/routing snapshot |
| Inbound i outbound snapshots | Przechowywać organization, mailbox, address oraz revision |
| Browser i server cache | Kluczować przez organization i mailbox |
| Audit i AI audit | Przechowywać organization i zasób bez treści wiadomości |
| Logs i traces | Dodawać organization jako strukturalny wymiar, nie jako dowód dostępu |

## 6. Kanonikalizacja i polityka adresów

Rekomendowana polityka pierwszego wydania:

- Domena jest normalizowana przez IDNA do małego ASCII A-label.
- Local-part jest kanonizowany do małych liter, zgodnie z zachowaniem dostawcy routingu.
- Dozwolony zestaw jest celowo węższy niż pełny RFC: litery ASCII, cyfry oraz pojedyncze `.`, `_` i `-` między segmentami.
- Kropki i znaki `+` nie otrzymują semantyki Gmaila. Plus addressing jest osobnym przyszłym featurem.
- Oryginalna pisownia może być zachowana tylko do prezentacji.
- Serwer wylicza pełny i kanoniczny adres. Dane kanoniczne od klienta są ignorowane.
- Rezerwujemy co najmniej `postmaster`, `abuse`, `security`, `auth`, `noreply` i techniczne adresy bounce.
- Wycofany adres zachowuje tombstone i nie wpada automatycznie do catch-all.
- Ponowne użycie adresu wymaga jawnej polityki cooldown oraz ostrzeżenia o przyszłych odpowiedziach od dawnych korespondentów.
- Minimalny cooldown wynosi 180 dni, po czym adres staje się wyłącznie eligible for manual reuse i nigdy nie jest zwalniany automatycznie.
- Przed włączeniem lowercase canonicalization wykonujemy preflight istniejących danych, ponieważ obecny system zachowuje wielkość liter local-part. Kolizje case/IDNA są kwarantannowane i rozwiązywane przez operatora przed dodaniem unique indexu.

## 7. Model uprawnień

### Role organizacyjne

| Rola | Zarządzanie organizacją | Domeny i adresy | Mailbox lifecycle | Audit | Czytanie poczty |
| --- | --- | --- | --- | --- | --- |
| Organization Owner | Tak | Tak | Tak | Tak | Nie, bez osobnego grantu |
| Organization Admin | Tak, bez ownership transfer | Tak | Tak | Tak | Nie, bez osobnego grantu |
| Organization Member | Nie | Nie | Nie | Nie | Tylko przez mailbox grants |

### Role mailboxowe

Punktem wyjścia pozostają istniejące role `owner`, `manager`, `editor`, `viewer`, ale ich definicje i identyfikatory powinny być jawnie namespacowane jako mailboxowe. Tenant nie może edytować globalnego znaczenia platformowych ról.

Pierwsze wydanie nadaje dostęp wyłącznie per mailbox. Product workflows nie wystawiają ani nie tworzą folder-only grants. Istniejące folder permissions mogą pozostać wewnętrznym mechanizmem autoryzacji zasobów, ale użytkownik zawsze potrzebuje mailbox assignment i mailbox-level read authority.

| Rola            | Read | Modify | Send | Rules | Settings | Members | Export |
| --------------- | ---- | ------ | ---- | ----- | -------- | ------- | ------ |
| Mailbox Owner   | Tak  | Tak    | Tak  | Tak   | Tak      | Tak     | Tak    |
| Mailbox Manager | Tak  | Tak    | Tak  | Tak   | Nie      | Nie     | Nie    |
| Mailbox Editor  | Tak  | Tak    | Nie  | Nie   | Nie      | Nie     | Nie    |
| Mailbox Viewer  | Tak  | Nie    | Nie  | Nie   | Nie      | Nie     | Nie    |

### Send As

Wysłanie wiadomości wymaga:

- `draft.send`,
- `mailbox.send`,
- aktywnej send identity należącej do mailboxa,
- prawa użycia danej send identity,
- aktywnej i gotowej do wysyłki domeny.

Prawo odczytu mailboxa nie wystarcza do wysyłania. Shared send identity wymaga mailbox-scoped `mailbox.send_from_shared_identity`, które otrzymują Mailbox Owner i Manager. Restricted send identity, w tym osobisty alias, wymaga bezpośredniego `send_identity.use` na scope `JSON [mailboxId, sendIdentityId]`; nie dziedziczy go automatycznie nawet Mailbox Owner. W pierwszym wydaniu tylko Organization Owner/Admin może alokować, przenosić i wycofywać adresy; Mailbox Owner może zarządzać display name i domyślnym `From` wyłącznie wśród już przypisanych send identities.

### Administracja grantami

Nie wystawiamy generycznego `PermissionAdministration` bezpośrednio do klienta. Aplikacyjny serwis administracji musi:

- wyprowadzać aktora z bieżącej sesji,
- wymagać dokładnego organization i mailbox scope,
- odrzucać globalne role i uprawnienia mailowe,
- walidować aktywne członkostwo target usera,
- blokować self-escalation,
- wymuszać hierarchy grantowania,
- chronić ostatniego Organization Owner i Mailbox Owner,
- atomowo aktualizować assignment, granty i audit,
- obsługiwać idempotency oraz optimistic concurrency.

## 8. Semantyka inbound, outbound i zmian routingu

### Inbound

1. Cloudflare przekazuje SMTP envelope recipient do Backend Workera.
2. Backend kanonizuje adres zgodnie z wersjonowaną polityką.
3. Resolver znajduje aktywny adres, aktywne route assignment i aktywną skrzynkę.
4. Moment odczytu przypisania w D1 jest punktem linearyzacji routingu.
5. Ingress zapisuje snapshot adresu, assignment ID, revision i mailbox ID w R2 oraz Workflow input.
6. Workflow zawsze kończy ingest w przypiętej skrzynce, nawet jeśli routing zostanie później zmieniony.
7. Wiadomość przechowuje queryable `envelopeTo` oraz snapshot decyzji routingu.
8. Nieznany, zawieszony lub wycofany adres jest odrzucany bez ujawniania szczegółów organizacji.

### Outbound

1. Nowy draft otrzymuje jawne `fromIdentityId` z domyślnej send identity.
2. Zmiana domyślnego adresu wpływa na nowe drafty, nie przepisuje istniejących.
3. Przed zaplanowaniem wysyłki serwer ponownie sprawdza wersję i prawo `Send As`.
4. Immutable send snapshot zapisuje pełny adres, display name, address ID i identity revision.
5. Zmiana routingu po zaplanowaniu nie zmienia wysłanego snapshotu.

### Reply

- Adresatem reply jest poprawny MIME `Reply-To`, a w jego braku MIME `From`.
- Domyślnym `From` jest ingress address oryginalnej wiadomości, jeśli nadal należy do mailboxa i jest send-enabled.
- Jeżeli dawny alias nie jest już dostępny, UI wybiera bieżący default `From` i pokazuje ostrzeżenie.
- Reply ustawia poprawne RFC `Message-ID`, `In-Reply-To` oraz `References`.
- Reply-all usuwa bieżące tożsamości wysyłającego mailboxa oraz historyczny ingress recipient i wszystkie historyczne own-recipient snapshots, nawet gdy adres został już przeniesiony. Następnie deduplikuje adresy i nigdy nie odtwarza Bcc.

### Reassignment adresu

- Route-only reassignment jest jedną atomową operacją D1 i zmienia wyłącznie przyszły inbound target.
- Historyczne wiadomości pozostają w poprzednim `MailboxDO`.
- In-flight inbound pozostaje przypięty do revision odczytanej przed zmianą.
- Route-only reassignment nie zmienia automatycznie niezależnej send identity.
- Pełny address transfer zmienia route oraz send identities, ale nie właściciela domeny, i korzysta z D1 fencing epoch oraz dispatch permits.
- Dispatch atomowo pozyskuje w D1 epoch-bound permit przed wywołaniem providera. Rozpoczęcie transferu blokuje nowe permits, a finalizacja czeka na rozstrzygnięcie wszystkich istniejących.
- Operacje w `MailboxDO`, takie jak anulowanie pending sends, są wykonywane przez idempotentny outbox/Workflow i reconciliation, a nie przedstawiane jako jedna rozproszona transakcja.
- Pending, scheduled, sending oraz indeterminate sends wymagają jawnej polityki. Bezpieczny default zatrzymuje pełny transfer do ich anulowania, zakończenia albo ręcznego rozstrzygnięcia nieznanego wyniku.
- Pełny transfer wymaga step-up, powodu, wersji oczekiwanej i wpisu audit.

## 9. Docelowe obszary UI

### Nawigacja

- URL zawiera jawne `organizationId` i `mailboxId`; wybór skrzynki nie zależy od `limit(1)`.
- Mailbox switcher pokazuje wyłącznie autoryzowane przypisania do mailboxów `active`, `suspended` i `archived`, z czytelnym stanem niedostępnych operacji; `archiving` nie jest normalnym celem nawigacji.
- Domyślna skrzynka jest preferencją użytkownika per organizacja i może wskazywać wyłącznie autoryzowany mailbox `active`; deterministyczny fallback również wybiera tylko `active`.
- Query cache, optimistic state i błędy 403 są zakresowane co najmniej przez organization i mailbox ID.

Rekomendowany kształt URL:

```text
/o/:organizationId/mailboxes/:mailboxId/inbox
```

### Kreator mailboxa

Krok po kroku:

1. Wybór `Personal` lub `Shared`.
2. Nazwa skrzynki.
3. Local-part i podgląd pełnego adresu.
4. Wybór personal assignee albo członków zespołu.
5. Role i możliwość wysyłania.
6. Podsumowanie oraz atomowe utworzenie zasobów.

### Ustawienia organizacji

- Dane organizacji.
- Status domeny, DNS, routing i wysyłka.
- Lista użytkowników, zaproszeń i statusów.
- Lista skrzynek.
- Globalna lista adresów i ich targetów.
- Audit log.

### Ustawienia mailboxa

- Nazwa, typ i lifecycle.
- Adresy odbiorcze.
- Send identities oraz default `From`.
- Członkowie i role.
- Efektywny dostęp użytkownika wraz ze źródłem grantu.
- Reguły, eksport i operacje niebezpieczne.

### Bezpieczny UX

- Przy skierowaniu osobistego adresu do shared mailboxa wyświetlamy informację, że wszyscy czytelnicy mailboxa zobaczą te wiadomości.
- Przy transferze adresu wyświetlamy wpływ na przyszłe odpowiedzi oraz pending, scheduled, sending i indeterminate sends.
- UI rozróżnia `alias`, `shared mailbox`, `personal mailbox`, `forwarding` i `distribution group`.
- Operacje destrukcyjne wymagają ponownego potwierdzenia oraz step-up.

## 10. Plan wdrożenia i trackowalne TODO

### Etap 0: Decyzje i kontrakt produktu

Cel: zamrozić semantykę przed zmianami schematu, aby UI, API i migracje implementowały ten sam produkt.

- [x] DEC-001 Przyjąć architekturę tenant-aware z jednym tenantem na pierwsze wdrożenie.
- [x] DEC-002 Przyjąć jeden model `Mailbox` z szablonami `personal` i `shared`.
- [x] DEC-003 Przyjąć relację wiele adresów do jednej skrzynki oraz jeden aktywny target dla jednego adresu.
- [x] DEC-004 Ustalić, że Organization Admin nie otrzymuje automatycznie dostępu do treści poczty.
- [x] DEC-005 Oddzielić authentication identity od biznesowego adresu routowanego.
- [x] DEC-006 Odłożyć forwarding zewnętrzny i distribution groups poza pierwsze wydanie.
- [x] DEC-007 Ustalić, że mailbox ID jest opaque, immutable i niezależny od adresu.
- [x] DEC-008 Ustalić, że transfer adresu nie przenosi historycznych wiadomości.
- [x] DEC-009 Zatwierdzić lowercase ASCII local-part 1-64 zgodny z `[a-z0-9]+(?:[._-][a-z0-9]+)*` oraz system-managed reserved names.
- [x] DEC-010 Zatwierdzić minimum 180 dni kwarantanny, brak automatycznego reuse i ręczny step-up po cooldownie.
- [x] DEC-011 Zatwierdzić archiwizację bez automatycznego hard delete i bezterminową retencję danych w pierwszym wydaniu.
- [x] DEC-012 Przyjąć passkey-first, recovery codes i osobną external recovery identity; hosted/shared address nie jest samodzielnym email-auth proof.
- [x] DEC-013 Zatwierdzić blokadę pełnego transferu do anulowania lub rozstrzygnięcia pending, scheduled, sending i indeterminate sends.
- [x] DEC-014 Odłożyć folder-only access; pierwsze wydanie nadaje role i dostęp wyłącznie per mailbox.
- [x] DEC-015 Spisać i podlinkować ADR 0001-0004 dla decyzji wpływających na schemat, auth, routing i lifecycle.
- [x] DEC-016 Rozdzielić route-only reassignment od pełnego address transfer obejmującego send identities, bez zmiany właściciela domeny.
- [x] DEC-017 Zatwierdzić permission IDs i niemutowalne mapowania ról platformowych opisane w ADR 0003.
- [x] DEC-018 Zatwierdzić `active <-> suspended`, `active -> archiving -> archived`, `archived -> active`, operation-specific read-only dla suspended/archive bez inbound/outbound oraz historyczne, wizualnie wygaszone route assignments zgodnie z ADR 0004.

Kryterium wyjścia spełnione: wszystkie decyzje blokujące schemat i autoryzację są zatwierdzone, a ADR 0001-0004 są podlinkowane z tego dokumentu.

### Etap 1: Fundament bezpieczeństwa i operacji

Cel: przed rozszerzeniem liczby użytkowników i skrzynek domknąć mechanizmy wymagane do bezpiecznych mutacji administracyjnych.

- [x] SAFE-001 Dodać wersjonowaną, pięciominutową politykę step-up, password completion z rotacją sesji, typed HTTP/UI flow i transakcyjny recheck; zastosować ją do obecnego owner bootstrapu i wymagać jej od przyszłych domen, adresów, grantów, transferów oraz operacji właścicielskich.
- [ ] SAFE-002 Dodać passkey oraz recovery codes albo zatwierdzony równoważny mechanizm odzyskiwania. Guarded passkey enrollment, privacy-safe credential list/revoke, discoverable UV passkey sign-in, token-bound passkey step-up i atomiczne wydawanie 10 hash-only recovery codes są gotowe. Public recovery wymaga dwóch niezależnych dowodów: linku wysłanego na verified external recovery identity oraz jednorazowego recovery code. Consume atomowo sprawdza exact verification row, identity ID/version, aktywnego użytkownika i kod, po czym tworzy piętnastominutową restricted session z jedyną capability `second-passkey`; zwykłe application routes oraz core session management odrzucają tę sesję. Recovery passkey ceremony wiąże challenge z session ID, hashem generacji tokenu i exact recovery identity, wymaga exact RP/origin oraz UV, a końcowy D1 batch dodaje passkey i unrestricted session, zastępuje primary login authority passkey-only identity, unieważnia poprzednie sesje, passkeys, password/TOTP credentials i recovery codes, zapisuje 10 nowych hashy oraz metadata-only audyty. Plaintext nowych kodów jest zwracany i pokazywany tylko raz przez odpowiedzi `no-store`; produkcyjna dostawa linku działa przez `waitUntil`, a publiczny start ma osobny rate-limit bucket i enumeration-safe odpowiedź. Zadanie pozostaje konserwatywnie otwarte do zakończenia należącego do SAFE-006 operation ID, exact replay i readback dla mutujących kroków recovery oraz dodania bezpośrednich testów denial/conflict i warstwy HTTP potwierdzających `waitUntil`, rate limit, enumeration-safe response i `no-store`.
- [ ] SAFE-003 Wprowadzić wersjonowaną macierz session requirements dla całej grupy mailbox operations. Domyślnie każda operacja mailboxowa odrzuca restricted session i sesję z nieukończonymi requirements; wyjątki muszą być jawne, capability-scoped i fail-closed. Część auth/application routes ma lokalne guardy, ale brakuje jednego group-wide defaultu, kompletnej macierzy per operation oraz testów pozytywnych i odmowy dla całej grupy.
- [x] SAFE-004 Dodać wersjonowany append-only administracyjny audit event store, privacy contract i atomowe API zapisu używane przez kolejne etapy. D1 wymusza zamkniętą taksonomię i spójność metadanych, opaque UUID v4 dla operation ID, blokuje update/delete/conflict replacement oraz indeksuje operation, tenant, actor, resource i action; owner bootstrap, mailbox rename oraz external recovery enrollment/verification zapisują sukces w tym samym batchu co mutacja, a odmowa nie tworzy zdarzenia. Typed prepare contract obejmuje także przyszłe recovery revoke bez publicznego niezależnego write API i bez generic JSON, treści wiadomości, adresów email, sekretów lub tokenów. Replay/readback i pełna idempotency pozostają w SAFE-006.
- [ ] SAFE-005 Dodać backup D1, R2 i każdego MailboxDO SQLite wraz z procedurą identity-preserving restore przed pierwszą migracją destrukcyjną.
- [ ] SAFE-006 Dodać operation ID, expected version i readback dla wszystkich nowych mutacji control plane. Część obecnych ścieżek ma już durable operation receipts, expected version lub readback, ale kontrakt nie jest jednolity ani kompletny dla bootstrapu, rename, recovery i przyszłych mutacji; exact replay musi odróżniać identyczne powtórzenie od reuse operation ID z innym intentem.
- [ ] SAFE-007 Zachować transactional session oraz authorization recheck dla każdej mutacji D1. Owner bootstrap, rename i część account-security mutations stanowią aktualny guarded-D1 baseline; DoD przyszłych mutacji wymaga tego samego token-bound session, requirement, authorization i expected-state rechecku w jednym batchu z zapisem, receipt i audytem.
- [ ] SAFE-008 Dodać bazowy limit rozmiaru inbound przed zapisem raw MIME do R2; INB-009 ma zachować i przetestować guard na nowej ścieżce.
- [ ] SAFE-009 Dodać bazową regresję security invariants obecnego singletona przed usunięciem ograniczeń: owner allowlist, unrestricted i świeży step-up dla bootstrapu, transactional token/permission recheck, membership bez prawa autoryzacji, kwalifikowane folder ancestry, caller mailbox hints bez roli dowodu, routing wyłącznie po SMTP envelope recipient, izolacja `MailboxDO` identity oraz odrzucenie próby utworzenia drugiego mailboxa.
- [ ] SAFE-010 Uzupełnić recovery runbook o utratę właściciela, błędny grant i błędny routing.
- [ ] SAFE-011 Dodać CI gate dla migracji, typecheck, test, lint, format i build. Lokalny gate i skrypty `bun run check`, `typecheck`, `test`, `format` oraz `build` istnieją, ale repozytorium nie ma jeszcze egzekwującego ich CI.
- [x] SAFE-012 Uzgodnić nakładające się pozycje z `TODO.md`, poprawić jego nieaktualne statusy infrastruktury i pozostawić jeden kanoniczny checkbox per deliverable.
- [ ] SAFE-013 Utrzymać recovery-safe identity policy dla enrollment i wszystkich login/recovery initiation paths; shared-routed address nigdy nie może być samodzielnym dowodem email-auth. Recovery-only identity ma osobny model i D1 constraints, a wspólna policy odrzuca zarządzaną domenę, mailbox routes, login identities i duplikaty. Authenticated enrollment z pięciominutowym step-up, same-user verification oraz public recovery z external link plus recovery code są zintegrowane: sekrety trafiają wyłącznie do fragmentu linku, a właściwe consumption/lifecycle/version/audit mutations są atomowe. Zadanie pozostaje otwarte do objęcia policy pozostałych generic login/recovery initiation paths i testami całej powierzchni; invitation acceptance należy do INV-010, a przyszłe shared-route mutations do ADDR-022.
- [x] SAFE-014 Dodać minimalny request/correlation context i wide event contract przed pierwszym nowym endpointem administracyjnym. Backend generuje UUID per request, udostępnia context w request-scoped grafie Layer i emituje jeden privacy-bounded completion event z zamkniętą rodziną route, statusem, outcome, duration i zwalidowanym CF-Ray; propagacja między service hops pozostaje w OBS-006.
- [ ] SAFE-015 Przetestować restore wiadomości, folderów, reguł, draftów, outbound state, raw MIME i attachmentów do tego samego mailbox ID.

Kryterium wyjścia: wrażliwe mutacje mają step-up, audit, idempotency, backup i powtarzalny test odmowy dostępu.

### Etap 2: Organizacja, członkostwo i domena

Cel: wprowadzić granicę tenantową, zanim zostanie usunięty singleton mailboxa.

- [ ] ORG-001 Dodać `app_organization` ze statusem, wersją i niemutowalnym ID.
- [ ] ORG-002 Dodać `app_organization_member` z aktywnym, zawieszonym i odwołanym lifecycle.
- [ ] ORG-003 Zasiać zatwierdzone w DEC-017 organization i mailbox role mappings przez publiczny kontrakt kontekstu `authorization`; kontekst `authorization` jest właścicielem katalogu permission IDs, scope contracts i rozwiązywania uprawnień, a `organization` orkiestruje bootstrap/migrację bez przejmowania tego ownership.
- [ ] ORG-004 Dodać wersjonowaną IDNA domain canonicalization, wykonać preflight obecnej domeny i utworzyć `app_mail_domain` z globalnie wyłącznym canonical domain ownership.
- [ ] ORG-005 Rozdzielić trzy role `MAILBOX_OWNER_EMAIL`: zachować osobną bootstrap allowlist, przenieść initial mailbox address do jawnego command/migration input oraz zastąpić przejściową managed-domain heurystykę kanonicznym `MailDomain`.
- [ ] ORG-006 Utworzyć legacy/default organization podczas migracji istniejącego wdrożenia.
- [ ] ORG-007 Przypisać istniejący mailbox `primary` do legacy organization bez zmiany mailbox ID.
- [ ] ORG-008 Przypisać istniejącego właściciela jako aktywnego Organization Owner.
- [ ] ORG-009 Utworzyć rekord domeny na podstawie istniejącego adresu i oznaczyć status migracji jawnie.
- [ ] ORG-010 Dodać `organizationId` do mailbox registry oraz wymaganych indeksów.
- [ ] ORG-011 Rozszerzyć user preferences o organization scope i zweryfikowany default mailbox.
- [ ] ORG-012 Dodać serwis bootstrapu organizacji bez zaufania do organization ID przesłanego jako dowód dostępu.
- [ ] ORG-013 Dodać lifecycle organization pierwszego wydania: `active <-> suspended`, z wersjonowaną macierzą dozwolonych operacji. `deleting` i `deleted` oraz organization delete workflow są odłożone do SAAS-006.
- [ ] ORG-014 Dodać testy unikalności domeny, izolacji organizacji i atomowego bootstrapu.
- [ ] ORG-015 Udokumentować migrację i aktualny model w `README.md`.
- [ ] ORG-016 Dodać ownership challenge, proof expiry, re-verification i aktywację domeny.
- [ ] ORG-017 Oddzielić status ownership od observed inbound, outbound i DNS readiness.
- [ ] ORG-019 Sporządzić inwentarz wszystkich tabel D1, schematów MailboxDO, obiektów R2, Workflow payloads, cache keys, auditów i scopes z regułą stored/derived/validated `organizationId`.

Kryterium wyjścia: każdy istniejący mailbox i każda zarządzana domena mają kanoniczną organizację oraz poprawnie zmigrowaną własność; request-level enforcement zostaje uruchomiony i zweryfikowany w etapie 3 przed drugim mailboxem.

### Etap 3: Uprawnienia, assignments i bramy izolacji

Cel: uruchomić wszystkie bramy bezpieczeństwa przy nadal aktywnym singletonie, zanim powstanie drugi mailbox.

- [ ] ACL-001 Namespacować role organizacyjne i mailboxowe oraz atomowo zmigrować definitions, mappings i istniejące grants.
- [ ] ACL-002 Dodać aplikacyjny serwis member oraz grant administration zamiast publicznego generycznego administratora.
- [ ] ACL-003 Wymagać aktywnego organization membership, mailbox assignment i dokładnego permission przy normalnym dostępie.
- [ ] ACL-004 Zinwentaryzować, odwołać lub skwantannować istniejące globalne mail grants, a następnie odrzucać tworzenie kolejnych.
- [ ] ACL-005 Dodać exact-scope permissions do mailbox creation, lifecycle, member management, address management i audit read.
- [ ] ACL-006 Zaimplementować hierarchy grantowania i zablokować self-escalation.
- [ ] ACL-007 Chronić ostatniego aktywnego Organization Owner.
- [ ] ACL-008 Chronić ostatniego aktywnego Mailbox Owner, jeśli polityka mailboxa go wymaga.
- [ ] ACL-009 Atomowo synchronizować mailbox assignment, grants oraz audit.
- [ ] ACL-010 Dodać bezpieczne direct grants jako wyjątki addytywne bez deny grants w pierwszym wydaniu.
- [ ] ACL-011 Dodać endpoint efektywnego dostępu pokazujący źródło roli lub grantu.
- [x] ACL-012 Jawnie odłożyć folder-only access zgodnie z DEC-014; pierwsze wydanie wymaga mailbox assignment i mailbox-level read authority, a product workflows nie wystawiają folder-only grantów.
- [ ] ACL-013 Dodać coarse organization/mailbox gate przed lookupem child resource w Durable Object.
- [ ] ACL-014 Ujednolicić odpowiedzi dla zasobu nieistniejącego i istniejącego poza tenantem, aby ograniczyć existence oracle.
- [ ] ACL-015 Dodać macierz testów cross-organization i cross-mailbox dla każdej klasy permission.
- [ ] ACL-016 Rozszerzyć lub zastąpić `app_mailbox_member` kanonicznym `MailboxAssignment` ze statusem, organization, kind, actor, version i revocation metadata.
- [ ] ACL-017 Backfillować istniejące discovery rows oraz wymusić same-organization membership i foreign keys tam, gdzie są dostępne.
- [ ] ACL-018 Dodać one-to-one personal assignee invariant i jego bezpieczny stan podczas offboardingu.
- [ ] ACL-019 Włączyć nowe authorization gates i przejść regresję, nadal nie usuwając singleton indexu.

Kryterium wyjścia: wszystkie requesty wymagają właściwego tenanta, assignmentu i exact grant; Organization Admin nie czyta treści bez mailbox grantu; singleton nadal chroni przed przedwczesnym utworzeniem drugiej skrzynki.

### Etap 4: Wiele skrzynek i jawna nawigacja

Cel: dopiero po aktywacji bram z etapu 3 przygotować usunięcie globalnego singletona i uruchomić wiele mailboxów w development/staging bez utraty danych istniejącego `MailboxDO`; produkcyjne usunięcie ograniczenia pozostaje w etapie 13.

- [ ] MBX-001 Dodać `kind: personal | shared` oraz wymagane lifecycle metadata do mailboxa.
- [ ] MBX-002 Dodać generator opaque mailbox IDs dla nowych mailboxów i zachować legacy wyjątek `primary`.
- [ ] MBX-003 Zastąpić owner bootstrap ogólną, atomową komendą create mailbox.
- [ ] MBX-004 Atomowo tworzyć mailbox, podstawowy assignment, grant właścicielski i audit; initial address zostaje dołączony po wdrożeniu etapu 5.
- [ ] MBX-005 Dodać listę autoryzowanych mailbox assignments dla bieżącego użytkownika, obejmującą mailboxy `active`, `suspended` i `archived` zgodnie z operation matrix.
- [ ] MBX-006 Zastąpić `limit(1)` jawnym wybraniem mailboxa i deterministycznym fallbackiem.
- [ ] MBX-007 Zacząć używać `defaultMailboxId` per organizacja.
- [ ] UI-001 Dodać jawny organization/mailbox routing do URL i loaderów.
- [ ] UI-002 Dodać responsywny mailbox switcher dla autoryzowanych mailboxów `active`, `suspended` i `archived`, z defaultem ograniczonym do `active` i czytelnymi stanami niedostępności.
- [ ] MBX-008 Dodać create, rename i suspend mailbox APIs.
- [ ] MBX-009 Zablokować hard delete i cascade do czasu wdrożenia address history, retencji, audytu i cleanup workflow.
- [ ] MBX-011 Przygotować i przetestować usunięcie `app_mailbox_singleton_idx`; produkcyjne wykonanie pozostaje w ROLL-008.
- [ ] MBX-012 Zachować istniejące ID `primary` i jego MailboxDO podczas migracji.
- [ ] MBX-013 Zakresować cache, query keys i 403 state przez organization oraz mailbox ID.
- [ ] MBX-014 Dodać testy równoległego tworzenia mailboxów, lifecycle i wyboru defaultu.
- [ ] MBX-015 Dodać test dowodzący, że dwa mailboxy mają oddzielne Durable Objects i dane.
- [ ] MBX-016 Udostępnić drugi mailbox wyłącznie w development i staging za feature flagiem po przejściu wszystkich ACL gates; produkcyjne włączenie należy do ROLL-008/ROLL-010.
- [ ] MBX-017 Wdrożyć state machine `active <-> suspended`, `active -> archiving -> archived`, `archived -> active` oraz wersjonowaną operation matrix. `suspended` i `archived` dopuszczają jawnie autoryzowane read/search/attachment/export, blokują inbound, outbound i content mutations; `archiving` dopuszcza tylko operacje workflow i kontrolowane rozstrzygnięcie in-flight pracy.
- [ ] MBX-020 Dodać audytowany mailbox export dla active i archived mailboxów: manifest, wiadomości, reguły, drafty i attachmenty z checksumami oraz wygasającym downloadem.

Kryterium wyjścia: w development i staging użytkownik może pod feature flagiem posiadać kilka mailboxów i jawnie przełączać kontekst, a wiadomości i uprawnienia pozostają odizolowane przez bramy wdrożone przed usunięciem singletona. Produkcyjne usunięcie singleton indexu i uruchomienie dodatkowych mailboxów pozostaje wyłącznie w ROLL-008.

### Etap 5: Stabilne adresy i routing

Cel: oddzielić adres od mailboxa i umożliwić bezpieczne aliasy oraz zmianę targetu.

- [ ] ADDR-001 Zastąpić mailbox-owned identity w `app_mailbox_address` stabilnym `app_mail_address` należącym do domeny.
- [ ] ADDR-002 Przed zmianą polityki zinwentaryzować case oraz IDNA collisions w istniejących danych i przygotować quarantine/operator-resolution flow.
- [ ] ADDR-003 Dodać wersjonowaną kanonikalizację local-part, złożyć ją z canonical domain z ORG-004, a po rozwiązaniu kolizji wymusić globalną unikalność i spójność raw/canonical fields.
- [ ] ADDR-004 Dodać listę zarezerwowanych local-parts i testy kolizji.
- [ ] ADDR-005 Dodać lifecycle adresu: provisioning `pending -> active`, operacyjne `active <-> suspended` oraz retirement `active | suspended -> quarantined -> retired`, wraz z `quarantinedAt`, `quarantinedUntil`, reason i version; `retired` oznacza tylko eligible for manual reuse.
- [ ] ADDR-006 Dodać `app_inbound_route_assignment` z niemutowalną historią i revision.
- [ ] ADDR-007 Wymusić najwyżej jedno active route assignment zawsze oraz dokładnie jedno przy każdej zmianie statusu adresu na `active`.
- [ ] ADDR-008 Wymusić tę samą organizację dla domeny, adresu, route i mailboxa.
- [ ] ADDR-009 Dodać atomowe create address plus assign route, wymagające aktywnej, zweryfikowanej domeny należącej do tej samej organizacji.
- [ ] ADDR-010 Dodać atomowy route-only reassignment z expected revision, powodem i audit eventem, bez automatycznej zmiany send identities.
- [ ] ADDR-011 Dodać activate, suspend, quarantine, retire i manual reuse; wymusić minimum 180 dni, zakazać automatycznego reuse i reaktywować ten sam stabilny address record, ID oraz historię.
- [ ] ADDR-012 Nie pozwalać zawieszonemu lub wycofanemu exact address spaść do catch-all.
- [ ] ADDR-013 Dodać idempotentne list, create, update, route-only reassignment i lifecycle APIs; pełny transfer jest własnością OUT-023.
- [ ] ADDR-014 Mapować uniqueness conflicts na bezpieczny 409 bez ujawniania obcego tenanta.
- [ ] ADDR-015 Zmigrować istniejące `app_mailbox_address` do stable address plus route history.
- [ ] ADDR-016 Zachować historyczne ID lub mapowanie migracyjne wymagane przez istniejące dane.
- [ ] ADDR-017 Dodać testy równoległej rezerwacji tego samego adresu i transferu revision conflict.
- [ ] ADDR-018 Dodać testy canonical collisions, reserved names i tombstone precedence.
- [ ] ADDR-019 Dodać D1 fencing epoch i transfer-state primitives wymagane przez OUT-023; zadanie nie implementuje pełnego transferu ani integracji send identity/MailboxDO.
- [ ] ADDR-020 Dodać atomową komendę create receive-only mailbox plus initial address, route, assignment, grants i audit; wariant send-enabled zostaje domknięty w OUT-024.
- [ ] ADDR-021 Dodać osobne kontrakty i permissions dla route-only reassignment oraz pełnego address transfer; implementację pełnego transferu ma OUT-023, a jego UI ma UI-007.
- [ ] ADDR-022 Egzekwować recovery-safe identity policy w route-only reassignment i każdej współdzielonej mutacji address/route, aby adres dostarczany do shared mailboxa nie pozostał samodzielnym email-auth proof; operacja ma używać wspólnego guardu z SAFE-013 i być atomowa względem zmiany route.
- [ ] ORG-018 Przed etapem inbound/outbound uruchomić bazowy staging catch-all do Workera oraz zweryfikowaną sender domain; etap 10 rozszerza monitoring i produkcyjne utrzymanie.

Kryterium wyjścia: wiele adresów może prowadzić do jednego mailboxa, adres może bezpiecznie zmienić target, a historia decyzji pozostaje dostępna.

### Etap 6: Inbound dla wielu skrzynek i aliasów

Cel: po pełnym zakończeniu etapu 5 każdą wiadomość trwale powiązać z dokładną decyzją routingu, która obowiązywała w chwili odbioru.

- [ ] INB-001 Rozszerzyć resolver o aktywną organization, zweryfikowaną aktywną domain, address, route assignment i revision.
- [x] INB-002 Zachować SMTP envelope recipient jako jedyne źródło decyzji routingu; obecny ingress i resolver już ignorują MIME `To` jako routing evidence.
- [ ] INB-003 Zapisać address ID, assignment ID, revision, match kind i mailbox ID w R2 metadata.
- [ ] INB-004 Przekazać ten sam immutable routing snapshot do Workflow.
- [ ] INB-005 Dodać queryable envelope recipient i routing snapshot do schematu wiadomości MailboxDO.
- [ ] INB-006 Zachować historyczny snapshot na wiadomości zamiast dynamicznego joinu do bieżącego route.
- [ ] INB-007 Zdefiniować i wdrożyć zachowanie, gdy mailbox zostanie zawieszony po linearyzacji ingressu.
- [ ] INB-008 Odrzucać unknown, suspended i retired addresses generycznym komunikatem SMTP.
- [ ] INB-009 Zachować i rozszerzyć guard z SAFE-008 na nowej ścieżce routingu: limit raw size musi zadziałać przed R2, zwrócić jawny generyczny kod odrzucenia i mieć test regresyjny.
- [ ] INB-010 Zachować działanie reguł `envelopeTo` dla aliasów.
- [ ] INB-011 Dodać reconciliation dla raw objects bez uruchomionego Workflow.
- [ ] INB-012 Dodać test: dwa aliasy do jednego mailboxa trafiają do tej samej izolowanej bazy z różnym envelopeTo.
- [ ] INB-013 Dodać test: dwa adresy do różnych mailboxów nie mieszają danych.
- [ ] INB-014 Dodać test race: route transfer po lookupie nie zmienia targetu in-flight ingestu.
- [ ] INB-015 Dodać test retry i replay zachowujący oryginalny assignment revision.
- [ ] INB-016 Utworzyć syntetyczne legacy assignment/revision dla danych sprzed wprowadzenia route history.
- [ ] INB-017 Wprowadzić nową wersję R2 metadata i Workflow payload, zachowując czytniki wersji wymaganych przez już zapisane oraz in-flight V1/V2.
- [ ] INB-018 Backfillować historyczne `envelopeTo` z request key lub R2 metadata, a brakujące wartości oznaczyć jawnym `legacy_unknown` zamiast zgadywać.
- [ ] INB-019 Dodać test deployu z Workflow rozpoczętym na starej wersji i kończącym po wdrożeniu nowego schematu.
- [ ] INB-020 Odrzucać archived mailbox jako nowy route target, ale pozwolić trusted pre-cutover snapshots zakończyć ingest podczas kontrolowanego `archiving` drain.

Kryterium wyjścia: inbound jest deterministyczny przy aliasach i transferach, a każdą wiadomość można powiązać z historycznym adresem oraz targetem.

### Etap 7: Tożsamości nadawcy, wysyłka i reply

Cel: po pełnym zakończeniu etapów 5-6 oddzielić przyjmowanie poczty od prawa wysyłania i zachować poprawną tożsamość w odpowiedziach.

- [ ] OUT-001 Dodać `app_mailbox_send_identity` z address, mailbox, send-enabled, default, fencing epoch i revision; nie duplikować stanu inbound receive.
- [ ] OUT-002 Wymusić dokładnie jedną aktywną default send identity dla mailboxa z włączoną wysyłką i zero dla receive-only.
- [ ] OUT-003 Zezwolić na zero send identities dla mailboxa receive-only.
- [ ] OUT-004 Dodać mailbox-scoped `mailbox.send_from_shared_identity` do ról Owner/Manager oraz direct-only `send_identity.use` na exact `JSON [mailboxId, sendIdentityId]` zgodnie z ADR 0003.
- [ ] OUT-005 Dodać `fromIdentityId` i expected revision do draftu.
- [ ] OUT-006 Inicjalizować nowe drafty bieżącym defaultem, ale nie zmieniać istniejących draftów po zmianie defaultu.
- [ ] OUT-007 Ponownie autoryzować send identity bezpośrednio przed utworzeniem immutable send snapshot.
- [ ] OUT-008 Zamrozić address ID, canonical address, display name i identity revision w outbound snapshot.
- [ ] OUT-009 Parsować i przechowywać inbound MIME `Reply-To`.
- [ ] OUT-010 Dodać poprawne RFC `Message-ID`, `In-Reply-To` i `References` do outbound providera.
- [ ] OUT-011 Dodać reply oraz reply-all z bezpieczną deduplikacją adresów.
- [ ] OUT-012 Domyślnie odpowiadać z ingress aliasu, jeśli nadal jest send-enabled dla mailboxa.
- [ ] OUT-013 Pokazywać jawny fallback i ostrzeżenie, gdy ingress alias nie jest już dostępny.
- [ ] OUT-014 Zaimplementować politykę pending, scheduled, sending oraz indeterminate sends podczas pełnego address transfer zgodnie z DEC-013, używając outbox/Workflow zamiast pozornej transakcji D1 plus DO.
- [ ] OUT-015 Sprawdzać aktywną domenę i sender readiness przed schedule oraz dispatch.
- [ ] OUT-016 Dodać selektor `From` ograniczony do autoryzowanych send identities.
- [ ] OUT-017 Dodać testy stale identity, transfer race, reply, reply-all i immutable resend.
- [ ] OUT-018 Dodać test, że read-only user nigdy nie może wysłać z żadnego aliasu.
- [ ] OUT-019 Dodać epoch-bound D1 dispatch permit/lease: schedule i dispatch sprawdzają aktualną identity/domain epoch, transfer blokuje nowe permits oraz czeka na rozstrzygnięcie aktywnych permits przed finalizacją.
- [ ] OUT-020 Dodać test transfer-then-reply-all potwierdzający usunięcie historycznego ingress/own recipient po przeniesieniu adresu.
- [ ] OUT-021 Zmigrować legacy primary address do default send identity oraz jawnie obsłużyć otwarte drafty, istniejące scheduled snapshots i resend.
- [ ] OUT-022 Wersjonować protokół Website, Backend i MailboxDO tak, aby deploy nie uszkodził starych draftów ani zaplanowanych wiadomości.
- [ ] OUT-023 Dodać pełny address transfer jako state machine łączący route, send identities, dispatch permits, idempotentny outbox/Workflow i reconciliation operacji MailboxDO.
- [ ] OUT-024 Rozszerzyć ADDR-020 o atomowe utworzenie default send identity dla mailboxa send-enabled.
- [ ] OUT-025 Dla `sending` i `indeterminate` permitów wymagać bezpiecznego rozstrzygnięcia albo jawnej interwencji operatora; nie finalizować transferu na podstawie timeoutu bez wiedzy o wyniku providera.
- [ ] OUT-026 Blokować draft mutations, schedule, dispatch i send identity use dla `suspended`, `archiving` oraz `archived`, z wyjątkiem kontrolowanego anulowania lub rozstrzygnięcia istniejącej wysyłki podczas `archiving`.

Kryterium wyjścia: każda wysyłka ma jawny i autoryzowany `From`, reply zachowuje właściwy alias, a transfer nie pozostawia staremu mailboxowi prawa wysyłania.

### Etap 8: Zaproszenia, skrzynki osobiste i offboarding

Cel: obsłużyć pełny lifecycle pracownika bez ręcznego modyfikowania bazy lub grantów.

- [ ] MBX-010 Zastosować lifecycle bez blanket revoke: przy suspend/archive zachować assignments oraz jawne granty read/search/attachment/export potrzebne do dozwolonego dostępu, a operacje blokować przez state matrix; odwoływać tylko granty niezgodne z jawną polityką i nigdy nie nadawać Organization Admin implicit read.
- [ ] MBX-018 Dodać archive workflow wymagający disposition każdego route, wyłączenia send identities, rozstrzygnięcia outboundów i drenażu pre-cutover inboundów.
- [ ] MBX-019 Dodać audytowany restore workflow walidujący organization, assignments, grants, domain, routes i send identities przed przejściem z `archived` do `active`.
- [ ] INV-001 Wybrać i włączyć wymagane moduły invitation z effect-auth albo zbudować równoważny aplikacyjny model.
- [ ] INV-002 Zdefiniować wersjonowany invitation intent: organizacja, recipient, role, mailbox assignments i expiry.
- [ ] INV-003 Przechowywać wyłącznie hash jednorazowego tokenu zaproszenia.
- [ ] INV-004 Wymagać aktywnej, zweryfikowanej i recovery-safe identity zgodnej z recipientem przy akceptacji.
- [ ] INV-005 Atomowo tworzyć organization membership, mailbox assignments, grants, acceptance receipt i audit.
- [ ] INV-006 Dodać resend, revoke, expire i replay-safe acceptance.
- [ ] INV-007 Dodać kreator pracownika z opcjonalnym personal mailboxem i adresem.
- [ ] INV-008 Personal mailbox domyślnie przypisać wyłącznie pracownikowi jako właścicielowi.
- [ ] INV-009 Shared mailboxes przypisywać jawnie z wybraną rolą.
- [ ] INV-010 Egzekwować recovery-safe policy przy invitation acceptance: recipient dostarczany do shared lub jeszcze niedostępnego personal mailboxa nie może być samodzielnym kanałem magic link, OTP, verification ani recovery. To zadanie jest właścicielem integracji invitation; SAFE-013 pozostaje właścicielem enrollment i login/recovery initiation, a ADDR-022 route mutations.
- [ ] INV-011 Dodać suspend member blokujący nowe sesje i dostęp bez utraty historii.
- [ ] INV-012 Dodać atomową część D1 offboardingu odwołującą sesje, assignments, grants, team access, invitations i delegated grants.
- [ ] INV-013 Dodać idempotentny offboarding workflow dla personal address, pending drafts, scheduled/sending/indeterminate sends i pełnego address transfer oraz reconciliation częściowych awarii.
- [ ] INV-014 Chronić ostatniego właściciela organizacji przy równoległych operacjach.
- [ ] INV-015 Dodać readback raportujący wszystkie odebrane i pozostałe uprawnienia użytkownika.
- [ ] INV-016 Dodać testy invitation hijack, recipient mismatch, replay, expiry i concurrent last-owner removal.

Kryterium wyjścia: pracownika można bezpiecznie zaprosić, przypisać, zawiesić i usunąć bez osieroconych grantów lub dostępu do cudzej poczty.

### Etap 9: UI organizacji, skrzynek i adresów

Cel: udostępnić wszystkie zatwierdzone operacje w prostym UI, bez omijania backendowych invariantów.

- [ ] UI-003 Dodać kreator `Personal mailbox` i `Shared mailbox`.
- [ ] UI-004 Dodać organization mailbox directory z lifecycle i liczbą członków.
- [ ] UI-005 Dodać organization address directory z filtrem domeny, mailboxa i statusu.
- [ ] UI-006 Dodać mailbox address settings dla aliases, receive, send i default `From`.
- [ ] UI-007 Dodać kanoniczny UI pełnego address transfer z preview skutków, expected revision, reason i step-up; route-only reassignment pozostaje osobnym intentem z ADDR-021.
- [ ] UI-008 Dodać mailbox members UI z rolami i effective access preview.
- [ ] UI-009 Dodać organization members oraz invitations UI.
- [ ] UI-010 Dodać personal address to shared mailbox warning.
- [ ] UI-011 Dodać audit log UI z filtrem actor, resource, action i outcome.
- [ ] UI-012 Dodać domain readiness UI dla DNS, inbound i outbound.
- [ ] UI-013 Dodać bezpieczne empty, loading, conflict, forbidden i stale-version states.
- [ ] UI-014 Unieważniać cache po transferze, zmianie roli, offboardingu i zmianie default mailboxa.
- [ ] UI-015 Usuwać wrażliwe mailbox data z browser cache po utracie dostępu.
- [ ] UI-016 Zweryfikować wszystkie flow na desktopie i mobile.
- [ ] UI-017 Dodać accessibility coverage dla formularzy, dialogów i mailbox switchera.
- [ ] UI-018 Dodać testy UI najważniejszych ścieżek i odmów.
- [ ] UI-019 W archived mailbox pokazywać zamknięte route assignments jako wyszarzoną historię z bieżącym disposition: transferred albo quarantined until.
- [ ] UI-020 Dodać archive wizard, który nie pozwala zakończyć operacji bez wyboru disposition każdego aktywnego adresu.

Kryterium wyjścia: administrator wykonuje codzienne operacje bez ręcznych zmian, użytkownik widzi tylko autoryzowane mailboxy, a ryzykowne skutki są jasno komunikowane.

### Etap 10: Produkcyjna gotowość Cloudflare Email Service

Cel: rozszerzyć bazowy staging transport z ORG-018 do produkcyjnego, stale monitorowanego stanu bez przenoszenia dynamicznego routingu aliasów poza D1.

- [ ] INFRA-001 Potwierdzić wspierany proces onboardingu domeny używającej Cloudflare DNS.
- [ ] INFRA-002 Zadeklarować produkcyjny Email Routing/Email Service i catch-all do Backend Workera przez Alchemy, jeśli API zasobu na to pozwala.
- [ ] INFRA-003 Utrzymać statyczny catch-all per domena i dokładny routing adresów w D1.
- [ ] INFRA-004 Nie tworzyć osobnej Cloudflare route przy każdej zmianie aliasu w pierwszym wydaniu.
- [ ] INFRA-005 Dodać domain readiness state: ownership, MX, SPF, DKIM, DMARC, inbound routing i outbound sending.
- [ ] INFRA-006 Dodać okresową weryfikację DNS oraz obserwowanego stanu Cloudflare.
- [ ] INFRA-007 Reconciliation ma wykrywać i zawieszać adresy, których domena nie jest aktywna, zweryfikowana albo nie należy do organizacji; synchroniczny guard obowiązuje już od ADDR-009.
- [ ] INFRA-008 Odrzucać wysyłkę, gdy sender domain nie jest aktywna lub dostępna u providera.
- [ ] INFRA-009 Dodać limity unknown-recipient traffic, message size i abuse monitoring dla catch-all.
- [ ] INFRA-010 Dodać staging domain i przejść pełny inbound/outbound smoke test.
- [ ] INFRA-011 Przetestować dostarczalność oraz nagłówki SPF, DKIM i DMARC na Gmailu i Outlooku.
- [ ] INFRA-012 Udokumentować ręczny fallback i recovery przy niedostępności Email Service.
- [ ] INFRA-013 Jawnie zaznaczyć, że wiele domen klientów wymaga osobnego późniejszego procesu Cloudflare account/zone onboarding.

Kryterium wyjścia: stan domeny w aplikacji odpowiada rzeczywistej konfiguracji, dynamiczne aliasy nie wymagają zmian edge rules, a unknown recipients są bezpiecznie odrzucane.

### Etap 11: Audit, observability i reconciliation

Cel: wykrywać i naprawiać rozbieżności, bez logowania treści wiadomości lub sekretów.

- [ ] OBS-001 Rozszerzyć i zamrozić wersję bazowego audit schema z SAFE-004 po implementacji wszystkich typów zasobów.
- [ ] OBS-002 Zweryfikować atomowy zapis audit z każdą mutacją D1 oraz outbox-linked audit dla operacji przekraczających D1 i MailboxDO.
- [ ] OBS-003 Zweryfikować rejestrowanie actor, organization, mailbox, address, assignment revision, before/after, reason, operation ID i outcome.
- [ ] OBS-004 Zweryfikować automatycznymi testami, że audit nie zawiera body, subject, raw MIME, tokenów, sekretów ani pełnego IP.
- [ ] OBS-005 Rozszerzyć bazowy kontrakt SAFE-014 do jednego ustrukturyzowanego wide eventu per request i service hop.
- [ ] OBS-006 Propagować request/correlation ID przez Website, Backend, Workflow i MailboxDO.
- [ ] OBS-007 W wide eventach uwzględniać environment, deployment version, actor ID, organization ID, mailbox ID, resource IDs, status, duration i commit state.
- [ ] OBS-008 Nie emitować rozproszonych, niespójnych logów tekstowych dla jednej operacji.
- [ ] OBS-009 Dodać metryki: routing rejects, unknown recipients, transfer conflicts, authorization denies, invitation failures i send failures.
- [ ] OBS-010 Dodać alerty dla cross-scope mismatch, orphan grants, routing errors, provider failures i reconciliation drift.
- [ ] OBS-011 Dodać reconciliation organization membership kontra mailbox assignments i grants.
- [ ] OBS-012 Dodać reconciliation addresses kontra active routes i send identities.
- [ ] OBS-013 Dodać reconciliation control plane kontra Cloudflare domain/routing readiness.
- [ ] OBS-014 Dodać reconciliation orphan raw MIME, Workflow i MailboxDO commits.
- [ ] OBS-015 Dodać reconciliation scheduled/sending/indeterminate sends, dispatch permits i nieaktywnych identities.
- [ ] OBS-016 Zapewnić idempotentne i audytowane naprawy albo bezpieczne raporty wymagające decyzji operatora.
- [ ] OBS-017 Dodać runbooki i przykładowe zapytania diagnostyczne dla najważniejszych incydentów.

Kryterium wyjścia: operator potrafi odtworzyć kto zmienił dostęp lub routing, znaleźć drift i bezpiecznie go naprawić bez dostępu do treści poczty.

### Etap 12: Testy przekrojowe i hardening

Cel: udowodnić izolację, poprawność migracji oraz zachowanie w wyścigach i częściowych awariach.

- [ ] TEST-001 Dodać unit tests schematów, kanonikalizacji, role matrix i state machines.
- [ ] TEST-002 Dodać migration tests od aktualnego singletona do organization/multi-mailbox.
- [ ] TEST-003 Dodać invariant tests unikalności domeny, adresu, active route i default sendera.
- [ ] TEST-004 Dodać adversarial cross-organization access suite.
- [ ] TEST-005 Dodać adversarial cross-mailbox oraz folder ancestry suite.
- [ ] TEST-006 Dodać testy membership bez grantu i grantu bez assignment.
- [ ] TEST-007 Dodać testy global grant rejection.
- [ ] TEST-008 Dodać testy równoległego create, transfer, suspend, offboard i last-owner protection.
- [ ] TEST-009 Dodać testy inbound linearyzacji oraz replay po zmianie route.
- [ ] TEST-010 Dodać testy outbound stale identity, dispatch permit race oraz pending/scheduled/sending/indeterminate policy.
- [ ] TEST-011 Dodać testy browser cache oraz utraty dostępu podczas aktywnej sesji.
- [ ] TEST-012 Dodać testy ograniczonej sesji i step-up dla każdej wrażliwej operacji.
- [ ] TEST-013 Dodać testy invitation abuse i shared alias jako niedozwolonego recovery proof.
- [ ] TEST-014 Dodać testy częściowych awarii D1, R2, Workflow, Durable Object i Email Service.
- [ ] TEST-015 Dodać load tests catch-all unknown recipients i listy wielu mailboxów.
- [ ] TEST-016 Dodać testy backup/restore oraz reconciliation na kopii produkcyjnego kształtu danych.
- [ ] TEST-017 Przejść manualny security review oraz threat model.
- [ ] TEST-018 Uruchomić pełne `bun run typecheck`, `bun run test`, `bun run check` i `bun run build`.
- [ ] TEST-019 Dodać compatibility tests dla starych i nowych wersji Workflow, MailboxDO protocol, draftów i outbound snapshots podczas rolling deployu.
- [ ] TEST-020 Dodać test, że zmiana login identity route na shared mailbox uruchamia recovery-safe policy i nie pozwala przejąć konta.

Kryterium wyjścia: wszystkie krytyczne scenariusze pozytywne, negatywne, race i recovery są automatycznie pokryte, a pełny quality gate jest zielony.

### Etap 13: Migracja, rollout i odbiór produkcyjny

Cel: przejść z istniejącego mailboxa bez utraty danych, zmiany jego Durable Object identity ani niekontrolowanego rozszerzenia dostępu.

- [ ] ROLL-001 Przygotować expand/backfill/switch/contract plan migracji D1.
- [ ] ROLL-002 Wykonać i zweryfikować backup przed produkcyjną migracją.
- [ ] ROLL-003 Wykonać przygotowane migracje expand: nowe tabele i nullable references bez usuwania starego routingu.
- [ ] ROLL-004 Wykonać przygotowany backfill organization, domain, MailboxAssignment, address, synthetic legacy route i default send identity dla istniejącego `primary`.
- [ ] ROLL-005 Zweryfikować counts, foreign keys, grants, route uniqueness, sender identity, open drafts i scheduled snapshots po backfillu.
- [ ] ROLL-006 Przełączyć read path na nowe modele i porównać wynik ze starym routingiem.
- [ ] ROLL-007 Przełączyć write path na nowe serwisy z idempotency i audit.
- [ ] ROLL-008 Usunąć singleton index dopiero po pozytywnym production-shaped teście.
- [ ] ROLL-009 Usunąć stare kolumny lub tabele dopiero po okresie stabilizacji i potwierdzonym backupie.
- [ ] ROLL-010 Dodać tymczasowy feature flag dla tworzenia dodatkowych mailboxów i usunąć go po stabilizacji.
- [ ] ROLL-011 Wdrożyć etapami: owner-only, wewnętrzny zespół, jedna organizacja produkcyjna.
- [ ] ROLL-012 Monitorować authorization denies, routing rejects, provider failures, drift i latency po każdym etapie.
- [ ] ROLL-013 Przećwiczyć rollback kodu oraz forward-fix danych bez cofania zaakceptowanych wiadomości.
- [ ] ROLL-014 Zaktualizować `README.md`, `TODO.md`, runbooki i dokumentację operatora.
- [ ] ROLL-015 Usunąć `MAILBOX_OWNER_EMAIL` z ról initial mailbox address i managed-domain recovery heuristic, zachowując wyłącznie zatwierdzoną bootstrap allowlist.
- [ ] ROLL-016 Zebrać datowane staging/production evidence wykonania wszystkich scenariuszy `ACCEPT-*`; implementacja i automatyczne testy pozostają własnością ich kanonicznych zadań, a ten checkbox nie dubluje pracy.
- [ ] ROLL-018 Przeprowadzić compatibility rollout dla in-flight Workflow, legacy draftów i zaplanowanych outboundów przed usunięciem starych czytników.

Kryterium wyjścia: obecna skrzynka działa bez regresji, nowe skrzynki i aliasy są aktywne, a rollback oraz recovery zostały przećwiczone.

### Jawnie odłożone poza pierwsze wydanie

- [ ] ROLL-017 `DEFERRED`: wdrożyć mailbox delete/retention workflow dopiero po address history, audit, MailboxDO/R2 backup, cleanup i reconciliation. W pierwszym wydaniu hard delete pozostaje zablokowany, archived data jest zachowane, a zadanie nie blokuje kryterium wyjścia etapu 13.

### Etap 14: Wiele organizacji w jednym SaaS

Cel: świadomie odłożony etap po udowodnieniu bezpieczeństwa i operacyjności pojedynczej organizacji.

- [ ] SAAS-001 Dodać organization switcher i izolację wszystkich preferences oraz cache per tenant.
- [ ] SAAS-002 Zbudować proces onboardingu domen klienta korzystających z Cloudflare DNS.
- [ ] SAAS-003 Zdefiniować model dostępu do Cloudflare account/zone bez przejmowania niepotrzebnych uprawnień klienta.
- [ ] SAAS-004 Dodać billing, plany, limity mailboxów, storage, wysyłki i użytkowników.
- [ ] SAAS-005 Dodać per-tenant quotas, abuse prevention, suppression i rate limits.
- [ ] SAAS-006 Dodać tenant suspend, export i delete workflows, w tym odłożone stany organization `deleting` i `deleted`.
- [ ] SAAS-007 Dodać polityki retencji, prywatności, data residency i wymagane umowy.
- [ ] SAAS-008 Dodać support tooling bez domyślnego dostępu do treści klienta.
- [ ] SAAS-009 Dodać break-glass access z jawną zgodą, step-up i pełnym audytem, jeżeli będzie wymagany.
- [ ] SAAS-010 Przeprowadzić niezależny security review przed uruchomieniem wielu firm.

Kryterium wyjścia: wiele firm może współdzielić wdrożenie bez współdzielenia domen, danych, grantów, logów lub cache.

## 11. Kryteria odbioru produktu

Wydanie nie jest ukończone, dopóki wszystkie poniższe scenariusze nie przejdą automatycznie oraz manualnie w stagingu:

- [ ] ACCEPT-001 Owner tworzy organizację i aktywuje zweryfikowaną domenę.
- [ ] ACCEPT-002 Owner tworzy shared mailbox HR z adresem `hr@domena.com`.
- [ ] ACCEPT-003 Owner tworzy personal mailbox Magdaleny z adresem `magdalena.gdyba@domena.com`.
- [ ] ACCEPT-004 Magdalena widzi swój mailbox oraz HR, ale nie widzi Support ani Accounting.
- [ ] ACCEPT-005 Użytkownik Support nie może odkryć mailboxa HR nawet znając jego ID.
- [ ] ACCEPT-006 Alias `kadry@domena.com` trafia do HR i zachowuje oryginalny envelope recipient.
- [ ] ACCEPT-007 Wiadomość do `magdalena.gdyba@...` trafia do personal mailboxa, dopóki route nie zostanie jawnie zmieniony.
- [ ] ACCEPT-008 Przekierowanie osobistego adresu do shared mailboxa wymaga potwierdzenia widoczności dla wszystkich czytelników.
- [ ] ACCEPT-009 Reply z wiadomości do `kadry@...` domyślnie używa `kadry@...`, jeśli prawo `Send As` nadal obowiązuje.
- [ ] ACCEPT-010 Użytkownik z rolą Viewer może czytać, ale nie może wysyłać ani zmieniać adresów.
- [ ] ACCEPT-011 Organization Admin tworzy adres i członka, ale bez mailbox grantu nie czyta wiadomości.
- [ ] ACCEPT-012 Route-only reassignment aliasu wpływa wyłącznie na nowe inboundy, a stare wiadomości i send identities pozostają bez zmian.
- [ ] ACCEPT-013 In-flight inbound pozostaje w target mailboxie wybranym przed transferem.
- [ ] ACCEPT-014 Offboarding natychmiast blokuje nowy dostęp i raportuje wszystkie odwołane uprawnienia.
- [ ] ACCEPT-015 Magic link i recovery nie mogą zostać przejęte przez czytelników shared mailboxa.
- [ ] ACCEPT-016 Unknown recipient trafiający przez catch-all jest odrzucony i nie tworzy automatycznie adresu.
- [ ] ACCEPT-017 Każda zmiana roli, adresu, route i lifecycle ma kompletny audit event.
- [ ] ACCEPT-018 Reconciliation wykrywa sztucznie utworzony orphan grant lub route drift.
- [ ] ACCEPT-019 Backup odtwarza organization, routes, grants, registry, wiadomości, foldery, reguły, drafty, outbound state, raw MIME i attachmenty bez zmiany MailboxDO identity.
- [ ] ACCEPT-020 Gmail i Outlook akceptują testowe wiadomości z prawidłowymi wynikami SPF, DKIM i DMARC.
- [ ] ACCEPT-021 Route-only reassignment nie zmienia send identity, a pełny address transfer blokuje stale schedule/dispatch przez fencing epoch i czeka na aktywne dispatch permits.
- [ ] ACCEPT-022 Reply-all po transferze nie dodaje historycznego ingress address jako odbiorcy w jego nowym mailboxie.
- [ ] ACCEPT-023 Rolling deploy kończy już uruchomione inbound Workflows oraz zachowuje legacy drafts i scheduled sends.
- [ ] ACCEPT-024 Archive zamyka historyczny route bez usuwania go, a adres zostaje atomowo przeniesiony albo poddany minimum 180 dni kwarantanny.
- [ ] ACCEPT-025 Suspended i archived mailbox są read-only, nie odbierają i nie wysyłają, lecz jawnie uprawniony użytkownik widzi ich stan i może czytać, wyszukiwać, pobierać attachmenty i eksportować; żaden z nich nie może być defaultem.
- [ ] ACCEPT-026 Mailbox export wymaga `mailbox.export`, działa dla active i archived, ma audyt, integralny manifest oraz nie ujawnia storage keys.

## 12. Definition of Done

### Zadanie decyzyjne lub ADR

Decyzję produktową można oznaczyć `[x]`, gdy jej treść i uzasadnienie są zapisane w tym planie oraz zostały zaakceptowane przez product ownera. Dlatego zaakceptowane zadania `DEC-*` mogą być ukończone bez wdrożonego kodu. Osobny ADR techniczny można zamknąć dopiero po zapisaniu alternatyw, konsekwencji, właściciela i zależnych zadań; formalizację tych ADR-ów śledzi DEC-015.

### Zadanie implementacyjne

Można oznaczyć `[x]`, gdy:

- Implementacja zachowuje organization i mailbox boundaries.
- Publiczne wejście ma Effect Schema i mapowanie typed errors.
- Mutacja jest idempotentna, wersjonowana i audytowana, jeśli zmienia control plane.
- Uprawnienia są sprawdzane na serwerze na podstawie bieżącej sesji.
- Istnieje test sukcesu oraz co najmniej jeden test odmowy lub konfliktu.
- Istnieje test cross-mailbox lub cross-organization, jeśli operacja dotyka izolacji.
- Logi i telemetry nie zawierają body, subject, tokenów ani sekretów.
- Dokumentacja i kontrakty zostały zaktualizowane.

### Zadanie migracyjne

Można oznaczyć `[x]`, gdy migracja ma test na rzeczywistym poprzednim kształcie danych, preflight, backup, walidację po migracji, opisaną strategię forward-fix oraz nie zmienia istniejącego `MailboxDO` identity.

### Zadanie infrastrukturalne lub manualne

Można oznaczyć `[x]`, gdy wynik ma datowane evidence ze środowiska, oczekiwany i obserwowany stan, monitoring oraz runbook awarii. Samo kliknięcie konfiguracji bez weryfikacji nie kończy zadania.

### Gate etapu

Etap można oznaczyć `DONE`, gdy wszystkie jego checkboxy spełniają właściwy DoD oraz przechodzą `bun run typecheck`, `bun run test`, `bun run check` i `bun run build`.

## 13. Najważniejsze ryzyka i zabezpieczenia

| Ryzyko | Zabezpieczenie |
| --- | --- |
| Cross-tenant data leak | Organization gate przed DO lookupem, exact scopes, adversarial tests |
| Globalny grant otwierający wszystkie mailboxy | Zakaz globalnych mail roles i permissions |
| Membership/grant drift | Atomowe lifecycle operations i reconciliation |
| Przejęcie konta przez shared alias | Oddzielne auth identity, passkey/SSO/external recovery |
| Przypadkowy odczyt HR przez administratora | Org admin bez implicit mailbox read |
| Address squatting | Wyłączna zweryfikowana domena, server-side canonicalization, reserved names |
| Ujawnienie starych rozmów po reassignment | Historia nie jest przenoszona, ostrzeżenie i cooldown |
| Stale Send As po transferze | Versioned send identity, fencing epoch, dispatch permits i transfer state machine |
| Race podczas transferu inbound | Routing snapshot i assignment revision przypięte na ingressie |
| Catch-all abuse i dictionary attacks | Exact D1 allowlist, generic reject, rate/size limits i alerty |
| Usunięcie ostatniego ownera | Atomowy last-owner guard |
| Stale browser cache po revocation | Tenant/mailbox cache keys, purge oraz no-store dla treści |
| Stare grants po delete | Nigdy nieużywane ponownie IDs, explicit revoke i reconciliation |
| Cloudflare state drift | Domain readiness, okresowa weryfikacja i runbook |
| Utrata danych podczas migracji | Expand/backfill/switch/contract, backup i restore test |

## 14. Zalecana kolejność pierwszych pionowych slice'ów

Etapy powyżej opisują pełne zależności. Implementację warto dostarczać w małych milestone'ach i pionowych slice'ach:

1. Foundation milestone: domknąć pozostałe bramy bieżącego etapu 1, kolejno SAFE-006 jako zależność operation-contract, SAFE-002 DoD, SAFE-003, a następnie SAFE-005, SAFE-007-011, SAFE-013 i SAFE-015; ukończone SAFE-001, SAFE-004, SAFE-012 i SAFE-014 pozostają baseline, nie nowym zakresem.
2. Migration milestone: organization bootstrap, domain ownership, role catalog, MailboxAssignment i migracja obecnego `primary`, nadal z aktywnym singletonem.
3. Security milestone: organization/mailbox gates, global-grant cleanup i adversarial tests, nadal bez drugiego mailboxa.
4. Pierwszy funkcjonalny slice: drugi mailbox tylko dla obecnego ownera, jawny URL, feature flag i switcher.
5. Shared mailbox z drugim użytkownikiem oraz rolą Viewer.
6. Staging catch-all i sender readiness przed uruchomieniem dynamicznych adresów.
7. Drugi alias do istniejącego mailboxa, receive-only, wraz z routing snapshot.
8. Stabilny address route oraz route-only reassignment między dwoma mailboxami.
9. Send identity, dispatch permits, pełny address transfer, selektor `From` i reply z ingress aliasu.
10. Personal mailbox tworzony razem z zaproszeniem pracownika.
11. Offboarding, audit UI, reconciliation i produkcyjny domain readiness.

Foundation i migration milestones mogą nie mieć UI, ale muszą mieć testy, migracje, evidence i obserwowalność. Każdy późniejszy funkcjonalny slice kończy się działającym UI, API, migracją, testami i telemetrią, zamiast pozostawiać długotrwały częściowo aktywny model bezpieczeństwa.

Każdy slice musi utrzymać ukończony układ bounded contexts, runtime roots, dependency rules i lifetimes z [Architecture Migration Guide](docs/architecture-migration-guide.md). Cofnięcie do globalnych bucketów, cross-context adapter imports albo process-global request/Workflow/AI state jest regresją architektury, nawet jeśli test funkcjonalny przechodzi.
