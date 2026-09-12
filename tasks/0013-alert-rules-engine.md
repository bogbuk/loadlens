# Task: движок правил Telegram-алертов
Date: 2026-09-12
Status: done

## Checklist
- [x] LLRULES.normalize / normKeyword / active + тесты
- [x] LLRULES.matches / select + тесты
- [x] LLALERT: {load, rule} + ruleName
- [x] backend: NotifyItemDto.ruleName + formatAlertMessage
- [x] content.js + manifest: отбор через LLRULES
- [x] popup: список правил + редактор
- [x] CLAUDE.md
### Verification
- [x] npm test (корень) + backend npm test — 98 / 177
- [x] build backend — OK
- [x] commit & push — push: controller after final review
