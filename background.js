// background.js — Digital Whips
// Al hacer clic en el ícono de la extensión:
//  - Si la pestaña activa es una de las páginas soportadas, se envía un
//    mensaje al content script para alternar (toggle) el látigo.
//  - Si no es una página soportada, se abre la página de configuración
//    (settings.html) en una pestaña nueva.

// Debe reflejar exactamente los "matches" de content_scripts en manifest.json.
const SUPPORTED_URL_PATTERNS = [
  /^https:\/\/gemini\.google\.com\//,
  /^https:\/\/chatgpt\.com\//,
  /^https:\/\/chat\.openai\.com\//,
  /^https:\/\/grok\.com\//,
  /^https:\/\/copilot\.microsoft\.com\//,
  /^https:\/\/(www\.)?dola\.com\//,
  /^https:\/\/ecogpt\.com\//,
  /^https:\/\/(www\.)?character\.ai\//,
];

function isSupportedUrl(url) {
  if (!url) return false;
  return SUPPORTED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function openSettingsPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;

  if (!isSupportedUrl(tab.url)) {
    openSettingsPage();
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "WHIP_TOGGLE" }).catch(() => {
    // La página es soportada pero el content script no respondió (por
    // ejemplo, la pestaña se acaba de abrir y todavía está cargando).
    // Como último recurso, llevamos al usuario a la configuración en vez
    // de fallar en silencio.
    openSettingsPage();
  });
});
