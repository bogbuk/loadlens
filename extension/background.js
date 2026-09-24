/* LoadLens — service worker. Клик по иконке открывает боковую панель; FAB/бейджи на странице
   DAT просят открыть её сообщением open-panel. */
"use strict";

function enablePanelOnActionClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
chrome.runtime.onInstalled.addListener(enablePanelOnActionClick);
enablePanelOnActionClick(); // и на каждом старте SW — поведение могло не сохраниться после обновления Chrome

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "open-panel" || !sender.tab) return false;
  // open() зовём СИНХРОННО в обработчике, без await до него — иначе Chrome теряет user gesture
  // клика в content-скрипте. windowId (а не tabId) — та же глобальная панель, что по иконке.
  chrome.sidePanel.open({ windowId: sender.tab.windowId })
    .then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // ответ асинхронный
});
