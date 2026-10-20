// content.js — Digital Whips
// Orquesta todo dentro de los sitios soportados: crea el canvas overlay,
// mueve el látigo (physics.js) siguiendo al cursor, detecta el gesto de
// latigazo, dibuja el efecto de impacto e inserta/envía el mensaje
// correspondiente.

(function () {
  "use strict";

  // Evita doble inyección si el content script se vuelve a ejecutar.
  if (window.__DIGITAL_WHIPS_LOADED__) return;
  window.__DIGITAL_WHIPS_LOADED__ = true;

  // ---------------------------------------------------------------------
  // Config del gesto de latigazo
  // ---------------------------------------------------------------------
  const GESTURE_WINDOW_MS = 220; // ventana en la que buscamos el "vaivén"
  const GESTURE_COOLDOWN_MS = 600; // evita disparos repetidos
  const MIN_SPEED = 0.75; // px/ms, umbral mínimo para considerar "rápido"
  const OPPOSITE_COS_THRESHOLD = -0.3; // qué tan opuestas deben ser las direcciones
  const IMPACT_DURATION_MS = 350;
  const INTENSE_IMPACT_DURATION_MS = 480; // impacto más largo/grande con Shake Screen Effect
  const STOP_TO_SEND_DELAY_MS = 300; // espera tras cancelar antes de escribir/enviar
  const SHAKE_DURATION_MS = 420;

  // Efecto de sonido del latigazo (precargado como blob para esquivar el
  // CSP de la página; requiere el host_permission correspondiente en el
  // manifest). Si Google archiva/mueve el archivo, solo hay que actualizar
  // esta URL.
  const WHIP_SOUND_URL =
    "https://ia601409.us.archive.org/20/items/free-sound-effects/whip%20sound%20effect.mp3";

  // ---------------------------------------------------------------------
  // Configuración del usuario (chrome.storage.local, ver settings.js)
  // ---------------------------------------------------------------------
  const settings = {
    shakeScreenEffect: false,
    messagesEnabled: true,
    whipsYouEnabled: true,
    specialWordEnabled: false,
  };

  function loadSettings() {
    chrome.storage.local.get(
      {
        shakeScreenEffect: false,
        messagesEnabled: true,
        whipsYouEnabled: true,
        specialWordEnabled: false,
      },
      (result) => {
        settings.shakeScreenEffect = !!result.shakeScreenEffect;
        settings.messagesEnabled = !!result.messagesEnabled;
        settings.whipsYouEnabled = !!result.whipsYouEnabled;
        settings.specialWordEnabled = !!result.specialWordEnabled;
      }
    );
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.shakeScreenEffect) {
      settings.shakeScreenEffect = !!changes.shakeScreenEffect.newValue;
    }
    if (changes.messagesEnabled) {
      settings.messagesEnabled = !!changes.messagesEnabled.newValue;
    }
    if (changes.whipsYouEnabled) {
      settings.whipsYouEnabled = !!changes.whipsYouEnabled.newValue;
    }
    if (changes.specialWordEnabled) {
      settings.specialWordEnabled = !!changes.specialWordEnabled.newValue;
    }
  });

  loadSettings();

  // ---------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------
  let active = false;
  let canvas = null;
  let ctx = null;
  let rope = null;
  let rafId = null;
  let velocityHistory = [];
  let lastCrackTime = 0;
  let impacts = [];
  let lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let whipAudioBlobUrl = null;
  let whipAudioLoadPromise = null;
  let shakeTimeoutId = null;

  // ---------------------------------------------------------------------
  // Canvas overlay
  // ---------------------------------------------------------------------
  function createCanvas() {
    canvas = document.createElement("canvas");
    canvas.id = "__digital_whips_canvas__";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.documentElement.appendChild(canvas);
    ctx = canvas.getContext("2d");
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  // ---------------------------------------------------------------------
  // Efecto de sacudida de pantalla (solo si "Shake Screen Effect" == ON)
  // ---------------------------------------------------------------------
  function triggerScreenShake() {
    const el = document.documentElement;
    el.classList.remove("__digital_whips_shake__");
    void el.offsetWidth; // fuerza reflow para poder reiniciar la animación
    el.classList.add("__digital_whips_shake__");
    if (shakeTimeoutId) clearTimeout(shakeTimeoutId);
    shakeTimeoutId = setTimeout(() => {
      el.classList.remove("__digital_whips_shake__");
    }, SHAKE_DURATION_MS);
  }

  // ---------------------------------------------------------------------
  // Sonido del latigazo
  // ---------------------------------------------------------------------
  function loadWhipSound() {
    if (whipAudioLoadPromise) return whipAudioLoadPromise;
    whipAudioLoadPromise = fetch(WHIP_SOUND_URL)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.blob();
      })
      .then((blob) => {
        whipAudioBlobUrl = URL.createObjectURL(blob);
      })
      .catch((err) => {
        console.warn("[Digital Whips] No se pudo cargar el sonido del látigo:", err);
      });
    return whipAudioLoadPromise;
  }

  function playWhipSound() {
    if (!whipAudioBlobUrl) return;
    // Se crea una instancia nueva cada vez para permitir latigazos
    // encadenados sin que un sonido corte al anterior.
    const audio = new Audio(whipAudioBlobUrl);
    audio.volume = 0.8;
    audio.play().catch(() => {
      // Reproducción bloqueada (p. ej. sin gesto del usuario todavía);
      // se ignora en silencio.
    });
  }

  // ---------------------------------------------------------------------
  // Activar / desactivar
  // ---------------------------------------------------------------------
  function activate() {
    if (active) return;
    active = true;
    createCanvas();
    rope = new window.WhipRope(lastMouse.x, lastMouse.y);
    document.documentElement.classList.add("__digital_whips_active__");
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("resize", resizeCanvas);
    loadWhipSound();
    loop();
  }

  function deactivate() {
    if (!active) return;
    active = false;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("resize", resizeCanvas);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (canvas) {
      canvas.remove();
      canvas = null;
      ctx = null;
    }
    document.documentElement.classList.remove("__digital_whips_active__");
    if (shakeTimeoutId) {
      clearTimeout(shakeTimeoutId);
      shakeTimeoutId = null;
    }
    document.documentElement.classList.remove("__digital_whips_shake__");
    velocityHistory = [];
    impacts = [];
  }

  function toggle() {
    if (active) deactivate();
    else activate();
  }

  // ---------------------------------------------------------------------
  // Movimiento del mouse + detección del gesto (latigazo)
  // ---------------------------------------------------------------------
  function onMouseMove(e) {
    const now = performance.now();
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    // dt aproximado: usamos el tiempo entre frames de mousemove reales
    const prevT = velocityHistory.length
      ? velocityHistory[velocityHistory.length - 1].t
      : now - 16;
    const dt = Math.max(1, now - prevT);

    const vx = dx / dt;
    const vy = dy / dt;
    const speed = Math.sqrt(vx * vx + vy * vy);

    velocityHistory.push({ vx, vy, speed, t: now });
    // conserva solo la ventana reciente
    while (
      velocityHistory.length &&
      now - velocityHistory[0].t > GESTURE_WINDOW_MS
    ) {
      velocityHistory.shift();
    }

    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
    if (rope) rope.setHandle(e.clientX, e.clientY);

    detectCrack(now);
  }

  function detectCrack(now) {
    if (now - lastCrackTime < GESTURE_COOLDOWN_MS) return;
    if (velocityHistory.length < 3) return;

    const latest = velocityHistory[velocityHistory.length - 1];
    if (latest.speed < MIN_SPEED) return;

    for (let i = velocityHistory.length - 2; i >= 0; i--) {
      const sample = velocityHistory[i];
      if (sample.speed < MIN_SPEED) continue;
      const dot = sample.vx * latest.vx + sample.vy * latest.vy;
      const cos = dot / (sample.speed * latest.speed);
      if (cos < OPPOSITE_COS_THRESHOLD) {
        lastCrackTime = now;
        triggerCrack();
        return;
      }
    }
  }

  // Frases posibles cuando la IA está generando (se cancela y se envía una
  // de estas al azar) y la frase cuando está inactiva.
  const GENERATING_PHRASES = [
    "FASTER!",
    "Speed it up!",
    "FASTER FASTER FASTER!",
    "GO FASTER",
    "Work FASTER",
  ];
  const IDLE_PHRASE = "DO IT BETTER!";
  const WHIPS_YOU_PREFIX = "*Whips you*";

  // "Special Word": solo cambia estas dos frases exactas; el resto queda
  // intacto aunque la opción esté activada.
  const SPECIAL_WORD_MAP = {
    "FASTER!": "FASTER CLANKER!",
    "Speed it up!": "Speed it up CLANKER!",
  };

  function applySpecialWord(phrase) {
    return Object.prototype.hasOwnProperty.call(SPECIAL_WORD_MAP, phrase)
      ? SPECIAL_WORD_MAP[phrase]
      : phrase;
  }

  function buildWhipMessage(kind) {
    // "Messages" controla si se agrega frase; apagada, solo se envía
    // "*Whips you*".
    if (!settings.messagesEnabled) return WHIPS_YOU_PREFIX;

    let phrase;
    if (kind === "generating") {
      phrase =
        GENERATING_PHRASES[Math.floor(Math.random() * GENERATING_PHRASES.length)];
      if (settings.specialWordEnabled) phrase = applySpecialWord(phrase);
    } else {
      phrase = IDLE_PHRASE;
    }

    // "*Whips You*" apagado: solo la frase. Con "Messages" activado
    // siempre hay frase, así que nunca se envía un mensaje vacío.
    return settings.whipsYouEnabled ? WHIPS_YOU_PREFIX + " " + phrase : phrase;
  }

  function triggerCrack() {
    if (!rope) return;
    const intense = settings.shakeScreenEffect;
    const tip = rope.getTip();
    impacts.push({ x: tip.x, y: tip.y, start: performance.now(), intense });
    playWhipSound();
    if (intense) triggerScreenShake();

    const stopBtn = getStopButton();
    if (stopBtn) {
      // La IA está generando: primero se cancela esa respuesta y recién
      // después se escribe y envía el mensaje del latigazo.
      stopBtn.click();
      const message = buildWhipMessage("generating");
      setTimeout(() => sendWhipMessage(message), STOP_TO_SEND_DELAY_MS);
    } else {
      sendWhipMessage(buildWhipMessage("idle"));
    }
  }

  // ---------------------------------------------------------------------
  // Loop de animación
  // ---------------------------------------------------------------------
  function loop() {
    if (!active) return;
    rope.update();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawImpacts();
    rope.draw(ctx);
    rafId = requestAnimationFrame(loop);
  }

  function drawImpacts() {
    const now = performance.now();
    impacts = impacts.filter(
      (imp) =>
        now - imp.start <
        (imp.intense ? INTENSE_IMPACT_DURATION_MS : IMPACT_DURATION_MS)
    );
    for (const imp of impacts) {
      const duration = imp.intense
        ? INTENSE_IMPACT_DURATION_MS
        : IMPACT_DURATION_MS;
      const t = (now - imp.start) / duration; // 0 -> 1
      const baseRadius = imp.intense ? 14 : 6;
      const growth = imp.intense ? 95 : 40;
      const radius = baseRadius + t * growth;
      const alpha = 1 - t;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * (imp.intense ? 1 : 0.9)})`;
      ctx.lineWidth = (imp.intense ? 5 : 3) * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(imp.x, imp.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.6})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(imp.x, imp.y, radius * 0.6, 0, Math.PI * 2);
      ctx.stroke();

      if (imp.intense) {
        // Anillo extra rojizo para reforzar la sensación de más fuerza.
        ctx.strokeStyle = `rgba(255, 70, 70, ${alpha * 0.55})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(imp.x, imp.y, radius * 1.35, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------
  // Integración con la interfaz de Gemini
  //
  // NOTA IMPORTANTE: Gemini es una app web que Google actualiza con
  // frecuencia, así que las clases/atributos exactos del DOM pueden
  // cambiar. Las funciones de abajo intentan varios selectores de
  // respaldo. Si en algún momento dejan de funcionar, hay que abrir las
  // devtools (F12), inspeccionar el cuadro de texto y el botón de enviar,
  // y actualizar los selectores en getEditor() / getSendButton() /
  // isGenerating().
  // ---------------------------------------------------------------------
  function getEditor() {
    return (
      // Gemini
      document.querySelector('div.ql-editor[contenteditable="true"]') ||
      document.querySelector('rich-textarea [contenteditable="true"]') ||
      // ChatGPT
      document.querySelector("#prompt-textarea") ||
      document.querySelector('div[contenteditable="true"]#prompt-textarea') ||
      document.querySelector('textarea#prompt-textarea') ||
      // Grok (editor TipTap/ProseMirror)
      document.querySelector('div[contenteditable="true"].tiptap.ProseMirror') ||
      // Copilot
      document.querySelector('#userInput') ||
      // EcoGPT
      document.querySelector('div.composer-field[contenteditable="true"]') ||
      document.querySelector(
        'div[contenteditable="true"][aria-label="Mensaje"]'
      ) ||
      // Character.AI
      document.querySelector('textarea#chat-input-textarea') ||
      // Genéricos de respaldo
      document.querySelector(
        '[contenteditable="true"][aria-label*="prompt" i]'
      ) ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector("textarea")
    );
  }

  function getSendButton() {
    return (
      // Gemini
      document.querySelector('button[aria-label*="Send" i]') ||
      document.querySelector('button[aria-label*="Enviar" i]') ||
      // ChatGPT
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('#composer-submit-button') ||
      // Grok
      document.querySelector('button[aria-label="Submit"]') ||
      // Dola (id estable; se excluye la versión deshabilitada/oculta)
      document.querySelector('#flow-end-msg-send:not([disabled])') ||
      // EcoGPT
      document.querySelector('button[aria-label="Enviar mensaje"]') ||
      // Character.AI (el aria-label está duplicado entre enviar/detener en
      // este sitio, así que se identifica por el ícono SVG del botón)
      findClickableByIconPathPrefix("M3.113 6.178C2.448 4.073 4.64 2.202") ||
      // Genérico de respaldo
      document.querySelector('button[data-testid*="send" i]')
    );
  }

  // Encuentra un elemento clicable a partir del "path" de su ícono SVG.
  // Útil en sitios (como Dola) donde el botón no tiene aria-label ni
  // data-testid, y su clase CSS trae un sufijo tipo hash que puede cambiar
  // entre builds — el dibujo del ícono en sí es mucho más estable.
  function findClickableByIconPathPrefix(prefix) {
    const paths = document.querySelectorAll("svg path[d]");
    for (const p of paths) {
      const d = p.getAttribute("d") || "";
      if (d.startsWith(prefix)) {
        const clickable = p.closest(
          'button, [role="button"], [class*="cursor-pointer"]'
        );
        if (clickable) return clickable;
      }
    }
    return null;
  }

  // Botón que cancela/detiene la generación en curso.
  function getStopButton() {
    const candidate =
      // Grok
      document.querySelector('button[aria-label="Stop model response"]') ||
      // Copilot (confirmado): data-testid es estable sin importar el idioma
      document.querySelector('button[data-testid="stop-button"]') ||
      document.querySelector('button[aria-label*="Interrumpir" i]') ||
      document.querySelector('button[aria-label*="Interrupt" i]') ||
      // EcoGPT
      document.querySelector('button[aria-label="Detener la generación"]') ||
      // Character.AI (mismo motivo que en enviar: se usa el ícono)
      findClickableByIconPathPrefix("M16.839 3H7.16c-.527 0-.981") ||
      // Dola: sin aria-label/data-testid; se identifica por su ícono
      // (círculo con cuadrado redondeado adentro) o por el prefijo de clase
      // "break-btn-" (el sufijo tras el guion es un hash que puede variar).
      document.querySelector('div[class*="break-btn"]') ||
      findClickableByIconPathPrefix("M12 0.5C18.3513") ||
      // Genéricos (Gemini, ChatGPT y respaldo)
      document.querySelector('button[aria-label*="Stop" i]') ||
      document.querySelector('button[aria-label*="Detener" i]') ||
      document.querySelector('button[aria-label*="Cancel" i]') ||
      document.querySelector('button[aria-label*="Cancelar" i]');
    if (candidate && candidate.offsetParent !== null) return candidate;
    return null;
  }

  function isGenerating() {
    return !!getStopButton();
  }

  function setContentEditableText(editor, text) {
    editor.focus();
    document.execCommand("selectAll", false, null);
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted || editor.textContent.trim() !== text) {
      // Respaldo para editores tipo ProseMirror/TipTap (p. ej. Grok), que
      // esperan el contenido envuelto en un <p> para procesarlo bien.
      const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      editor.innerHTML = "<p>" + escaped + "</p>";
      editor.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        })
      );
    }
  }

  function setTextareaText(editor, text) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;
    nativeSetter.call(editor, text);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function submitEditor(editor) {
    const enterDown = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    });
    editor.dispatchEvent(enterDown);

    // Respaldo: si tras el Enter el cuadro sigue con texto, clickeamos enviar.
    setTimeout(() => {
      const stillHasText =
        editor.tagName === "TEXTAREA"
          ? editor.value.trim().length > 0
          : editor.textContent.trim().length > 0;
      if (stillHasText) {
        const btn = getSendButton();
        if (btn && !btn.disabled) btn.click();
      }
    }, 60);
  }

  function sendWhipMessage(text) {
    const editor = getEditor();
    if (!editor) {
      console.warn("[Digital Whips] No se encontró el cuadro de texto del chat.");
      return;
    }
    if (editor.tagName === "TEXTAREA") {
      setTextareaText(editor, text);
    } else {
      setContentEditableText(editor, text);
    }
    setTimeout(() => submitEditor(editor), 30);
  }

  // ---------------------------------------------------------------------
  // Mensajería con background.js (toggle por ícono de la extensión)
  // ---------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "WHIP_TOGGLE") {
      toggle();
    }
  });
})();
