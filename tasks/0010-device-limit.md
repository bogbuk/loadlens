# Task: лимит устройств — защита Pro-подписки от шеринга
Date: 2026-07-20
Status: done

## Checklist
- [x] чистое правило decideDevices + юниты
- [x] таблица user_devices + колонка device_evictions
- [x] DevicesService (registerOnAuth / verifyOnRefresh)
- [x] подключение к login/register/refresh + заголовок X-Client-Id
- [x] клиент: заголовок и показ причины разлогина
- [x] админка: колонки устройств и вытеснений
### Verification
- [x] npm test
- [x] backend build + test
- [x] ручная проверка на локальной БД (вытеснение, reason, client_id_required)
- [x] commit
