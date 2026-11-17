/* 앱 상태 · 화면 · 오케스트레이션 */
const Store = {
  KEY: 'ocs.v1',
  data: {
    settings: {
      geminiKey: '', geminiModel: 'gemini-2.5-flash',
      youtubeKey: '',
      paid: { openai: '', runway: '', kling: '', luma: '' }
    },
    plan: null,
    lastTopic: ''
  },
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return;
      const j = JSON.parse(raw);
      if (j.settings) {
        this.data.settings = Object.assign(this.data.settings, j.settings);
        this.data.settings.paid = Object.assign({ openai: '', runway: '', kling: '', luma: '' }, j.settings.paid || {});
      }
      if (j.plan) this.data.plan = j.plan;
      if (j.lastTopic) this.data.lastTopic = j.lastTopic;
    } catch (_) {}
  },
  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (_) {}
  }
};

const App = {
  preset: 'emotion',
  plan: null,
  images: [],            // {img,url,label,license,artist,page,source}
  commons: [],
  commonsSelected: [],
  pc: null,
  busy: false,
  lastDownloadUrl: null,

  init() {
    Store.load();
    this.applySettingsToUI();
    Gemini.key = Store.data.settings.geminiKey || '';
    Gemini.model = Store.data.settings.geminiModel || 'gemini-2.5-flash';
    YouTube.key = Store.data.settings.youtubeKey || '';

    Renderer.init(document.getElementById('stage'));
    this.bindTabs();
    this.bindCreate();
    this.bindPlan();
    this.bindVideo();
    this.bindRefs();
    this.bindSettings();
    this.bindHelp();

    const plan = Store.data.plan;
    if (plan) { this.plan = plan; this.renderPlan(); this.syncShotsToRenderer(); }
    else this.syncShotsToRenderer();

    document.getElementById('planTopic').value = Store.data.lastTopic || '';
    document.getElementById('topicInput').value = Store.data.lastTopic || '';
    this.renderMyImages();
    this.refreshStatus();
    this.checkPcBridge();
    this.updateBrowserNote();
    document.getElementById('appVersion').textContent = '1.0.0';
  },

  /* ---------- 공통 ---------- */
  toast(msg, ms = 2200) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => el.classList.remove('show'), ms);
  },

  async copy(text, label = '복사했습니다') {
    try {
      await navigator.clipboard.writeText(text);
      this.toast(label);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); this.toast(label); }
      catch (e) { this.toast('복사가 막혔습니다. 길게 눌러 선택해 주세요.'); }
      ta.remove();
    }
  },

  go(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tab === 'video') this.syncShotsToRenderer();
  },

  bindTabs() {
    document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => this.go(b.dataset.tab)));
    document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => this.go(b.dataset.goto)));
  },

  refreshStatus() {
    const g = Gemini.available(), y = YouTube.available();
    document.getElementById('dotGemini').className = 'dot ' + (g ? 'ok' : 'off');
    document.getElementById('txtGemini').innerHTML = g
      ? '<b>AI 대본 다듬기 (제미나이)</b> · 켜짐'
      : '<b>AI 대본 다듬기 (제미나이)</b> · 무료 키를 넣으면 켜집니다';
    document.getElementById('dotYt').className = 'dot ' + (y ? 'ok' : 'off');
    document.getElementById('txtYt').innerHTML = y
      ? '<b>유튜브 인기 쇼츠 검색</b> · 켜짐'
      : '<b>유튜브 인기 쇼츠 검색</b> · 무료 키를 넣으면 켜집니다';
    document.getElementById('engineTag').textContent = g ? 'AI 모드 (제미나이)' : '템플릿 모드 (키 없이 동작)';
    document.getElementById('engineTag').className = 'tag ' + (g ? 'ready' : '');
    document.getElementById('geminiTag').textContent = g ? '입력됨' : '미입력';
    document.getElementById('geminiTag').className = 'tag ' + (g ? 'ready' : '');
    document.getElementById('ytTag').textContent = y ? '입력됨' : '미입력';
    document.getElementById('ytTag').className = 'tag ' + (y ? 'ready' : '');
    document.getElementById('refKeyHint').innerHTML = y
      ? '키가 있어 조회수·길이까지 자동으로 가져옵니다.'
      : '키가 없으면 <b>유튜브에서 직접 검색</b> 링크로 열고, 제목을 복사해 아래 붙여넣기 분석을 쓰세요. 설치는 <b>설정</b>에서.';
  },

  updateBrowserNote() {
    const el = document.getElementById('browserNote');
    if (!Studio.canRender()) {
      el.className = 'note bad';
      el.innerHTML = '<b>이 브라우저는 영상 저장을 지원하지 않습니다.</b> 크롬·엣지·삼성 인터넷에서 열어 주세요. (사파리는 최신 버전에서 MP4로 저장됩니다.)';
      return;
    }
    const mime = Studio.pickMime();
    el.className = 'note';
    el.innerHTML = mime.includes('mp4')
      ? '저장 형식: <b>MP4 영상</b> (사파리) · 실시간으로 그리기 때문에 영상 길이만큼 시간이 걸립니다.'
      : '저장 형식: <b>웹엠(WebM) 영상</b> (크롬 계열) · 유튜브에 그대로 올릴 수 있습니다. 음성은 파일에 들어가지 않습니다.';
  },

  /* ---------- 1. 만들기 ---------- */
  bindCreate() {
    document.querySelectorAll('#presetList .preset').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#presetList .preset').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        this.preset = b.dataset.preset;
        if (this.preset === 'refs') {
          this.go('refs');
          const q = this.topicValue();
          if (q) document.getElementById('refQuery').value = q;
        }
      });
    });

    document.getElementById('btnExample').addEventListener('click', () => {
      const examples = {
        emotion: '아버지의 낡은 공구함에서 나온 편지',
        movie: '영화 「기생충」 1분 요약',
        shopping: '겨울철 차량용 무선 타이어 공기압 주입기',
        story: '30년 동안 열리지 않은 지하실 문',
        blog: '대전 에어컨 청소 비용과 시기, 한 번에 정리',
        refs: '에어컨청소'
      };
      const v = examples[this.preset] || '대전 에어컨 청소 필요한 이유';
      document.getElementById('topicInput').value = v;
      document.getElementById('planTopic').value = v;
      this.toast('예시 주제를 넣었습니다. ⚡ 초안 만들기를 눌러 보세요.');
    });

    document.getElementById('topicInput').addEventListener('input', e => {
      document.getElementById('planTopic').value = e.target.value;
      Store.data.lastTopic = e.target.value; Store.save();
    });

    document.getElementById('planTopic').addEventListener('input', e => {
      document.getElementById('topicInput').value = e.target.value;
      Store.data.lastTopic = e.target.value; Store.save();
    });

    document.getElementById('btnOneClick').addEventListener('click', () => this.oneClick());
  },

  topicValue() {
    return (document.getElementById('topicInput').value || document.getElementById('planTopic').value || '').trim();
  },

  async oneClick() {
    if (this.busy) return;
    if (this.preset === 'refs') { this.go('refs'); return; }
    const topic = this.topicValue();
    if (!topic) {
      this.toast('주제를 한 줄만 적어 주세요');
      document.getElementById('topicInput').focus();
      return;
    }
    document.getElementById('planTopic').value = topic;
    if (this.preset === 'blog') await this.makeBlog(topic);
    else await this.makeShorts(topic);
  },

  /* ---------- 2. 대본 ---------- */
  bindPlan() {
    document.getElementById('btnAiPlan').addEventListener('click', () => this.makeShorts(this.topicValue(), { ai: true }));
    document.getElementById('btnTemplatePlan').addEventListener('click', () => this.makeShorts(this.topicValue(), { ai: false }));
  },

  async makeShorts(topic, { ai } = {}) {
    topic = (topic || '').trim();
    if (!topic) { this.toast('주제를 먼저 적어 주세요'); this.go('create'); return; }
    if (this.busy) return;
    const useAi = ai !== false && Gemini.available();
    if (ai === true && !Gemini.available()) {
      this.toast('AI 키가 없어 템플릿 초안으로 만듭니다');
    }
    this.busy = true;
    const btn = document.getElementById('btnAiPlan');
    const old = btn.innerHTML;
    btn.innerHTML = '<span class="spin"></span> 만드는 중…';
    document.getElementById('btnOneClick').disabled = true;

    try {
      let plan;
      if (useAi) {
        const prompt = Prompts.shortsPlan({
          topic,
          audience: document.getElementById('planAudience').value.trim(),
          tone: document.getElementById('planTone').value,
          length: Number(document.getElementById('planLength').value),
          scenes: Number(document.getElementById('planScenes').value),
          preset: this.preset === 'refs' ? 'emotion' : this.preset
        });
        const text = await Gemini.generate(prompt, { maxTokens: 3000, temperature: 0.95 });
        plan = this.normalizeShorts(Gemini.parseJson(text), topic);
        plan.engine = 'ai';
      } else {
        plan = Templates.shorts(this.preset, {
          topic,
          tone: document.getElementById('planTone').value,
          length: Number(document.getElementById('planLength').value),
          scenes: Number(document.getElementById('planScenes').value)
        });
        plan.engine = 'template';
      }
      this.plan = plan;
      Store.data.plan = plan; Store.save();
      this.renderPlan();
      this.syncShotsToRenderer();
      this.go('plan');
      this.toast(plan.engine === 'ai' ? 'AI 대본이 나왔습니다' : '템플릿 초안이 나왔습니다');
    } catch (e) {
      this.toast(e.message || '생성 실패', 3200);
      if (useAi) {
        /* AI 실패 시에도 작업이 멈추지 않도록 템플릿으로 대체 */
        this.plan = Templates.shorts(this.preset, {
          topic,
          tone: document.getElementById('planTone').value,
          length: Number(document.getElementById('planLength').value),
          scenes: Number(document.getElementById('planScenes').value)
        });
        this.plan.engine = 'template';
        this.plan.aiError = e.message;
        Store.data.plan = this.plan; Store.save();
        this.renderPlan();
        this.syncShotsToRenderer();
        this.go('plan');
      }
    } finally {
      this.busy = false;
      btn.innerHTML = old;
      document.getElementById('btnOneClick').disabled = false;
    }
  },

  normalizeShorts(j, topic) {
    const shotsRaw = Array.isArray(j.shots) ? j.shots : [];
    if (!shotsRaw.length) throw new Error('AI 응답에 장면이 없습니다. 다시 시도해 주세요.');
    let shots = shotsRaw.slice(0, 10).map((s, i) => ({
      n: i + 1,
      role: String(s.role || ''),
      text: String(s.text || s.subtitle || '').trim(),
      image_query: String(s.image_query || s.imageQuery || '').trim(),
      seconds: Math.max(2, Math.min(12, Number(s.seconds) || 5))
    })).filter(s => s.text);
    if (!shots.length) throw new Error('AI 응답의 자막이 비어 있습니다. 다시 시도해 주세요.');
    const yt = j.youtube || {};
    return {
      kind: 'shorts',
      topic,
      title_candidates: (j.title_candidates || [yt.title] || []).filter(Boolean).slice(0, 3),
      hook_pattern: String(j.hook_pattern || ''),
      thumbnail_text: String(j.thumbnail_text || ''),
      shots,
      youtube: {
        title: String(yt.title || (j.title_candidates && j.title_candidates[0]) || topic),
        description: String(yt.description || ''),
        hashtags: (yt.hashtags || []).map(h => String(h).startsWith('#') ? h : '#' + h).slice(0, 10),
        pinned_comment: String(yt.pinned_comment || '')
      }
    };
  },

  renderPlan() {
    const plan = this.plan;
    const out = document.getElementById('planOutput');
    const meta = document.getElementById('metaOutput');
    const blog = document.getElementById('blogOutput');
    const kindTag = document.getElementById('planKindTag');
    if (!plan) return;

    if (plan.kind === 'blog') {
      kindTag.textContent = '블로그';
      this.renderBlog(plan);
      return;
    }
    kindTag.textContent = '쇼츠';
    blog.innerHTML = '';

    const engineBadge = plan.engine === 'ai'
      ? '<span class="tag ready">AI가 쓴 초안</span>'
      : '<span class="tag">내장 템플릿</span>';
    out.innerHTML = `
      <div class="row between" style="margin-bottom:10px">
        <div class="row">${engineBadge}${plan.hook_pattern ? `<span class="tag">${esc(plan.hook_pattern)}</span>` : ''}</div>
        <span class="tag">${plan.shots.length}컷 · ${plan.shots.reduce((a, s) => a + s.seconds, 0)}초</span>
      </div>
      ${plan.aiError ? `<div class="note bad" style="margin-bottom:10px">AI 호출에 실패해 템플릿 초안을 대신 만들었습니다.<br>${esc(plan.aiError)}</div>` : ''}
      ${plan.engine !== 'ai' ? `<div class="note warn">템플릿 초안입니다. <b>[ ] 안의 내용</b>만 실제 상황으로 바꾸면 바로 쓸 수 있습니다. AI 키를 넣으면 주제에 맞게 자동으로 채워 줍니다.</div>` : ''}
      <div id="shotEditor">${plan.shots.map(s => shotRow(s)).join('')}</div>
      <button class="btn primary block" id="btnToVideo" style="margin-top:6px">🎬 이 대본으로 영상 만들기 →</button>
    `;
    document.getElementById('btnToVideo').addEventListener('click', () => {
      this.syncShotsToRenderer();
      this.go('video');
      const q = plan.shots[0] && plan.shots[0].image_query;
      if (q && !document.getElementById('commonsQuery').value) document.getElementById('commonsQuery').value = q;
    });

    /* 편집 반영 */
    out.querySelectorAll('[data-shot]').forEach(el => {
      el.addEventListener('input', e => {
        const i = Number(el.dataset.shot), k = el.dataset.k;
        const s = this.plan.shots[i];
        if (!s) return;
        if (k === 'seconds') s.seconds = Math.max(1.5, Math.min(20, Number(e.target.value) || 5));
        else s[k] = e.target.value;
        Store.data.plan = this.plan; Store.save();
        if (k !== 'image_query') this.syncShotsToRenderer(true);
      });
    });

    /* 유튜브 세트 */
    const y = plan.youtube;
    const cands = plan.title_candidates.length ? plan.title_candidates : [y.title];
    meta.innerHTML = `
      <div class="card tight">
        <h3>제목 후보 <span class="tag">눌러서 선택</span></h3>
        <div class="grid" style="margin-top:8px">
          ${cands.map((t, i) => `<button class="btn small ${t === y.title ? 'primary' : ''}" data-title="${i}" style="justify-content:flex-start;text-align:left;white-space:normal">${esc(t)}</button>`).join('')}
        </div>
      </div>
      <div class="card tight">
        <div class="copyline"><b>제목</b><span class="val" id="mTitle">${esc(y.title)}</span></div>
        <button class="btn small ghost block" data-copy="title">제목 복사</button>
      </div>
      <div class="card tight">
        <h3>설명</h3>
        <pre class="copybox" id="mDesc">${esc(y.description)}</pre>
        <button class="btn small ghost block" data-copy="desc">설명 복사</button>
      </div>
      <div class="card tight">
        <h3>해시태그</h3>
        <pre class="copybox" id="mTags" style="max-height:120px">${esc(y.hashtags.join(' '))}</pre>
        <button class="btn small ghost block" data-copy="tags">해시태그 복사</button>
      </div>
      <div class="card tight">
        <h3>고정댓글</h3>
        <pre class="copybox" id="mPin" style="max-height:140px">${esc(y.pinned_comment)}</pre>
        <button class="btn small ghost block" data-copy="pin">고정댓글 복사</button>
      </div>
      ${plan.thumbnail_text ? `<div class="card tight"><h3>첫 화면 큰 글씨</h3><p style="font-size:20px;color:#fff;font-weight:800">${esc(plan.thumbnail_text)}</p></div>` : ''}
    `;

    meta.querySelectorAll('[data-title]').forEach(b => {
      b.addEventListener('click', () => {
        this.plan.youtube.title = this.plan.title_candidates[Number(b.dataset.title)] || b.textContent;
        document.getElementById('videoTitle').value = '';
        Store.data.plan = this.plan; Store.save();
        this.renderPlan();
        this.syncShotsToRenderer(true);
      });
    });
    meta.querySelectorAll('[data-copy]').forEach(b => {
      b.addEventListener('click', () => {
        const map = { title: y.title, desc: y.description, tags: y.hashtags.join(' '), pin: y.pinned_comment };
        this.copy(map[b.dataset.copy] || '', '복사했습니다');
      });
    });
  },

  /* ---------- 블로그 ---------- */
  async makeBlog(topic) {
    topic = (topic || '').trim();
    if (!topic) { this.toast('주제를 먼저 적어 주세요'); this.go('create'); return; }
    if (this.busy) return;
    this.busy = true;
    const useAi = Gemini.available();
    document.getElementById('btnOneClick').disabled = true;
    try {
      let plan;
      if (useAi) {
        const text = await Gemini.generate(Prompts.blogPost({
          topic,
          audience: document.getElementById('planAudience').value.trim(),
          tone: document.getElementById('planTone').value
        }), { maxTokens: 4096, temperature: 0.85 });
        const j = Gemini.parseJson(text);
        plan = {
          kind: 'blog',
          topic,
          engine: 'ai',
          titles: (j.titles || []).slice(0, 3),
          meta_description: j.meta_description || '',
          markdown: j.markdown || '',
          hashtags: (j.hashtags || []).map(h => String(h).startsWith('#') ? h : '#' + h),
          faq: j.faq || [],
          cta: j.cta || ''
        };
        if (!plan.markdown) throw new Error('AI가 본문을 만들지 못했습니다. 다시 시도해 주세요.');
      } else {
        plan = Templates.blog({ topic });
        plan.engine = 'template';
      }
      this.plan = plan;
      Store.data.plan = plan; Store.save();
      this.renderPlan();
      this.go('plan');
      this.toast(plan.engine === 'ai' ? 'AI 블로그 글이 나왔습니다' : '블로그 템플릿 초안이 나왔습니다');
    } catch (e) {
      this.toast(e.message || '블로그 생성 실패', 3200);
      if (useAi) {
        this.plan = Templates.blog({ topic });
        this.plan.engine = 'template';
        this.plan.aiError = e.message;
        Store.data.plan = this.plan; Store.save();
        this.renderPlan(); this.go('plan');
      }
    } finally {
      this.busy = false;
      document.getElementById('btnOneClick').disabled = false;
    }
  },

  renderBlog(plan) {
    const out = document.getElementById('planOutput');
    const meta = document.getElementById('metaOutput');
    const blog = document.getElementById('blogOutput');
    document.getElementById('planKindTag').textContent = '블로그';

    out.innerHTML = `
      <div class="card tight">
        <div class="row" style="margin-bottom:10px">
          <span class="tag ${plan.engine === 'ai' ? 'ready' : ''}">${plan.engine === 'ai' ? 'AI가 쓴 초안' : '내장 템플릿'}</span>
          <span class="tag">${plan.markdown.replace(/\s/g, '').length}자</span>
        </div>
        ${plan.aiError ? `<div class="note bad">AI 호출 실패: ${esc(plan.aiError)}</div>` : ''}
        ${plan.engine !== 'ai' ? `<div class="note warn">템플릿 초안입니다. <b>[ ]</b> 부분을 실제 정보로 채우면 네이버 블로그에 바로 붙여넣을 수 있습니다.</div>` : ''}
        <h3 style="margin-top:12px">제목 후보</h3>
        <div class="grid" style="margin-top:8px">
          ${(plan.titles || []).map(t => `<button class="btn small" data-btitle="${esc(t)}" style="justify-content:flex-start;text-align:left;white-space:normal">${esc(t)}</button>`).join('')}
        </div>
        <h3 style="margin-top:16px">본문</h3>
        <div class="hint">복사해서 네이버 블로그 ‘글쓰기’에 붙여넣으면 소제목과 문단이 그대로 들어갑니다.</div>
        <textarea id="blogBody" rows="16" style="margin-top:8px;font-size:14px;line-height:1.65">${esc(plan.markdown)}</textarea>
        <button class="btn primary block" id="btnCopyBlog" style="margin-top:10px">블로그 본문 전체 복사</button>
        <div class="hint">${esc(plan.meta_description || '')}</div>
      </div>
    `;
    document.getElementById('btnCopyBlog').addEventListener('click', () => this.copy(document.getElementById('blogBody').value, '블로그 본문을 복사했습니다'));
    document.getElementById('blogBody').addEventListener('input', e => {
      this.plan.markdown = e.target.value;
      Store.data.plan = this.plan; Store.save();
    });
    out.querySelectorAll('[data-btitle]').forEach(b => b.addEventListener('click', () => this.copy(b.dataset.btitle, '제목을 복사했습니다')));

    meta.innerHTML = `
      <div class="card tight">
        <h3>검색 설명 (메타)</h3>
        <pre class="copybox" style="max-height:120px">${esc(plan.meta_description || '')}</pre>
        <button class="btn small ghost block" data-bcopy="meta">복사</button>
      </div>
      <div class="card tight">
        <h3>해시태그</h3>
        <pre class="copybox" style="max-height:120px">${esc((plan.hashtags || []).join(' '))}</pre>
        <button class="btn small ghost block" data-bcopy="tags">복사</button>
      </div>
      ${(plan.faq && plan.faq.length) ? `<div class="card tight"><h3>FAQ</h3>${plan.faq.map(f => `<p style="margin:8px 0"><b style="color:#fff">Q. ${esc(f.q)}</b><br>${esc(f.a)}</p>`).join('')}</div>` : ''}
      ${plan.cta ? `<div class="card tight"><h3>마무리 문장</h3><p style="color:#fff">${esc(plan.cta)}</p><button class="btn small ghost block" data-bcopy="cta" style="margin-top:8px">복사</button></div>` : ''}
    `;
    const map = { meta: plan.meta_description || '', tags: (plan.hashtags || []).join(' '), cta: plan.cta || '' };
    meta.querySelectorAll('[data-bcopy]').forEach(b => b.addEventListener('click', () => this.copy(map[b.dataset.bcopy], '복사했습니다')));
    blog.innerHTML = '';
  },

  /* ---------- 3. 영상 ---------- */
  bindVideo() {
    document.querySelectorAll('[data-imgsrc]').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('[data-imgsrc]').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        document.getElementById('paneCommons').style.display = b.dataset.imgsrc === 'commons' ? '' : 'none';
        document.getElementById('paneUpload').style.display = b.dataset.imgsrc === 'upload' ? '' : 'none';
        document.getElementById('paneColor').style.display = b.dataset.imgsrc === 'color' ? '' : 'none';
      });
    });

    document.getElementById('btnCommonsSearch').addEventListener('click', () => this.searchCommons());
    document.getElementById('commonsQuery').addEventListener('keydown', e => { if (e.key === 'Enter') this.searchCommons(); });
    document.getElementById('btnUseCommons').addEventListener('click', () => this.useCommonsSelection());
    document.getElementById('fileInput').addEventListener('change', e => this.addFiles(e.target.files));
    const colorBtn = document.getElementById('btnColorOnly');
    if (colorBtn) colorBtn.addEventListener('click', () => {
      this.images = [];
      this.afterImagesChanged();
      this.toast('사진을 모두 지우고 색 배경으로 만듭니다');
    });

    document.getElementById('btnReloadShots').addEventListener('click', () => { this.syncShotsToRenderer(); this.toast('대본을 다시 불러왔습니다'); });
    document.getElementById('videoTitle').addEventListener('input', () => this.syncShotsToRenderer(true));
    document.getElementById('hlColor').addEventListener('change', e => { Renderer.hl = e.target.value; Renderer.drawPreview(); });
    document.getElementById('watermark').addEventListener('input', e => { Renderer.watermark = e.target.value; Renderer.drawPreview(); });

    document.getElementById('btnPreview').addEventListener('click', () => {
      if (!Renderer.shots.length) { this.toast('먼저 대본을 만들어 주세요'); return; }
      const speak = document.getElementById('voiceMode').value === 'speech';
      Studio.play({ speak, onProgress: (p, end) => {
        const bar = document.querySelector('#renderProgress > i');
        document.getElementById('renderProgress').classList.add('show');
        bar.style.width = Math.round(p * 100) + '%';
        document.getElementById('renderLabel').textContent = end ? '미리보기 끝' : Math.round(p * 100) + '%';
        if (!speak) document.getElementById('renderLabel').textContent = end ? '미리보기 끝' : '음성 없음 · 자막만';
      }});
    });
    document.getElementById('btnStopPreview').addEventListener('click', () => { Studio.stop(); this.toast('정지'); });

    document.getElementById('btnRender').addEventListener('click', () => this.renderVideo());
    document.getElementById('btnPcRender').addEventListener('click', () => this.renderPc());
  },

  syncShotsToRenderer(redrawOnly) {
    const plan = this.plan;
    const shots = (plan && plan.kind === 'shorts' && plan.shots) ? plan.shots : [];
    const title = (document.getElementById('videoTitle').value || '').trim()
      || (plan && plan.youtube && plan.youtube.title) || (plan && plan.title_candidates && plan.title_candidates[0]) || (plan && plan.topic) || '';
    Renderer.setContent({
      title,
      shots: shots.map(s => ({ text: s.text, seconds: s.seconds })),
      images: this.images,
      hl: document.getElementById('hlColor').value,
      watermark: document.getElementById('watermark').value
    });
    if (redrawOnly) {
      Renderer.drawPreview();
      document.getElementById('shotCount').textContent = Renderer.shots.length + '컷 · ' + Math.round(Renderer.total) + '초';
      return;
    }
    this.renderShotList();
    Renderer.drawPreview();
    document.getElementById('shotCount').textContent = Renderer.shots.length + '컷 · ' + Math.round(Renderer.total) + '초';
  },

  renderShotList() {
    const box = document.getElementById('shotList');
    if (!Renderer.shots.length) {
      box.innerHTML = '<p class="hint">‘기획·대본’에서 대본을 만들면 자동으로 여기에 들어옵니다.</p>';
      document.getElementById('shotCount').textContent = '0컷';
      return;
    }
    box.innerHTML = Renderer.shots.map((s, i) => `
      <div class="shot" style="grid-template-columns:26px 1fr">
        <div class="n">${i + 1}</div>
        <div>
          <input type="text" data-vshot="${i}" data-k="text" value="${esc(s.text)}">
          <div class="row" style="margin-top:6px">
            <input type="number" min="2" max="20" step="1" data-vshot="${i}" data-k="seconds" value="${s.seconds}" style="width:86px;padding:8px 10px;font-size:14px">
            <span class="hint" style="margin:0">초</span>
          </div>
        </div>
      </div>
    `).join('');
    box.querySelectorAll('[data-vshot]').forEach(el => {
      el.addEventListener('input', e => {
        const i = Number(el.dataset.vshot), k = el.dataset.k;
        if (!this.plan || !this.plan.shots || !this.plan.shots[i]) return;
        if (k === 'seconds') this.plan.shots[i].seconds = Math.max(1.5, Math.min(20, Number(e.target.value) || 5));
        else this.plan.shots[i].text = e.target.value;
        Store.data.plan = this.plan; Store.save();
        Renderer.setContent({ shots: this.plan.shots.map(x => ({ text: x.text, seconds: x.seconds })) });
        Renderer.drawPreview();
        document.getElementById('shotCount').textContent = Renderer.shots.length + '컷 · ' + Math.round(Renderer.total) + '초';
      });
    });
  },

  async searchCommons() {
    const q = document.getElementById('commonsQuery').value.trim() || 'nature';
    const btn = document.getElementById('btnCommonsSearch');
    btn.disabled = true; btn.textContent = '검색 중…';
    try {
      const items = await Commons.search(q, { limit: 30, freeOnly: true });
      this.commons = items;
      this.commonsSelected = [];
      const box = document.getElementById('commonsResults');
      if (!items.length) {
        box.innerHTML = '<p class="hint">결과가 없습니다. 영어로 더 단순하게(예: air conditioner) 검색해 보세요.</p>';
      } else {
        box.innerHTML = items.map((it, i) => `
          <div class="img-card" data-cidx="${i}" title="${esc(it.title)}">
            <img src="${it.url}" alt="${esc(it.title)}" loading="lazy" referrerpolicy="no-referrer">
            <span class="pick">＋</span>
            <span class="lic">${esc(it.license)}${it.artist ? ' · ' + esc(it.artist) : ''}</span>
          </div>`).join('');
        box.querySelectorAll('[data-cidx]').forEach(el => {
          el.addEventListener('click', () => {
            const i = Number(el.dataset.cidx);
            if (this.commonsSelected.includes(i)) {
              this.commonsSelected = this.commonsSelected.filter(x => x !== i);
              el.classList.remove('sel');
            } else {
              if (this.commonsSelected.length >= 10) { this.toast('한 번에 10장까지 고를 수 있습니다'); return; }
              this.commonsSelected.push(i); el.classList.add('sel');
            }
            const btn2 = document.getElementById('btnUseCommons');
            btn2.style.display = this.commonsSelected.length ? '' : 'none';
            btn2.textContent = '선택한 사진 ' + this.commonsSelected.length + '장 사용';
          });
        });
      }
      document.getElementById('btnUseCommons').style.display = 'none';
    } catch (e) {
      this.toast(e.message || '검색 실패', 3000);
    } finally {
      btn.disabled = false; btn.textContent = '검색';
    }
  },

  async useCommonsSelection() {
    const picked = this.commonsSelected.map(i => this.commons[i]).filter(Boolean);
    if (!picked.length) { this.toast('사진을 먼저 골라 주세요'); return; }
    for (const it of picked) {
      try {
        const img = await ImageLoader.fromUrl(it.url);
        this.images.push({ img, url: it.url, full: it.full, label: it.title, license: it.license, artist: it.artist, page: it.page, source: 'commons' });
      } catch (e) {
        this.toast('일부 사진을 불러오지 못했습니다');
      }
    }
    this.afterImagesChanged();
    this.toast(picked.length + '장 추가 · 라이선스는 미리보기 아래에 표시됩니다');
  },

  async addFiles(files) {
    const list = Array.from(files || []).slice(0, 12);
    for (const f of list) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const { img, url } = await ImageLoader.fromFile(f);
        this.images.push({ img, url, label: f.name, license: '내 사진', source: 'upload' });
      } catch (e) { this.toast(e.message); }
    }
    document.getElementById('fileInput').value = '';
    this.afterImagesChanged();
    if (list.length) this.toast(list.length + '장 사진을 올렸습니다');
  },

  afterImagesChanged(keepColors) {
    if (!keepColors) this.images = this.images.filter(x => x.img);
    this.syncShotsToRenderer(true);
    this.renderMyImages();
  },

  renderMyImages() {
    const box = document.getElementById('myImages');
    if (!this.images.length) {
      box.innerHTML = '<div class="hint" style="margin-top:10px">아직 사진이 없습니다. 사진이 없으면 색 배경 + 큰 글씨로 만듭니다.</div>';
      return;
    }
    box.innerHTML = `
      <div class="row between" style="margin-top:14px">
        <b style="font-size:14px">사용할 사진 ${this.images.length}장</b>
        <button class="btn small ghost" id="btnClearImages">전체 지우기</button>
      </div>
      <div class="img-grid" style="margin-top:8px">
        ${this.images.map((it, i) => `
          <div class="img-card">
            <img src="${it.img.src}" alt="">
            <button class="del" data-delimg="${i}" aria-label="삭제">✕</button>
            <span class="lic">${esc(it.source === 'commons' ? it.license : '내 사진')}${it.artist ? ' · ' + esc(it.artist) : ''}</span>
          </div>`).join('')}
      </div>
      ${this.images.some(x => x.source === 'commons') ? `<div class="note">사진 출처 표시: ${this.images.filter(x => x.source === 'commons').map(x => `<a href="${x.page}" target="_blank" rel="noopener">${esc((x.artist || 'Wikimedia'))}</a> (${esc(x.license)})`).join(', ')}</div>` : ''}
    `;
    box.querySelectorAll('[data-delimg]').forEach(b => b.addEventListener('click', () => {
      this.images.splice(Number(b.dataset.delimg), 1);
      this.afterImagesChanged();
    }));
    const clr = document.getElementById('btnClearImages');
    if (clr) clr.addEventListener('click', () => { this.images = []; this.afterImagesChanged(); });
  },

  async renderVideo() {
    if (!Renderer.shots.length) { this.toast('먼저 대본을 만들어 주세요'); return; }
    if (!Studio.canRender()) { this.toast('이 브라우저는 영상 저장을 지원하지 않습니다. 크롬을 써 주세요', 3200); return; }
    if (Studio.recording) return;
    const btn = document.getElementById('btnRender');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> 그리는 중…';
    const bar = document.querySelector('#recProgress > i');
    const label = document.getElementById('recLabel');
    document.getElementById('recProgress').classList.add('show');
    this.toast('영상 길이만큼 시간이 걸립니다. 화면을 켜 두세요.', 3000);
    try {
      const speak = document.getElementById('voiceMode').value === 'speech';
      const { blob, ext } = await Studio.record({
        speak,
        onProgress: p => {
          bar.style.width = Math.round(p * 100) + '%';
          label.textContent = '렌더링 ' + Math.round(p * 100) + '% · 남은 시간 약 ' + Math.max(0, Math.round(Renderer.total * (1 - p))) + '초';
        }
      });
      label.textContent = '완료 · 파일을 저장합니다';
      const name = 'shorts-' + stamp() + '.' + ext;
      download(blob, name);
      this.toast('저장했습니다: ' + name, 3000);
      label.textContent = '저장 완료 · ' + (blob.size / 1048576).toFixed(1) + 'MB 짜리 ' + (ext === 'mp4' ? 'MP4' : '웹엠(WebM)') + ' 영상입니다. 유튜브에 그대로 올릴 수 있어요.';
    } catch (e) {
      label.textContent = '';
      this.toast(e.message || '렌더링 실패', 3200);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '⬇ 영상 만들기 (다운로드)';
    }
  },

  /* ---------- PC 브리지 ---------- */
  async checkPcBridge() {
    try {
      const res = await fetch('api/health', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      if (!j || !j.ok) return;
      this.pc = j;
      const btn = document.getElementById('btnPcRender');
      btn.style.display = '';
      const note = document.getElementById('pcNote');
      note.style.display = '';
      const voiceWrap = document.getElementById('pcVoiceWrap');
      if (voiceWrap) voiceWrap.style.display = '';
      note.className = j.edge_tts ? 'note good' : 'note warn';
      note.innerHTML = j.edge_tts
        ? '<b>PC 모드 연결됨.</b> 한국어 음성 + 1080×1920 MP4로 저장합니다. (ffmpeg ' + esc(j.ffmpeg || 'ok') + ')'
        : '<b>PC 모드이지만 음성 라이브러리(edge-tts)가 없습니다.</b> 무음 MP4로 만들 수 있습니다. <code>pip install edge-tts</code> 후 다시 실행하세요.';
    } catch (_) { /* 웹 배포판: PC 기능 없음 */ }
  },

  async renderPc() {
    if (!this.pc) { this.toast('PC 패키지에서 실행할 때 쓸 수 있습니다'); return; }
    if (!Renderer.shots.length) { this.toast('먼저 대본을 만들어 주세요'); return; }
    const btn = document.getElementById('btnPcRender');
    btn.disabled = true;
    const bar = document.querySelector('#recProgress > i');
    const label = document.getElementById('recLabel');
    document.getElementById('recProgress').classList.add('show');
    bar.style.width = '2%';
    label.textContent = 'PC 렌더링 준비 중…';
    try {
      /* 사진은 원본 URL을, 업로드는 1600px JPEG 데이터로 보냄 */
      const shots = [];
      for (let i = 0; i < Renderer.shots.length; i++) {
        const s = Renderer.shots[i];
        const src = this.images.length ? this.images[i % this.images.length] : null;
        let image = null;
        if (src) image = await toJpegDataUrl(src.img);   // 브라우저가 본 사진 그대로 PC로 전달
        shots.push({ text: s.text, seconds: s.seconds, image });
      }
      const payload = {
        title: Renderer.title,
        watermark: Renderer.watermark,
        hl: Renderer.hl,
        voice: (document.getElementById('pcVoice') ? document.getElementById('pcVoice').value : 'ko-KR-SunHiNeural'),
        shots
      };
      const res = await fetch('api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('렌더 요청 실패 (' + res.status + ')');
      const { job } = await res.json();
      /* 진행률 폴링 */
      let outUrl = null;
      for (let k = 0; k < 900; k++) {
        await sleep(1000);
        const p = await (await fetch('api/job/' + job, { cache: 'no-store' })).json();
        bar.style.width = Math.max(3, p.percent || 0) + '%';
        label.textContent = 'PC 렌더링 ' + (p.percent || 0) + '% · ' + (p.message || '');
        if (p.status === 'done') { outUrl = p.url; break; }
        if (p.status === 'error') throw new Error(p.error || '렌더 실패');
      }
      if (!outUrl) throw new Error('시간이 너무 오래 걸립니다. 콘솔 창을 확인하세요.');
      window.location.href = outUrl;
      label.textContent = '완료 · MP4 파일을 저장합니다';
      this.toast('PC에서 MP4를 만들었습니다', 3000);
    } catch (e) {
      label.textContent = '';
      this.toast(e.message || 'PC 렌더 실패', 3600);
    } finally {
      btn.disabled = false;
    }
  },

  /* ---------- 4. 레퍼런스 ---------- */
  bindRefs() {
    document.getElementById('btnRefSearch').addEventListener('click', () => this.searchRefs());
    document.getElementById('refQuery').addEventListener('keydown', e => { if (e.key === 'Enter') this.searchRefs(); });
    document.getElementById('btnRefOpenYT').addEventListener('click', () => {
      const q = document.getElementById('refQuery').value.trim() || '쇼츠';
      window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(q + ' shorts') + '&sp=CAMSAhAB', '_blank', 'noopener');
    });
    document.getElementById('btnRefAnalyzePaste').addEventListener('click', () => {
      const titles = Analysis.parseTitles(document.getElementById('refPaste').value);
      if (titles.length < 3) { this.toast('제목을 3줄 이상 붙여넣어 주세요'); return; }
      const items = titles.map(t => ({ title: t, views: 0, seconds: 0 }));
      this.showAnalysis(items, { pasted: true });
      document.getElementById('refResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  },

  async searchRefs() {
    const q = document.getElementById('refQuery').value.trim();
    if (!q) { this.toast('키워드를 적어 주세요'); return; }
    if (!YouTube.available()) {
      this.toast('설정에서 유튜브 무료 키를 넣으면 자동으로 가져옵니다', 3000);
      window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(q + ' shorts'), '_blank', 'noopener');
      return;
    }
    const btn = document.getElementById('btnRefSearch');
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 검색 중…';
    document.getElementById('refResults').innerHTML = '<p class="hint">유튜브에서 조회수 높은 쇼츠를 모으는 중…</p>';
    try {
      const items = await YouTube.searchShorts(q, { max: 25, days: 365 });
      if (!items.length) {
        document.getElementById('refResults').innerHTML = '<div class="note warn">결과가 없습니다. 더 일반적인 키워드로 시도하거나 기간을 늘려 보세요.</div>';
        return;
      }
      this.showAnalysis(items, { pasted: false });
    } catch (e) {
      document.getElementById('refResults').innerHTML = '<div class="note bad">' + esc(e.message) + '</div>';
    } finally {
      btn.disabled = false; btn.textContent = '조회수 높은 쇼츠 찾기';
    }
  },

  showAnalysis(items, { pasted }) {
    const a = Analysis.analyze(items);
    const fmt = n => n >= 1e8 ? (n / 1e8).toFixed(1) + '억' : n >= 1e4 ? (n / 1e4).toFixed(1) + '만' : String(n);
    const top = items.slice(0, 12);

    document.getElementById('refResults').innerHTML = `
      <h2 class="sec"><span class="num">1</span>구조 분석 ${pasted ? '(붙여넣은 제목 ' + a.count + '개)' : '(' + a.count + '개 쇼츠)'}</h2>
      <div class="note">제목·길이·조회수 <b>텍스트 통계</b>로 계산한 결과입니다. 영상 화면을 직접 본 분석은 아닙니다.</div>
      <div class="analysis" style="margin-top:12px">
        <div class="card tight">
          <h3>후킹 패턴</h3>
          <table class="plan">
            <tr><th>유형</th><th>비율</th><th>설명</th></tr>
            ${a.hooks.slice(0, 5).map(h => `<tr><td>${h.name}</td><td>${h.pct}%</td><td style="color:#9aa8cc">${h.desc || ''}</td></tr>`).join('')}
          </table>
          <p style="margin-top:8px">가장 많이 쓰인 방식: <b style="color:#fff">${a.topHook.name}</b></p>
        </div>
        <div class="card tight">
          <h3>컷 리듬</h3>
          <p>평균 길이 <b style="color:#fff">${a.avgSec || '-'}초</b> · 제목 평균 <b style="color:#fff">${a.avgLen}자</b>${a.medianViews ? ' · 조회수 중앙값 <b style="color:#fff">' + fmt(a.medianViews) + '</b>' : ''}</p>
          <p style="margin-top:6px">권장: <b style="color:#fff">${a.cutCount}컷 / 컷당 ${a.cutSeconds}초</b> (평균 길이 기준 계산)</p>
        </div>
        <div class="card tight">
          <h3>자막 구조 템플릿</h3>
          <pre class="copybox" id="refTemplate">${esc(a.template)}</pre>
          <div class="row">
            <button class="btn small ghost" id="btnCopyTemplate">복사</button>
            <button class="btn small primary" id="btnUseTemplate">이 구조로 대본 만들기</button>
          </div>
        </div>
        <div class="card tight">
          <h3>자주 쓰인 단어</h3>
          <p>${a.words.map(w => `<span class="chip" style="cursor:default;margin:0 6px 6px 0">${esc(w[0])} <b>${w[1]}</b></span>`).join('') || '<span class="hint">없음</span>'}</p>
        </div>
      </div>

      <h2 class="sec"><span class="num">2</span>${pasted ? '붙여넣은 제목' : '조회수 높은 쇼츠'}</h2>
      ${top.map(v => `
        <div class="ref-item">
          ${v.thumb ? `<img src="${v.thumb}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div style="width:84px;aspect-ratio:9/16;background:#0a1124;border-radius:9px"></div>'}
          <div style="min-width:0">
            <div class="t">${esc(v.title)}</div>
            <div class="s">${v.views ? fmt(v.views) + '회 · ' : ''}${v.seconds ? v.seconds + '초 · ' : ''}${esc(v.channel || '')} ${v.published ? '· ' + v.published : ''}</div>
            ${v.url ? `<a class="s" href="${v.url}" target="_blank" rel="noopener">영상 열기 ↗</a>` : ''}
          </div>
        </div>`).join('')}
    `;

    const q = document.getElementById('refQuery').value.trim();
    document.getElementById('btnCopyTemplate').addEventListener('click', () => this.copy(a.template, '템플릿을 복사했습니다'));
    document.getElementById('btnUseTemplate').addEventListener('click', () => {
      if (q) { document.getElementById('topicInput').value = q; document.getElementById('planTopic').value = q; Store.data.lastTopic = q; Store.save(); }
      this.go('plan');
      this.toast(q ? '주제가 채워졌습니다. AI로 기획·대본을 눌러 보세요' : '대본 탭에서 주제를 적어 주세요', 2800);
    });
    document.getElementById('refResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  /* ---------- 5. 설정 ---------- */
  applySettingsToUI() {
    const s = Store.data.settings;
    document.getElementById('geminiKey').value = s.geminiKey || '';
    document.getElementById('geminiModel').value = s.geminiModel || 'gemini-2.5-flash';
    document.getElementById('ytKey').value = s.youtubeKey || '';
    document.getElementById('keyOpenai').value = (s.paid && s.paid.openai) || '';
    document.getElementById('keyRunway').value = (s.paid && s.paid.runway) || '';
    document.getElementById('keyKling').value = (s.paid && s.paid.kling) || '';
    document.getElementById('keyLuma').value = (s.paid && s.paid.luma) || '';
  },

  bindSettings() {
    document.getElementById('btnSaveGemini').addEventListener('click', () => {
      Store.data.settings.geminiKey = document.getElementById('geminiKey').value.trim();
      Store.data.settings.geminiModel = document.getElementById('geminiModel').value;
      Gemini.key = Store.data.settings.geminiKey;
      Gemini.model = Store.data.settings.geminiModel;
      Store.save();
      this.refreshStatus();
      document.getElementById('geminiStatus').textContent = Gemini.available() ? '저장했습니다. 이제 AI 기능이 켜집니다.' : '키를 비웠습니다. AI 기능이 꺼집니다.';
      this.toast('저장했습니다');
    });

    document.getElementById('btnTestGemini').addEventListener('click', async () => {
      const el = document.getElementById('geminiStatus');
      if (!Gemini.available()) { el.textContent = '먼저 키를 저장해 주세요.'; return; }
      el.textContent = '연결 확인 중…';
      try {
        const r = await Gemini.test();
        el.textContent = '연결 성공 ✓ (응답: ' + r + ')';
        this.toast('AI 연결에 성공했습니다');
      } catch (e) {
        el.textContent = '실패: ' + e.message;
      }
    });

    document.getElementById('btnSaveYt').addEventListener('click', () => {
      Store.data.settings.youtubeKey = document.getElementById('ytKey').value.trim();
      YouTube.key = Store.data.settings.youtubeKey;
      Store.save();
      this.refreshStatus();
      document.getElementById('ytStatus').textContent = YouTube.available() ? '저장했습니다. 레퍼런스 탭에서 검색해 보세요.' : '키를 비웠습니다.';
      this.toast('저장했습니다');
    });

    document.getElementById('btnSavePaid').addEventListener('click', () => {
      Store.data.settings.paid = {
        openai: document.getElementById('keyOpenai').value.trim(),
        runway: document.getElementById('keyRunway').value.trim(),
        kling: document.getElementById('keyKling').value.trim(),
        luma: document.getElementById('keyLuma').value.trim()
      };
      Store.save();
      const n = Object.values(Store.data.settings.paid).filter(Boolean).length;
      document.getElementById('paidStatus').textContent = n
        ? n + '개 키를 보관했습니다. 아직 영상 생성에는 연결되지 않습니다(연동 준비 단계).'
        : '보관한 키가 없습니다.';
      this.toast('보관했습니다 (아직 미연결)');
    });

    document.getElementById('btnExport').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(Store.data, null, 2)], { type: 'application/json' });
      download(blob, 'creator-studio-settings-' + stamp() + '.json');
      this.toast('내보냈습니다');
    });

    document.getElementById('btnClear').addEventListener('click', () => {
      if (!confirm('저장된 설정과 마지막 프로젝트를 지웁니다. 계속할까요?')) return;
      try { localStorage.removeItem(Store.KEY); } catch (_) {}
      location.reload();
    });

    /* 키 입력란: 붙여넣기 후 엔터로 바로 저장 */
    ['geminiKey', 'ytKey'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById(id === 'geminiKey' ? 'btnSaveGemini' : 'btnSaveYt').click();
      });
    });
  },

  bindHelp() {
    document.getElementById('btnHelp').addEventListener('click', () => document.getElementById('helpModal').classList.add('show'));
    document.getElementById('helpModal').addEventListener('click', e => {
      if (e.target.id === 'helpModal') e.currentTarget.classList.remove('show');
    });
  }
};

/* ---------- 템플릿 ---------- */
const Templates = {
  presets: {
    emotion: { roles: ['hook', 'situation', 'crisis', 'turn', 'peak', 'close'], weights: [1, 1.4, 1.5, 1.7, 1.9, 1.4] },
    info: { roles: ['hook', 'myth', 'fact', 'proof', 'how', 'close'], weights: [1, 1.3, 1.7, 1.5, 1.7, 1.2] },
    movie: { roles: ['hook', 'intro', 'plot', 'twist', 'cliff', 'close'], weights: [1, 1.4, 1.8, 1.8, 1.6, 1.2] },
    shopping: { roles: ['hook', 'reveal', 'feature', 'feature', 'proof', 'cta'], weights: [1, 1.3, 1.6, 1.6, 1.7, 1.2] },
    story: { roles: ['hook', 'char', 'event', 'conflict', 'climax', 'ending'], weights: [1, 1.4, 1.6, 1.6, 1.8, 1.4] }
  },

  shorts(preset, { topic, tone, length, scenes }) {
    const p = this.presets[preset] || this.presets.emotion;
    const roles = p.roles.slice(0, scenes);
    const weights = p.weights.slice(0, scenes);
    const wsum = weights.reduce((a, b) => a + b, 0);
    const total = length || 40;
    const T = topic.replace(/["']/g, '').trim();
    const Ts = T.length > 18 ? T.slice(0, 18) + '…' : T;
    const lines = {
      emotion: [
        `그날 밤, 아무도 말하지 않았다`,
        `${Ts} — [누가] [어디서] 하루를 보냈다`,
        `그런데 [예상치 못한 일]이 벌어졌다`,
        `[반전] 사실은 [숨겨진 사정]이 있었다`,
        `[감정 절정] 그 사람이 마지막에 남긴 말`,
        `끝까지 보셨다면 저장해 두세요`
      ],
      info: [
        `${Ts}, 이거 모르면 손해입니다`,
        `많이들 [흔한 오해]라고 알고 계십니다`,
        `실제로는 [사실]입니다. 이유는 [근거] 때문입니다`,
        `[근거 2] — [수치나 사례 한 줄]`,
        `그래서 [구체적인 방법]을 권합니다`,
        `[한 줄 정리] · 저장해 두면 쓸 데 있습니다`
      ],
      movie: [
        `이 영화, 결말 하나 때문에 다시 봤습니다`,
        `${Ts} — 줄거리는 단순합니다`,
        `[주인공]은 [목표]를 향해 움직이고, [장애물]을 만납니다`,
        `그런데 중반에 [반전]이 터집니다`,
        `결말 직전, [핵심 장면]에서 모든 게 뒤집힙니다`,
        `스포일러 없이 보고 싶다면 저장만 해두세요`
      ],
      shopping: [
        `${Ts}, 이거 모르고 사면 돈 아깝습니다`,
        `그래서 직접 써봤습니다 — [제품명]`,
        `첫 번째, [기능1]이 생각보다 편합니다`,
        `두 번째, [기능2]는 [상황]에서 진짜 유용합니다`,
        `[기간] 써보니 [변화]가 있었습니다`,
        `가격은 [가격] · 자세한 건 프로필 링크 확인`
      ],
      story: [
        `30년 동안 열리지 않은 문이 있었다`,
        `${Ts} — [주인공]은 [장소]로 이사 왔다`,
        `첫날 밤, [소리/흔적]이 시작됐다`,
        `[주인공]은 [선택]을 해야 했다`,
        `문이 열린 순간, [반전]이 드러났다`,
        `그리고 [주인공]은 [마지막 행동]을 했다`
      ]
    }[preset] || [];

    const shots = roles.map((role, i) => ({
      n: i + 1,
      role,
      text: lines[i] || `[${T}] ${i + 1}번째 장면 자막을 적어 주세요`,
      image_query: (preset === 'info'
        ? ['air conditioner indoor unit', 'dust filter close up', 'clean living room', 'technician working', 'home interior sunlight', 'cozy living room']
        : ['dramatic sky sunset', 'old house window', 'rainy street night', 'hands holding photo', 'mountain fog morning', 'calm sea sunrise'])[i % 6],
      seconds: Math.max(2, Math.round(total * weights[i] / wsum))
    }));
    /* 합계 보정 */
    const sum = shots.reduce((a, s) => a + s.seconds, 0);
    const diff = total - sum;
    if (shots.length) shots[shots.length - 1].seconds = Math.max(2, shots[shots.length - 1].seconds + diff);

    const first = shots[0] ? shots[0].text : T;
    return {
      kind: 'shorts',
      topic: T,
      engine: 'template',
      title_candidates: [
        first,
        `${T} — 아무도 몰랐던 이야기`,
        `${T} (${total}초 정리)`
      ],
      hook_pattern: '첫 문장에 상황 + 궁금증을 동시에',
      thumbnail_text: T.slice(0, 12),
      shots,
      youtube: {
        title: first.slice(0, 40),
        description: `${T}\n\n${shots.map(s => s.text).slice(0, 4).join('\n')}\n\n#쇼츠 #${T.replace(/\s/g, '')}`,
        hashtags: ['#쇼츠', '#숏폼', '#' + T.replace(/[\s#]/g, ''), '#shorts'],
        pinned_comment: `${T} — 여러분 생각은 어떠세요? 댓글로 알려 주세요.`
      }
    };
  },

  blog({ topic }) {
    const T = topic.replace(/["']/g, '');
    const md = `# ${T}, 2026년 기준 한 번에 정리

${T}를 검색했다면 지금 "어디서부터 확인해야 하지?" 하는 단계일 겁니다. 이 글은 [지역] 기준으로 **시기·비용·진행 순서**를 한 번에 정리했습니다.

## 1. ${T}, 왜 지금 확인해야 할까요

${T}는 미루면 [문제]가 커지는 경우가 많습니다. 특히 [계절/상황]에는 [이유] 때문에 문의가 몰립니다. 미리 알아두면 일정과 비용을 아낄 수 있습니다.

## 2. 시작 전 체크리스트

- [ ] 처리 범위(어디까지 포함되는지) 확인
- [ ] 추가 비용이 생기는 조건 확인
- [ ] 작업 시간과 방문 일정 확인
- [ ] 사후 보증 기간 확인
- [ ] 실제 작업 사진·후기 확인

## 3. 실제 진행 순서

1. **상담** — 사진이나 상황 설명으로 견적 범위 확인
2. **일정 확정** — 방문 시간과 필요한 준비물 안내
3. **작업** — [소요 시간] 정도, 범위에 따라 달라짐
4. **확인** — 결과를 함께 보고 마무리

## 4. 비용과 기간 (지역·범위에 따라 다름)

| 구분 | 기준 | 비고 |
|---|---|---|
| 기본 | [금액] | [범위] |
| 추가 | [금액] | [조건] |

정확한 금액은 현장 상태에 따라 달라지므로, 상담 때 **추가 비용 조건**을 꼭 물어보세요.

## 5. 자주 묻는 질문

**Q. ${T}는 얼마나 자주 해야 하나요?**
A. [주기]를 권합니다. 사용 환경에 따라 다르니 상태를 먼저 확인하세요.

**Q. 당일도 가능한가요?**
A. 일정에 따라 가능합니다. 성수기에는 [며칠] 전 예약을 권합니다.

## 마무리

${T}는 정보를 미리 확인하는 것만으로도 절반은 해결됩니다. 급할 때 허둥대지 않으려면 지금 정리해 두세요.
[지역]에서 상담이 필요하면 댓글이나 프로필의 연락처로 문의해 주세요.`;
    return {
      kind: 'blog',
      topic: T,
      titles: [
        `${T} 총정리 (2026년 기준 비용·시기)`,
        `${T}, 이것만 확인하면 끝`,
        `${T} 초보자 가이드 — 순서와 비용`
      ],
      meta_description: `${T}의 시기, 비용, 진행 순서를 한 번에 정리했습니다. 상담 전 체크리스트 포함.`,
      markdown: md,
      hashtags: ['#' + T.replace(/[\s#]/g, ''), '#정보', '#정리', '#가이드'],
      faq: [],
      cta: `${T}, 궁금한 점은 댓글로 남겨 주세요.`
    };
  }
};

/* ---------- 도우미 ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function shotRow(s) {
  return `<div class="shot">
    <div class="n">${s.n}</div>
    <div>
      <textarea data-shot="${s.n - 1}" data-k="text" rows="2">${esc(s.text)}</textarea>
      <div class="meta row" style="gap:8px">
        <input type="text" class="img-q" data-shot="${s.n - 1}" data-k="image_query" value="${esc(s.image_query || '')}" placeholder="영어 이미지 검색어" style="flex:1;min-width:120px;padding:8px 10px;font-size:13px">
        <input type="number" min="2" max="20" data-shot="${s.n - 1}" data-k="seconds" value="${s.seconds}" style="width:74px;padding:8px 10px;font-size:13px">
        <span class="hint" style="margin:0">초</span>
      </div>
    </div>
  </div>`;
}
async function toJpegDataUrl(img) {
  const max = 1600;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const sc = Math.min(1, max / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.round(iw * sc); c.height = Math.round(ih * sc);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

document.addEventListener('DOMContentLoaded', () => App.init());
