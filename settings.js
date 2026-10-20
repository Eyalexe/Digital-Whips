// settings.js — Digital Whips
// Lee y guarda las preferencias del usuario en chrome.storage.local, para
// que persistan entre sesiones del navegador.

const DEFAULT_SETTINGS = {
  shakeScreenEffect: false,
  messagesEnabled: true,
  whipsYouEnabled: true,
  specialWordEnabled: false,
};

const shakeToggle = document.getElementById("shake-toggle");
const messagesToggle = document.getElementById("messages-toggle");
const whipsYouToggle = document.getElementById("whips-you-toggle");
const specialWordToggle = document.getElementById("special-word-toggle");
const statusText = document.getElementById("status-text");

let statusTimeoutId = null;
function showStatus(text) {
  statusText.textContent = text;
  statusText.classList.add("visible");
  if (statusTimeoutId) clearTimeout(statusTimeoutId);
  statusTimeoutId = setTimeout(() => {
    statusText.classList.remove("visible");
  }, 1200);
}

function loadSettings() {
  chrome.storage.local.get(DEFAULT_SETTINGS, (result) => {
    shakeToggle.checked = !!result.shakeScreenEffect;
    messagesToggle.checked = !!result.messagesEnabled;
    whipsYouToggle.checked = !!result.whipsYouEnabled;
    specialWordToggle.checked = !!result.specialWordEnabled;
  });
}

shakeToggle.addEventListener("change", () => {
  chrome.storage.local.set(
    { shakeScreenEffect: shakeToggle.checked },
    () => showStatus("Saved")
  );
});

messagesToggle.addEventListener("change", () => {
  chrome.storage.local.set(
    { messagesEnabled: messagesToggle.checked },
    () => showStatus("Saved")
  );
});

whipsYouToggle.addEventListener("change", () => {
  chrome.storage.local.set(
    { whipsYouEnabled: whipsYouToggle.checked },
    () => showStatus("Saved")
  );
});

specialWordToggle.addEventListener("change", () => {
  chrome.storage.local.set(
    { specialWordEnabled: specialWordToggle.checked },
    () => showStatus("Saved")
  );
});

loadSettings();
