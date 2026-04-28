# Teplovmeste Booking MVP

Узкий MVP-модуль онлайн-записи для проекта "ТеплоВместе".

## Что внутри

- публичная страница записи
- простая внутренняя админка
- серверная защита от двойного бронирования
- Postgres/Supabase для продакшена
- SQLite fallback для локальной разработки и тестов
- email-уведомления через Resend
- Render-ready конфиг
- GitHub Actions CI

## Структура

- `server.js` — HTTP-сервер
- `src/` — бизнес-логика, конфиг, БД и email
- `tests/` — критические сценарии
- `render.yaml` — деплой на Render
- `supabase/migrations/` — SQL для Supabase/Postgres
- `.github/workflows/ci.yml` — CI для GitHub

## Локальный запуск

1. Установить зависимости:

```bash
npm install
```

2. Запустить приложение:

```bash
npm start
```

По умолчанию локально используется SQLite и автоматически подмешиваются demo-данные.

Приложение будет доступно на [http://localhost:3000](http://localhost:3000).

## Запуск в подпути сайта

Если модуль размещается внутри существующего сайта, а не на отдельном поддомене:

```bash
BASE_PATH=/booking npm start
```

Тогда:

- публичная страница будет на `/booking`
- админка будет на `/booking/admin`

## Тесты

```bash
npm test
```

## Подготовка к GitHub

Перед пушем:

1. Скопировать `.env.example` в `.env` и заполнить локальные значения.
2. Не коммитить `.env`, `node_modules/`, `data/`, архивы и временные файлы.
3. Убедиться, что проходит:

```bash
npm test
```

GitHub Actions уже настроен и будет запускать тесты на `push` и `pull_request`.

## Supabase

1. Создать проект в Supabase.
2. Взять `DATABASE_URL`.
3. Использовать connection string с SSL.
4. Применить схему:

```bash
npm run migrate
```

Альтернатива: выполнить SQL из `supabase/migrations/20260427_init_booking_mvp.sql` вручную в SQL Editor.

Если нужны demo-данные:

```bash
npm run seed:demo
```

Важно:

- для продакшена demo-seed по умолчанию выключен
- включать `AUTO_SEED_DEMO_DATA=true` на проде не рекомендуется

## Render

В репозитории уже есть `render.yaml`.

Минимальный сценарий:

1. Залить проект на GitHub.
2. В Render создать сервис из репозитория.
3. Render подхватит `render.yaml`.
4. В настройках переменных окружения указать:
   - `DATABASE_URL`
   - `ADMIN_EMAIL`
   - `ADMIN_BASIC_AUTH_USER`
   - `ADMIN_BASIC_AUTH_PASS`
   - `RESEND_API_KEY`
   - `RESEND_FROM`
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_SECURE`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `SMTP_FROM`
5. Если модуль нужен в подпути сайта, дополнительно задать `BASE_PATH=/booking`.

Render использует:

- `buildCommand: npm install`
- `preDeployCommand: npm run migrate`
- `startCommand: npm start`
- `healthCheckPath: /health`

## Переменные окружения

См. `.env.example`.

Основные:

- `PORT`
- `BASE_PATH`
- `DATABASE_URL`
- `DATABASE_SSL`
- `DATABASE_SSL_REJECT_UNAUTHORIZED`
- `AUTO_SEED_DEMO_DATA`
- `ADMIN_EMAIL`
- `ADMIN_BASIC_AUTH_USER`
- `ADMIN_BASIC_AUTH_PASS`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `BOOKING_SUCCESS_MESSAGE`

## Email

Основной продакшен-вариант: Resend.

Рекомендуемый набор:

- `ADMIN_EMAIL=support@teplovmeste.com`
- `RESEND_FROM=support@teplovmeste.com`
- `RESEND_API_KEY=...`

SMTP и `sendmail` оставлены как fallback.

Если email-канал не настроен:

- бронь все равно создается
- ошибка логируется в `data/email-errors.log` локально
- API возвращает успешную бронь с флагом ошибки уведомления

## Что еще не закрыто

- production-rate-limiting
- клиентские email-уведомления
- оплата
- интеграции с календарями
