/* 레퍼런스: YouTube Data API v3 검색 + 구조 분석 / Wikimedia Commons 무료 이미지 */

const YouTube = {
  key: '',
  available() { return !!(this.key && this.key.trim()); },

  async searchShorts(query, opts = {}) {
    if (!this.available()) throw new Error('NO_YT_KEY');
    const max = opts.max || 25;
    const days = opts.days || 180;
    const after = new Date(Date.now() - days * 864e5).toISOString();
    const base = 'https://www.googleapis.com/youtube/v3/search';
    const params = new URLSearchParams({
      key: this.key.trim(),
      part: 'snippet',
      q: query,
      type: 'video',
      videoDuration: 'short',
      order: 'viewCount',
      maxResults: String(max),
      regionCode: 'KR',
      relevanceLanguage: 'ko',
      safeSearch: 'none',
      publishedAfter: after
    });

    const res = await fetch(base + '?' + params.toString());
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = (j.error && j.error.message) || ''; } catch (_) {}
      if (res.status === 400 || res.status === 403) {
        if (/quota/i.test(detail)) throw new Error('오늘 무료 한도(10,000유닛)를 다 썼습니다. 내일 다시 시도하세요.');
        throw new Error('유튜브 연결 오류 ' + res.status + ' — 키와 사용 설정을 확인하세요. ' + detail.slice(0, 120));
      }
      throw new Error('유튜브 연결 오류 ' + res.status + (detail ? ' — ' + detail.slice(0, 120) : ''));
    }
    const data = await res.json();
    const items = (data.items || []).filter(i => i.id && i.id.videoId);
    if (!items.length) return [];

    const ids = items.map(i => i.id.videoId).join(',');
    const vres = await fetch('https://www.googleapis.com/youtube/v3/videos?key=' + encodeURIComponent(this.key.trim()) +
      '&part=snippet,statistics,contentDetails&id=' + encodeURIComponent(ids));
    const vdata = vres.ok ? await vres.json() : { items: [] };
    const stats = {};
    (vdata.items || []).forEach(v => { stats[v.id] = v; });

    return items.map(i => {
      const v = stats[i.id.videoId] || {};
      const sn = v.snippet || i.snippet || {};
      const sec = ISO8601.toSeconds((v.contentDetails && v.contentDetails.duration) || '');
      return {
        id: i.id.videoId,
        title: sn.title || '',
        channel: sn.channelTitle || '',
        published: (sn.publishedAt || '').slice(0, 10),
        description: (sn.description || '').slice(0, 400),
        views: Number((v.statistics && v.statistics.viewCount) || 0),
        likes: Number((v.statistics && v.statistics.likeCount) || 0),
        comments: Number((v.statistics && v.statistics.commentCount) || 0),
        seconds: sec,
        thumb: (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default) || {}).url || '',
        url: 'https://www.youtube.com/shorts/' + i.id.videoId
      };
    })
    .filter(v => !v.seconds || v.seconds <= 65)
    .sort((a, b) => b.views - a.views);
  }
};

const ISO8601 = {
  toSeconds(d) {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || '');
    if (!m) return 0;
    return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
  }
};

/* ---- 제목·길이 기반 구조 분석 (화면 픽셀을 보는 게 아니라 텍스트 통계임을 화면에 명시) ---- */
const Analysis = {
  STOP: ['그리고', '하지만', '그래서', '진짜', '정말', '너무', '이거', '저거', '있는', '없는', '하는', '한번', '영상', 'shorts', '쇼츠'],

  words(titles) {
    const freq = {};
    titles.forEach(t => {
      String(t).replace(/[^\uAC00-\uD7A3a-zA-Z0-9#]/g, ' ').split(/\s+/).forEach(w => {
        if (w.length < 2) return;
        if (this.STOP.includes(w.toLowerCase())) return;
        freq[w] = (freq[w] || 0) + 1;
      });
    });
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12);
  },

  hookTypes(titles) {
    const n = titles.length || 1;
    const has = re => titles.filter(t => re.test(t)).length;
    return [
      { name: '숫자 제시', count: has(/\d/), desc: '“3가지”, “10분”처럼 숫자로 약속' },
      { name: '질문형', count: has(/\?|까\?|나요|을까|일까/) },
      { name: '비밀·반전', count: has(/비밀|반전|몰랐|충격|숨겨|결말|실체/) },
      { name: '손해·경고', count: has(/손해|위험|큰일|후회|안 하면|망가|고장/) },
      { name: '방법·이유', count: has(/방법|이유|하는 법|어떻게|가이드|정리/) },
      { name: '감정·사연', count: has(/눈물|감동|슬픈|사연|그날|마지막/) },
      { name: '1인칭 경험', count: has(/내가|저는|나는|우리|엄마|아빠/) }
    ].map(x => ({ ...x, pct: Math.round(x.count / n * 100) }))
      .sort((a, b) => b.count - a.count);
  },

  analyze(items) {
    const titles = items.map(i => i.title).filter(Boolean);
    const secs = items.map(i => i.seconds).filter(Boolean);
    const avgSec = secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : 0;
    const avgLen = titles.length ? Math.round(titles.reduce((a, t) => a + t.length, 0) / titles.length) : 0;
    const views = items.map(i => i.views || 0).filter(Boolean);
    const medianViews = views.length ? views.sort((a, b) => a - b)[Math.floor(views.length / 2)] : 0;
    const words = this.words(titles);
    const hooks = this.hookTypes(titles);
    const topHook = hooks[0] || { name: '훅', pct: 0 };
    const topWord = (words[0] && words[0][0]) || '';

    const cutSeconds = avgSec ? Math.max(2, Math.min(8, Math.round(avgSec / 6))) : 5;
    const cutCount = avgSec ? Math.max(3, Math.round(avgSec / cutSeconds)) : 6;

    return {
      count: items.length,
      avgSec, avgLen, medianViews, words, hooks, topHook, topWord, cutSeconds, cutCount,
      template: this.template({ topWord, topHook, avgSec, cutSeconds, cutCount, avgLen })
    };
  },

  template({ topWord, topHook, avgSec, cutSeconds, cutCount, avgLen }) {
    return [
      `[0~2초] 훅 — ${topHook.name} 방식. ${topWord ? `“${topWord}”를 첫 문장에 넣기` : '숫자나 질문으로 시작'} / ${Math.max(6, Math.min(14, avgLen || 12))}자 안쪽`,
      `[2~${2 + cutSeconds}초] 상황 — 왜 이 이야기를 해야 하는지 한 줄`,
      `[중반 ${cutCount - 3}컷] 근거·전개 — 한 컷에 정보 1개, ${cutSeconds}초 간격`,
      `[마지막-1컷] 반전 또는 반박 — “그런데 여기서…”`,
      `[마지막 컷] 정리 + 저장 유도 — “저장해두면 쓸 데 있습니다”`,
      `전체 ${avgSec || 40}초 · ${cutCount}컷 · 컷당 ${cutSeconds}초 · 자막 2줄 이내`
    ].join('\n');
  },

  /* 붙여넣은 글에서 제목 줄만 뽑기 */
  parseTitles(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(s => s.replace(/^\s*[\d.\-•)]+\s*/, '').replace(/\s{2,}.*$/, '').trim())
      .filter(s => s.length >= 4 && s.length <= 120);
  }
};

/* ---- Wikimedia Commons 무료 이미지 (퍼블릭 도메인 / CC) ---- */
const Commons = {
  async search(query, opts = {}) {
    const limit = opts.limit || 30;
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    u.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'search',
      gsrsearch: 'filetype:bitmap ' + (query || ''),
      gsrnamespace: '6',
      gsrlimit: String(limit),
      prop: 'imageinfo',
      iiprop: 'url|extmetadata|size',
      iiurlwidth: '1080'
    }).toString();

    const res = await fetch(u.toString());
    if (!res.ok) throw new Error('무료 이미지 검색 실패 (' + res.status + ')');
    const data = await res.json();
    const pages = (data.query && data.query.pages) ? Object.values(data.query.pages) : [];
    const out = pages
      .filter(p => p.imageinfo && p.imageinfo[0])
      .map(p => {
        const ii = p.imageinfo[0];
        const meta = ii.extmetadata || {};
        const val = k => (meta[k] && meta[k].value ? String(meta[k].value).replace(/<[^>]*>/g, '').trim() : '');
        const license = val('LicenseShortName') || val('License') || '라이선스 확인 필요';
        return {
          source: 'commons',
          title: p.title.replace(/^File:/, ''),
          url: ii.thumburl || ii.url,
          full: ii.url,
          page: ii.descriptionurl,
          width: ii.width, height: ii.height,
          license,
          licenseUrl: val('LicenseUrl'),
          artist: val('Artist').slice(0, 60),
          credit: val('Credit').slice(0, 60),
          isFree: /(cc|public domain|pd|cc0|gfdl)/i.test(license)
        };
      })
      .filter(x => /\.(jpe?g|png|webp|gif)$/i.test(String(x.url || '').split('?')[0]))
      .filter(x => opts.freeOnly ? x.isFree : true);
    return out;
  }
};
