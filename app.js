// ═══════════════════════════════════════════
// API BASE URL
// ═══════════════════════════════════════════
const API_BASE = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? ''
  : 'https://email-automation-production-7cba.up.railway.app';

// ═══════════════════════════════════════════
// STORAGE (Supabase)
// ═══════════════════════════════════════════
const SUPABASE_URL = 'https://vihwzugbrulsxbembkby.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaHd6dWdicnVsc3hiZW1ia2J5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTI1NjAsImV4cCI6MjA5MDA4ODU2MH0.Gnh1verFEqdCD77puXRL3CA3vAu1oaW7DGxxyzlqv5U';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);


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
  document.getElementById('topbar-logo').style.display = isEditor ? 'none' : 'flex';
  document.getElementById('topbar-back-btn').style.display = isEditor ? 'inline-flex' : 'none';
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const navMap = { list: 'nav-template', dashboard: 'nav-dashboard', segment: 'nav-segment', sql: 'nav-sql', automation: 'nav-automation' };
  if(navMap[name]) document.getElementById(navMap[name]).classList.add('active');
  currentView = name;
  if(name === 'list') renderTemplateList();
  if(name === 'dashboard') renderDashboard();
  if(name === 'segment') renderSegmentList();
  if(name === 'sql') initSQLView();
  if(name === 'automation') initAutomationPage();
}

function goTab(tab) { showView(tab); }

function goList() { showView('list'); }

function newTemplate() {
  currentTplId = null;
  nextId = 1;
  blocks = [
    { id: nextId++, type: 'logo',   open: false, data: {} },
    { id: nextId++, type: 'title',  open: false, data: { text: '이메일 제목을 입력하세요', size: '24' } },
    { id: nextId++, type: 'text',   open: false, data: { text: '본문 내용을 입력하세요.' } },
    { id: nextId++, type: 'notice', open: false, data: { n1: '안내 문구 1', n2: '안내 문구 2' } },
    { id: nextId++, type: 'banner', open: false, data: {} },
    { id: nextId++, type: 'footer', open: false, data: {} },
  ];
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
        <button class="btn-schedule" onclick="openScheduleModal('${t.id}','${(t.name||'제목 없는 템플릿').replace(/'/g,"\\'")}')">📅 발송 예약</button>
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
  logo:'로고', title:'타이틀', subtitle:'서브타이틀', text:'텍스트', highlight:'강조박스',
  hotels:'호텔그리드', reservation:'예약내역표', cta:'버튼(CTA)', divider:'구분선',
  notice:'안내사항', imagemap:'이미지+링크', banner:'앱배너', footer:'푸터'
};

let blocks = [], nextId = 1, sortable = null;

function addBlock(type) {
  const defaults = {
    logo:{}, title:{text:'새 타이틀', size:'24'}, subtitle:{text:'서브타이틀을 입력하세요', size:'18'}, text:{text:'텍스트를 입력하세요.'},
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
  if(b.type==='subtitle') return b.data.text?.split('\n')[0]||'';
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
  if(['logo','divider','banner'].includes(t)) return '<div class="no-edit-note">편집 항목 없음 — 고정 블록</div>';
  if(t==='footer') return `
    <div class="fl">푸터 유형</div>
    <div class="fv" style="display:flex;gap:8px">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="radio" name="footer-type-${b.id}" value="marketing" ${(b.data.footerType||'marketing')==='marketing'?'checked':''} onchange="blocks[${idx}].data.footerType=this.value;render();rp()">
        <span style="font-size:13px">광고성 (수신거부 포함)</span>
      </label>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="radio" name="footer-type-${b.id}" value="info" ${b.data.footerType==='info'?'checked':''} onchange="blocks[${idx}].data.footerType=this.value;render();rp()">
        <span style="font-size:13px">일반 정보성</span>
      </label>
    </div>`;
  if(t==='title') return `
    <div class="fl">제목 텍스트</div>
    <textarea class="fi" rows="3" oninput="blocks[${idx}].data.text=this.value;rp()">${esc(b.data.text||'')}</textarea>
    <div class="fl">폰트 크기 (px)</div>
    <input class="fi" type="number" value="${b.data.size||24}" min="14" max="40" oninput="blocks[${idx}].data.size=this.value;rp()">`;
  if(t==='subtitle') return `
    <div class="fl">서브타이틀 텍스트</div>
    <textarea class="fi" rows="3" oninput="blocks[${idx}].data.text=this.value;rp()">${esc(b.data.text||'')}</textarea>
    <div class="fl">폰트 크기 (px)</div>
    <input class="fi" type="number" value="${b.data.size||18}" min="12" max="32" oninput="blocks[${idx}].data.size=this.value;rp()">`;
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
    const cartBtn = cartHotels.length > 0
      ? `<button class="btn-load-cart" onclick="loadCartToBlock(${idx})">🏨 담아둔 호텔 불러오기 (${cartHotels.length}개)</button>`
      : `<div class="cart-empty-hint">SQL 탭에서 hotel_id 포함 쿼리 실행 후 호텔을 담아오면 여기서 불러올 수 있어요</div>`;
    return `${cartBtn}${hs.map((h,hi)=>`
      <div class="hotel-entry">
        <div class="hotel-entry-head"><span class="hotel-entry-label">카드 ${hi+1}</span>
          <button class="ba del" onclick="blocks[${idx}].data.hotels.splice(${hi},1);render();rp()">✕</button></div>
        <div class="fl">호텔명</div><input class="fi" value="${esc(h.name)}" oninput="blocks[${idx}].data.hotels[${hi}].name=this.value;rp()">
        <div class="fl">지역</div><input class="fi" value="${esc(h.area)}" oninput="blocks[${idx}].data.hotels[${hi}].area=this.value;rp()">
        <div class="fl">가격 (숫자만, 예: 150000)</div><input class="fi" type="number" value="${esc(h.price||'')}" oninput="blocks[${idx}].data.hotels[${hi}].price=this.value;rp()">
        <div class="fl">할인율 % (없으면 빈칸)</div><input class="fi" type="number" min="0" max="99" value="${esc(h.discount||'')}" oninput="blocks[${idx}].data.hotels[${hi}].discount=this.value;rp()">
        <div class="fl">이미지 URL</div><input class="fi" placeholder="https://..." value="${esc(h.img)}" oninput="blocks[${idx}].data.hotels[${hi}].img=this.value;rp()">
        <div class="fl">예약 링크</div><input class="fi" value="${esc(h.link)}" oninput="blocks[${idx}].data.hotels[${hi}].link=this.value;rp()">
      </div>`).join('')}
    <button class="btn-add-hotel" onclick="blocks[${idx}].data.hotels.push({name:'',area:'',price:'',discount:'',img:'',link:''});render();rp();scrollBlockEditorToBottom(${idx})">+ 호텔 카드 추가</button>`;
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
    const isMarketing = (b.data.footerType || 'marketing') === 'marketing';
    if(isMarketing) {
      return `<tr><td style="padding:32px 0">
<table style="max-width:600px;min-width:320px;width:100%;margin:0 auto;color:#222;word-break:keep-all;"><tbody>
<tr><td width="32"></td><td style="padding-bottom:10px;font-size:12px;color:#a0a0a0;line-height:20px;vertical-align:top;${FF}">
<p>본 메일은 정보통신망 이용 촉진 및 정보 보호 등에 관한 법률 시행 규칙에 의거하여 <br>2024년 6월 3일 트립비토즈 회원님의 이메일 수신동의 여부를 확인 후 보내드리고 있습니다.<br>광고정보수신 정보의 변경을 원하시는 경우, [트립비토즈 앱 - 마이 탭 - 설정]에서 광고 수신을 거부하실 수 있습니다.</p>
<p>메일 수신을 원치 않으시면 <a href="{{UNSUB_URL}}" target="_blank" style="color:#B3B3B3;">[수신거부]</a>를 클릭하세요.</p>
</td></tr>
<tr><td width="32"></td><td style="padding-bottom:10px;font-size:12px;color:#a0a0a0;line-height:18px;vertical-align:top;${FF}">
주식회사 트립비토즈 &nbsp;|&nbsp; 대표이사 : 정지하 &nbsp;|&nbsp;사업자등록번호 : 778-86-00179<br>
(06160) 서울시 강남구 테헤란로 415, L7 빌딩<br>
Copyright (c) 2015. Tripbtoz, Inc. All Rights Reserved.
</td></tr>
<tr><td width="32"></td><td style="font-size:12px;color:#a0a0a0;line-height:22px;vertical-align:top;${FF}">
<a href="https://www.tripbtoz.com/" target="_blank" style="color:#B3B3B3;">www.tripbtoz.com</a><br>
모든 여행자가 만나는 세상, 트립비토즈
</td></tr>
<tr><td width="32"></td><td style="padding-top:12px;vertical-align:top;">
<table cellpadding="0" cellspacing="0"><tbody><tr>
<td style="padding-right:8px"><a href="https://www.instagram.com/tripbtoz" target="_blank"><img src="https://kr.object.ncloudstorage.com/tripbtoz-image/email/mail_mange_templates/img_Instagram.png" width="32" height="32" border="0"></a></td>
<td style="padding-right:8px"><a href="https://www.facebook.com/Tripbtoz" target="_blank"><img src="https://kr.object.ncloudstorage.com/tripbtoz-image/email/mail_mange_templates/img_facebook.png" width="32" height="32" border="0"></a></td>
<td style="padding-right:8px"><a href="https://www.youtube.com/c/%ED%8A%B8%EB%A6%BD%EB%B9%84%ED%86%A0%EC%A6%88" target="_blank"><img src="https://kr.object.ncloudstorage.com/tripbtoz-image/email/mail_mange_templates/img_youtube.png" width="32" height="32" border="0"></a></td>
<td style="padding-right:8px"><a href="https://blog.naver.com/tripbtoz" target="_blank"><img src="https://kr.object.ncloudstorage.com/tripbtoz-image/email/mail_mange_templates/img_blog.png" width="32" height="32" border="0"></a></td>
</tr></tbody></table>
</td></tr>
</tbody></table>
</td></tr>`;
    } else {
      return `<tr><td style="padding:32px 0">
<table style="max-width:600px;min-width:320px;width:100%;margin:0 auto;color:#222;word-break:keep-all"><tbody>
<tr><td width="32"></td><td style="padding-bottom:10px;font-size:12px;color:#a0a0a0;line-height:20px;vertical-align:top;${FF}">
본 메일은 발신 전용 메일입니다.<br>
도움이 필요하신가요? <u><b>고객센터(02-711-6880)</b></u>로 문의해주세요.
</td></tr>
<tr><td width="32"></td><td style="padding-bottom:10px;font-size:12px;color:#a0a0a0;line-height:18px;vertical-align:top;${FF}">
주식회사 트립비토즈 &nbsp;|&nbsp; 대표이사 : 정지하 &nbsp;|&nbsp;사업자등록번호 : 778-86-00179<br>
(06160) 서울시 강남구 테헤란로 415, L7 빌딩<br>
Copyright (c) 2015. Tripbtoz, Inc. All Rights Reserved.
</td></tr>
<tr><td width="32"></td><td style="font-size:12px;color:#a0a0a0;line-height:22px;vertical-align:top;${FF}">
<a href="https://www.tripbtoz.com/" target="_blank" style="color:#B3B3B3;">www.tripbtoz.com</a><br>
모든 여행자가 만나는 세상, 트립비토즈
</td></tr>
<tr><td width="32"></td><td style="padding-top:12px;vertical-align:top;">
<table cellpadding="0" cellspacing="0"><tbody><tr>
<td style="padding-right:8px"><a href="https://www.instagram.com/tripbtoz" target="_blank"><img src="https://kr.object.ncloudstorage.com/tripbtoz-image/email/mail_mange_templates/img_Instagram.png" width="32" height="32" border="0"></a></td>
<td style="padding-right:8px"><a href="https://www.facebook.com/Tripbtoz" target="_blank"><img src="https://kr.object.ncloudstorage.com/tripbtoz-image/email/mail_mange_templates/img_facebook.png" width="32" height="32" border="0"></a></td>
<td style="padding-right:8px"><a href="https://www.youtube.com/c/%ED%8A%B8%EB%A6%BD%EB%B9%84%ED%86%A0%EC%A6%88" target="_blank"><img src="https://kr.object.ncloudstorage.com/tripbtoz-image/email/mail_mange_templates/img_youtube.png" width="32" height="32" border="0"></a></td>
<td style="padding-right:8px"><a href="https://blog.naver.com/tripbtoz" target="_blank"><img src="https://kr.object.ncloudstorage.com/tripbtoz-image/email/mail_mange_templates/img_blog.png" width="32" height="32" border="0"></a></td>
</tr></tbody></table>
</td></tr>
</tbody></table>
</td></tr>`;
    }
  }
  if(b.type==='title') { const lines=(b.data.text||'').split('\n').join('<br>'); return `<tr><td style="padding:28px 32px 12px;font-size:${b.data.size||24}px;color:#181818;line-height:1.4;${FF}"><b>${lines}</b></td></tr>`; }
  if(b.type==='subtitle') { const lines=(b.data.text||'').split('\n').join('<br>'); return `<tr><td style="padding:12px 32px 8px;font-size:${b.data.size||18}px;font-weight:700;color:#181818;line-height:1.4;${FF}"><b>${lines}</b></td></tr>`; }
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
      const priceNum = parseInt(String(h.price||'').replace(/[^0-9]/g,'')) || 0;
      const fmtPrice = priceNum > 0 ? priceNum.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' 원~' : '';
      const discBadge = h.discount ? `<div style="position:absolute;top:8px;left:8px;background:#f43f5e;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;">-${h.discount}%</div>` : '';
      const imgBox = `<div style="position:relative;">${h.img ? `<img src="${h.img}" width="100%" style="display:block;height:150px;object-fit:cover;">` : `<div style="width:100%;height:150px;background:#c8b9a8;"></div>`}${discBadge}</div>`;
      const cardInner = `<table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;background:#fff"><tr><td>${imgBox}</td></tr><tr><td style="padding:12px 14px;${FF}"><div style="font-size:14px;font-weight:bold;color:#181818;margin-bottom:3px">${h.name||'호텔명'}</div><div style="font-size:12px;color:#818286;margin-bottom:8px">${h.area||''}</div><div style="font-size:16px;font-weight:bold;color:#7B3CFF">${fmtPrice}</div><div style="font-size:11px;color:#818286;margin-top:2px">1박 기준</div></td></tr></table>`;
      return h.link ? `<a href="${h.link}" target="_blank" style="display:block;text-decoration:none;color:inherit">${cardInner}</a>` : cardInner;
    };
    const rows=[];
    for(let i=0;i<hs.length;i+=2) rows.push(`<tr><td width="32"></td><td style="padding:0 5px 10px 0;vertical-align:top;width:262px">${card(hs[i])}</td><td style="padding:0 0 10px 5px;vertical-align:top;width:262px">${hs[i+1]?card(hs[i+1]):''}</td><td width="32"></td></tr>`);
    return `<tr><td style="padding:4px 0 8px"><table cellpadding="0" cellspacing="0" width="100%">${rows.join('')}</table></td></tr>`;
  }
  return '';
}

function rp() {
  const rows = blocks.map(b => blockToHTML(b)).join('\n');
  document.getElementById('preview').innerHTML = `<table cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#fff;border-collapse:collapse;margin:0 auto">${rows}</table>`;
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
// CITY SEARCH DROPDOWN
// ═══════════════════════════════════════════
let cityDebounce = null;
let cityActiveIdx = -1;
let citySelected = '';

async function onCityInput(q) {
  citySelected = '';
  document.getElementById('hs-city-clear').style.display = q ? 'block' : 'none';
  clearTimeout(cityDebounce);
  if(!q) { hideCityDropdown(); return; }
  cityDebounce = setTimeout(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cities?q=${encodeURIComponent(q)}`);
      const cities = await res.json();
      renderCityDropdown(cities, q);
    } catch { hideCityDropdown(); }
  }, 180);
}

function renderCityDropdown(cities, q) {
  const dd = document.getElementById('hs-city-dropdown');
  cityActiveIdx = -1;
  if(!cities.length) {
    dd.innerHTML = `<div class="hs-city-empty">결과 없음</div>`;
    dd.style.display = 'block';
    return;
  }
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  dd.innerHTML = cities.map((c, i) =>
    `<div class="hs-city-item" data-val="${c}" onmousedown="selectCity('${c}')">${c.replace(re, '<b>$1</b>')}</div>`
  ).join('');
  dd.style.display = 'block';
}

function hideCityDropdown() {
  document.getElementById('hs-city-dropdown').style.display = 'none';
  cityActiveIdx = -1;
}

function selectCity(val) {
  citySelected = val;
  document.getElementById('hs-region').value = val;
  document.getElementById('hs-city-clear').style.display = 'block';
  hideCityDropdown();
}

function clearCity() {
  citySelected = '';
  document.getElementById('hs-region').value = '';
  document.getElementById('hs-city-clear').style.display = 'none';
  hideCityDropdown();
  document.getElementById('hs-region').focus();
}

function onCityKeydown(e) {
  const dd = document.getElementById('hs-city-dropdown');
  const items = dd.querySelectorAll('.hs-city-item');
  if(e.key === 'ArrowDown') {
    e.preventDefault();
    cityActiveIdx = Math.min(cityActiveIdx + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('active', i === cityActiveIdx));
  } else if(e.key === 'ArrowUp') {
    e.preventDefault();
    cityActiveIdx = Math.max(cityActiveIdx - 1, 0);
    items.forEach((el, i) => el.classList.toggle('active', i === cityActiveIdx));
  } else if(e.key === 'Enter') {
    if(cityActiveIdx >= 0 && items[cityActiveIdx]) {
      selectCity(items[cityActiveIdx].dataset.val);
    } else {
      searchHotels();
    }
  } else if(e.key === 'Escape') {
    hideCityDropdown();
  }
}

document.addEventListener('click', e => {
  if(!document.getElementById('hs-city-wrap')?.contains(e.target)) hideCityDropdown();
});

// ═══════════════════════════════════════════
// SQL EDITOR
// ═══════════════════════════════════════════
async function searchHotels() {
  const region = (citySelected || document.getElementById('hs-region').value).trim();
  if(!region) { showToast('지역을 입력해주세요'); document.getElementById('hs-region').focus(); return; }

  const year   = document.getElementById('hs-year').value;
  const month  = parseInt(document.getElementById('hs-month').value);
  const metric = document.querySelector('input[name="hs-metric"]:checked').value;
  const limit  = document.getElementById('hs-limit').value;

  // 날짜 범위
  let dateFrom, dateTo;
  if(month === 0) {
    dateFrom = `${year}-01-01`;
    dateTo   = `${parseInt(year)+1}-01-01`;
  } else {
    const mm = String(month).padStart(2, '0');
    const lastDay = new Date(year, month, 0).getDate();
    dateFrom = `${year}-${mm}-01`;
    dateTo   = `${year}-${mm}-${lastDay}`;
  }

  const nextWeekSub = `(
    SELECT b2.hotel_id, MIN(p2.fee_sell) AS min_price
    FROM bookings b2
    JOIN checkouts c2 ON c2.id = b2.checkout_id
    JOIN payments p2 ON p2.checkout_id = c2.id
    WHERE b2.check_in >= CURDATE() + INTERVAL (7 - WEEKDAY(CURDATE())) DAY
      AND b2.check_in <= CURDATE() + INTERVAL (13 - WEEKDAY(CURDATE())) DAY
      AND p2.currency = 'KRW' AND p2.fee_sell > 0
    GROUP BY b2.hotel_id
  ) np`;

  let sql;
  if(metric === 'booking') {
    sql = `SELECT h.hotel_id, h.name_kr, h.city_kr, MAX(ac.thumbnail) AS thumbnail, COUNT(b.id) AS 예약건수,
       MAX(np.min_price) AS min_price
FROM hotels h
LEFT JOIN tripbtoz_meta.accommodation_common ac ON ac.id = h.hotel_id
JOIN bookings b ON b.hotel_id = h.hotel_id
LEFT JOIN ${nextWeekSub} ON np.hotel_id = h.hotel_id
WHERE h.hotel_id IN (SELECT hotel_id FROM hotels WHERE city_kr LIKE '%${region}%' OR city IN (SELECT DISTINCT city FROM hotels WHERE city_kr LIKE '%${region}%'))
  AND b.check_in >= '${dateFrom}' AND b.check_in <= '${dateTo}'
GROUP BY h.hotel_id, h.name_kr, h.city_kr
HAVING MAX(np.min_price) IS NOT NULL
ORDER BY 예약건수 DESC
LIMIT ${limit};`;
  } else {
    sql = `SELECT h.hotel_id, h.name_kr, h.city_kr, MAX(ac.thumbnail) AS thumbnail,
       CONCAT(FORMAT(SUM(p.fee_sell)/10000, 0), '만원') AS 매출,
       MAX(np.min_price) AS min_price
FROM hotels h
LEFT JOIN tripbtoz_meta.accommodation_common ac ON ac.id = h.hotel_id
JOIN bookings b ON b.hotel_id = h.hotel_id
JOIN checkouts c ON c.id = b.checkout_id
JOIN payments p ON p.checkout_id = c.id
LEFT JOIN ${nextWeekSub} ON np.hotel_id = h.hotel_id
WHERE h.hotel_id IN (SELECT hotel_id FROM hotels WHERE city_kr LIKE '%${region}%' OR city IN (SELECT DISTINCT city FROM hotels WHERE city_kr LIKE '%${region}%'))
  AND b.check_in >= '${dateFrom}' AND b.check_in <= '${dateTo}'
  AND p.currency = 'KRW'
GROUP BY h.hotel_id, h.name_kr, h.city_kr
HAVING MAX(np.min_price) IS NOT NULL
ORDER BY SUM(p.fee_sell) DESC
LIMIT ${limit};`;
  }

  // SQL 입력창에도 표시
  document.getElementById('sql-input').value = sql;

  const btn = document.querySelector('.hs-btn');
  btn.disabled = true; btn.textContent = '검색 중...';
  document.getElementById('sql-result-bar-text').innerHTML = '';
  document.getElementById('sql-result-body').innerHTML = `<div class="sql-loading">
    <div class="sql-loading-spinner"></div>
    <div class="sql-loading-text">${region} 호텔 검색 중...</div>
  </div>`;

  try {
    const res = await fetch(API_BASE + '/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const data = await res.json();
    if(data.error) {
      document.getElementById('sql-result-bar-text').innerHTML = `<span class="sql-stat-err">오류</span>`;
      document.getElementById('sql-result-body').innerHTML = `<div class="sql-error">${data.error}</div>`;
      return;
    }
    const label = month === 0 ? `${year}년` : `${year}년 ${month}월`;
    showSQLResult(data, `<span class="sql-stat-ok">완료</span> ${region} · ${label} · ${data.total}개`);
  } catch(e) {
    document.getElementById('sql-result-bar-text').innerHTML = `<span class="sql-stat-err">연결 실패</span>`;
    document.getElementById('sql-result-body').innerHTML = `<div class="sql-error">서버에 연결할 수 없어요.</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '검색';
  }
}

const SQL_PRESETS = {
  member: `-- 회원 광고수신 동의
-- 기준: tripbtoz.users_0519 / mkt_email_agree=1 / status=AT(활성)
SELECT DISTINCT email
FROM tripbtoz.users_0519
WHERE mkt_email_agree = 1
  AND status = 'AT'
  AND email IS NOT NULL
  AND email != '';`,

  guest: `-- 비회원 광고수신 동의
-- 기준: 비회원 결제(user_type=guest) + 광고동의(ad_policy_agreement_yn=1) + 이메일 수집분만
SELECT DISTINCT c.user_email AS email
FROM tripbtoz.checkouts c
JOIN tripbtoz_payment.checkout_detail cd ON cd.checkout_id = c.id
WHERE c.user_type = 'guest'
  AND cd.ad_policy_agreement_yn = 1
  AND c.user_email IS NOT NULL
  AND c.user_email != '';`,

  all: `-- 전체 합산 (회원 + 비회원, 중복 제거)
-- 회원: tripbtoz.users_0519 / mkt_email_agree=1 / status=AT
-- 비회원: 비회원 결제 + 광고동의 + 이메일 수집분
SELECT DISTINCT email FROM tripbtoz.users_0519 WHERE mkt_email_agree = 1 AND status = 'AT' AND email IS NOT NULL AND email != ''
UNION
SELECT DISTINCT c.user_email FROM tripbtoz.checkouts c
JOIN tripbtoz_payment.checkout_detail cd ON cd.checkout_id = c.id
WHERE c.user_type = 'guest'
  AND cd.ad_policy_agreement_yn = 1
  AND c.user_email IS NOT NULL
  AND c.user_email != '';`,
};

let sqlResultEmails = [];
let cartHotels = []; // 담아둔 호텔

function updateCartBadge() {
  const badge = document.getElementById('hotel-cart-badge');
  if(!badge) return;
  if(cartHotels.length > 0) {
    badge.textContent = `🏨 ${cartHotels.length}개 담김`;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

function loadPreset(key) {
  document.getElementById('sql-input').value = SQL_PRESETS[key];
  document.getElementById('sql-input').focus();
}

async function runPreset(key) {
  const btn = document.getElementById('sql-run-btn');
  btn.disabled = true; btn.textContent = '실행 중...';
  document.getElementById('sql-result-bar-text').innerHTML = '';
  document.getElementById('sql-result-body').innerHTML = `<div class="sql-loading">
    <div class="sql-loading-spinner"></div>
    <div class="sql-loading-text" id="sql-loading-text">불러오는 중...</div>
  </div>`;

  try {
    const res = await fetch(`${API_BASE}/api/preset/${key}`);
    const data = await res.json();
    if(data.error) {
      document.getElementById('sql-result-bar-text').innerHTML = `<span class="sql-stat-err">오류</span>`;
      document.getElementById('sql-result-body').innerHTML = `<div class="sql-error">${data.error}</div>`;
      return;
    }

    const cachedAgo = data.cached
      ? `<span class="sql-cache-badge" title="클릭해서 새로고침" onclick="refreshPreset('${key}')">캐시 · ${formatAgo(data.cachedAt)} 전 기준 🔄</span>`
      : `<span class="sql-cache-badge fresh">방금 조회</span>`;

    showSQLResult(data, `<span class="sql-stat-ok">완료</span> ${data.total.toLocaleString()}행 · ${cachedAgo}`);
  } catch(e) {
    document.getElementById('sql-result-bar-text').innerHTML = `<span class="sql-stat-err">연결 실패</span>`;
    document.getElementById('sql-result-body').innerHTML = `<div class="sql-error">서버에 연결할 수 없어요. <code>npm run dev</code> 실행 중인지 확인하세요.</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '▶ 실행';
  }
}

async function refreshPreset(key) {
  await fetch(`${API_BASE}/api/preset/${key}/cache`, { method: 'DELETE' });
  runPreset(key);
}

function formatAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if(diff < 60) return `${diff}초`;
  if(diff < 3600) return `${Math.floor(diff/60)}분`;
  if(diff < 86400) return `${Math.floor(diff/3600)}시간`;
  return `${Math.floor(diff/86400)}일`;
}

// ─── 공통 결과 렌더러 ───
function showSQLResult(data, barHTML) {
  // 이메일 컬럼 감지
  const emailIdx = data.columns.findIndex(c => /^email$/i.test(c));
  if(emailIdx !== -1) {
    sqlResultEmails = data.rows.map(r => (r[emailIdx]||'').toString().trim()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    document.getElementById('sql-save-seg-wrap').style.display = 'block';
  } else {
    sqlResultEmails = [];
    document.getElementById('sql-save-seg-wrap').style.display = 'none';
  }

  // hotel_id 컬럼 감지
  const hotelIdIdx = data.columns.findIndex(c => /^hotel_id$/i.test(c));

  let fullBar = barHTML;
  if(emailIdx !== -1) fullBar += ` · 유효 이메일 <strong>${sqlResultEmails.length.toLocaleString()}개</strong>`;
  document.getElementById('sql-result-bar-text').innerHTML = fullBar;

  if(data.rows.length === 0) {
    document.getElementById('sql-result-body').innerHTML = '<div class="sql-empty">결과 없음</div>';
    return;
  }

  if(hotelIdIdx !== -1) {
    renderHotelTable(data, hotelIdIdx);
  } else {
    const thead = `<thead><tr>${data.columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${data.rows.slice(0,500).map(row =>
      `<tr>${row.map(v => `<td>${v===null?'<span class="sql-null">NULL</span>':String(v)}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;
    document.getElementById('sql-result-body').innerHTML = `<div class="sql-table-wrap"><table class="sql-table">${thead}${tbody}</table></div>`;
  }
}

function renderHotelTable(data, hotelIdIdx) {
  const cols = data.columns;
  const nameIdx  = cols.findIndex(c => /^name_kr$/i.test(c)) !== -1 ? cols.findIndex(c => /^name_kr$/i.test(c)) : cols.findIndex(c => /^name$/i.test(c));
  const areaIdx  = cols.findIndex(c => /^city_kr$/i.test(c)) !== -1 ? cols.findIndex(c => /^city_kr$/i.test(c)) : cols.findIndex(c => /city|area/i.test(c));
  const imgIdx   = cols.findIndex(c => /^thumbnail$|^img$/i.test(c));
  const priceIdx = cols.findIndex(c => /^price$|^min_price$|^fee_sell$/i.test(c));

  window._hotelRows   = data.rows;
  window._hotelColMap = { hotelIdIdx, nameIdx, areaIdx, imgIdx, priceIdx };
  window._hotelPrices = {};

  const thead = `<thead><tr>
    <th style="width:36px;text-align:center"><input type="checkbox" id="hotel-check-all" onchange="toggleAllHotels(this)"></th>
    ${cols.map(c => {
      if(c.toLowerCase() === 'min_price') return `<th>${c} <span class="preset-info-icon" style="vertical-align:middle">i<span class="preset-tooltip" style="white-space:pre-line">실제 예약 DB 기준&#10;차주(월~일) 체크인 예약 중&#10;최저 결제금액</span></span></th>`;
      return `<th>${c}</th>`;
    }).join('')}
    <th>차주최저가 <span class="preset-info-icon" style="vertical-align:middle">i<span class="preset-tooltip" style="white-space:pre-line">트립비토즈 API 기준&#10;차주 월요일 체크인 1박 2인&#10;현재 판매 중인 실시간 최저가</span></span></th>
    <th>할인율 <span class="preset-info-icon" style="vertical-align:middle">i<span class="preset-tooltip" style="white-space:pre-line">정가 대비 할인된 비율&#10;(정가 - 판매가) / 정가 × 100</span></span></th>
  </tr></thead>`;

  const tbody = `<tbody>${data.rows.slice(0,200).map((row, ri) => {
    const hid = row[hotelIdIdx];
    return `<tr class="hotel-row" onclick="toggleHotelRow(${ri})">
      <td style="text-align:center"><input type="checkbox" class="hotel-check" data-idx="${ri}" onclick="event.stopPropagation()" onchange="onHotelCheck()"></td>
      ${row.map(v => `<td>${v===null?'<span class="sql-null">NULL</span>':String(v)}</td>`).join('')}
      <td class="hotel-price-cell" data-hid="${hid}" style="color:#aaa;font-size:11px">조회중...</td>
      <td class="hotel-discount-cell" data-hid="${hid}" style="color:#aaa;font-size:11px">-</td>
    </tr>`;
  }).join('')}</tbody>`;

  document.getElementById('sql-result-body').innerHTML = `
    <div class="sql-hotel-hint">🏨 hotel_id 감지 — 호텔을 선택해서 템플릿에 넣으세요 <span style="color:#bbb">(최대 4개)</span></div>
    <div class="sql-hotel-toolbar">
      <span id="hotel-select-count" style="font-size:12px;color:#888">선택된 호텔 없음</span>
      <button class="sql-add-cart-btn" id="sql-add-cart-btn" onclick="addSelectedToCart()" disabled>🏨 담기</button>
    </div>
    <div class="sql-table-wrap"><table class="sql-table">${thead}${tbody}</table></div>`;

  fetchHotelPrices(data.rows.slice(0, 200).map(r => r[hotelIdIdx]));
}

async function fetchHotelPrices(hotelIds) {
  await Promise.all(hotelIds.map(async hid => {
    try {
      const res  = await fetch(`${API_BASE}/api/hotel-price/${hid}`);
      const data = await res.json();
      const priceCell    = document.querySelector(`.hotel-price-cell[data-hid="${hid}"]`);
      const discountCell = document.querySelector(`.hotel-discount-cell[data-hid="${hid}"]`);
      if(!priceCell) return;

      if(!data.available) {
        priceCell.innerHTML    = `<span style="color:#ccc">-</span>`;
        discountCell.innerHTML = `<span style="color:#ccc">-</span>`;
        return;
      }

      window._hotelPrices[hid] = data;
      const priceStr = data.discounted_price >= 10000
        ? `${Math.round(data.discounted_price / 10000)}만원`
        : `${Math.round(data.discounted_price).toLocaleString()}원`;
      priceCell.innerHTML    = `<strong style="color:#333">${priceStr}</strong>`;
      discountCell.innerHTML = data.discount_rate > 0
        ? `<span style="color:#e53e3e;font-weight:600">${data.discount_rate}%</span>`
        : `<span style="color:#ccc">-</span>`;
    } catch(e) {
      const priceCell = document.querySelector(`.hotel-price-cell[data-hid="${hid}"]`);
      if(priceCell) priceCell.innerHTML = `<span style="color:#ccc">-</span>`;
    }
  }));
}

function toggleAllHotels(cb) {
  const checks = document.querySelectorAll('.hotel-check');
  let count = 0;
  checks.forEach(c => { c.checked = cb.checked && count < 4; if(cb.checked) count++; });
  onHotelCheck();
}

function toggleHotelRow(ri) {
  const cb = document.querySelector(`.hotel-check[data-idx="${ri}"]`);
  const checked = document.querySelectorAll('.hotel-check:checked');
  if(!cb.checked && checked.length >= 4) { showToast('최대 4개까지 선택 가능해요'); return; }
  cb.checked = !cb.checked;
  onHotelCheck();
}

function onHotelCheck() {
  const checked = document.querySelectorAll('.hotel-check:checked');
  const count = checked.length;
  const countEl = document.getElementById('hotel-select-count');
  const btn = document.getElementById('sql-add-cart-btn');
  if(countEl) countEl.textContent = count > 0 ? `${count}개 선택됨` : '선택된 호텔 없음';
  if(btn) { btn.disabled = count === 0; btn.textContent = count > 0 ? `🏨 ${count}개 담기` : '🏨 담기'; }
}

function addSelectedToCart() {
  const checked = document.querySelectorAll('.hotel-check:checked');
  if(checked.length === 0) return;
  const { hotelIdIdx, nameIdx, areaIdx, imgIdx, priceIdx } = window._hotelColMap;
  const rows = window._hotelRows;
  cartHotels = [];
  checked.forEach(cb => {
    const row = rows[parseInt(cb.dataset.idx)];
    const hid = row[hotelIdIdx];
    const priceData = (window._hotelPrices || {})[hid];
    let priceNum = 0;
    let discountNum = 0;
    if(priceData && priceData.available) {
      priceNum    = priceData.discounted_price || 0;
      discountNum = priceData.discount_rate    || 0;
    } else if(priceIdx !== -1 && row[priceIdx]) {
      priceNum = Math.round(parseFloat(String(row[priceIdx]))) || 0;
    }
    const now = new Date();
    const daysToMonday = (8 - now.getDay()) % 7 || 7;
    const ci = new Date(now); ci.setDate(now.getDate() + daysToMonday);
    const co = new Date(ci); co.setDate(ci.getDate() + 1);
    const fmtD = d => d.toISOString().split('T')[0];
    const checkIn = fmtD(ci);
    const checkOut = fmtD(co);
    const hotelName = nameIdx !== -1 ? String(row[nameIdx] || '') : '';
    cartHotels.push({
      name:     hotelName,
      area:     areaIdx !== -1 ? String(row[areaIdx] || '') : '',
      price:    priceNum,
      discount: discountNum,
      img:      imgIdx  !== -1 ? String(row[imgIdx]  || '') : '',
      link:     `https://www.tripbtoz.com/hotels/${hid}?check-in=${checkIn}&check-out=${checkOut}&rooms=1&room-0-adults=2&room-0-children=0&query=${encodeURIComponent(hotelName)}&searchId=${hid}&searchType=HOTEL`,
    });
  });
  updateCartBadge();
  showToast(`🏨 ${cartHotels.length}개 호텔 담김 — 에디터에서 불러오세요`);
}

function loadCartToBlock(idx) {
  if(cartHotels.length === 0) { showToast('담아둔 호텔이 없어요. SQL 탭에서 선택해주세요'); return; }
  const current = blocks[idx].data.hotels || [];
  const msg = current.length > 0
    ? `현재 ${current.length}개 호텔을 담아둔 ${cartHotels.length}개로 교체할까요?`
    : null;
  if(!msg || confirm(msg)) {
    blocks[idx].data.hotels = cartHotels.map(h => ({...h}));
    render(); rp();
    showToast(`${cartHotels.length}개 호텔 불러오기 완료`);
  }
}

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
  document.getElementById('sql-result-bar-text').innerHTML = '';
  document.getElementById('sql-result-body').innerHTML = '<div class="sql-empty">쿼리를 실행하면 결과가 여기에 표시됩니다</div>';
  document.getElementById('sql-input').focus();
}

async function runSQL() {
  const sql = document.getElementById('sql-input').value.trim();
  if(!sql) return;

  const btn = document.getElementById('sql-run-btn');
  btn.disabled = true; btn.textContent = '실행 중...';
  document.getElementById('sql-result-bar-text').innerHTML = '';
  document.getElementById('sql-result-body').innerHTML = `<div class="sql-loading">
    <div class="sql-loading-spinner"></div>
    <div class="sql-loading-text" id="sql-loading-text">DB 접속 중...</div>
  </div>`;
  const loadingMsgs = ['DB 접속 중...', '쿼리 날리는 중...', '데이터 긁어오는 중...', '결과 정리하는 중...', '거의 다 됐어요...'];
  let msgIdx = 0;
  let msgTimer = setInterval(() => {
    msgIdx = (msgIdx + 1) % loadingMsgs.length;
    const el = document.getElementById('sql-loading-text');
    if(el) el.textContent = loadingMsgs[msgIdx];
  }, 800);

  try {
    const res = await fetch(API_BASE + '/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const data = await res.json();

    if(data.error) {
      document.getElementById('sql-result-bar-text').innerHTML = `<span class="sql-stat-err">오류</span>`;
      document.getElementById('sql-result-body').innerHTML = `<div class="sql-error">${data.error}</div>`;
      return;
    }

    if(data.type === 'ok') {
      document.getElementById('sql-result-bar-text').innerHTML = `<span class="sql-stat-ok">완료</span> ${data.affectedRows}행 영향 · ${data.elapsed}ms`;
      document.getElementById('sql-result-body').innerHTML = '';
      return;
    }

    showSQLResult(data, `<span class="sql-stat-ok">완료</span> ${data.total.toLocaleString()}행 · ${data.elapsed}ms`);
  } catch(e) {
    clearInterval(msgTimer);
    console.error('[runSQL] 오류:', e.name, e.message, e.stack);
    document.getElementById('sql-result-bar-text').innerHTML = `<span class="sql-stat-err">연결 실패</span>`;
    document.getElementById('sql-result-body').innerHTML = `<div class="sql-error">서버에 연결할 수 없어요. <code>npm run dev</code> 실행 중인지 확인하세요.</div>`;
  } finally {
    clearInterval(msgTimer);
    btn.disabled = false; btn.textContent = '▶ 실행';
  }
}

function openSaveAsSegment() {
  if(sqlResultEmails.length === 0) { showToast('저장할 이메일이 없습니다'); return; }
  document.getElementById('save-seg-name').value = '';
  document.getElementById('save-seg-count').textContent = `${sqlResultEmails.length.toLocaleString()}명`;
  document.getElementById('save-seg-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('save-seg-name').focus(), 50);
}

function closeSaveAsSegment() { document.getElementById('save-seg-modal').style.display = 'none'; }

async function confirmSaveAsSegment() {
  const name = document.getElementById('save-seg-name').value.trim();
  if(!name) { showToast('세그먼트 이름을 입력해주세요'); return; }
  const { error } = await sb.from('segments').insert({ name, emails: sqlResultEmails, count: sqlResultEmails.length });
  if(error) { showToast('저장 실패: ' + error.message); return; }
  closeSaveAsSegment();
  showToast(`"${name}" 세그먼트 저장됨 (${sqlResultEmails.length.toLocaleString()}명)`);
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

// ═══════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════
async function renderDashboard() {
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: pending } = await sb.from('email_schedules')
    .select('*').eq('status', 'pending').order('scheduled_at', { ascending: true });

  const { data: sent } = await sb.from('email_schedules')
    .select('*').eq('status', 'sent')
    .gte('sent_at', twoWeeksAgo).order('sent_at', { ascending: false });

  const { data: failed } = await sb.from('email_schedules')
    .select('*').eq('status', 'failed')
    .gte('sent_at', twoWeeksAgo).order('sent_at', { ascending: false });

  const sentList = sent || [];
  const failedList = failed || [];
  const totalSent   = sentList.reduce((s, r) => s + (r.sent_count   || 0), 0);
  const totalFailed = sentList.reduce((s, r) => s + (r.failed_count || 0), 0);

  document.getElementById('kpi-pending').textContent = `${(pending||[]).length}건`;
  document.getElementById('kpi-sent').textContent = `${sentList.length}건`;
  document.getElementById('kpi-total-sent').textContent = totalSent.toLocaleString() + '명';
  document.getElementById('kpi-total-failed').textContent = totalFailed > 0 ? totalFailed.toLocaleString() + '명' : '0명';

  // 발송 완료 캠페인 통계 배치 조회
  const allSentIds = sentList.map(s => s.id);
  let statsMap = {};
  if(allSentIds.length > 0) {
    const { data: events } = await sb.from('email_events')
      .select('schedule_id, event_type, email_hash')
      .in('schedule_id', allSentIds);
    if(events) {
      allSentIds.forEach(sid => {
        const evs = events.filter(e => e.schedule_id === sid);
        statsMap[sid] = {
          opens:  new Set(evs.filter(e => e.event_type === 'open').map(e => e.email_hash)).size,
          clicks: new Set(evs.filter(e => e.event_type === 'click').map(e => e.email_hash)).size,
        };
      });
    }
  }

  renderDashSection('dash-pending-list', pending || [], 'pending', {});
  renderDashSection('dash-sent-list', sentList, 'sent', statsMap);
  renderDashSection('dash-failed-list', failedList, 'failed', {});
}

const SCHEDULE_TYPE_LABEL = { once: '1회성', daily: '매일', weekly: '매주', biweekly: '격주', monthly: '매월' };
const WEEKDAY_LABEL = ['일','월','화','수','목','금','토'];

function fmtScheduleTime(s) {
  if(s.schedule_type === 'once') {
    return s.scheduled_at
      ? new Date(s.scheduled_at).toLocaleString('ko-KR', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
      : '-';
  }
  if(s.schedule_type === 'daily') return `매일 ${s.send_time}`;
  if(s.schedule_type === 'weekly') return `매주 ${WEEKDAY_LABEL[s.weekday||0]}요일 ${s.send_time}`;
  if(s.schedule_type === 'biweekly') return `격주 ${WEEKDAY_LABEL[s.weekday||0]}요일 ${s.send_time}`;
  if(s.schedule_type === 'monthly') return `매월 ${s.day_of_month}일 ${s.send_time}`;
  return '-';
}

function renderDashSection(containerId, list, type, statsMap = {}) {
  const el = document.getElementById(containerId);
  if(list.length === 0) {
    const emptyMsg = type === 'pending' ? '예약된 발송이 없어요' : type === 'failed' ? '최근 2주 실패 내역이 없어요' : '최근 2주 발송 내역이 없어요';
    el.innerHTML = `<div class="dash-empty">${emptyMsg}</div>`;
    return;
  }
  el.innerHTML = list.map(s => {
    const timeStr = (type === 'sent' || type === 'failed')
      ? (s.sent_at ? new Date(s.sent_at).toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '-')
      : fmtScheduleTime(s);
    const badge = `<span class="dash-type-badge dash-type-${s.schedule_type}">${SCHEDULE_TYPE_LABEL[s.schedule_type]||s.schedule_type}</span>`;
    const actions = type === 'pending'
      ? `<button class="btn-danger btn-sm" onclick="cancelSchedule('${s.id}')">취소</button>
         <button class="btn-schedule btn-sm" onclick="markSent('${s.id}')">발송 완료 처리</button>`
      : '';

    const sentCount = s.sent_count || 0;
    const stats = statsMap[s.id] || {};
    const openRate  = sentCount > 0 && stats.opens  ? Math.round(stats.opens  / sentCount * 100) : null;
    const clickRate = sentCount > 0 && stats.clicks ? Math.round(stats.clicks / sentCount * 100) : null;

    const sentStats = type === 'sent'
      ? `<div class="dash-card-stats">
           <span class="dash-stat-sent">✔ ${sentCount.toLocaleString()}명 발송</span>
           ${stats.opens  != null ? `<span class="dash-stat-open">👁 ${stats.opens.toLocaleString()}명 열람${openRate != null ? ` (${openRate}%)` : ''}</span>` : ''}
           ${stats.clicks != null ? `<span class="dash-stat-click">🖱 ${stats.clicks.toLocaleString()}명 클릭${clickRate != null ? ` (${clickRate}%)` : ''}</span>` : ''}
           ${s.failed_count > 0 ? `<span class="dash-stat-failed">✘ ${s.failed_count.toLocaleString()}명 실패</span>` : ''}
         </div>`
      : type === 'failed'
      ? `<div class="dash-card-stats"><span class="dash-stat-failed">✘ ${s.failed_count?.toLocaleString()||0}명 실패</span></div>`
      : '';

    const clickAttr = type === 'sent'
      ? `onclick="openCampaignStats('${s.id}','${(s.subject||'').replace(/'/g,"\\'")}',${sentCount})" style="cursor:pointer"`
      : type === 'pending' || type === 'failed'
      ? `onclick="openScheduleDetail('${s.id}')" style="cursor:pointer"`
      : '';

    return `<div class="dash-card" ${clickAttr}>
      <div class="dash-card-left">
        <div class="dash-card-left-row">
          ${badge}
          <div class="dash-card-tpl">${s.template_name || '-'}</div>
        </div>
        <div class="dash-card-subject">${s.subject || '-'}</div>
        <div class="dash-card-seg">${s.segment_name ? '<span class="dash-arrow">→</span> ' + s.segment_name : '세그먼트 없음'}</div>
        ${sentStats}
      </div>
      <div class="dash-card-right">
        <div class="dash-card-time">${timeStr}</div>
        <div class="dash-card-actions">${actions}</div>
      </div>
    </div>`;
  }).join('');
}

async function openCampaignStats(scheduleId, subject, sentCount) {
  const modal = document.getElementById('schedule-detail-modal');
  const body  = document.getElementById('schedule-detail-body');
  body.innerHTML = '<div style="text-align:center;padding:40px;color:#888">통계 불러오는 중...</div>';
  modal.style.display = 'flex';

  try {
    const res  = await fetch(`${API_BASE}/api/campaign-stats/${scheduleId}`);
    const data = await res.json();
    const { opens, clicks, totalClicks, urlStats } = data;
    const openRate  = sentCount > 0 ? (opens  / sentCount * 100).toFixed(1) : 0;
    const clickRate = sentCount > 0 ? (clicks / sentCount * 100).toFixed(1) : 0;

    const urlRows = (urlStats || []).map(({ url, count }) => {
      const label = url.includes('/hotels/') ? `🏨 ${decodeURIComponent(url.match(/query=([^&]+)/)?.[1] || url.split('/hotels/')[1]?.split('?')[0] || url)}` : url.length > 60 ? url.slice(0, 60) + '…' : url;
      const pct = totalClicks > 0 ? Math.round(count / totalClicks * 100) : 0;
      return `<tr>
        <td style="padding:8px 12px;font-size:12px;color:#444;max-width:260px;word-break:break-all">${label}</td>
        <td style="padding:8px 12px;text-align:right;font-weight:600;color:#7B3CFF">${count}</td>
        <td style="padding:8px 12px;text-align:right;color:#888;font-size:12px">${pct}%</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:600;color:#eee;margin-bottom:12px">${subject}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <div class="stat-chip"><div class="stat-chip-val">${sentCount.toLocaleString()}</div><div class="stat-chip-label">발송</div></div>
          <div class="stat-chip open"><div class="stat-chip-val">${opens.toLocaleString()} <span style="font-size:12px;font-weight:400">(${openRate}%)</span></div><div class="stat-chip-label">👁 열람</div></div>
          <div class="stat-chip click"><div class="stat-chip-val">${clicks.toLocaleString()} <span style="font-size:12px;font-weight:400">(${clickRate}%)</span></div><div class="stat-chip-label">🖱 클릭</div></div>
        </div>
      </div>
      ${urlRows ? `
      <div style="font-size:12px;color:#888;margin-bottom:8px">링크별 클릭</div>
      <div style="overflow-y:auto;max-height:260px;border-radius:8px;border:1px solid #2a2a3a">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#1a1a2e">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888">링크</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;color:#888">클릭</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;color:#888">비율</th>
          </tr></thead>
          <tbody>${urlRows}</tbody>
        </table>
      </div>` : '<div style="color:#888;font-size:13px">아직 클릭 데이터가 없습니다.</div>'}`;
  } catch(e) {
    body.innerHTML = `<div style="color:#e24b4a">통계를 불러올 수 없습니다.</div>`;
  }
}

async function openScheduleDetail(id) {
  const { data: s, error } = await sb.from('email_schedules').select('*').eq('id', id).single();
  if(error || !s) { showToast('정보를 불러올 수 없어요'); return; }

  const typeLabel = SCHEDULE_TYPE_LABEL[s.schedule_type] || s.schedule_type;
  const scheduledStr = s.scheduled_at
    ? new Date(s.scheduled_at).toLocaleString('ko-KR', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})
    : '-';
  const createdStr = s.created_at
    ? new Date(s.created_at).toLocaleString('ko-KR', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})
    : '-';

  document.getElementById('schedule-detail-body').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;line-height:2">
      <tr><td style="color:#888;width:90px">템플릿</td><td style="font-weight:600">${s.template_name || '-'}</td></tr>
      <tr><td style="color:#888">제목</td><td>${s.subject || '-'}</td></tr>
      <tr><td style="color:#888">수신자</td><td>${s.segment_name || '-'}</td></tr>
      <tr><td style="color:#888">발송 주기</td><td>${typeLabel}</td></tr>
      <tr><td style="color:#888">예약 일시</td><td>${scheduledStr}</td></tr>
      <tr><td style="color:#888">등록일시</td><td>${createdStr}</td></tr>
    </table>`;

  document.getElementById('schedule-detail-cancel-btn').onclick = async () => {
    if(!confirm('예약을 취소할까요?')) return;
    await cancelSchedule(id);
    closeScheduleDetail();
  };

  document.getElementById('schedule-detail-modal').style.display = 'flex';
}

function closeScheduleDetail() {
  document.getElementById('schedule-detail-modal').style.display = 'none';
}

async function cancelSchedule(id) {
  if(!confirm('예약을 취소할까요?')) return;
  const { error } = await sb.from('email_schedules').update({ status: 'cancelled' }).eq('id', id);
  if(error) { showToast('취소 실패'); return; }
  showToast('예약 취소됨');
  renderDashboard();
}

async function markSent(id) {
  if(!confirm('발송 완료로 처리할까요?')) return;
  const { error } = await sb.from('email_schedules')
    .update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id);
  if(error) { showToast('처리 실패'); return; }
  showToast('발송 완료 처리됨');
  renderDashboard();
}

// ═══════════════════════════════════════════
// SCHEDULE MODAL
// ═══════════════════════════════════════════
let _schedTplId = null;

async function openScheduleModal(tplId, tplName) {
  _schedTplId = tplId;
  document.getElementById('sch-tpl-name').textContent = tplName;

  // 세그먼트 목록 로드
  const { data: segs } = await sb.from('segments').select('id,name').order('created_at', { ascending: false });
  const sel = document.getElementById('sch-segment');
  sel.innerHTML = `<option value="">세그먼트 선택...</option>
    <optgroup label="── 광고수신 동의 ──">
      <option value="__preset_member__" data-name="회원 광고수신 동의">⚡ 회원 광고수신 동의</option>
      <option value="__preset_guest__" data-name="비회원 광고수신 동의">⚡ 비회원 광고수신 동의</option>
      <option value="__preset_all__" data-name="전체 광고수신 동의">⚡ 전체 광고수신 동의</option>
    </optgroup>
    <optgroup label="── 저장된 세그먼트 ──">
      ${(segs||[]).map(s => `<option value="${s.id}" data-name="${s.name}">${s.name}</option>`).join('')}
    </optgroup>`;
  document.getElementById('sch-segment-status').textContent = '';

  // 매월 일수 채우기
  const daysSel = document.getElementById('sch-monthly-day');
  if(!daysSel.options.length) {
    daysSel.innerHTML = Array.from({length:31},(_,i)=>`<option value="${i+1}">${i+1}일</option>`).join('');
  }

  // 1회성 기본값: 현재 시각
  const now = new Date();
  document.getElementById('sch-once-dt').value = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0,16);

  // 타입 초기화
  document.querySelector('input[name="sch-type"][value="once"]').checked = true;
  onSchTypeChange();

  // 저장된 콘텐츠 쿼리 복원
  const savedQuery = localStorage.getItem(`tpl_cq_${tplId}`);
  const savedLimit = localStorage.getItem(`tpl_cl_${tplId}`);
  const savedUtm   = localStorage.getItem(`tpl_utm_${tplId}`);
  if(savedQuery) {
    document.getElementById('sch-content-query').value = savedQuery;
    document.getElementById('sch-dynamic-section').style.display = '';
    document.getElementById('sch-dynamic-arrow').textContent = '▾';
  }
  if(savedLimit) {
    const r = document.querySelector(`input[name="sch-limit"][value="${savedLimit}"]`);
    if(r) r.checked = true;
  }
  if(savedUtm) document.getElementById('sch-utm-campaign').value = savedUtm;

  // 제목 초기화
  document.getElementById('sch-subject').value = '';

  document.getElementById('schedule-modal').style.display = 'flex';
}

function closeScheduleModal() {
  if(_schedTplId) {
    const q   = document.getElementById('sch-content-query').value.trim();
    const lim = document.querySelector('input[name="sch-limit"]:checked')?.value;
    const utm = document.getElementById('sch-utm-campaign').value.trim();
    if(q)   localStorage.setItem(`tpl_cq_${_schedTplId}`, q);
    else    localStorage.removeItem(`tpl_cq_${_schedTplId}`);
    if(lim) localStorage.setItem(`tpl_cl_${_schedTplId}`, lim);
    if(utm) localStorage.setItem(`tpl_utm_${_schedTplId}`, utm);
    else    localStorage.removeItem(`tpl_utm_${_schedTplId}`);
  }
  document.getElementById('schedule-modal').style.display = 'none';
  _schedTplId = null;
}

function toggleDynamicSection() {
  const sec = document.getElementById('sch-dynamic-section');
  const arrow = document.getElementById('sch-dynamic-arrow');
  const open = sec.style.display === 'none';
  sec.style.display = open ? '' : 'none';
  arrow.textContent = open ? '▾' : '▸';
}

async function previewDynamicContent() {
  const contentQuery = document.getElementById('sch-content-query').value.trim();
  const contentLimit = parseInt(document.querySelector('input[name="sch-limit"]:checked')?.value || '6');
  const preview = document.getElementById('sch-dynamic-preview');
  if(!contentQuery) { preview.style.display = 'none'; return; }
  preview.style.display = '';
  preview.textContent = '조회 중...';
  try {
    const res = await fetch(API_BASE + '/api/preview-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentQuery, contentLimit }),
    });
    const data = await res.json();
    if(data.error) { preview.textContent = '오류: ' + data.error; return; }
    preview.innerHTML = data.hotels.map(h => {
      let priceLabel;
      if (h.price_available) {
        priceLabel = `<span style="color:#7B3CFF">${h.discounted_price?.toLocaleString()}원${h.discount_rate > 0 ? ` -${h.discount_rate}%` : ''}</span>`;
      } else if (h.db_min_price) {
        priceLabel = `<span style="color:#7B3CFF">${Number(h.db_min_price).toLocaleString()}원~</span>`;
      } else {
        priceLabel = '<span style="color:#999">가격미조회</span>';
      }
      return `<div style="margin-bottom:4px">• <strong>${h.name_kr||h.name||'-'}</strong> (${h.city_kr||'-'}) ${priceLabel}</div>`;
    }).join('');
  } catch(e) { preview.textContent = '서버 연결 실패'; }
}

const PRESET_LABELS = { member: '회원 광고수신 동의', guest: '비회원 광고수신 동의', all: '전체 광고수신 동의' };

async function onSchSegmentChange(sel) {
  const val = sel.value;
  const statusEl = document.getElementById('sch-segment-status');
  if(!val || !val.startsWith('__preset_')) { statusEl.textContent = ''; return; }
  const key = val.replace('__preset_', '').replace('__', '');
  const label = PRESET_LABELS[key] || key;
  statusEl.innerHTML = `<span style="color:#7B3CFF;font-size:11px">🔍 ${label} 수신자 수 확인 중이에요...</span>`;
  try {
    const res = await fetch(`${API_BASE}/api/preset-count/${key}`);
    const { count, error } = await res.json();
    if(error) throw new Error(error);
    statusEl.innerHTML = `<span style="color:#4ade80;font-size:11px">✅ ${count.toLocaleString()}명 준비됐어요!</span>`;
    showToast(`🎉 ${label} ${count.toLocaleString()}명 확인 완료!`);
  } catch(e) {
    statusEl.innerHTML = `<span style="color:#f87171;font-size:11px">⚠️ 수신자 수 확인 실패</span>`;
  }
}

function onSchTypeChange() {
  const type = document.querySelector('input[name="sch-type"]:checked')?.value;
  document.getElementById('sch-once-fields').style.display = type === 'once' ? '' : 'none';
  document.getElementById('sch-daily-fields').style.display = type === 'daily' ? '' : 'none';
  document.getElementById('sch-weekly-fields').style.display = (type === 'weekly' || type === 'biweekly') ? '' : 'none';
  document.getElementById('sch-monthly-fields').style.display = type === 'monthly' ? '' : 'none';
}

async function sendNow(dryRun = false) {
  const subject = document.getElementById('sch-subject').value.trim();
  const segSel = document.getElementById('sch-segment');
  const segRaw = segSel.value || null;
  const isPreset = segRaw && segRaw.startsWith('__preset_');
  const presetKey = isPreset ? segRaw.replace('__preset_', '').replace('__', '') : null;
  const segId = (!isPreset && segRaw) ? segRaw : null;
  const segName = segSel.options[segSel.selectedIndex]?.dataset.name || '';
  const segmentQuery = document.getElementById('sch-segment-query').value.trim() || null;
  const contentQuery = document.getElementById('sch-content-query').value.trim() || null;
  const contentLimit = parseInt(document.querySelector('input[name="sch-limit"]:checked')?.value || '6');
  const utmCampaign  = document.getElementById('sch-utm-campaign').value.trim() || null;

  if(!_schedTplId) { showToast('템플릿 정보가 없습니다'); return; }
  if(!subject) { showToast('이메일 제목을 입력해주세요'); document.getElementById('sch-subject').focus(); return; }
  if(!segId && !segmentQuery && !presetKey) { showToast('세그먼트를 선택하거나 세그먼트 쿼리를 입력해주세요'); return; }

  const tplName = document.getElementById('sch-tpl-name').textContent;
  if(!dryRun && !confirm(`"${tplName}" 을 "${segName || '다이나믹 세그먼트'}" 에게 지금 바로 발송할까요?`)) return;

  const templateId = _schedTplId;
  const tplNameFinal = document.getElementById('sch-tpl-name').textContent;
  closeScheduleModal();
  openSendProgress(dryRun ? '🧪 테스트 발송 시뮬레이션 중...' : '발송 중...');

  try {
    // 즉시 발송도 현황판에 기록되도록 schedule 레코드 생성
    let scheduleId = null;
    if(!dryRun) {
      const now = new Date().toISOString();
      const { data: sch, error: schErr } = await sb.from('email_schedules').insert({
        template_id: templateId,
        template_name: tplNameFinal,
        segment_name: segName || presetKey || '다이나믹 세그먼트',
        subject,
        schedule_type: 'once',
        scheduled_at: now,
        status: 'pending',
        created_at: now,
      }).select('id').single();
      if(schErr) console.error('[sendNow] schedule insert error:', schErr);
      scheduleId = sch?.id || null;
      console.log('[sendNow] scheduleId:', scheduleId);
    }

    const res = await fetch(API_BASE + '/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, segmentId: segId, segmentQuery, presetKey, subject, contentQuery, contentLimit, utmCampaign, dryRun, scheduleId }),
    });
    const { jobId, error } = await res.json();
    if(error) { setSendProgressError(error); return; }
    pollSendJob(jobId, dryRun);
  } catch(e) {
    setSendProgressError('서버 연결 실패: ' + e.message);
  }
}

function openSendProgress(title) {
  document.getElementById('send-progress-title').textContent = title;
  document.getElementById('send-progress-spinner').style.display = 'block';
  document.getElementById('send-progress-text').textContent = '준비 중...';
  document.getElementById('send-progress-footer').style.display = 'none';
  document.getElementById('send-progress-modal').style.display = 'flex';
}

function closeSendProgress() {
  document.getElementById('send-progress-modal').style.display = 'none';
}

function setSendProgressError(msg) {
  document.getElementById('send-progress-title').textContent = '발송 실패';
  document.getElementById('send-progress-spinner').style.display = 'none';
  document.getElementById('send-progress-text').innerHTML = `<span style="color:#e24b4a">${msg}</span>`;
  document.getElementById('send-progress-footer').style.display = 'flex';
}

async function pollSendJob(jobId, dryRun = false) {
  const poll = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/send-job/${jobId}`);
      const job = await res.json();

      if(!dryRun) {
        document.getElementById('send-progress-text').innerHTML =
          `총 ${job.total.toLocaleString()}명 중<br>
           ✅ 발송 완료: <b>${job.sent.toLocaleString()}명</b><br>
           ❌ 실패: ${job.failed}명<br>
           🚫 수신거부 제외: ${job.filtered}명`;
      }

      if(job.status === 'done') {
        document.getElementById('send-progress-spinner').style.display = 'none';
        document.getElementById('send-progress-footer').style.display = 'flex';

        if(dryRun && job.preview) {
          const p = job.preview;
          document.getElementById('send-progress-title').textContent = '🧪 테스트 결과';
          document.getElementById('send-progress-text').innerHTML = `
            <div style="text-align:left;font-size:12px;line-height:2">
              <b>발신자</b><br><span style="color:#888">${p.from}</span><br>
              <b>제목</b><br><span style="color:#888">${p.subject}</span><br>
              <b>총 수신자</b><br><span style="color:#7B3CFF;font-size:15px;font-weight:700">${job.total.toLocaleString()}명</span>
              ${job.filtered ? `<span style="color:#bbb;font-size:11px"> (수신거부 ${job.filtered}명 제외)</span>` : ''}<br>
              <b>수신거부 링크</b><br><span style="color:#888;font-size:11px;word-break:break-all">${p.sampleUnsubUrl}</span><br>
              <b>{{UNSUB_URL}} 치환</b> ${p.hasUnsubPlaceholder ? '✅ 있음' : '⚠️ 없음 (푸터 블록 확인 필요)'}<br>
              ${p.sampleEmails.length ? `<b>발송 대상 샘플</b><br><span style="color:#888">${p.sampleEmails.join('<br>')}</span>` : ''}
            </div>`;
        } else {
          document.getElementById('send-progress-title').textContent = '발송 완료';
          renderDashboard();
        }
      } else if(job.status === 'error') {
        setSendProgressError(job.errorMessage || '알 수 없는 오류');
      } else {
        setTimeout(poll, 2000);
      }
    } catch(e) {
      setTimeout(poll, 3000);
    }
  };
  poll();
}

async function saveSchedule() {
  const type = document.querySelector('input[name="sch-type"]:checked')?.value;
  const segSel = document.getElementById('sch-segment');
  const segRaw = segSel.value || null;
  const isPreset = segRaw && segRaw.startsWith('__preset_');
  const presetKey = isPreset ? segRaw.replace('__preset_', '').replace('__', '') : null;
  const segId = (!isPreset && segRaw) ? segRaw : null;
  const segName = segSel.options[segSel.selectedIndex]?.dataset.name || null;
  const tplName = document.getElementById('sch-tpl-name').textContent;

  if(!_schedTplId) return;

  const subject = document.getElementById('sch-subject').value.trim();
  if(!subject) { showToast('이메일 제목을 입력해주세요'); document.getElementById('sch-subject').focus(); return; }

  const payload = {
    template_id: String(_schedTplId),
    template_name: tplName,
    segment_id: segId ? String(segId) : null,
    segment_name: segName,
    segment_query: presetKey ? `__PRESET__:${presetKey}` : null,
    subject,
    schedule_type: type,
    status: 'pending',
  };

  if(type === 'once') {
    const dt = document.getElementById('sch-once-dt').value;
    if(!dt) { showToast('발송 일시를 선택해주세요'); return; }
    payload.scheduled_at = new Date(dt).toISOString();
  } else if(type === 'daily') {
    payload.send_time = document.getElementById('sch-daily-time').value;
  } else if(type === 'weekly' || type === 'biweekly') {
    const wd = document.querySelector('input[name="sch-weekday"]:checked');
    if(!wd) { showToast('요일을 선택해주세요'); return; }
    payload.weekday = parseInt(wd.value);
    payload.send_time = document.getElementById('sch-weekly-time').value;
  } else if(type === 'monthly') {
    payload.day_of_month = parseInt(document.getElementById('sch-monthly-day').value);
    payload.send_time = document.getElementById('sch-monthly-time').value;
  }

  const { error } = await sb.from('email_schedules').insert(payload);
  if(error) { showToast('저장 실패: ' + error.message); return; }

  closeScheduleModal();
  showToast('발송 예약이 저장되었어요');
}

// ═══════════════════════════════════════════
// AUTOMATION PAGE
// ═══════════════════════════════════════════

const AUTO_SEG_SQLS = {
  member: `SELECT DISTINCT email FROM tripbtoz.users_0519 WHERE mkt_email_agree = 1 AND status = 'AT' AND email IS NOT NULL AND email != ''`,
  guest: `SELECT DISTINCT c.user_email AS email FROM tripbtoz.checkouts c JOIN tripbtoz_payment.checkout_detail cd ON cd.checkout_id = c.id WHERE c.user_type = 'guest' AND cd.ad_policy_agreement_yn = 1 AND c.user_email IS NOT NULL AND c.user_email != ''`,
  all: `SELECT DISTINCT email FROM tripbtoz.users_0519 WHERE mkt_email_agree = 1 AND status = 'AT' AND email IS NOT NULL AND email != ''
UNION
SELECT DISTINCT c.user_email AS email FROM tripbtoz.checkouts c JOIN tripbtoz_payment.checkout_detail cd ON cd.checkout_id = c.id WHERE c.user_type = 'guest' AND cd.ad_policy_agreement_yn = 1 AND c.user_email IS NOT NULL AND c.user_email != ''`,
};

const AUTO_CONTENT_SQLS = {
  next_month: `SELECT h.id as hotel_id, h.name_kr, h.city_kr, h.star_rating FROM tripbtoz.hotels h JOIN tripbtoz.bookings b ON b.hotel_id = h.id WHERE b.check_in BETWEEN {{NEXT_MONTH_START}} AND {{NEXT_MONTH_END}} AND h.city_kr IS NOT NULL GROUP BY h.id ORDER BY COUNT(*) DESC LIMIT {{LIMIT}}`,
  recent: `SELECT h.id as hotel_id, h.name_kr, h.city_kr, h.star_rating FROM tripbtoz.hotels h JOIN tripbtoz.bookings b ON b.hotel_id = h.id WHERE b.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND h.city_kr IS NOT NULL GROUP BY h.id ORDER BY COUNT(*) DESC LIMIT {{LIMIT}}`,
};

let _autoTplId = null;
let _autoTplName = '';

async function initAutomationPage() {
  // 템플릿 목록 로드
  const sel = document.getElementById('auto-tpl-select');
  const { data: tpls } = await sb.from('templates').select('id,name').order('updated_at', { ascending: false });
  sel.innerHTML = '<option value="">템플릿 선택...</option>' +
    (tpls || []).map(t => `<option value="${t.id}">${t.name || '제목 없는 템플릿'}</option>`).join('');

  // 매월 일수 채우기
  const daysSel = document.getElementById('auto-monthly-day');
  if(!daysSel.options.length) {
    daysSel.innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i+1}">${i+1}일</option>`).join('');
  }

  // 1회성 기본값: 내일 오전 9시
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
  document.getElementById('auto-once-dt').value = tomorrow.toISOString().slice(0, 16);

  // localStorage 복원
  autoRestore();
  onAutoTypeChange();
}

function autoSave() {
  const d = {
    tplId:       document.getElementById('auto-tpl-select').value,
    subject:     document.getElementById('auto-subject').value,
    utm:         document.getElementById('auto-utm').value,
    segDesc:     document.getElementById('auto-seg-desc').value,
    segSql:      document.getElementById('auto-seg-sql').value,
    contentDesc: document.getElementById('auto-content-desc').value,
    contentSql:  document.getElementById('auto-content-sql').value,
    limit:       document.querySelector('input[name="auto-limit"]:checked')?.value || '6',
    type:        document.querySelector('input[name="auto-type"]:checked')?.value || 'now',
    onceDt:      document.getElementById('auto-once-dt').value,
    dailyTime:   document.getElementById('auto-daily-time').value,
    weekday:     document.querySelector('input[name="auto-weekday"]:checked')?.value || '',
    weeklyTime:  document.getElementById('auto-weekly-time').value,
    monthlyDay:  document.getElementById('auto-monthly-day').value,
    monthlyTime: document.getElementById('auto-monthly-time').value,
    contentOpen: document.getElementById('auto-content-body').style.display !== 'none',
  };
  localStorage.setItem('auto_settings', JSON.stringify(d));
}

function autoRestore() {
  try {
    const d = JSON.parse(localStorage.getItem('auto_settings') || 'null');
    if(!d) return;

    if(d.tplId) {
      document.getElementById('auto-tpl-select').value = d.tplId;
      onAutoTplSelect();
    }
    if(d.subject)     document.getElementById('auto-subject').value = d.subject;
    if(d.utm)         document.getElementById('auto-utm').value = d.utm;
    if(d.segDesc)     document.getElementById('auto-seg-desc').value = d.segDesc;
    if(d.segSql)      document.getElementById('auto-seg-sql').value = d.segSql;
    if(d.contentDesc) document.getElementById('auto-content-desc').value = d.contentDesc;
    if(d.contentSql)  document.getElementById('auto-content-sql').value = d.contentSql;
    if(d.limit) {
      const r = document.querySelector(`input[name="auto-limit"][value="${d.limit}"]`);
      if(r) r.checked = true;
    }
    if(d.type) {
      const r = document.querySelector(`input[name="auto-type"][value="${d.type}"]`);
      if(r) r.checked = true;
    }
    if(d.onceDt)     document.getElementById('auto-once-dt').value = d.onceDt;
    if(d.dailyTime)  document.getElementById('auto-daily-time').value = d.dailyTime;
    if(d.weekday) {
      const r = document.querySelector(`input[name="auto-weekday"][value="${d.weekday}"]`);
      if(r) r.checked = true;
    }
    if(d.weeklyTime)  document.getElementById('auto-weekly-time').value = d.weeklyTime;
    if(d.monthlyDay)  document.getElementById('auto-monthly-day').value = d.monthlyDay;
    if(d.monthlyTime) document.getElementById('auto-monthly-time').value = d.monthlyTime;
    if(d.contentOpen) {
      document.getElementById('auto-content-body').style.display = '';
      document.getElementById('auto-content-arrow').textContent = '▾';
    }
  } catch(e) {}
}

async function onAutoTplSelect() {
  const sel = document.getElementById('auto-tpl-select');
  _autoTplId = sel.value || null;
  _autoTplName = sel.options[sel.selectedIndex]?.text || '';
  autoSave();

  if(!_autoTplId) {
    document.getElementById('auto-preview-empty').style.display = '';
    document.getElementById('auto-preview-frame').style.display = 'none';
    return;
  }

  // 템플릿 html 로드해서 미리보기
  const { data: tpl } = await sb.from('templates').select('html').eq('id', _autoTplId).single();
  if(tpl?.html) {
    document.getElementById('auto-preview-html').innerHTML = tpl.html;
    document.getElementById('auto-preview-empty').style.display = 'none';
    document.getElementById('auto-preview-frame').style.display = '';
  }
}

function autoToggleContent() {
  const body = document.getElementById('auto-content-body');
  const arrow = document.getElementById('auto-content-arrow');
  const open = body.style.display === 'none';
  body.style.display = open ? '' : 'none';
  arrow.textContent = open ? '▾' : '▸';
  autoSave();
}

function autoFillSegSQL(key) {
  document.getElementById('auto-seg-sql').value = AUTO_SEG_SQLS[key] || '';
  autoSave();
}

function autoFillContentSQL(key) {
  document.getElementById('auto-content-sql').value = AUTO_CONTENT_SQLS[key] || '';
  autoSave();
}

async function autoCheckRecipients() {
  const sql = document.getElementById('auto-seg-sql').value.trim();
  if(!sql) { showToast('SQL을 먼저 입력해주세요'); return; }
  const badge = document.getElementById('auto-recipient-badge');
  const badgeRight = document.getElementById('auto-recipient-badge-right');
  badge.style.display = 'inline-flex';
  badge.textContent = '확인 중...';
  badgeRight.style.display = 'none';
  try {
    const res = await fetch(API_BASE + '/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const data = await res.json();
    if(data.error) { badge.textContent = '오류: ' + data.error.substring(0, 50); return; }
    const count = data.total;
    const txt = `수신자 ${count.toLocaleString()}명`;
    badge.textContent = txt;
    badgeRight.textContent = txt;
    badgeRight.style.display = 'inline-flex';
  } catch(e) {
    badge.textContent = '서버 연결 실패';
  }
}

async function autoPreviewContent() {
  const contentQuery = document.getElementById('auto-content-sql').value.trim();
  const contentLimit = parseInt(document.querySelector('input[name="auto-limit"]:checked')?.value || '6');
  const preview = document.getElementById('auto-content-preview');
  if(!contentQuery) { preview.style.display = 'none'; return; }
  preview.style.display = '';
  preview.textContent = '조회 중...';
  try {
    const res = await fetch(API_BASE + '/api/preview-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentQuery, contentLimit }),
    });
    const data = await res.json();
    if(data.error) { preview.textContent = '오류: ' + data.error; return; }
    preview.innerHTML = data.hotels.map(h => {
      let priceLabel;
      if (h.price_available) {
        priceLabel = `<span style="color:var(--accent)">${h.discounted_price?.toLocaleString()}원${h.discount_rate > 0 ? ` -${h.discount_rate}%` : ''}</span>`;
      } else if (h.db_min_price) {
        priceLabel = `<span style="color:var(--accent)">${Number(h.db_min_price).toLocaleString()}원~</span>`;
      } else {
        priceLabel = '<span style="color:#666">가격미조회</span>';
      }
      return `<div style="margin-bottom:4px">• <strong>${h.name_kr || h.name || '-'}</strong> (${h.city_kr || '-'}) ${priceLabel}</div>`;
    }).join('');
  } catch(e) { preview.textContent = '서버 연결 실패'; }
}

function onAutoTypeChange() {
  const type = document.querySelector('input[name="auto-type"]:checked')?.value;
  document.getElementById('auto-once-fields').style.display    = type === 'once'    ? '' : 'none';
  document.getElementById('auto-daily-fields').style.display   = type === 'daily'   ? '' : 'none';
  document.getElementById('auto-weekly-fields').style.display  = (type === 'weekly' || type === 'biweekly') ? '' : 'none';
  document.getElementById('auto-monthly-fields').style.display = type === 'monthly' ? '' : 'none';
  document.getElementById('auto-btn-send-now').style.display = type === 'now' ? '' : 'none';
  document.getElementById('auto-btn-save').style.display     = type === 'now' ? 'none' : '';
  autoRenderSchedulePreview();
}

// 제목 변수 {{월}}, {{N주차}}, {{MM}}, {{YYYY}} 치환
function autoResolveSubject(template, date) {
  const d = date || new Date();
  const month = d.getMonth() + 1;
  const year  = d.getFullYear();
  const mm    = String(month).padStart(2, '0');
  // N주차: 해당 월의 몇 번째 주인지
  const firstDay = new Date(year, d.getMonth(), 1).getDay(); // 0=일
  const weekN = Math.ceil((d.getDate() + firstDay) / 7);
  return template
    .replace(/\{\{월\}\}/g, `${month}월`)
    .replace(/\{\{N주차\}\}/g, `${weekN}주차`)
    .replace(/\{\{MM\}\}/g, mm)
    .replace(/\{\{YYYY\}\}/g, String(year));
}

// 발송 주기에 따른 다음 N개 날짜 계산
function autoGetNextDates(n = 6) {
  const type    = document.querySelector('input[name="auto-type"]:checked')?.value;
  const dates   = [];
  const now     = new Date();

  if(type === 'now' || type === 'once') {
    const dt = document.getElementById('auto-once-dt')?.value;
    dates.push(dt ? new Date(dt) : now);
    return dates;
  }

  let cursor = new Date(now);
  cursor.setSeconds(0, 0);

  if(type === 'daily') {
    const [h, m] = (document.getElementById('auto-daily-time')?.value || '09:00').split(':');
    cursor.setHours(+h, +m);
    if(cursor <= now) cursor.setDate(cursor.getDate() + 1);
    for(let i = 0; i < n; i++) { dates.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }
  } else if(type === 'weekly' || type === 'biweekly') {
    const targetDay = parseInt(document.querySelector('input[name="auto-weekday"]:checked')?.value ?? '1');
    const [h, m]   = (document.getElementById('auto-weekly-time')?.value || '09:00').split(':');
    const step     = type === 'biweekly' ? 14 : 7;
    let diff = (targetDay - cursor.getDay() + 7) % 7 || 7;
    cursor.setDate(cursor.getDate() + diff);
    cursor.setHours(+h, +m);
    for(let i = 0; i < n; i++) { dates.push(new Date(cursor)); cursor.setDate(cursor.getDate() + step); }
  } else if(type === 'monthly') {
    const day  = parseInt(document.getElementById('auto-monthly-day')?.value || '1');
    const [h, m] = (document.getElementById('auto-monthly-time')?.value || '09:00').split(':');
    cursor = new Date(now.getFullYear(), now.getMonth(), day, +h, +m);
    if(cursor <= now) cursor.setMonth(cursor.getMonth() + 1);
    for(let i = 0; i < n; i++) { dates.push(new Date(cursor)); cursor.setMonth(cursor.getMonth() + 1); }
  }
  return dates;
}

function autoRenderSchedulePreview() {
  const el = document.getElementById('auto-schedule-preview');
  if(!el) return;
  const subjectTpl = document.getElementById('auto-subject')?.value.trim();
  const type = document.querySelector('input[name="auto-type"]:checked')?.value;
  if(!subjectTpl || type === 'now') { el.style.display = 'none'; return; }

  const dates = autoGetNextDates(6);
  if(!dates.length) { el.style.display = 'none'; return; }

  const fmt = d => d.toLocaleDateString('ko-KR', { month:'short', day:'numeric', weekday:'short', hour:'2-digit', minute:'2-digit' });
  const rows = dates.map(d =>
    `<div class="auto-schedule-item">
      <span class="auto-schedule-date">${fmt(d)}</span>
      <span class="auto-schedule-subject">${autoResolveSubject(subjectTpl, d)}</span>
    </div>`
  ).join('');

  el.innerHTML = `<div class="auto-label" style="margin-bottom:6px">다음 발송 예정 (제목 미리보기)</div><div class="auto-schedule-list">${rows}</div>`;
  el.style.display = '';
}

function autoInsertVar(v) {
  const el = document.getElementById('auto-subject');
  if(!el) return;
  const s = el.selectionStart, e = el.selectionEnd;
  el.value = el.value.slice(0, s) + v + el.value.slice(e);
  el.selectionStart = el.selectionEnd = s + v.length;
  el.focus();
  autoSave();
  autoRenderSchedulePreview();
}

async function autoSendNow(dryRun = false) {
  const subject = autoResolveSubject(document.getElementById('auto-subject').value.trim());
  const segmentQuery = document.getElementById('auto-seg-sql').value.trim() || null;
  const contentQuery = document.getElementById('auto-content-sql').value.trim() || null;
  const contentLimit = parseInt(document.querySelector('input[name="auto-limit"]:checked')?.value || '6');
  const utmCampaign  = document.getElementById('auto-utm').value.trim() || null;
  const segName      = document.getElementById('auto-seg-desc').value.trim() || '자동화 세그먼트';

  if(!_autoTplId) { showToast('템플릿을 선택해주세요'); return; }
  if(!subject) { showToast('이메일 제목을 입력해주세요'); document.getElementById('auto-subject').focus(); return; }
  if(!segmentQuery) { showToast('수신자 SQL을 입력해주세요'); return; }

  if(!dryRun && !confirm(`"${_autoTplName}" 을 "${segName}" 에게 지금 바로 발송할까요?`)) return;

  const templateId = _autoTplId;
  const tplNameFinal = _autoTplName;
  openSendProgress(dryRun ? '🧪 테스트 발송 시뮬레이션 중...' : '발송 중...');

  try {
    let scheduleId = null;
    if(!dryRun) {
      const now = new Date().toISOString();
      const { data: sch } = await sb.from('email_schedules').insert({
        template_id: templateId,
        template_name: tplNameFinal,
        segment_id: null,
        segment_name: segName,
        subject,
        schedule_type: 'once',
        scheduled_at: now,
        status: 'sending',
        created_at: now,
      }).select('id').single();
      scheduleId = sch?.id || null;
    }

    const res = await fetch(API_BASE + '/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, segmentId: null, segmentQuery, subject, contentQuery, contentLimit, utmCampaign, dryRun, scheduleId }),
    });
    const { jobId, error } = await res.json();
    if(error) { setSendProgressError(error); return; }
    pollSendJob(jobId, dryRun);
  } catch(e) {
    setSendProgressError('서버 연결 실패: ' + e.message);
  }
}

async function autoSaveSchedule() {
  const type = document.querySelector('input[name="auto-type"]:checked')?.value;
  if(!_autoTplId) { showToast('템플릿을 선택해주세요'); return; }

  const subjectTpl = document.getElementById('auto-subject').value.trim();
  if(!subjectTpl) { showToast('이메일 제목을 입력해주세요'); document.getElementById('auto-subject').focus(); return; }
  // 첫 번째 예정 발송일 기준으로 제목 변수 치환
  const firstDate = autoGetNextDates(1)[0] || new Date();
  const subject = autoResolveSubject(subjectTpl, firstDate);

  const segmentQuery = document.getElementById('auto-seg-sql').value.trim() || null;
  if(!segmentQuery) { showToast('수신자 SQL을 입력해주세요'); return; }

  const contentQuery = document.getElementById('auto-content-sql').value.trim() || null;
  const contentLimit = parseInt(document.querySelector('input[name="auto-limit"]:checked')?.value || '6');
  const utmCampaign  = document.getElementById('auto-utm').value.trim() || null;
  const segName      = document.getElementById('auto-seg-desc').value.trim() || null;

  const payload = {
    template_id:    _autoTplId,
    template_name:  _autoTplName,
    segment_id:     null,
    segment_name:   segName,
    segment_query:  segmentQuery,
    subject,
    schedule_type:  type,
    status:         'pending',
    content_query:  contentQuery,
    content_limit:  contentLimit,
    utm_campaign:   utmCampaign,
  };

  if(type === 'once') {
    const dt = document.getElementById('auto-once-dt').value;
    if(!dt) { showToast('발송 일시를 선택해주세요'); return; }
    payload.scheduled_at = new Date(dt).toISOString();
  } else if(type === 'daily') {
    payload.send_time = document.getElementById('auto-daily-time').value;
  } else if(type === 'weekly' || type === 'biweekly') {
    const wd = document.querySelector('input[name="auto-weekday"]:checked');
    if(!wd) { showToast('요일을 선택해주세요'); return; }
    payload.weekday   = parseInt(wd.value);
    payload.send_time = document.getElementById('auto-weekly-time').value;
  } else if(type === 'monthly') {
    payload.day_of_month = parseInt(document.getElementById('auto-monthly-day').value);
    payload.send_time    = document.getElementById('auto-monthly-time').value;
  }

  const { error } = await sb.from('email_schedules').insert(payload);
  if(error) { showToast('저장 실패: ' + error.message); return; }

  showToast('발송 예약이 저장되었어요');
}
