/* 9:16 쇼츠 캔버스 렌더러 — 미리보기 · 실시간 녹화(MediaRecorder) */
const Renderer = {
  W: 1080,
  H: 1920,
  fps: 30,
  canvas: null,
  ctx: null,
  title: '',
  shots: [],            // [{text, seconds}]
  images: [],           // [{img, label, license}]
  hl: '#ffe066',
  watermark: '',
  timeline: [],
  total: 0,
  palette: ['#1b2a5e', '#3b1f4e', '#123b32', '#4a2a12', '#2a1a3e'],

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.drawPreview();
  },

  setContent({ title, shots, images, hl, watermark }) {
    if (title != null) this.title = String(title);
    if (shots) this.shots = shots.map(s => ({ text: String(s.text || ''), seconds: Math.max(1.5, Number(s.seconds) || 5) }));
    if (images) this.images = images;
    if (hl) this.hl = hl;
    if (watermark != null) this.watermark = String(watermark);
    this.buildTimeline();
  },

  buildTimeline() {
    this.timeline = [];
    let t = 0;
    this.shots.forEach((s, i) => {
      this.timeline.push({ i, start: t, end: t + s.seconds });
      t += s.seconds;
    });
    this.total = t;
  },

  shotAt(t) {
    if (!this.timeline.length) return null;
    for (const seg of this.timeline) if (t < seg.end) return { seg, p: (t - seg.start) / (seg.end - seg.start) };
    const last = this.timeline[this.timeline.length - 1];
    return { seg: last, p: 1 };
  },

  /* 정지 상태(썸네일) — 시작 페이드를 건너뛴 프레임 */
  drawPreview() {
    const t = Math.min(Math.max(0.6, 0), this.total || 0.6);
    this.drawFrame(t);
  },

  /* ---------- 그리기 ---------- */
  drawFrame(t) {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const cur = this.shotAt(t);
    const shotIdx = cur ? cur.seg.i : 0;
    const p = cur ? cur.p : 0;

    this.drawBackground(shotIdx, p);

    /* 위아래 스크림 — 자막 가독성 */
    let g = ctx.createLinearGradient(0, 0, 0, 760);
    g.addColorStop(0, 'rgba(0,0,0,.72)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 760);

    g = ctx.createLinearGradient(0, H - 900, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(.55, 'rgba(0,0,0,.55)');
    g.addColorStop(1, 'rgba(0,0,0,.85)');
    ctx.fillStyle = g; ctx.fillRect(0, H - 900, W, 900);

    this.drawTitle(t);
    if (cur) this.drawSubtitle(this.shots[shotIdx].text, p, shotIdx);
    this.drawFooter(t);

    /* 시작·끝 페이드 */
    const fade = 0.35;
    if (t < fade) { ctx.fillStyle = 'rgba(0,0,0,' + (1 - t / fade) + ')'; ctx.fillRect(0, 0, W, H); }
    if (this.total && t > this.total - fade) {
      ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, (t - (this.total - fade)) / fade) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  },

  drawBackground(idx, p) {
    const ctx = this.ctx, W = this.W, H = this.H;
    const img = this.images.length ? this.images[idx % this.images.length] : null;
    const pic = img && (img.img || img.el);

    if (!pic) {
      /* 사진이 없을 때: 그라데이션 + 큰 첫 글자 */
      const base = this.palette[idx % this.palette.length];
      const gr = ctx.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, base);
      gr.addColorStop(1, '#080b16');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = .12;
      ctx.fillStyle = '#fff';
      ctx.font = '900 520px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((this.title || 'S').trim().slice(0, 1), W / 2, H / 2);
      ctx.restore();
      return;
    }

    const iw = pic.naturalWidth || pic.width, ih = pic.naturalHeight || pic.height;
    const dir = idx % 2 === 0 ? 1 : -1;
    const zoom = 1.06 + 0.10 * (dir > 0 ? p : 1 - p);
    const scale = Math.max(W / iw, H / ih) * zoom;
    const dw = iw * scale, dh = ih * scale;
    const px = 0.5 + dir * (p - 0.5) * 0.10;     // 가로 팬
    const py = 0.5 - dir * (p - 0.5) * 0.06;     // 세로 팬
    const dx = (W - dw) * Math.max(0.1, Math.min(0.9, px));
    const dy = (H - dh) * Math.max(0.1, Math.min(0.9, py));
    ctx.drawImage(pic, dx, dy, dw, dh);
  },

  wrap(text, font, maxWidth, maxLines) {
    const ctx = this.ctx;
    ctx.font = font;
    const str = String(text == null ? '' : text).trim();
    if (!str) return [];
    const tokens = str.split(/\s+/);
    const lines = [];
    let cur = '', truncated = false;

    const pushChars = (word) => {
      for (const ch of Array.from(word)) {
        if (ctx.measureText(cur + ch).width > maxWidth && cur) {
          lines.push(cur); cur = ch;
          if (lines.length >= maxLines) { truncated = true; return; }
        } else cur += ch;
      }
    };

    for (const w of tokens) {
      const cand = cur ? cur + ' ' + w : w;
      if (ctx.measureText(cand).width <= maxWidth) { cur = cand; continue; }
      if (cur) {
        lines.push(cur); cur = '';
        if (lines.length >= maxLines) { truncated = true; break; }
      }
      if (ctx.measureText(w).width <= maxWidth) cur = w;
      else { pushChars(w); if (truncated) break; }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    else if (cur) truncated = true;
    if (truncated && lines.length) {
      let last = lines[lines.length - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
      lines[lines.length - 1] = last + '…';
    }
    return lines;
  },

  drawTitle(t) {
    if (!this.title) return;
    const ctx = this.ctx, W = this.W;
    const size = 82;
    const font = `900 ${size}px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif`;
    const lines = this.wrap(this.title, font, W - 160, 2);
    const lh = size * 1.28;
    const startY = 190 + Math.max(0, (1 - Math.min(1, t / 0.5)) * -24);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font;
    lines.forEach((line, i) => {
      const y = startY + i * lh;
      const w = ctx.measureText(line).width;
      const isLast = i === lines.length - 1;
      if (isLast) {
        /* 형광펜 — 첫 0.6초 동안 왼쪽에서 그어짐 */
        const grow = Math.min(1, Math.max(0, t / 0.6));
        const bw = Math.min(w + 46, W - 90) * grow;
        ctx.save();
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = this.hl;
        const bx = W / 2 - (Math.min(w + 46, W - 90)) / 2;
        roundRect(ctx, bx, y - size * 0.42, bw, size * 0.84, 12);
        ctx.fill();
        ctx.restore();
      }
      ctx.shadowColor = 'rgba(0,0,0,.75)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line, W / 2, y);
      ctx.shadowColor = 'transparent';
    });
    ctx.restore();
  },

  drawSubtitle(text, p, idx) {
    if (!text) return;
    const ctx = this.ctx, W = this.W;
    let size = 62;
    let font = `800 ${size}px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif`;
    let lines = this.wrap(text, font, W - 170, 2);
    if (lines.length > 2) lines = lines.slice(0, 2);
    /* 길면 자동 축소 */
    if (lines.join('').length > 40) {
      size = 52;
      font = `800 ${size}px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif`;
      lines = this.wrap(text, font, W - 170, 3);
    }
    const lh = size * 1.34;
    const boxH = lh * lines.length + 46;
    const boxW = Math.min(W - 120, Math.max(...lines.map(l => { ctx.font = font; return ctx.measureText(l).width; })) + 76);
    const cx = W / 2;
    const boxY = this.H - 520 - boxH + 46;

    ctx.save();
    /* 등장 팝 */
    const pop = p < 0.10 ? 0.94 + 0.06 * (p / 0.10) : 1;
    ctx.translate(cx, boxY + boxH / 2);
    ctx.scale(pop, pop);
    ctx.translate(-cx, -(boxY + boxH / 2));

    ctx.fillStyle = 'rgba(8,12,26,.58)';
    roundRect(ctx, cx - boxW / 2, boxY, boxW, boxH, 26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font;
    lines.forEach((line, i) => {
      const y = boxY + 23 + lh * (i + 0.5);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,.9)';
      ctx.shadowBlur = 10;
      ctx.fillText(line, cx, y);
      ctx.shadowColor = 'transparent';
    });

    /* 컷 진행 게이지 */
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    roundRect(ctx, cx - boxW / 2 + 18, boxY + boxH - 12, boxW - 36, 5, 3);
    ctx.fill();
    ctx.fillStyle = this.hl;
    roundRect(ctx, cx - boxW / 2 + 18, boxY + boxH - 12, (boxW - 36) * Math.max(0.02, p), 5, 3);
    ctx.fill();
    ctx.restore();
  },

  drawFooter(t) {
    const ctx = this.ctx, W = this.W, H = this.H;
    /* 진행 바 */
    const prog = this.total ? Math.min(1, t / this.total) : 0;
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = this.hl;
    ctx.fillRect(0, 0, W * prog, 8);

    if (this.watermark) {
      ctx.save();
      ctx.font = '700 34px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.watermark, W / 2, H - 96);
      ctx.restore();
    }
  }
};

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ---------- 재생 / 녹화 ---------- */
const Studio = {
  playing: false,
  raf: 0,
  recording: false,

  pickMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    const cands = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=avc1',
      'video/mp4'
    ];
    for (const m of cands) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
    }
    return '';
  },

  canRender() {
    return typeof MediaRecorder !== 'undefined' && !!this.pickMime() && !!HTMLCanvasElement.prototype.captureStream;
  },

  stop() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (Renderer.canvas) { const ctx = Renderer.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); }
  },

  async play({ from = 0, speak = false, onProgress } = {}) {
    this.stop();
    this.playing = true;
    const start = performance.now() - from * 1000;
    let lastShot = -1;
    const loop = () => {
      if (!this.playing) return;
      const t = (performance.now() - start) / 1000;
      if (t >= Renderer.total) {
        Renderer.drawFrame(Renderer.total);
        this.playing = false;
        if (onProgress) onProgress(1, true);
        return;
      }
      Renderer.drawFrame(t);
      if (onProgress) onProgress(t / Renderer.total, false);
      if (speak && 'speechSynthesis' in window) {
        const cur = Renderer.shotAt(t);
        if (cur && cur.seg.i !== lastShot) {
          lastShot = cur.seg.i;
          const u = new SpeechSynthesisUtterance(Renderer.shots[cur.seg.i].text);
          u.lang = 'ko-KR'; u.rate = 1.05;
          window.speechSynthesis.speak(u);
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },

  async record({ speak = false, onProgress } = {}) {
    if (!this.canRender()) throw new Error('이 브라우저는 영상 녹화(MediaRecorder)를 지원하지 않습니다. Chrome·Edge·삼성 인터넷을 써 주세요.');
    this.stop();
    const mime = this.pickMime();
    const stream = Renderer.canvas.captureStream(Renderer.fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9_000_000 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

    const done = new Promise(resolve => { rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] })); });
    rec.start(250);
    this.recording = true;

    await new Promise(resolve => {
      this.play({
        speak,
        onProgress: (p, end) => { if (onProgress) onProgress(p); if (end) resolve(); }
      });
      /* 안전장치: 재생이 끝나지 않으면 최대 길이 + 2초에서 종료 */
      setTimeout(() => resolve(), (Renderer.total + 2) * 1000);
    });

    this.recording = false;
    this.stop();
    if (rec.state !== 'inactive') rec.stop();
    const blob = await done;
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    return { blob, ext, mime };
  }
};

/* 사진 불러오기 — fetch로 blob을 받아 캔버스 오염(taint) 방지 */
const ImageLoader = {
  cache: new Map(),

  async fromUrl(url) {
    if (this.cache.has(url)) return this.cache.get(url);
    const p = (async () => {
      let src = url;
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res.ok) {
          const blob = await res.blob();
          src = URL.createObjectURL(blob);
        }
      } catch (_) { /* CORS 실패 시 직접 로드 */ }
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('이미지를 불러오지 못했습니다'));
        im.src = src;
      });
      return img;
    })();
    this.cache.set(url, p);
    return p;
  },

  fromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => resolve({ img: im, url });
      im.onerror = () => reject(new Error('사진을 읽지 못했습니다: ' + file.name));
      im.src = url;
    });
  }
};
