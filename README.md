# infinita-tenders

Агент за обществени поръчки на **Infinita OOD** — автоматизира откриването, класификацията и подготовката на оферти за медицинско оборудване.

## Защо

Обществените поръчки са 80% рутина: следиш портал → четеш спецификации → проверяваш дали имаш подходящ продукт → подготвяш оферта → следиш срокове. Този проект поема рутината; човек влиза само на ключовите решения и финалното подаване (което изисква **КЕП** в ЦАИС ЕОП → остава ръчно).

## Архитектура — конвейер от 4 агента

```
[Cron 07:00]
   │
   ▼
1. DISCOVERY  → TED API търси по 10 CPV кода → дедупликация → db (статус NEW)
   ▼
2. CLASSIFIER → Claude чете спецификацията + мач срещу каталога → score → RELEVANT/SKIP
   ▼
3. DOCUMENTER → за RELEVANT: чернова оферта + таблица за съответствие   (Фаза 3)
   ▼
4. DEADLINES  → напомняния T-7/T-3/T-1 през Resend                       (Фаза 4)
```

## Източници на поръчки

| Източник | Статус | Роля |
|---|---|---|
| **TED API** (`sources/ted.js`) | ✅ работи | Основен поток + готови BG PDF/XML документи |
| data.egov.bg РОП (`sources/rop.js`) | заготовка | Под-прагови BG поръчки |
| app.eop.bg скрапер (`sources/eop.js`) | заготовка | Пълно досие, само по нужда |

TED Search API е официален и **не изисква ключ**. По-широкият CPV код включва под-кодовете си.

## CPV кодове (изведени от Odoo каталога, 2026-06-29)

| CPV | Описание | Ваши линии |
|---|---|---|
| 33110000 | Образна диагностика | Ехографи, трансдюсери |
| 33120000 | Записващи изследвания | ЕКГ, фетални монитори |
| 33124100 | Диагностични/лаб. апарати | PCR, биохимия, хематология |
| 33130000 | Дентални | Дентална медицина |
| 33140000 | Консумативи | Болнични консумативи |
| 33160000 | Хирургия/ендоскопия | Електроножове, лапароскопия |
| 33170000 | Анестезия и реанимация | Анестезиологични машини |
| 33190000 | Разни мед. изделия | Отоскопи, аспиратори |
| 33192000 | Мед. обзавеждане | Операционни лампи/маси |
| 33195000 | Мониторинг на пациенти | Пациентни монитори |

Списъкът се редактира в `src/config/cpv.js`. Ветеринарната линия ползва същите кодове.

## Достъп и работа (как се пуска)

Приложението е **2 части**: backend (API на :4010) + frontend (дашборд на :5173). Трябват **2 терминала**.

```bash
# Терминал 1 — backend
cd backend
cp .env.example .env       # TED работи без ключ; добави ANTHROPIC_API_KEY за classify/document
npm install
npm start                  # API на http://localhost:4010

# Терминал 2 — frontend (дашбордът)
cd frontend
npm install
npm run dev                # отвори http://localhost:5173
```

➡️ **Отвори http://localhost:5173** в браузъра — това е дашбордът.

### Работа от дашборда
- **Табове**: Нови / Релевантни / С чернова / Пропуснати — фунията от поръчки.
- **Бутони горе**: „Открий" (нов TED скан) · „Класифицирай" (оценка с Claude) · „Чернови" (генерира предложения).
- **🔔 Банер**: поръчки със срок до 14 дни.
- **📄 Досие**: отваря пълния BG PDF в TED. **📝 Чернова**: преглежда генерираното предложение.

### CLI (без дашборд)
```bash
cd backend
npm run discover          # само откриване (без ключове)
npm run classify          # оценка (нужен ANTHROPIC_API_KEY)
npm run document          # чернови за релевантните
npm run pipeline          # пълен цикъл discover→classify→document→deadlines
npm run cron              # дневен конвейер 07:00 (остави го да върви)
npm run classify:dry      # виж prompt-а без ключ
npm run export-catalog    # презареди каталога от Odoo TEST
```

### Email напомняния (по избор)
Добави `RESEND_API_KEY` + `ALERT_EMAIL` в `backend/.env` → `deadlines` праща дневно резюме.

## API

- `GET /api/tenders?status=NEW|RELEVANT|SKIP`
- `GET /api/deadlines?days=7`
- `GET /api/runs`
- `POST /api/discover` · `POST /api/classify`

## Деплой (Railway — 2 услуги)

Repo: `IVUSsky/infinita-tenders` (private). Същият модел като Skyrent/infinita-logistic.

**Backend услуга** (Root Directory = `backend`):
- Build/Start идват от `backend/railway.toml` (`npm install` → `npm start`).
- Env променливи: `ANTHROPIC_API_KEY`, `ENABLE_CRON=true`, `CRON_SCHEDULE=0 7 * * *`, по избор `RESEND_API_KEY`+`ALERT_EMAIL`.
- **Прикачи Volume** на `/data` и сложи `DB_PATH=/data/db.json`, `DRAFTS_DIR=/data/drafts` — иначе данните се губят при всеки деплой.
- `data/catalog.json` се качва в repo-то (нужен на Railway); презареждай го локално с `npm run export-catalog` и push.

**Frontend услуга** (Root Directory = `frontend`):
- Build: `npm install --include=dev && npm run build` → Start: `serve -s dist`.
- Env: `VITE_API_URL` = публичния URL на backend услугата.

> Бележка: подаването на оферти остава ръчно (КЕП в ЦАИС ЕОП) — деплоят автоматизира само откриване/класификация/чернови/напомняния.

## Пътна карта

- [x] Фаза 0 — валидиран източник (TED)
- [x] Фаза 1 — Discovery агент + db + CLI/API
- [x] Фаза 2 — Classifier: реален каталог от Odoo + описание от TED + Claude scoring
- [x] Фаза 3 — Documenter: чернови (таблица за съответствие + предложение) в data/drafts/
- [x] Фаза 4 — Deadlines (Resend) + React дашборд
- [ ] Бъдещо — docx export на черновите; data.egov.bg РОП адаптер (под-прагови); деплой (Railway)
