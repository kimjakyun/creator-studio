/* Gemini 무료 API 연결 — 브라우저에서 직접 호출 (키는 로컬에만 저장) */
const Gemini = {
  key: '',
  model: 'gemini-2.5-flash',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
  lastError: '',

  available() { return !!(this.key && this.key.trim()); },

  async generate(prompt, opts = {}) {
    if (!this.available()) throw new Error('NO_KEY');
    const model = (opts.model || this.model || 'gemini-2.5-flash').trim();
    const url = this.endpoint + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(this.key.trim());
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature == null ? 0.9 : opts.temperature,
        maxOutputTokens: opts.maxTokens || 4096,
        topP: 0.95
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    };

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      this.lastError = '네트워크 오류: ' + e.message;
      throw new Error('네트워크 오류로 Gemini에 연결하지 못했습니다. 인터넷 연결을 확인하세요.');
    }

    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.status)) || ''; } catch (_) {}
      let msg;
      if (res.status === 400 && /API key not valid/i.test(detail)) msg = 'API 키가 올바르지 않습니다. 설정에서 키를 다시 확인하세요.';
      else if (res.status === 403) msg = '이 키로는 사용할 수 없습니다(권한/할당량). AI Studio에서 키를 새로 만들어 보세요.';
      else if (res.status === 429) msg = '무료 한도를 넘었습니다. 잠시 뒤(또는 내일) 다시 시도하세요.';
      else if (res.status === 404) msg = '모델 이름을 찾을 수 없습니다. 설정에서 다른 모델을 골라 보세요.';
      else msg = 'Gemini 오류 ' + res.status + (detail ? ' — ' + detail : '');
      this.lastError = msg;
      throw new Error(msg);
    }

    const data = await res.json();
    const cand = (data.candidates || [])[0];
    const text = ((cand && cand.content && cand.content.parts) || []).map(p => p.text || '').join('\n').trim();
    if (!text) {
      const reason = (data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || '';
      this.lastError = '응답이 비어 있습니다' + (reason ? ' (' + reason + ')' : '');
      throw new Error('AI가 내용을 만들지 못했습니다' + (reason ? ' (' + reason + ')' : '') + '. 주제를 바꿔 다시 시도하세요.');
    }
    return text;
  },

  /* ```json ... ``` 울타리와 앞뒤 설명을 걷어내고 첫 JSON 객체를 파싱 */
  parseJson(text) {
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try { return JSON.parse(t); } catch (_) {}
    const start = t.indexOf('{');
    if (start >= 0) {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < t.length; i++) {
        const ch = t[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(t.slice(start, i + 1)); } catch (_) { break; } } }
      }
    }
    throw new Error('AI 응답을 해석하지 못했습니다. 한 번 더 눌러 주세요.');
  },

  /* 설정 화면의 '연결 테스트' */
  async test() {
    const text = await this.generate('딱 한 단어로만 답하세요: 연결됨', { temperature: 0, maxTokens: 16 });
    return text.trim().slice(0, 40);
  }
};

/* ---- 프롬프트 ---- */
const Prompts = {
  shortsPlan({ topic, audience, tone, length, scenes, preset }) {
    const roleGuide = {
      emotion: '실화 감동 서사: 훅 → 인물/상황 → 위기 → 반전 → 감동 → 여운+구독 유도',
      movie: '영화 소개: 강한 스포일러 훅 → 한 줄 소개 → 핵심 전개 2컷 → 반전 → 결말 직전에서 끊기 → 추천',
      shopping: '제품 쇼츠: 문제 제기 → 제품 등장 → 기능 1 → 기능 2 → 실사용 장면 → 가격/링크 CTA',
      info: '정보·꿀팁: 통념/오해 훅 → 사실은? → 근거 1 → 근거 2(수치·사례) → 실제 방법 → 한 줄 정리+저장 유도',
      story: '창작 단편: 첫 문장 훅 → 주인공 소개 → 사건 발생 → 갈등 심화 → 절정 → 반전 엔딩',
      blog: '정보형 쇼츠: 궁금증 훅 → 오해 바로잡기 → 근거 2개 → 실제 방법 → 정리+저장 유도'
    }[preset] || '훅 → 전개 → 전환 → 마무리';

    return `너는 한국 유튜브 쇼츠를 1년에 300개 이상 기획해 조회수를 만든 카피라이터다.
아래 조건으로 9:16 세로 쇼츠 한 편을 설계해라. 반드시 JSON 하나만 출력하고 다른 말은 쓰지 마라.

주제: ${topic}
시청자: ${audience || '일반인'}
톤: ${tone}
영상 길이: 약 ${length}초
장면 수: ${scenes}개
구성 지침: ${roleGuide}

규칙:
- 첫 1~2초 장면의 자막은 스크롤을 멈추게 하는 강한 훅이어야 한다. 15자 안팎.
- 자막은 한 컷에 최대 2줄, 한 줄 18자 이내. 말하듯 자연스러운 한국어.
- 각 컷은 3~10초. 전체 합이 ${length}초에 가깝게.
- image_query는 그 장면을 표현하는 '영어' 명사구 2~4단어(무료 이미지 검색용). 예: "air conditioner cleaning", "rainy window night".
- 유튜브 제목은 40자 이내, 설명 첫 줄에 핵심 문장, 해시태그 8개 이내, 고정댓글은 질문형 1~2문장.
- 과장·거짓 정보·타인 비방 금지. 실제로 확인 가능한 내용만.

출력 JSON 형식:
{"title_candidates":["제목1","제목2","제목3"],
 "hook_pattern":"이 대본이 쓴 후킹 방식 한 줄",
 "shots":[{"n":1,"role":"hook","text":"자막","image_query":"english query","seconds":3}],
 "youtube":{"title":"","description":"","hashtags":["#쇼츠"],"pinned_comment":""},
 "thumbnail_text":"썸네일/첫 화면에 크게 넣을 6~12자"}`
  },

  blogPost({ topic, audience, tone, keywords }) {
    return `너는 네이버 블로그 상위노출 글을 쓰는 한국 마케팅 카피라이터다.
주제: ${topic}
독자: ${audience || '일반인'}
톤: ${tone}
핵심 키워드: ${keywords || topic}

조건:
- 한국어, 1,200~1,800자, 소제목 4개 이상, 문단은 2~3문장씩 짧게.
- 첫 문단 100자 안에 핵심 키워드를 넣고, 검색자가 바로 답을 얻도록.
- 실제로 도움이 되는 정보·체크리스트·비용/절차 같은 구체 내용 포함. 모르는 수치는 쓰지 말고 "업체에 확인" 같은 표현 사용.
- 마지막에 자연스러운 상담/문의 유도 1문단(과한 광고 문구 금지).
- 이모지는 문단开头에 1~2개만.
반드시 JSON 하나만 출력:
{"titles":["제목 후보1","제목 후보2","제목 후보3"],
 "meta_description":"80자 이내 요약",
 "markdown":"# 제목\\n\\n본문...",
 "hashtags":["#태그"],
 "faq":[{"q":"","a":""}],
 "cta":"마지막 유도 문장"}`
  },

  imageQuery({ topic, count }) {
    return `주제 "${topic}" 쇼츠에 쓸 무료 이미지 검색어를 영어로 ${count}개 만들어라. 각 항목은 2~4단어 명사구. JSON 배열만 출력: ["...","..."]`;
  }
};
