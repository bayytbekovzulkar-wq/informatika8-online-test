# Пошаговая инструкция развёртывания «Informatika 8 — Online Test» на Cloudflare

Платформа разворачивается целиком внутри экосистемы **Cloudflare Pages + Cloudflare Workers (Pages Functions) + Cloudflare D1** без VPS, PHP, MySQL и Node.js-сервера. Все функции работают на бесплатном тарифе Cloudflare Free.

---

## Шаг 1. Подготовка репозитория

1. Загрузите содержимое папки `informatika8-online-test` в новый репозиторий на **GitHub** или **GitLab**.
2. Убедитесь, что файл `.dev.vars` не попал в репозиторий (он уже добавлен в `.gitignore`).

---

## Шаг 2. Создание базы данных Cloudflare D1

### Вариант А — Через Cloudflare Dashboard (веб-интерфейс)
1. Войдите в [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. В левом меню откройте **Storage & Databases → D1 SQL Database**.
3. Нажмите **Create**.
4. Введите имя базы данных: `informatika8-db` и выберите ближайший регион (например, **Eastern Europe** или **Asia Pacific**).
5. Нажмите **Create**.
6. Скопируйте **Database ID** (UUID) созданной базы и впишите его в `wrangler.toml` вместо `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

### Вариант Б — Через терминал (Wrangler CLI)
```bash
npm install
npx wrangler login
npx wrangler d1 create informatika8-db
```
Скопируйте `database_id` из вывода команды и вставьте в `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "informatika8-db"
database_id = "ваш-uuid-из-cloudflare"
```

---

## Шаг 3. Выполнение SQL-миграций (создание таблиц и учебной программы)

### Вариант А — Через терминал (рекомендуется)
Выполните обе миграции в удалённой базе D1:
```bash
npx wrangler d1 execute informatika8-db --remote --file=./migrations/0001_init.sql
npx wrangler d1 execute informatika8-db --remote --file=./migrations/0002_seed_curriculum.sql
```

### Вариант Б — Через Cloudflare Dashboard (без терминала)
1. Откройте **Storage & Databases → D1 SQL Database → informatika8-db → Console**.
2. Откройте файл `migrations/0001_init.sql`, скопируйте его содержимое в поле Console и нажмите **Execute**.
3. Затем скопируйте содержимое `migrations/0002_seed_curriculum.sql` и нажмите **Execute**.
4. Проверьте вкладку **Tables** — должны появиться таблицы `teachers`, `classes`, `students`, `topics`, `tests`, `questions`, `answers`, `test_attempts`, `student_answers`, `settings`, `retake_permissions`.

---

## Шаг 4. Публикация проекта через Cloudflare Dashboard (Pages)

1. В Cloudflare Dashboard откройте **Workers & Pages → Create → Pages → Connect to Git**.
2. Выберите ваш репозиторий `informatika8-online-test`.
3. Настройте параметры сборки:
   - **Project name**: `informatika8-online-test`
   - **Production branch**: `main`
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Нажмите **Save and Deploy**.

Cloudflare Pages автоматически соберёт React-фронтенд из `src/` и развернёт серверный API из папки `functions/api/[[path]].js` как Cloudflare Worker на том же домене (`https://ваш-проект.pages.dev`).

---

## Шаг 5. Подключение D1 Database к проекту (D1 Binding)

1. Откройте созданный проект в **Workers & Pages → informatika8-online-test**.
2. Перейдите в **Settings → Bindings** (или **Settings → Functions → D1 database bindings**).
3. Нажмите **Add** → выберите **D1 database**:
   - **Variable name**: `DB` *(строго заглавными буквами!)*
   - **D1 database**: выберите `informatika8-db`
4. Сохраните привязку для **Production** (и при необходимости для **Preview**).

---

## Шаг 6. Настройка переменных окружения (Environment Variables)

Перейдите в **Settings → Variables and Secrets** и добавьте переменные для **Production**:

| Переменная | Тип | Обязательно | Описание |
| :--- | :--- | :--- | :--- |
| `SESSION_SECRET` | **Secret (Encrypt)** | **Да** | Случайная строка от 32 символов для подписи HttpOnly сессий. Сгенерировать можно командой: `openssl rand -hex 32` |
| `INITIAL_SETUP_TOKEN` | **Secret (Encrypt)** | Опционально | Секретный код для защиты создания первого аккаунта учителя. Если не задан, регистрация первого учителя открыта только пока таблица `teachers` пуста. |
| `SESSION_TTL_HOURS` | Text | Опционально | Длительность сессии в часах (по умолчанию `8`). |
| `TURNSTILE_SITE_KEY` | Text | Опционально | Публичный Site Key из **Cloudflare Turnstile** (если нужна защита от ботов). |
| `TURNSTILE_SECRET_KEY` | **Secret (Encrypt)** | Опционально | Секретный ключ **Cloudflare Turnstile**. |

> После добавления привязки `DB` и переменных окружения откройте вкладку **Deployments** и нажмите **Retry deployment** на последнем деплое, чтобы новые настройки вступили в силу.

---

## Шаг 7. Подключение Cloudflare Turnstile (опционально)

1. В Cloudflare Dashboard перейдите в раздел **Turnstile → Add widget**.
2. Укажите ваш домен (например, `informatika8-online-test.pages.dev`).
3. Выберите режим **Managed** и создайте виджет.
4. Скопируйте **Site Key** → `TURNSTILE_SITE_KEY` и **Secret Key** → `TURNSTILE_SECRET_KEY` в настройки Pages.
5. Сделайте повторный деплой — виджет автоматически появится на формах входа ученика и учителя, а сервер будет проверять токен через Cloudflare API.

---

## Шаг 8. Создание первого аккаунта учителя

### Способ 1 — Через веб-интерфейс (самый простой)
1. Откройте ваш опубликованный сайт и нажмите **«Кабинет учителя»** (или перейдите по адресу `https://ваш-сайт.pages.dev/teacher`).
2. Поскольку таблица `teachers` пуста, система автоматически откроет форму **«Создание первого аккаунта учителя»**.
3. Введите:
   - **Логин** (например, `admin` или `osipova`)
   - **ФИО учителя** (например, `Н. Н. Осипова`)
   - **Надёжный пароль** (минимум 6 символов; сохраняется на сервере в виде хеша PBKDF2-SHA256)
   - Если вы задавали `INITIAL_SETUP_TOKEN`, введите его.
4. Нажмите **«Создать аккаунт и войти»**. После создания первого учителя форма первичной настройки автоматически блокируется навсегда.

### Способ 2 — Проверка работоспособности после деплоя
1. Проверьте API здоровья: откройте `https://ваш-сайт.pages.dev/api/health` — должен вернуться ответ `{"status":"ok","db":true}`.
2. В кабинете учителя откройте вкладку **«Классы»** — там уже доступен демонстрационный класс **8-А** с кодом **`INFO8A`** (вы можете переименовать его или создать свои классы).
3. Откройте вкладку **«Ученикам»**, введите имя, фамилию и код **`INFO8A`**, и пройдите любой из 4 готовых тестов по информатике 8 класса.
