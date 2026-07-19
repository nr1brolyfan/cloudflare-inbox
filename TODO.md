# Cloudflare Inbox v1

Jedna skrzynka z aliasami, auth, uprawnieniami na poziomie mailbox/folder, inbound, organizacja i wyszukiwanie, reguły, bezpieczne renderowanie, outbound z undo send oraz AI ograniczone do odczytu i draftów.

## Status

- Ostatnia aktualizacja: 2026-07-19
- Postęp zadań: **54/109 (50%)**
- Ukończone etapy: **3/11**
- Aktualny etap: **6. Inbound email**
- Aktualne zadanie: **Zapis raw MIME do R2 przed parsowaniem**

| #   | Etap                                  | Status      | Postęp |
| --- | ------------------------------------- | ----------- | ------ |
| 1   | Toolchain i zależności                | DONE        | 7/7    |
| 2   | Split Worker i infrastruktura Alchemy | IN PROGRESS | 11/13  |
| 3   | Effect-auth i sesje                   | IN PROGRESS | 15/20  |
| 4   | Permissions i control plane           | DONE        | 10/10  |
| 5   | MailboxDO i domena pocztowa           | DONE        | 9/9    |
| 6   | Inbound email                         | CURRENT     | 2/9    |
| 7   | Inbox UI i bezpieczne renderowanie    | TODO        | 0/9    |
| 8   | Reguły automatyczne                   | TODO        | 0/6    |
| 9   | Drafty i outbound                     | TODO        | 0/9    |
| 10  | AI                                    | TODO        | 0/6    |
| 11  | Hardening i produkcja                 | TODO        | 0/11   |

### Zasady aktualizacji

- `[x]` oznacza wdrożone i zweryfikowane zadanie.
- `[ ]` oznacza zadanie oczekujące; nie zaznaczamy pracy rozpoczętej jako ukończonej.
- Tylko jeden etap może mieć status `CURRENT`.
- Po zmianie checkboxów aktualizujemy tabelę, licznik globalny i datę.
- Etap otrzymuje `DONE` dopiero po zamknięciu wszystkich jego checkboxów.

## 1. Toolchain i zależności

- [x] Zachować pojedynczy projekt bez przedwczesnego monorepo.
- [x] Przejść na Bun i commitować `bun.lock`.
- [x] Przypiąć `@effect-auth/core@0.1.0-alpha.19`.
- [x] Przypiąć kompatybilne Effect, Effect-QB i Alchemy beta.
- [x] Dodać aktualne typy Cloudflare Workers.
- [x] Zapewnić czysty build, typecheck, test, Oxlint i Oxfmt check.
- [x] Zweryfikować minimalny `alchemy dev` lokalnym smoke testem.

## 2. Split Worker i infrastruktura Alchemy

- [x] Utworzyć publiczny TanStack Start Website Worker.
- [x] Utworzyć Effect Backend Worker i service binding `BACKEND`.
- [x] Wyłączyć publiczny URL Backend Workera (`url: false`).
- [x] Utworzyć D1 control plane z migracjami zarządzanymi przez Alchemy.
- [x] Utworzyć prywatny bucket R2 na raw messages i attachmenty.
- [x] Podłączyć effect-auth rate-limit Durable Object.
- [x] Zadeklarować produkcyjny Cloudflare `send_email` binding dla auth.
- [x] Dodać konfigurację originu, nadawcy i sekretów auth per environment.
- [x] Zapewnić stabilne porty i lokalny graf zasobów z local Alchemy state.
- [x] Włączyć bazowe Workers Logs, native traces i lokalny OTLP do Motel.
- [x] Utworzyć i podłączyć `MailboxDO`.
- [ ] Utworzyć zasoby Cloudflare Workflows dla inbound/outbound.
- [ ] Dodać Email Routing handler i mailbox sending bindings.

## 3. Effect-auth i sesje

- [x] Podłączyć `D1EffectQbSqliteAuthStorageLive` do control plane D1.
- [x] Generować i commitować aktualne `authStorageMigrations` dla D1.
- [x] Wystawić pełny Core Auth HTTP API.
- [x] Dodać same-origin proxy `/auth/*` przez Website Worker.
- [x] Wymusić origin policy i zaufane Cloudflare proxy metadata.
- [x] Podłączyć trwałe standardowe rate limits przez Durable Object.
- [x] Obsłużyć bezpieczne cookies, current session i logout.
- [x] Dodać email OTP i odrzucać caller-provided OTP secret.
- [x] Dodać magic link z jednorazową weryfikacją.
- [x] Dodać password sign-in/reset i minimum 12 znaków dla nowych haseł.
- [x] Zbudować responsywny Auth UI dla magic link, OTP i password sign-in.
- [x] Dodać completion pages dla magic link, resetu i email verification.
- [x] Zapisywać wiadomości auth w D1 `DevEmailStore` i wystawić dev inbox.
- [x] Użyć Cloudflare Email Sending jako transportu produkcyjnego.
- [x] Usunąć bearer credentials z query stringów auth completion links.
- [ ] Domknąć password sign-up wraz z identity API i wysłaniem verification.
- [ ] Dodać passkey jako silny faktor.
- [ ] Dodać recovery codes.
- [ ] Dodać step-up dla operacji wrażliwych.
- [ ] Dodać harmonogram czyszczenia wygasłych sessions i challenges.

## 4. Permissions i control plane

- [x] Zaprojektować migrację D1 dla mailbox registry i user preferences.
- [x] Zdefiniować permissions mailbox/folder/message/draft/rule/attachment/export.
- [x] Zdefiniować role `owner`, `manager`, `editor`, `viewer`.
- [x] Zdefiniować scopes `mailbox:{id}` i `folder:{id}`.
- [x] Podłączyć `PermissionAdministration`.
- [x] Podłączyć `PermissionsFromStoreLive` do D1.
- [x] Dostarczać zaufany `CurrentPrincipal` z bieżącej sesji.
- [x] Zaimplementować aplikacyjny `MailAuthorization` dla hierarchii zasobów.
- [x] Dodać owner bootstrap oraz transactional authorization recheck.
- [x] Dodać pierwsze chronione server functions i testy odmowy dostępu.

## 5. MailboxDO i domena pocztowa

- [x] Zdefiniować Effect schemas i publiczne kontrakty domenowe.
- [x] Zdefiniować typed errors oraz statusy inbound/outbound.
- [x] Utworzyć SQLite-backed Durable Object per logiczny mailbox.
- [x] Dodać wersjonowane migracje SQLite MailboxDO.
- [x] Zdefiniować port repozytorium i adapter Durable Object SQLite.
- [x] Zaimplementować folders i labels.
- [x] Zaimplementować messages, threads, drafts i outbound deliveries.
- [x] Dodać indeksy FTS5 i spójne aktualizacje indeksu.
- [x] Zapewnić atomowe, wersjonowane i idempotentne mutacje.

## 6. Inbound email

- [x] Dodać Cloudflare Email Routing handler.
- [x] Mapować mailbox po SMTP envelope recipient, nie po nagłówku `To`.
- [ ] CURRENT Zapisywać raw MIME do R2 przed parsowaniem.
- [ ] Uruchamiać trwały inbound Workflow.
- [ ] Parsować MIME przez `postal-mime`.
- [ ] Ekstrahować attachmenty i CID do R2.
- [ ] Obsłużyć deduplikację oraz idempotentny commit w MailboxDO.
- [ ] Obsłużyć retry, failure states i częściowe awarie.
- [ ] Dodać bezpieczny replay z raw MIME w R2.

## 7. Inbox UI i bezpieczne renderowanie

- [ ] Zbudować responsywny mailbox shell.
- [ ] Dodać nawigację folderów i labels.
- [ ] Dodać listę wiadomości i widok wątku.
- [ ] Dodać search, filtry i paginację.
- [ ] Dodać read, star, archive i trash.
- [ ] Egzekwować autoryzację i stany odmowy w server functions.
- [ ] Renderować HTML wyłącznie w sandboxie z restrykcyjnym CSP.
- [ ] Blokować remote images oraz bezpiecznie obsługiwać links i CID.
- [ ] Dodać loading, empty, error i optimistic update states.

## 8. Reguły automatyczne

- [ ] Zdefiniować model reguł z `priority` i warunkami.
- [ ] Zaimplementować deterministyczną ewaluację.
- [ ] Dodać akcje folder, label, read i star.
- [ ] Obsłużyć `stopProcessing`.
- [ ] Zapisywać idempotentną historię zastosowań.
- [ ] Uruchamiać reguły AI asynchronicznie, bez blokowania inboundu.

## 9. Drafty i outbound

- [ ] Zbudować draft editor.
- [ ] Dodać attachment upload reservations.
- [ ] Tworzyć immutable send snapshot.
- [ ] Planować wysyłkę alarmem MailboxDO.
- [ ] Dodać okno undo send.
- [ ] Podłączyć Cloudflare Email Sending dla mailboxa.
- [ ] Obsłużyć statusy `scheduled`, `sending`, `accepted`, `failed`, `indeterminate`.
- [ ] Zapewnić idempotency i retry bez podwójnej wysyłki.
- [ ] Dodać UX błędów i potwierdzenia dostarczenia do providera.

## 10. AI

- [ ] Podłączyć Workers AI.
- [ ] Zbudować autoryzowaną warstwę narzędzi AI.
- [ ] Dodać narzędzia read, search i thread.
- [ ] Dodać `createDraft` bez autonomicznego send.
- [ ] Wymagać jawnej akcji użytkownika przed wysłaniem.
- [ ] Dodać limity, audit i bezpieczne mapowanie danych wejściowych.

## 11. Hardening i produkcja

- [ ] Dodać reconciliation jobs.
- [ ] Rozszerzyć observability o Workflows, Durable Objects, custom spans, alerty i eksport.
- [ ] Dodać administracyjny audit trail.
- [ ] Dodać backup danych.
- [ ] Dodać eksport mailboxa.
- [ ] Spisać recovery runbook.
- [ ] Dodać CI/CD z kontrolą migracji i środowisk.
- [ ] Skonfigurować DNS, SPF, DKIM i DMARC.
- [ ] Przetestować częściowe awarie i retry.
- [ ] Przetestować dostarczalność na Gmailu i Outlooku.
- [ ] Przejść checklistę bezpieczeństwa i produkcyjnego uruchomienia.

## Poza v1

- Invitation i AccessGrant z effect-auth.
- Share links.
- API keys i MCP.
- Per-message ACL; v1 kończy się na mailbox/folder scopes.

## Uwagi wersji

- Implementacja używa `@effect-auth/core@0.1.0-alpha.19` i peer versions z jego manifestu.
- Strony Installation i Package Exports mogą nadal wymieniać alpha.17; źródłem prawdy są manifest pakietu, publiczne exports i lockfile repozytorium.
