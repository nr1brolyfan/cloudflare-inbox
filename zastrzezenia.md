Przyczyna: Cloudflare Workers ma twardy limit 100000 iteracji PBKDF2, a aplikacja wymagała 210000. Oba API, Node Crypto i Web Crypto, trafiały na ten sam limit. Rozwiązanie:

- Hasła używają teraz scrypt z parametrami OWASP.
- Enrollment zwrócił produkcyjnie 201.
- Automatyczny password step-up zwrócił 200.
- W D1 istnieje dokładnie jeden credential w oczekiwanym formacie scrypt.

---

- Nie powinnismy musiec najpierw zapisac jako draft zeby wyslac, niech jako draft sie zapisuje automatycznie, jak np. dokument w Word że z debouncem po keystrokeu czy coś w tym stylu.
