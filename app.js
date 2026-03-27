// ═══════════════════════════════════════════
// STORAGE (Supabase)
// ═══════════════════════════════════════════
const SUPABASE_URL = 'https://vihwzugbrulsxbembkby.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaHd6dWdicnVsc3hiZW1ia2J5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTI1NjAsImV4cCI6MjA5MDA4ODU2MH0.Gnh1verFEqdCD77puXRL3CA3vAu1oaW7DGxxyzlqv5U';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem('tb_settings') || 'null') || {
      phone: '02-711-6880',
      company: '주식회사 트립비토즈 | 대표이사 : 정지하 | 사업자등록번호 : 778-86-00179',
      address: '(06160) 서울시 강남구 테헤란로 415, L7 빌딩',
      website: 'https://www.tripbtoz.com/',
      websiteLabel: 'www.tripbtoz.com — 모든 여행자가 만나는 세상, 트립비토즈'
    };
  } catch { return {}; }
}
function setSettings(s) { localStorage.setItem('tb_settings', JSON.stringify(s)); }

function openSettings() {
  const s = getSettings();
  document.getElementById('s-phone').value = s.phone || '';
  document.getElementById('s-company').value = s.company || '';
  document.getElementById('s-address').value = s.address || '';
  document.getElementById('s-website').value = s.website || '';
  document.getElementById('s-websiteLabel').value = s.websiteLabel || '';
  document.getElementById('settings-modal').style.display = 'flex';
}
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
function closeSettingsOverlay(e) { if(e.target === e.currentTarget) closeSettings(); }
function saveSettings() {
  setSettings({
    phone: document.getElementById('s-phone').value.trim(),
    company: document.getElementById('s-company').value.trim(),
    address: document.getElementById('s-address').value.trim(),
    website: document.getElementById('s-website').value.trim(),
    websiteLabel: document.getElementById('s-websiteLabel').value.trim()
  });
  closeSettings();
  showToast('설정 저장됨');
  rp();
}

// ═══════════════════════════════════════════
// VIEW SWITCHING
// ═══════════════════════════════════════════
let currentView = 'list';
let currentTplId = null;

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  const isEditor = name === 'editor';
  document.getElementById('topbar-editor-actions').style.display = isEditor ? 'flex' : 'none';
  document.getElementById('topbar-editor-actions').style.flexDirection = 'row';
  document.getElementById('tpl-name-input').style.display = isEditor ? 'block' : 'none';
  document.getElementById('topbar-nav').style.display = isEditor ? 'none' : 'flex';
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const navMap = { list: 'nav-template', segment: 'nav-segment', sql: 'nav-sql' };
  if(navMap[name]) document.getElementById(navMap[name]).classList.add('active');
  currentView = name;
  if(name === 'list') renderTemplateList();
  if(name === 'segment') renderSegmentList();
  if(name === 'sql') initSQLView();
}

function goTab(tab) { showView(tab); }

function goList() { showView('list'); }

function newTemplate() {
  currentTplId = null;
  blocks = [];
  nextId = 1;
  document.getElementById('tpl-name-input').value = '';
  showView('editor');
  render(); rp();
}

async function editTemplate(id) {
  const { data: tpl, error } = await sb.from('templates').select('*').eq('id', id).single();
  if(error || !tpl) return;
  currentTplId = id;
  blocks = tpl.blocks || [];
  nextId = blocks.length > 0 ? Math.max(...blocks.map(b => b.id)) + 1 : 1;
  document.getElementById('tpl-name-input').value = tpl.name || '';
  showView('editor');
  render(); rp();
}

// ═══════════════════════════════════════════
// LIST VIEW
// ═══════════════════════════════════════════
async function renderTemplateList() {
  const { data: list, error } = await sb.from('templates').select('*').order('updated_at', { ascending: false });
  if(error) { console.error(error); return; }
  document.getElementById('tpl-count').textContent = `총 ${list.length}개`;
  const grid = document.getElementById('tpl-grid');
  if(list.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="8" y="6" width="32" height="36" rx="4" stroke="#ddd" stroke-width="2"/><path d="M16 16h16M16 22h16M16 28h10" stroke="#ddd" stroke-width="2" stroke-linecap="round"/></svg>
      <p>아직 템플릿이 없어요</p>
      <small>+ 새 템플릿 만들기를 눌러 시작하세요</small>
    </div>`;
    return;
  }
  grid.innerHTML = list.map(t => {
    const scale = (260 / 600).toFixed(4);
    const thumb = t.html
      ? `<div class="tpl-thumb-inner" style="transform:scale(${scale})">${t.html}</div>`
      : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ddd;font-size:12px">미리보기 없음</div>`;
    const updated = t.updated_at
      ? new Date(t.updated_at).toLocaleDateString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
      : '';
    return `<div class="tpl-card">
      <div class="tpl-thumb" onclick="editTemplate('${t.id}')">
        ${thumb}
        <div class="tpl-thumb-overlay"><span>편집하기</span></div>
      </div>
      <div class="tpl-info">
        <div class="tpl-name">${t.name || '제목 없는 템플릿'}</div>
        <div class="tpl-meta">수정: ${updated}</div>
      </div>
      <div class="tpl-actions">
        <button class="btn-secondary" onclick="editTemplate('${t.id}')">✏️ 편집</button>
        <button class="btn-secondary" onclick="duplicateTemplate('${t.id}')">복사</button>
        <button class="btn-danger" onclick="deleteTemplate('${t.id}')">삭제</button>
      </div>
    </div>`;
  }).join('');
}

async function duplicateTemplate(id) {
  const { data: src, error } = await sb.from('templates').select('*').eq('id', id).single();
  if(error || !src) return;
  const now = new Date().toISOString();
  const { error: err } = await sb.from('templates').insert({
    name: (src.name || '템플릿') + ' 복사본',
    blocks: src.blocks,
    html: src.html,
    created_at: now,
    updated_at: now
  });
  if(err) { showToast('복사 실패'); console.error(err); return; }
  renderTemplateList();
  showToast('복사되었어요');
}

async function deleteTemplate(id) {
  const { data: tpl } = await sb.from('templates').select('name').eq('id', id).single();
  if(!confirm(`"${tpl?.name||'이 템플릿'}"을 삭제할까요?`)) return;
  const { error } = await sb.from('templates').delete().eq('id', id);
  if(error) { showToast('삭제 실패'); console.error(error); return; }
  renderTemplateList();
  showToast('삭제되었어요');
}

// ═══════════════════════════════════════════
// EDITOR — BLOCK ENGINE
// ═══════════════════════════════════════════
const BLOCK_NAMES = {
  logo:'로고', title:'타이틀', text:'텍스트', highlight:'강조박스',
  hotels:'호텔그리드', reservation:'예약내역표', cta:'버튼(CTA)', divider:'구분선',
  notice:'안내사항', imagemap:'이미지+링크', banner:'앱배너', footer:'푸터'
};

let blocks = [], nextId = 1, sortable = null;

function addBlock(type) {
  const defaults = {
    logo:{}, title:{text:'새 타이틀', size:'24'}, text:{text:'텍스트를 입력하세요.'},
    highlight:{label:'강조 문구', sublabel:''},
    hotels:{hotels:[{name:'',area:'',price:'',img:'',link:''}]},
    reservation:{title:'예약 내역', rows:[
      {label:'예약번호',value:'${bookingId}'},{label:'숙소명',value:'${hotelName}'},
      {label:'숙소 주소',value:'${hotelAddress}'},{label:'예약일',value:'${checkin} ~ ${checkout} (${stayday}박)'},
    ], ctaText:'상세 내역 보기', ctaLink:'https://www.tripbtoz.com/mypage/reserve/${bookingId}'},
    cta:{text:'버튼 텍스트', link:'https://tripbtoz.com', style:'fill'},
    divider:{}, notice:{n1:'안내 문구 1', n2:'안내 문구 2'},
    imagemap:{src:'', naturalW:600, naturalH:300, areas:[]}, banner:{}, footer:{}
  };
  blocks.forEach(b => b.open = false);
  blocks.push({id:nextId++, type, open:true, data:{...defaults[type]}});
  render(); rp();
  setTimeout(() => {
    document.getElementById('block-list').scrollTop = document.getElementById('block-list').scrollHeight;
    const preview = document.querySelector('.preview-wrap');
    if(preview) preview.scrollTop = preview.scrollHeight;
  }, 60);
}

function moveBlock(idx, dir) {
  const ni = idx + dir;
  if(ni < 0 || ni >= blocks.length) return;
  [blocks[idx], blocks[ni]] = [blocks[ni], blocks[idx]];
  render(); rp();
}

function removeBlock(idx) {
  if(!confirm(`"${BLOCK_NAMES[blocks[idx].type]}" 블록을 삭제할까요?`)) return;
  blocks.splice(idx, 1); render(); rp();
}

function toggleBlock(idx) {
  const wasOpen = blocks[idx].open;
  blocks.forEach(b => b.open = false);
  blocks[idx].open = !wasOpen;
  render();
}

function getSummary(b) {
  if(!b.data) return '';
  if(b.type==='title') return b.data.text?.split('\n')[0]||'';
  if(b.type==='text') return (b.data.text||'').substring(0,50);
  if(b.type==='highlight') return b.data.label||'';
  if(b.type==='cta') return b.data.text||'';
  if(b.type==='hotels') return `${b.data.hotels?.length||0}개 호텔 카드`;
  if(b.type==='reservation') return b.data.title||'예약 내역';
  if(b.type==='notice') return (b.data.n1||'').substring(0,40);
  if(b.type==='imagemap') return b.data.src ? `${b.data.areas?.length||0}개 영역` : '이미지 없음';
  return '';
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderEditor(b, idx) {
  const t = b.type;
  if(['logo','divider','banner','footer'].includes(t)) return '<div class="no-edit-note">편집 항목 없음 — 고정 블록</div>';
  if(t==='title') return `
    <div class="fl">제목 텍스트</div>
    <textarea class="fi" rows="3" oninput="blocks[${idx}].data.text=this.value;rp()">${esc(b.data.text||'')}</textarea>
    <div class="fl">폰트 크기 (px)</div>
    <input class="fi" type="number" value="${b.data.size||24}" min="14" max="40" oninput="blocks[${idx}].data.size=this.value;rp()">`;
  if(t==='text') return `
    <div class="fl">본문</div>
    <textarea class="fi" rows="5" oninput="blocks[${idx}].data.text=this.value;rp()">${esc(b.data.text||'')}</textarea>`;
  if(t==='highlight') return `
    <div class="fl">메인 문구</div>
    <input class="fi" value="${esc(b.data.label||'')}" oninput="blocks[${idx}].data.label=this.value;rp()">
    <div class="fl">서브 문구</div>
    <input class="fi" value="${esc(b.data.sublabel||'')}" oninput="blocks[${idx}].data.sublabel=this.value;rp()">`;
  if(t==='cta') return `
    <div class="fl">버튼 텍스트</div>
    <input class="fi" value="${esc(b.data.text||'')}" oninput="blocks[${idx}].data.text=this.value;rp()">
    <div class="fl">링크 URL</div>
    <input class="fi" value="${esc(b.data.link||'')}" oninput="blocks[${idx}].data.link=this.value;rp()">
    <div class="fl">스타일</div>
    <select class="fi" onchange="blocks[${idx}].data.style=this.value;rp()">
      <option value="fill" ${b.data.style==='fill'?'selected':''}>채움 (보라색)</option>
      <option value="outline" ${b.data.style==='outline'?'selected':''}>아웃라인</option>
    </select>`;
  if(t==='notice') return `
    <div class="fl">안내 문구 1</div>
    <textarea class="fi" rows="2" oninput="blocks[${idx}].data.n1=this.value;rp()">${esc(b.data.n1||'')}</textarea>
    <div class="fl">안내 문구 2</div>
    <textarea class="fi" rows="2" oninput="blocks[${idx}].data.n2=this.value;rp()">${esc(b.data.n2||'')}</textarea>`;
  if(t==='hotels') {
    const hs = b.data.hotels||[];
    return `${hs.map((h,hi)=>`
      <div class="hotel-entry">
        <div class="hotel-entry-head"><span class="hotel-entry-label">카드 ${hi+1}</span>
          <button class="ba del" onclick="blocks[${idx}].data.hotels.splice(${hi},1);render();rp()">✕</button></div>
        <div class="fl">호텔명</div><input class="fi" value="${esc(h.name)}" oninput="blocks[${idx}].data.hotels[${hi}].name=this.value;rp()">
        <div class="fl">지역</div><input class="fi" value="${esc(h.area)}" oninput="blocks[${idx}].data.hotels[${hi}].area=this.value;rp()">
        <div class="fl">가격</div><input class="fi" value="${esc(h.price)}" oninput="blocks[${idx}].data.hotels[${hi}].price=this.value;rp()">
        <div class="fl">이미지 URL</div><input class="fi" placeholder="https://..." value="${esc(h.img)}" oninput="blocks[${idx}].data.hotels[${hi}].img=this.value;rp()">
        <div class="fl">예약 링크</div><input class="fi" value="${esc(h.link)}" oninput="blocks[${idx}].data.hotels[${hi}].link=this.value;rp()">
      </div>`).join('')}
    <button class="btn-add-hotel" onclick="blocks[${idx}].data.hotels.push({name:'',area:'',price:'',img:'',link:''});render();rp();scrollBlockEditorToBottom(${idx})">+ 호텔 카드 추가</button>`;
  }
  if(t==='reservation') {
    const rows = b.data.rows||[];
    return `
      <div class="fl">섹션 제목</div>
      <input class="fi" value="${esc(b.data.title||'')}" oninput="blocks[${idx}].data.title=this.value;rp()">
      <div class="fl">CTA 버튼 텍스트</div>
      <input class="fi" value="${esc(b.data.ctaText||'')}" oninput="blocks[${idx}].data.ctaText=this.value;rp()">
      <div class="fl">CTA 버튼 링크</div>
      <input class="fi" value="${esc(b.data.ctaLink||'')}" oninput="blocks[${idx}].data.ctaLink=this.value;rp()">
      <div class="fl" style="margin-top:12px">행 목록</div>
      ${rows.map((r,ri)=>`
        <div class="hotel-entry">
          <div class="hotel-entry-head"><span class="hotel-entry-label">행 ${ri+1}</span>
            <button class="ba del" onclick="blocks[${idx}].data.rows.splice(${ri},1);render();rp()">✕</button></div>
          <div class="fl">레이블</div><input class="fi" value="${esc(r.label)}" oninput="blocks[${idx}].data.rows[${ri}].label=this.value;rp()">
          <div class="fl">값 (변수 가능)</div><input class="fi" value="${esc(r.value)}" oninput="blocks[${idx}].data.rows[${ri}].value=this.value;rp()">
        </div>`).join('')}
      <button class="btn-add-hotel" onclick="blocks[${idx}].data.rows.push({label:'항목',value:'값'});render();rp();scrollBlockEditorToBottom(${idx})">+ 행 추가</button>`;
  }
  if(t==='imagemap') {
    const areas = b.data.areas||[];
    const hasImg = !!b.data.src;
    const fullLink = !!b.data.fullLink;
    return `
      <input type="file" class="fi-file" id="imgup-${idx}" accept="image/*" onchange="handleImgUpload(event,${idx})">
      ${hasImg ? `
        <button class="btn-add-hotel" style="margin-bottom:8px" onclick="document.getElementById('imgup-${idx}').click()">🔄 이미지 교체</button>
        <div class="fl">좌우 여백 (px)</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <input class="fi" type="range" min="0" max="128" step="4" value="${b.data.padding!=null?b.data.padding:32}" style="flex:1;padding:0"
            oninput="blocks[${idx}].data.padding=parseInt(this.value);this.nextElementSibling.textContent=this.value+'px';rp()">
          <span style="font-size:12px;font-weight:600;min-width:36px">${b.data.padding!=null?b.data.padding:32}px</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:${fullLink?'#f0ebff':'#f7f7f7'};border-radius:8px;border:1px solid ${fullLink?'#c4a8ff':'#ececec'};margin-bottom:10px;cursor:pointer"
          onclick="blocks[${idx}].data.fullLink=!blocks[${idx}].data.fullLink;blocks[${idx}].data.areas=[];render();rp()">
          <div style="width:18px;height:18px;border-radius:4px;border:2px solid ${fullLink?'#7B3CFF':'#ccc'};background:${fullLink?'#7B3CFF':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${fullLink?'<svg width="10" height="8" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>':''}
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:${fullLink?'#7B3CFF':'#555'}">이미지 전체 링크</div>
            <div style="font-size:10px;color:#aaa;margin-top:1px">이미지 전체가 하나의 링크</div>
          </div>
        </div>
        ${fullLink
          ? `<div class="fl">링크 URL</div>
             <input class="fi" placeholder="https://..." value="${esc(b.data.fullLinkHref||'')}" oninput="blocks[${idx}].data.fullLinkHref=this.value;rp()">
             <div class="fl">alt 텍스트</div>
             <input class="fi" value="${esc(b.data.fullLinkAlt||'')}" oninput="blocks[${idx}].data.fullLinkAlt=this.value;rp()">`
          : `<div style="font-size:11px;color:#7B3CFF;margin-bottom:6px;font-weight:600">이미지 위 드래그 → 클릭 영역 지정</div>
             <div class="imgmap-wrap" id="imwrap-${idx}" onmousedown="imStartDraw(event,${idx})">
               <img src="${b.data.src}" draggable="false">
               ${areas.map((a,ai)=>`
                 <div class="imgmap-area${a.selected?' selected':''}" style="left:${a.px}%;top:${a.py}%;width:${a.pw}%;height:${a.ph}%"
                   onclick="event.stopPropagation();imSelectArea(${idx},${ai})">
                   <div class="imgmap-area-label">${ai+1}</div>
                 </div>`).join('')}
               <div id="imdrawbox-${idx}" style="display:none;position:absolute;border:2px dashed #7B3CFF;background:rgba(123,60,255,0.1);pointer-events:none"></div>
             </div>
             <div class="imgmap-hint">드래그: 새 영역 · 영역 클릭: 선택</div>
             ${areas.length>0?`
               <div class="fl" style="margin-top:10px">클릭 영역 (${areas.length}개)</div>
               ${areas.map((a,ai)=>`
                 <div class="area-entry">
                   <div class="area-entry-head">
                     <span class="area-entry-label" onclick="imSelectArea(${idx},${ai})">영역 ${ai+1}${a.selected?' ✏️':''}</span>
                     <button class="ba del" onclick="blocks[${idx}].data.areas.splice(${ai},1);render();rp()">✕</button>
                   </div>
                   <div class="fl">링크 URL</div>
                   <input class="fi" placeholder="https://..." value="${esc(a.href||'')}" oninput="blocks[${idx}].data.areas[${ai}].href=this.value;rp()">
                   <div class="fl">alt 텍스트</div>
                   <input class="fi" value="${esc(a.alt||'')}" oninput="blocks[${idx}].data.areas[${ai}].alt=this.value;rp()">
                 </div>`).join('')}`:''}`
        }` : `<div class="btn-upload-img" onclick="document.getElementById('imgup-${idx}').click()">
          📁 이미지 클릭해서 업로드<br><span style="font-size:10px">PNG, JPG 지원</span>
        </div>`}`;
  }
  return '';
}

function render() {
  const list = document.getElementById('block-list');
  list.innerHTML = blocks.map((b,i) => `
    <div class="block-item${b.open?' active':''}" data-id="${b.id}">
      <div class="block-header" onclick="toggleBlock(${i})">
        <span class="drag-handle">⠿</span>
        <span class="block-badge">${BLOCK_NAMES[b.type]}</span>
        <span class="block-summary">${getSummary(b)}</span>
        <div class="block-actions">
          <button class="ba" onclick="event.stopPropagation();moveBlock(${i},-1)">↑</button>
          <button class="ba" onclick="event.stopPropagation();moveBlock(${i},1)">↓</button>
          <button class="ba del" onclick="event.stopPropagation();removeBlock(${i})">✕</button>
        </div>
        <span class="block-chevron">▼</span>
      </div>
      <div class="block-editor${b.open?' open':''}">${renderEditor(b,i)}</div>
    </div>`).join('');
  document.getElementById('block-count').textContent = `${blocks.length}개 블록`;
  if(sortable) sortable.destroy();
  sortable = Sortable.create(list, {
    handle: '.block-header',
    filter: '.block-actions,.block-actions *,.block-chevron',
    preventOnFilter: false,
    animation: 180, easing: 'cubic-bezier(0.25,1,0.5,1)',
    ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', dragClass: 'sortable-drag',
    scroll: true, scrollSensitivity: 80, scrollSpeed: 14,
    onEnd(evt) {
      if(evt.oldIndex===evt.newIndex) return;
      const moved = blocks.splice(evt.oldIndex,1)[0];
      blocks.splice(evt.newIndex,0,moved);
      render(); rp();
    }
  });
}

function blockToHTML(b) {
  const FF = "font-family:'맑은고딕','Malgun Gothic',Helvetica,sans-serif";
  if(b.type==='logo') return `<tr><td><img width="600" src="https://kr.object.ncloudstorage.com/tripbtoz-image/email/mail_mange_templates/logo_frame.png" style="display:block;width:100%"></td></tr>`;
  if(b.type==='divider') return `<tr><td style="padding:0 32px"><div style="height:1px;background:#eee"></div></td></tr>`;
  if(b.type==='banner') return `<tr><td align="center" style="padding:20px 0"><img src="https://asset.tripbtoz.com/email/mail_mange_templates/banner.jpg" width="536" style="display:inline-block;border:0"></td></tr>`;
  if(b.type==='footer') {
    const s = getSettings();
    return `<tr><td style="padding:24px 32px 40px;font-size:12px;color:#a0a0a0;line-height:20px;${FF}">본 메일은 발신 전용 메일입니다.<br>도움이 필요하신가요? <b>고객센터(${s.phone})</b>으로 문의해주세요.<br><br>${s.company}<br>${s.address}<br>Copyright (c) 2015. Tripbtoz, Inc. All Rights Reserved.<br><br><a href="${s.website}" style="color:#b3b3b3;text-decoration:none">${s.websiteLabel}</a></td></tr>`;
  }
  if(b.type==='title') { const lines=(b.data.text||'').split('\n').join('<br>'); return `<tr><td style="padding:28px 32px 12px;font-size:${b.data.size||24}px;color:#181818;line-height:1.4;${FF}"><b>${lines}</b></td></tr>`; }
  if(b.type==='text') { const lines=(b.data.text||'').split('\n').join('<br>'); return `<tr><td style="padding:8px 32px 20px;font-size:15px;color:#333;line-height:170%;${FF}">${lines}</td></tr>`; }
  if(b.type==='highlight') return `<tr><td style="padding:4px 32px 20px"><div style="background:#fff8e1;border-left:3px solid #f5a623;border-radius:0 6px 6px 0;padding:14px 18px"><div style="font-size:14px;font-weight:bold;color:#181818;margin-bottom:4px;${FF}">${b.data.label||''}</div>${b.data.sublabel?`<div style="font-size:13px;color:#666;${FF}">${b.data.sublabel}</div>`:''}</div></td></tr>`;
  if(b.type==='cta') { const s=b.data.style==='outline'?'border:2px solid #7B3CFF;color:#7B3CFF;background:#fff':'background:#7B3CFF;color:#fff;border:2px solid #7B3CFF'; return `<tr><td align="center" style="padding:16px 0 24px"><a href="${b.data.link||'#'}" style="display:inline-block;padding:13px 36px;border-radius:6px;font-size:15px;font-weight:bold;text-decoration:none;${s};${FF}">${b.data.text||'버튼'}</a></td></tr>`; }
  if(b.type==='notice') return `<tr><td style="padding:0 20px 24px"><table cellpadding="0" cellspacing="0" style="width:100%;background:#f6f6f6;border-radius:8px"><tr><td style="padding:18px 24px;font-size:13px;color:#6a6a6a;line-height:22px;${FF}"><b>꼭! 확인해주세요.</b><ul style="margin:10px 0 0 18px;padding:0">${b.data.n1?`<li style="margin-bottom:6px">${b.data.n1}</li>`:''}${b.data.n2?`<li>${b.data.n2}</li>`:''}</ul></td></tr></table></td></tr>`;
  if(b.type==='reservation') {
    const rows=b.data.rows||[];
    const rowsHTML=rows.map(r=>`<tr><td width="32"></td><td style="width:140px;padding:14px 0 14px 24px;font-size:15px;color:#818286;vertical-align:top;line-height:1.5;border-bottom:1px solid #f0f0f0;${FF}">${r.label}</td><td style="padding:14px 24px 14px 16px;font-size:15px;color:#121212;vertical-align:top;line-height:1.5;border-bottom:1px solid #f0f0f0;${FF}">${r.value}</td><td width="32"></td></tr>`).join('');
    return `<tr><td style="padding:8px 0 0"><table cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;margin:0 auto"><tbody><tr><td width="32"></td><td colspan="2" style="height:2px;background:#121212;padding:0"></td><td width="32"></td></tr><tr><td width="32"></td><td colspan="2" style="padding:14px 0 14px 24px;font-size:17px;color:#121212;border-bottom:2px solid #eee;${FF}"><b>${b.data.title||'예약 내역'}</b></td><td width="32"></td></tr>${rowsHTML}</tbody></table></td></tr>${b.data.ctaText?`<tr><td align="center" style="padding:24px 0 28px;${FF}"><a href="${b.data.ctaLink||'#'}" style="display:inline-block;padding:13px 32px;border-radius:6px;background:#7B3CFF;color:#fff;font-size:15px;text-decoration:none;${FF}"><b>${b.data.ctaText}</b></a></td></tr>`:''}<tr><td style="padding:0 32px"><div style="height:1px;background:#eee"></div></td></tr>`;
  }
  if(b.type==='imagemap') {
    if(!b.data.src) return '<tr><td style="padding:8px 32px;font-size:12px;color:#aaa;text-align:center">이미지를 업로드해주세요</td></tr>';
    const pad=b.data.padding!=null?b.data.padding:32;
    const imgW=600-pad*2;
    const radius=pad>0?'border-radius:8px;':'';
    const imgStyle=`display:inline-block;border:0;max-width:${imgW}px;width:100%;${radius}`;
    if(b.data.fullLink) return `<tr><td align="center" style="padding:8px ${pad}px"><a href="${b.data.fullLinkHref||'#'}" target="_blank" style="display:block;line-height:0"><img src="${b.data.src}" width="${imgW}" alt="${b.data.fullLinkAlt||''}" style="${imgStyle}"></a></td></tr>`;
    const nw=b.data.naturalW||600, nh=b.data.naturalH||300;
    const mapId=`map_${b.id}`;
    const areas=(b.data.areas||[]).map(a=>`<area shape="rect" alt="${a.alt||''}" coords="${Math.round(a.px/100*nw)},${Math.round(a.py/100*nh)},${Math.round((a.px+a.pw)/100*nw)},${Math.round((a.py+a.ph)/100*nh)}" href="${a.href||'#'}" target="_blank">`).join('');
    return `<tr><td align="center" style="padding:8px ${pad}px"><img src="${b.data.src}" width="${imgW}" usemap="#${mapId}" style="${imgStyle}"><map name="${mapId}" id="${mapId}">${areas}</map></td></tr>`;
  }
  if(b.type==='hotels') {
    const hs=b.data.hotels||[];
    const card=h=>{
      const img=h.img?`<img src="${h.img}" width="100%" style="display:block;height:150px;object-fit:cover">`:`<div style="width:100%;height:150px;background:#c8b9a8;display:flex;align-items:center;justify-content:center"><span style="font-size:11px;color:#888">이미지</span></div>`;
      return `<table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;background:#fff"><tr><td>${img}</td></tr><tr><td style="padding:12px 14px;${FF}"><div style="font-size:14px;font-weight:bold;color:#181818;margin-bottom:3px">${h.name||'호텔명'}</div><div style="font-size:12px;color:#818286;margin-bottom:10px">${h.area||''}</div><div style="font-size:16px;font-weight:bold;color:#181818">${h.price||''}</div><div style="font-size:11px;color:#818286;margin-top:2px">1박 기준</div></td></tr></table>`;
    };
    const rows=[];
    for(let i=0;i<hs.length;i+=2) rows.push(`<tr><td width="32"></td><td style="padding:0 5px 10px 0;vertical-align:top;width:262px">${card(hs[i])}</td><td style="padding:0 0 10px 5px;vertical-align:top;width:262px">${hs[i+1]?card(hs[i+1]):''}</td><td width="32"></td></tr>`);
    return `<tr><td style="padding:4px 0 8px"><table cellpadding="0" cellspacing="0" width="100%">${rows.join('')}</table></td></tr>`;
  }
  return '';
}

function rp() {
  const rows = blocks.map(b => blockToHTML(b)).join('\n');
  document.getElementById('preview').innerHTML = `<table cellpadding="0" cellspacing="0" width="100%" style="background:#fff;border-collapse:collapse">${rows}</table>`;
}

// ═══════════════════════════════════════════
// IMAGE MAP
// ═══════════════════════════════════════════
let imDrawing=false, imStartX=0, imStartY=0, imCurIdx=-1;

function handleImgUpload(e, idx) {
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      blocks[idx].data.src = ev.target.result;
      blocks[idx].data.naturalW = img.naturalWidth;
      blocks[idx].data.naturalH = img.naturalHeight;
      blocks[idx].data.areas = [];
      blocks[idx].open = true;
      render(); rp();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function imGetRelPos(e, wrap) {
  const r = wrap.getBoundingClientRect();
  return { x: Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)), y: Math.max(0,Math.min(1,(e.clientY-r.top)/r.height)) };
}

function imStartDraw(e, idx) {
  if(e.target.classList.contains('imgmap-area')) return;
  imDrawing=true; imCurIdx=idx;
  const wrap=document.getElementById(`imwrap-${idx}`);
  const pos=imGetRelPos(e,wrap);
  imStartX=pos.x; imStartY=pos.y;
  const box=document.getElementById(`imdrawbox-${idx}`);
  box.style.cssText=`display:block;position:absolute;border:2px dashed #7B3CFF;background:rgba(123,60,255,0.1);pointer-events:none;left:${imStartX*100}%;top:${imStartY*100}%;width:0;height:0`;
  e.preventDefault();
}

function _imFinish(e) {
  if(!imDrawing) return;
  const idx=imCurIdx; imDrawing=false; imCurIdx=-1;
  const wrap=document.getElementById(`imwrap-${idx}`); if(!wrap) return;
  const box=document.getElementById(`imdrawbox-${idx}`); if(box) box.style.display='none';
  const pos=imGetRelPos(e,wrap);
  const px=Math.min(imStartX,pos.x)*100, py=Math.min(imStartY,pos.y)*100;
  const pw=Math.abs(pos.x-imStartX)*100, ph=Math.abs(pos.y-imStartY)*100;
  if(pw<2||ph<2) return;
  blocks[idx].data.areas.forEach(a=>a.selected=false);
  blocks[idx].data.areas.push({px,py,pw,ph,href:'',alt:'',selected:true});
  render(); rp();
}

function imSelectArea(idx, ai) { blocks[idx].data.areas.forEach((a,i)=>a.selected=(i===ai)); render(); }

document.addEventListener('mouseup', e => { if(imDrawing) _imFinish(e); });
document.addEventListener('mousemove', e => {
  if(!imDrawing) return;
  const wrap=document.getElementById(`imwrap-${imCurIdx}`); if(!wrap) return;
  const pos=imGetRelPos(e,wrap);
  const x=Math.min(imStartX,pos.x), y=Math.min(imStartY,pos.y);
  const box=document.getElementById(`imdrawbox-${imCurIdx}`); if(!box) return;
  box.style.left=(x*100)+'%'; box.style.top=(y*100)+'%';
  box.style.width=(Math.abs(pos.x-imStartX)*100)+'%'; box.style.height=(Math.abs(pos.y-imStartY)*100)+'%';
});

function scrollBlockEditorToBottom(idx) {
  const blockId = blocks[idx]?.id;
  if(blockId == null) return;
  const editor = document.querySelector(`.block-item[data-id="${blockId}"] .block-editor`);
  if(editor) editor.scrollTop = editor.scrollHeight;
}

// ═══════════════════════════════════════════
// SAVE / COPY
// ═══════════════════════════════════════════
async function saveTemplate() {
  const name = document.getElementById('tpl-name-input').value.trim() || '제목 없는 템플릿';
  const html = document.getElementById('preview').innerHTML;
  const now = new Date().toISOString();
  if(currentTplId) {
    const { error } = await sb.from('templates').update({ name, blocks, html, updated_at: now }).eq('id', currentTplId);
    if(error) { showToast('저장 실패'); console.error(error); return; }
  } else {
    const { data, error } = await sb.from('templates').insert({ name, blocks, html, created_at: now, updated_at: now }).select('id').single();
    if(error) { showToast('저장 실패'); console.error(error); return; }
    currentTplId = data.id;
  }
  showToast('💾 저장되었어요');
}

function copyHTML() {
  const html = document.getElementById('preview').innerHTML;
  navigator.clipboard.writeText(html).then(() => showToast('✅ HTML 복사됨')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = html; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    showToast('✅ HTML 복사됨');
  });
}

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
renderTemplateList();

// ═══════════════════════════════════════════
// SQL EDITOR
// ═══════════════════════════════════════════
function initSQLView() {
  const input = document.getElementById('sql-input');
  if(input._sqlKeyBound) return;
  input._sqlKeyBound = true;
  input.addEventListener('keydown', e => {
    if((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runSQL(); }
    if(e.key === 'Tab') { e.preventDefault(); const s = input.selectionStart; input.value = input.value.slice(0,s) + '  ' + input.value.slice(input.selectionEnd); input.selectionStart = input.selectionEnd = s + 2; }
  });
}

function clearSQL() {
  document.getElementById('sql-input').value = '';
  document.getElementById('sql-result-bar').innerHTML = '';
  document.getElementById('sql-result-body').innerHTML = '<div class="sql-empty">쿼리를 실행하면 결과가 여기에 표시됩니다</div>';
  document.getElementById('sql-input').focus();
}

async function runSQL() {
  const sql = document.getElementById('sql-input').value.trim();
  if(!sql) return;

  const btn = document.getElementById('sql-run-btn');
  btn.disabled = true; btn.textContent = '실행 중...';
  document.getElementById('sql-result-bar').innerHTML = '';
  document.getElementById('sql-result-body').innerHTML = '<div class="sql-empty">실행 중...</div>';

  try {
    const res = await fetch('http://localhost:3001/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const data = await res.json();

    if(data.error) {
      document.getElementById('sql-result-bar').innerHTML = `<span class="sql-stat-err">오류</span>`;
      document.getElementById('sql-result-body').innerHTML = `<div class="sql-error">${data.error}</div>`;
      return;
    }

    if(data.type === 'ok') {
      document.getElementById('sql-result-bar').innerHTML = `<span class="sql-stat-ok">완료</span> ${data.affectedRows}행 영향 · ${data.elapsed}ms`;
      document.getElementById('sql-result-body').innerHTML = '';
      return;
    }

    document.getElementById('sql-result-bar').innerHTML =
      `<span class="sql-stat-ok">완료</span> ${data.total.toLocaleString()}행 · ${data.elapsed}ms`;

    if(data.rows.length === 0) {
      document.getElementById('sql-result-body').innerHTML = '<div class="sql-empty">결과 없음</div>';
      return;
    }

    const thead = `<thead><tr>${data.columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${data.rows.map(row =>
      `<tr>${row.map(v => `<td>${v === null ? '<span class="sql-null">NULL</span>' : String(v)}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;

    document.getElementById('sql-result-body').innerHTML =
      `<div class="sql-table-wrap"><table class="sql-table">${thead}${tbody}</table></div>`;
  } catch(e) {
    document.getElementById('sql-result-bar').innerHTML = `<span class="sql-stat-err">연결 실패</span>`;
    document.getElementById('sql-result-body').innerHTML = `<div class="sql-error">서버에 연결할 수 없어요. <code>npm run dev</code> 실행 중인지 확인하세요.</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '▶ 실행';
  }
}

// ═══════════════════════════════════════════
// SEGMENT
// ═══════════════════════════════════════════
let parsedEmails = [];
let segViewMode = false;

async function renderSegmentList() {
  const { data: list, error } = await sb.from('segments').select('id,name,count,created_at').order('created_at', { ascending: false });
  if(error) { console.error(error); return; }
  document.getElementById('seg-count').textContent = `총 ${list.length}개`;
  const grid = document.getElementById('seg-grid');
  if(list.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" stroke="#ddd" stroke-width="2"/><path d="M17 24h14M24 17v14" stroke="#ddd" stroke-width="2" stroke-linecap="round"/></svg>
      <p>아직 세그먼트가 없어요</p>
      <small>CSV를 업로드해서 수신자 그룹을 만드세요</small>
    </div>`;
    return;
  }
  grid.innerHTML = list.map(s => {
    const created = s.created_at
      ? new Date(s.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    return `<div class="seg-card">
      <div class="seg-card-top">
        <div class="seg-icon">👥</div>
        <div class="seg-info">
          <div class="seg-name">${s.name}</div>
          <div class="seg-meta">${created}</div>
        </div>
      </div>
      <div class="seg-count-badge">${Number(s.count).toLocaleString()}명</div>
      <div class="seg-card-actions">
        <button class="btn-secondary" onclick="viewSegment('${s.id}')">보기</button>
        <button class="btn-danger" onclick="deleteSegment('${s.id}', '${s.name}')">삭제</button>
      </div>
    </div>`;
  }).join('');
}

function openNewSegment() {
  segViewMode = false;
  parsedEmails = [];
  document.getElementById('seg-modal-title').textContent = '새 세그먼트 만들기';
  document.getElementById('seg-name').value = '';
  document.getElementById('seg-name').readOnly = false;
  document.getElementById('seg-upload-area').style.display = 'block';
  document.getElementById('csv-result').style.display = 'none';
  document.getElementById('csv-drop').innerHTML = `<div class="csv-drop-icon">📂</div><div class="csv-drop-text">CSV 파일을 선택하거나 여기에 드래그하세요</div><div class="csv-drop-sub">이메일 컬럼이 포함된 CSV 파일 (email, 이메일 등)</div>`;
  document.getElementById('csv-file').value = '';
  document.getElementById('seg-save-btn').style.display = 'inline-flex';
  document.getElementById('seg-save-btn').disabled = true;
  document.getElementById('seg-save-btn').textContent = '저장';
  setupCSVDrop();
  document.getElementById('seg-modal').style.display = 'flex';
}

async function viewSegment(id) {
  const { data, error } = await sb.from('segments').select('*').eq('id', id).single();
  if(error || !data) { showToast('불러오기 실패'); return; }
  document.getElementById('seg-modal-title').textContent = data.name;
  document.getElementById('seg-name').value = data.name;
  document.getElementById('seg-name').readOnly = true;
  document.getElementById('seg-upload-area').style.display = 'none';
  document.getElementById('seg-save-btn').style.display = 'none';
  showEmailTable(data.emails);
  document.getElementById('seg-modal').style.display = 'flex';
}

function closeNewSegment() { document.getElementById('seg-modal').style.display = 'none'; }
function closeSegModalOverlay(e) { if(e.target === e.currentTarget) closeNewSegment(); }

function setupCSVDrop() {
  const drop = document.getElementById('csv-drop');
  drop.ondragover = e => { e.preventDefault(); drop.style.borderColor = '#7B3CFF'; drop.style.background = '#f5f0ff'; };
  drop.ondragleave = () => { drop.style.borderColor = ''; drop.style.background = ''; };
  drop.ondrop = e => {
    e.preventDefault();
    drop.style.borderColor = ''; drop.style.background = '';
    const file = e.dataTransfer.files[0];
    if(file && file.name.endsWith('.csv')) readCSVFile(file);
    else showToast('CSV 파일만 업로드 가능합니다');
  };
}

function handleCSV(input) {
  if(input.files[0]) readCSVFile(input.files[0]);
}

function readCSVFile(file) {
  const reader = new FileReader();
  reader.onload = e => parseCSV(e.target.result, file.name);
  reader.readAsText(file, 'UTF-8');
}

function parseCSV(text, fileName) {
  if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.trim().split(/\r?\n/);
  if(lines.length < 2) { showToast('데이터가 없습니다'); return; }

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const emailIdx = headers.findIndex(h => /email|이메일|e-mail|mail/i.test(h));

  if(emailIdx === -1) {
    showToast('이메일 컬럼을 찾을 수 없어요 (email, 이메일, mail 중 하나 필요)');
    return;
  }

  const emails = [];
  for(let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const email = (cols[emailIdx] || '').trim().replace(/^"|"$/g, '');
    if(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) emails.push(email);
  }

  if(emails.length === 0) { showToast('유효한 이메일이 없습니다'); return; }

  parsedEmails = emails;
  document.getElementById('csv-drop').innerHTML = `<div style="font-size:13px;font-weight:600;color:#181818">📄 ${fileName}</div><div style="font-size:11px;color:#999;margin-top:4px">다른 파일로 교체하려면 클릭</div>`;
  showEmailTable(emails);
  document.getElementById('seg-save-btn').disabled = false;
}

function parseCSVLine(line) {
  const result = []; let inQuote = false; let cur = '';
  for(const c of line) {
    if(c === '"') inQuote = !inQuote;
    else if(c === ',' && !inQuote) { result.push(cur); cur = ''; }
    else cur += c;
  }
  result.push(cur);
  return result;
}

function showEmailTable(emails) {
  const result = document.getElementById('csv-result');
  result.style.display = 'block';
  const preview = emails.slice(0, 100);
  const more = emails.length - preview.length;
  document.getElementById('csv-stat').innerHTML = `총 <strong>${emails.length.toLocaleString()}명</strong>의 이메일 주소`;
  document.getElementById('csv-table').innerHTML = `
    <thead><tr><th>#</th><th>이메일</th></tr></thead>
    <tbody>
      ${preview.map((e, i) => `<tr><td>${i + 1}</td><td>${e}</td></tr>`).join('')}
      ${more > 0 ? `<tr><td colspan="2" class="csv-more">... 외 ${more.toLocaleString()}명 더</td></tr>` : ''}
    </tbody>`;
}

async function saveSegment() {
  const name = document.getElementById('seg-name').value.trim();
  if(!name) { showToast('세그먼트 이름을 입력해주세요'); return; }
  if(parsedEmails.length === 0) { showToast('이메일 목록이 없습니다'); return; }

  const btn = document.getElementById('seg-save-btn');
  btn.disabled = true; btn.textContent = '저장 중...';

  const { error } = await sb.from('segments').insert({ name, emails: parsedEmails, count: parsedEmails.length });
  if(error) { showToast('저장 실패: ' + error.message); btn.disabled = false; btn.textContent = '저장'; return; }

  closeNewSegment();
  showToast(`"${name}" 저장 완료 (${parsedEmails.length.toLocaleString()}명)`);
  renderSegmentList();
}

function downloadCSVTemplate() {
  const csv = 'email,name\nsample@tripbtoz.com,홍길동\n';
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'segment_template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function deleteSegment(id, name) {
  if(!confirm(`"${name}" 세그먼트를 삭제할까요?`)) return;
  const { error } = await sb.from('segments').delete().eq('id', id);
  if(error) { showToast('삭제 실패'); return; }
  showToast('세그먼트 삭제됨');
  renderSegmentList();
}
