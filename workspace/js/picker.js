// workspace/js/picker.js
import * as store from './store.js';
import * as utils from './utils.js';

const CATS = ['全部', '悲伤', '愤怒', '懵圈无力', '打工人', '开心', '转场特效'];
const FRAMINGS = ['全部', '全身', '上半身', '转场'];

let modalState = null;

export function openPicker(opts) {
  modalState = {
    assets: opts.assets || [],
    currentId: opts.currentId,
    currentIds: opts.currentIds || [],
    multi: opts.multi || false,
    onSelect: opts.onSelect,
    title: opts.title || '选图',
    sub: opts.sub || '',
    filterCat: '全部',
    filterFrm: '全部',
    query: ''
  };
  renderModal();
}

export function closePicker() {
  modalState = null;
  const root = document.getElementById('modalRoot');
  if (root) root.innerHTML = '';
}

function renderModal() {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal on" id="pickerModal">
      <div class="modal-box">
        <div class="modal-head">
          <div>
            <div class="t">${utils.esc(modalState.title)}</div>
            <div class="s">${utils.esc(modalState.sub)}</div>
          </div>
          <button class="btn primary" id="pickerClose">完成</button>
        </div>
        <div class="filters">
          <input class="search" id="pickerSearch" placeholder="🔍 搜索：存钱罐 / 背身 / 墨镜 / 推车 …" value="${utils.escAttr(modalState.query)}">
          <div class="chips" id="pickerCatChips"></div>
          <div class="chips" id="pickerFrmChips"></div>
        </div>
        <div class="grid" id="pickerGrid"></div>
      </div>
    </div>
  `;

  document.getElementById('pickerClose').onclick = closePicker;
  document.getElementById('pickerModal').addEventListener('click', e => {
    if (e.target.id === 'pickerModal') closePicker();
  });
  document.getElementById('pickerSearch').oninput = e => {
    modalState.query = e.target.value;
    renderGrid();
  };

  renderChips();
  renderGrid();
}

function renderChips() {
  document.getElementById('pickerCatChips').innerHTML = CATS.map(c =>
    `<button class="chip ${c === modalState.filterCat ? 'on' : ''}" data-cat="${utils.escAttr(c)}">${c}</button>`
  ).join('');
  document.getElementById('pickerFrmChips').innerHTML = FRAMINGS.map(f =>
    `<button class="chip ${f === modalState.filterFrm ? 'on' : ''}" data-frm="${utils.escAttr(f)}">${f}</button>`
  ).join('');

  document.getElementById('pickerCatChips').onclick = e => {
    const b = e.target.closest('button[data-cat]');
    if (!b) return;
    modalState.filterCat = b.dataset.cat;
    renderChips(); renderGrid();
  };
  document.getElementById('pickerFrmChips').onclick = e => {
    const b = e.target.closest('button[data-frm]');
    if (!b) return;
    modalState.filterFrm = b.dataset.frm;
    renderChips(); renderGrid();
  };
}

function getSelected() {
  if (modalState.multi) return modalState.currentIds.slice();
  return modalState.currentId ? [modalState.currentId] : [];
}

function renderGrid() {
  const q = modalState.query.trim().toLowerCase();
  const list = modalState.assets.filter(a => {
    if (modalState.filterCat !== '全部' && a.cat !== modalState.filterCat) return false;
    if (modalState.filterFrm !== '全部' && a.framing !== modalState.filterFrm) return false;
    if (q) {
      const hay = (a.id + ' ' + a.desc + ' ' + a.action + ' ' + a.state + ' ' + a.prop + ' ' + a.cat).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const grid = document.getElementById('pickerGrid');
  if (!list.length) {
    grid.innerHTML = '<div class="empty-grid">没找到匹配的素材</div>';
    return;
  }
  const selected = getSelected();
  grid.innerHTML = list.map(a => {
    const sel = selected.includes(a.id) ? 'sel' : '';
    return `<div class="asset ${sel}" data-id="${utils.escAttr(a.id)}">
      <div class="img-wrap"><img src="${store.assetUrl(a)}" loading="lazy" data-fb="${utils.escAttr(store.assetThumbUrl(a))}" onerror="this.onerror=null;if(this.src.startsWith('blob:'))this.src=this.dataset.fb;else this.parentElement.style.background='#fee'"></div>
      <div class="cap"><b>${utils.esc(a.id)}</b> ${utils.esc(a.desc)}<br><span style="opacity:.7">${utils.esc(a.cat)}/${utils.esc(a.framing)}</span></div>
    </div>`;
  }).join('');

  grid.onclick = e => {
    const el = e.target.closest('.asset');
    if (!el) return;
    pick(el.dataset.id);
  };
}

function pick(id) {
  if (!modalState) return;
  if (modalState.multi) {
    const idx = modalState.currentIds.indexOf(id);
    if (idx === -1) modalState.currentIds.push(id);
    else modalState.currentIds.splice(idx, 1);
    modalState.onSelect(modalState.currentIds.slice());
    renderGrid();
  } else {
    modalState.currentId = id;
    modalState.onSelect(id);
    closePicker();
  }
}
