Przyczyna: Cloudflare Workers ma twardy limit 100000 iteracji PBKDF2, a aplikacja wymagała 210000. Oba API, Node Crypto i Web Crypto, trafiały na ten sam limit. Rozwiązanie:

- Hasła używają teraz scrypt z parametrami OWASP.
- Enrollment zwrócił produkcyjnie 201.
- Automatyczny password step-up zwrócił 200.
- W D1 istnieje dokładnie jeden credential w oczekiwanym formacie scrypt.

---

- Wylogowuje mnie co chwile
- Wyslany email jest forever w scheduled nawet jak dawno dotarl do odbiorcy, cos z tym trzeba zrobic
- Jeden z toastów po wysłanym emailu wisi indefinitely (chyba ten w ktorym mozna kliknac przycisk sprawdzic status maila czy cos)
- Jak działa nasz primary inbox? Czy to jest jeden adres email, czy bardziej wszystkie pod tą domeną? Bo w UI nie widze naszego adresu email, tylko session id lub napis "Primary mailbox". I jak wysłałem emaila z naszej aplikacji w prod na moj inny adres gmail, to poprawnie wysłało ją. Wysłało ją z szymon@szymondlugolecki.com, ale jak probowalem odpisać na tego emaila to wyskoczyło

Mail Delivery Subsystem <mailer-daemon@googlemail.com> 10:53 PM (11 minutes ago) to me

Error Icon Address not found Your message wasn't delivered to szymon@szymondlugolecki.com because the address couldn't be found, or is unable to receive mail. The response from the remote server was: 550 5.1.1 Address does not exist. mhHhoSOZpvIs

To część mojego prod env btw: PUBLIC_ORIGIN=https://mail.szymondlugolecki.com AUTH_EMAIL_FROM=auth@szymondlugolecki.com MAILBOX_BOOTSTRAP_OWNER_EMAIL_ALLOWLIST=["szymon.dlugolecki77@gmail.com"] MAILBOX_INITIAL_ADDRESS=szymon@szymondlugolecki.com MAILBOX_ARCHIVE_RECIPIENT=szymon.dlugolecki77@gmail.com

- Nie powinnismy musiec najpierw zapisac jako draft zeby wyslac, niech jako draft sie zapisuje automatycznie, jak np. dokument w Word że z debouncem po keystrokeu czy coś w tym stylu.
- Poprawmy routing bo jest zjebany z search params, zamiast jakoś normalnie z pathami
