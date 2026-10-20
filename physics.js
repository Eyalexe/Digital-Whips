// physics.js
// Simulación de cuerda tipo "verlet integration" para el látigo, más el
// renderizado del contorno ahusado (grueso en el mango, fino en la punta)
// sobre un <canvas>. No depende de content.js: expone la clase WhipRope en
// window.WhipRope para que content.js la use.

(function () {
  "use strict";

  const NUM_POINTS = 17;
  const HANDLE_POINTS = 3; // índices 0,1,2 forman el mango rígido (empuñadura)
  const SEGMENT_LENGTH = 18; // separación en reposo entre puntos, en px
  const GRAVITY = 0.55;
  const DAMPING = 0.965; // 1 = sin fricción, <1 = pierde energía con el tiempo
  const CONSTRAINT_ITERATIONS = 6;

  // Colores tomados de la imagen de referencia (mango azul marino, cuerda negra).
  const COLOR_CORD = "#0d0d10";
  const COLOR_HANDLE_MAIN = "#2c3c62";
  const COLOR_HANDLE_DARK = "#10182e";
  const COLOR_HANDLE_WRAP = "#18213e";

  // Ancho de la cuerda (sin contar el mango, que se dibuja aparte): gruesa
  // donde se une al mango, se ahúsa hacia la punta.
  function cordWidthAt(cordT) {
    const start = 8.5;
    const tip = 1.2;
    const eased = Math.pow(cordT, 1.4);
    return start + (tip - start) * eased;
  }

  class WhipRope {
    constructor(startX, startY) {
      this.points = [];
      for (let i = 0; i < NUM_POINTS; i++) {
        this.points.push({
          x: startX,
          y: startY + i * 2,
          oldX: startX,
          oldY: startY + i * 2,
          pinned: i === 0,
        });
      }
      this.handleX = startX;
      this.handleY = startY;
    }

    // Mueve el punto 0 (mango) instantáneamente a la posición del cursor.
    setHandle(x, y) {
      this.handleX = x;
      this.handleY = y;
    }

    update() {
      const p = this.points;
      p[0].x = this.handleX;
      p[0].y = this.handleY;
      p[0].oldX = this.handleX;
      p[0].oldY = this.handleY;

      for (let i = 1; i < p.length; i++) {
        const pt = p[i];
        const vx = (pt.x - pt.oldX) * DAMPING;
        const vy = (pt.y - pt.oldY) * DAMPING;
        pt.oldX = pt.x;
        pt.oldY = pt.y;
        pt.x += vx;
        pt.y += vy + GRAVITY;
      }

      for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
        for (let i = 0; i < p.length - 1; i++) {
          const a = p[i];
          const b = p[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
          const diff = (dist - SEGMENT_LENGTH) / dist;
          const offX = dx * 0.5 * diff;
          const offY = dy * 0.5 * diff;

          if (a.pinned) {
            b.x -= offX * 2;
            b.y -= offY * 2;
          } else {
            a.x += offX;
            a.y += offY;
            b.x -= offX;
            b.y -= offY;
          }
        }

        // Rigidez extra del mango: mantiene casi recto el tramo 0-1-2 para
        // que se sienta como una empuñadura sólida y no como cuerda floja.
        const a0 = p[0];
        const b0 = p[HANDLE_POINTS - 1];
        const hdx = b0.x - a0.x;
        const hdy = b0.y - a0.y;
        const hdist = Math.sqrt(hdx * hdx + hdy * hdy) || 0.0001;
        const targetDist = SEGMENT_LENGTH * (HANDLE_POINTS - 1) * 0.97;
        const hdiff = (hdist - targetDist) / hdist;
        if (!a0.pinned) {
          a0.x += hdx * 0.5 * hdiff;
          a0.y += hdy * 0.5 * hdiff;
        }
        b0.x -= hdx * 0.5 * hdiff;
        b0.y -= hdy * 0.5 * hdiff;
      }
    }

    // Devuelve la posición de la punta (para efectos de impacto).
    getTip() {
      const t = this.points[this.points.length - 1];
      return { x: t.x, y: t.y };
    }

    // Dibuja el látigo completo: cuerda ahusada + punta deshilachada +
    // mango envuelto, reconstruyendo la imagen de referencia pero animada.
    draw(ctx) {
      const p = this.points;
      if (p.length < HANDLE_POINTS + 2) return;

      this._drawCord(ctx, p);
      this._drawFrayedTip(ctx, p);
      this._drawHandle(ctx, p); // se dibuja al final para tapar la unión
    }

    _drawCord(ctx, p) {
      const top = [];
      const bottom = [];
      const cordCount = p.length - (HANDLE_POINTS - 1) - 1;

      for (let i = HANDLE_POINTS - 1; i < p.length; i++) {
        const cur = p[i];
        const prev = p[i - 1] || cur;
        const next = p[i + 1] || cur;

        let nx = next.x - prev.x;
        let ny = next.y - prev.y;
        const len = Math.sqrt(nx * nx + ny * ny) || 1;
        nx /= len;
        ny /= len;

        const px = -ny;
        const py = nx;
        const cordT = (i - (HANDLE_POINTS - 1)) / cordCount;
        const w = cordWidthAt(cordT);

        top.push({ x: cur.x + px * w, y: cur.y + py * w });
        bottom.push({ x: cur.x - px * w, y: cur.y - py * w });
      }

      ctx.save();
      ctx.fillStyle = COLOR_CORD;
      ctx.beginPath();
      ctx.moveTo(top[0].x, top[0].y);
      for (let i = 1; i < top.length; i++) ctx.lineTo(top[i].x, top[i].y);
      for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(bottom[i].x, bottom[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Puntita deshilachada al final de la cuerda, como en la referencia.
    _drawFrayedTip(ctx, p) {
      const tip = p[p.length - 1];
      const prev = p[p.length - 2];
      let dx = tip.x - prev.x;
      let dy = tip.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len;
      dy /= len;
      const angle = Math.atan2(dy, dx);
      const strandLen = 9;
      const offsets = [-0.5, 0, 0.5];

      ctx.save();
      ctx.strokeStyle = COLOR_CORD;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      for (const off of offsets) {
        const a = angle + off;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x + Math.cos(a) * strandLen, tip.y + Math.sin(a) * strandLen);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Mango envuelto (azul marino) con casquetes redondeados en ambos
    // extremos y líneas diagonales imitando el agarre trenzado.
    _drawHandle(ctx, p) {
      const a = p[0]; // culata (extremo libre del mango)
      const b = p[HANDLE_POINTS - 1]; // unión con la cuerda
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      const px = -ny;
      const py = nx;
      const w = 10.5; // semiancho del mango
      const angle = Math.atan2(ny, nx);

      ctx.save();

      // Cuerpo principal del mango
      ctx.fillStyle = COLOR_HANDLE_MAIN;
      ctx.beginPath();
      ctx.moveTo(a.x + px * w, a.y + py * w);
      ctx.lineTo(b.x + px * w * 0.8, b.y + py * w * 0.8);
      ctx.lineTo(b.x - px * w * 0.8, b.y - py * w * 0.8);
      ctx.lineTo(a.x - px * w, a.y - py * w);
      ctx.closePath();
      ctx.fill();

      // Casquete redondeado en la culata
      ctx.fillStyle = COLOR_HANDLE_DARK;
      ctx.beginPath();
      ctx.ellipse(a.x, a.y, w * 0.55, w, angle, 0, Math.PI * 2);
      ctx.fill();

      // Collar redondeado donde el mango se une a la cuerda
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, w * 0.75 * 0.5, w * 0.75, angle, 0, Math.PI * 2);
      ctx.fill();

      // Líneas diagonales que imitan el envoltorio trenzado del agarre
      ctx.strokeStyle = COLOR_HANDLE_WRAP;
      ctx.lineWidth = 1.8;
      const wraps = 4;
      for (let i = 1; i <= wraps; i++) {
        const t0 = (i - 0.65) / (wraps + 0.5);
        const t1 = (i + 0.35) / (wraps + 0.5);
        const x0 = a.x + dx * t0 + px * w * 0.85;
        const y0 = a.y + dy * t0 + py * w * 0.85;
        const x1 = a.x + dx * t1 - px * w * 0.85;
        const y1 = a.y + dy * t1 - py * w * 0.85;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  window.WhipRope = WhipRope;
})();
