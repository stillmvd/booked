# Booked

Личное хранилище закладок под Windows 11. Tauri 2 + React + TypeScript, ядро на Rust,
хранилище SQLite через `rusqlite` (bundled). Контекст проекта, требования и роадмап —
в `.planning/`.

## Сборка и TLS

Сетевой запрос закладок идёт через `reqwest`. Фичи `reqwest` в `src-tauri/Cargo.toml`:
дефолтные (не отключены) плюс `gzip` и `brotli` для прозрачной распаковки ответов.

Дефолтный стек `reqwest` 0.13 — `rustls` поверх криптопровайдера `aws-lc-rs`, с
`rustls-platform-verifier` для системных корневых сертификатов. Проверено сборкой на
этой машине 21.08.2026: `cargo build --manifest-path src-tauri/Cargo.toml` завершается
кодом 0 при полном отсутствии `cmake` и NASM в `PATH` (`where cmake nasm` не находит
ничего). В дереве зависимостей — `aws-lc-sys 0.44.0`, `aws-lc-rs 1.18.0`,
`rustls 0.23.43`, `rustls-platform-verifier 0.7.0`; `aws-lc-sys` собрался без внешнего
тулчейна за счёт предсобранных объектов в самом крейте.

**Важно:** имя фичи `rustls-tls-webpki-roots`, которое встречается во внешних
источниках и черновике `FETCHING.md`, в `reqwest` 0.13.4 не существует — это фича из
линейки 0.12. Указание её в `Cargo.toml` уронит `cargo build` на разборе манифеста.

### Если дефолт всё-таки упадёт на другой машине

Лестница отступления, по возрастанию инвазивности:

1. Установить `cmake` и NASM в `PATH`.
2. Задать переменную окружения `AWS_LC_SYS_PREBUILT_NASM`, указывающую на уже собранные
   NASM-объекты, если сборка NASM недоступна, но объекты есть.
3. Отказаться от провайдера по умолчанию: `default-features = false` у `reqwest` плюс
   фича `rustls-no-provider`, и собрать собственный `rustls::ClientConfig` с нужным
   криптопровайдером вручную.

### Цена для Android v2

Дефолтный путь тянет `rustls-platform-verifier`, которому на Android нужна
инициализация через JNI, зависимость Gradle и правило ProGuard — без них приложение
падает в рантайме на первом же сетевом запросе. Запасной ход: собрать
`rustls::ClientConfig` на `webpki-roots` (без обращения к системному хранилищу
сертификатов) и передать его в `tls_backend_preconfigured`. Цена — теряются системные
и корпоративные корневые сертификаты; в обмен не нужна платформенная инициализация.

### Второй HTTP-стек не добавляется

`tauri-plugin-http` живёт на `reqwest ^0.12` и даёт в дереве два мажора `reqwest` и два
TLS-стека одновременно. В проекте ровно один HTTP-клиент — `reqwest::Client`, собранный
один раз в `setup()` и живущий в состоянии Tauri (`src-tauri/src/net.rs`).

## Маршрутизация контекста

- **Sketch findings for Booked** (design decisions, CSS patterns, visual direction) → `Skill("sketch-findings-booked")`

## Дизайн

Палитра и типографика — только из `brand/brandbook.html` («Стекло и свечение»). Свои цвета не
подбирать, единственный цветной акцент — красная лента. Техники стекла — по
`.planning/GLASS-RESEARCH.md`. Числа макета витрины — из `.planning/research/UX.md`
и утверждённых скетчей в `.planning/sketches/`.
