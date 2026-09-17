/**
 * 国盛智投AI助手 · 交互引擎（app.js）
 * ------------------------------------------------------------
 * 职责：
 *   1. 基础动效原语 —— 打字机 / 日志滚动 / 数字滚动 / 星星点亮
 *   2. Tab 切换
 *   3. 引擎一剧本：Cron 触发 → 链路日志 → 多源资讯聚合 → 简报打字机 → 人工对比 → QA
 *   4. 引擎二剧本：客户 CRUD → 持仓编辑 → 个股分析 → 风险打分 → 组合风险
 *   5. 引擎三剧本：文案生成 → 产品匹配 → 合规校验 → 渠道推送 → 彩蛋拦截
 *
 * 设计原则：全剧本可控，无真实网络依赖，任意时刻可重置重放。
 * 客户数据持久化在 localStorage，可一键恢复初始数据。
 */

/* ============================================================
 * 0. 工具原语
 * ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** HTML 转义，防止用户输入破坏结构 */
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);

/**
 * 打字机效果
 * @param {HTMLElement} el   目标容器
 * @param {string} text      文本
 * @param {number} speed     每字符间隔 ms
 * @param {boolean} clear    是否先清空
 */
function typewriter(el, text, speed = 18, clear = true) {
  return new Promise((resolve) => {
    if (!el) return resolve();
    if (clear) el.textContent = '';
    el.classList.add('typing');
    let i = 0;
    const timer = setInterval(() => {
      // 一次追加 1-2 个字符，长文本时观感更接近真实流式输出
      const step = text.length > 600 ? 2 : 1;
      el.textContent += text.slice(i, i + step);
      i += step;
      if (i >= text.length) {
        clearInterval(timer);
        activeTimers.delete(timer);
        el.classList.remove('typing');
        resolve();
      }
    }, speed);
    // 注册到全局计时器集合，确保「重置」能中断仍在进行的打字动画
    activeTimers.add(timer);
  });
}

/** 跳过动画：把已注册的进行中动画全部立即结束 */
const activeTimers = new Set();
function clearAllTimers() {
  activeTimers.forEach((t) => {
    clearInterval(t);
    clearTimeout(t);
  });
  activeTimers.clear();
}

/** 日志滚动 */
async function runLogs(container, logs, onStep) {
  container.innerHTML = '';
  for (let i = 0; i < logs.length; i++) {
    await sleep(i === 0 ? 180 : 480);
    const log = logs[i];
    const line = document.createElement('div');
    line.className = 'log-line log-in';
    line.dataset.tag = log.tag || 'default';
    line.innerHTML = `
      <span class="log-time">[${log.t}]</span>
      <span class="log-icon">${log.icon}</span>
      <span class="log-text">${log.text}</span>`;
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
    if (onStep) onStep(log, i);
  }
}

/** 数字滚动 */
function animateNumber(el, target, { duration = 900, decimals = 1, suffix = '' } = {}) {
  return new Promise((resolve) => {
    if (!el) return resolve();
    const start = performance.now();
    const from = 0;
    function frame(now) {
      const p = Math.min((now - start) / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      const val = from + (target - from) * eased;
      el.textContent = val.toFixed(decimals) + suffix;
      if (p < 1) {
        const id = requestAnimationFrame(frame);
        activeTimers.add(id);
      } else {
        el.textContent = target.toFixed(decimals) + suffix;
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

/** 星星逐颗点亮，返回 Promise */
function animateStars(el, score) {
  return new Promise((resolve) => {
    el.innerHTML = '';
    const stars = [];
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span');
      s.className = 'star';
      s.textContent = '★';
      el.appendChild(s);
      stars.push(s);
    }
    let i = 0;
    const timer = setInterval(() => {
      if (i >= 5) {
        clearInterval(timer);
        resolve();
        return;
      }
      const filled = score >= i + 1;
      const partial = !filled && score > i;
      if (filled) stars[i].classList.add('on');
      else if (partial) stars[i].classList.add('on', 'half');
      i++;
    }, 90);
  });
}

/** 状态灯 */
function setStatus(id, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('green', 'gray', 'amber', 'blink');
  el.classList.add(ok === 'amber' ? 'amber' : ok ? 'green' : 'gray');
}

/** 风险分 → 颜色分级：1-2 绿 / 3 黄 / 4-5 红 */
function riskLevel(score) {
  if (score < 2.5) return 'low';
  if (score < 3.5) return 'mid';
  return 'high';
}
function riskText(score) {
  const lv = riskLevel(score);
  return lv === 'low' ? '低风险' : lv === 'mid' ? '中风险' : '高风险';
}

/** 风险等级文案（产品用） */
function riskLabelLv(lv) {
  return ['', 'R1 低风险', 'R2 中低风险', 'R3 中风险', 'R4 中高风险', 'R5 高风险'][lv] || 'R?';
}

/** 轻提示 */
function toast(msg, type = 'ok') {
  const wrap = $('#toast-wrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, 2200);
}

/* ============================================================
 * 1. 全局状态
 * ============================================================ */

// V3：客户数据换成真实脱敏持仓，键名同步升级，避免旧版缓存串数据
const LS_KEY = 'ai-advisor-demo-clients-v3';

/** 深拷贝，避免 mock 数据被就地污染 */
const clone = (o) => JSON.parse(JSON.stringify(o));

const STATE = {
  activeTab: 'market',
  cronDone: false,
  analyzed: {}, // 运行时按客户 id 懒初始化
  briefText: '',
  clients: [], // 可编辑的客户数据（含持仓）
  currentClient: null,
  sendProducts: [], // 已勾选要推送的产品 id
};

/* --- 持久化 ------------------------------------------------- */

function loadClients() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (e) {
    /* 解析失败则回落到初始数据 */
  }
  return clone(DATA.CLIENTS);
}

function saveClients() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(STATE.clients));
  } catch (e) {
    toast('本地存储写入失败', 'warn');
  }
}

function resetClients() {
  STATE.clients = clone(DATA.CLIENTS);
  saveClients();
  STATE.analyzed = {};
  STATE.currentClient = STATE.clients[0]?.id || null;
  STATE.sendProducts = [];
  renderClientSwitch();
  renderClient(STATE.currentClient);
  initSendTab();
  toast('已恢复初始演示数据');
}

/** 计算某客户的组合风险分（按仓位加权） */
function calcPortfolioRisk(client) {
  if (!client.holdings.length) return 0;
  const totalW = client.holdings.reduce((s, h) => s + (Number(h.weight) || 0), 0);
  if (totalW <= 0) {
    const avg = client.holdings.reduce((s, h) => s + (Number(h.risk) || 0), 0) / client.holdings.length;
    return Math.round(avg * 10) / 10;
  }
  const w = client.holdings.reduce((s, h) => s + (Number(h.risk) || 0) * (Number(h.weight) || 0), 0);
  return Math.round((w / totalW) * 10) / 10;
}

/** 计算某客户的合计仓位 */
function calcTotalWeight(client) {
  const t = client.holdings.reduce((s, h) => s + (Number(h.weight) || 0), 0);
  return Math.round(t * 100) / 100;
}

/**
 * 单只标的的盈亏率（%）。
 * 优先使用真实持仓盈亏率字段 pnl；缺失时回落到 成本价/现价 推算。
 */
function holdingPnl(h) {
  if (h.pnl !== undefined && h.pnl !== null && h.pnl !== '') return Number(h.pnl) || 0;
  if (h.cost) return ((Number(h.price) - Number(h.cost)) / Number(h.cost)) * 100;
  return 0;
}

/** 组合加权浮动盈亏率（%），按仓位占比加权 */
function calcPortfolioPnl(client) {
  const list = client.holdings || [];
  const totalW = list.reduce((s, h) => s + (Number(h.weight) || 0), 0);
  if (!list.length || totalW <= 0) {
    if (!list.length) return 0;
    return Math.round((list.reduce((s, h) => s + holdingPnl(h), 0) / list.length) * 100) / 100;
  }
  const w = list.reduce((s, h) => s + holdingPnl(h) * (Number(h.weight) || 0), 0);
  return Math.round((w / totalW) * 100) / 100;
}

/* ============================================================
 * 2. Tab 切换
 * ============================================================ */

function initTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  STATE.activeTab = tab;
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.tab === tab));
  // 进入发送页时，默认锁定为当前正在查看的客户，保持「简报 × 持仓 × 产品」链路一致
  if (tab === 'send') syncSendClientChip();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** 把发送页的客户 chip 同步为当前查看的客户（不触发重置） */
function syncSendClientChip() {
  const cs = $('#send-client');
  if (!cs) return;
  const target = STATE.currentClient || STATE.clients[0]?.id;
  $$('.chip', cs).forEach((b) => b.classList.toggle('active', b.dataset.client === target));
}

/* ============================================================
 * 3. 引擎一：盘前简报
 * ============================================================ */

function initMarketTab() {
  const btnRun = $('#btn-run-cron');
  const btnReset = $('#btn-reset-cron');
  const btnCompare = $('#btn-compare');

  // 渲染美股行情卡片
  $('#market-strip').innerHTML = DATA.US_MARKET.map(
    (m) => `
    <div class="mkt-card">
      <div class="mkt-name">${m.name} <span class="mkt-code">${m.code}</span></div>
      <div class="mkt-close">${m.close.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
      <div class="mkt-chg ${m.chg >= 0 ? 'up' : 'down'}">
        ${m.chg >= 0 ? '▲' : '▼'} ${Math.abs(m.chg).toFixed(2)}%
      </div>
    </div>`
  ).join('');

  // 渲染 A 股行情卡片
  $('#cn-market-strip').innerHTML = DATA.CN_MARKET.map(
    (m) => `
    <div class="mkt-card">
      <div class="mkt-name">${m.name} <span class="mkt-code">${m.code}</span></div>
      <div class="mkt-close">${m.close.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
      <div class="mkt-foot">
        <span class="mkt-chg ${m.chg >= 0 ? 'up' : 'down'}">${m.chg >= 0 ? '▲' : '▼'} ${Math.abs(m.chg).toFixed(2)}%</span>
        ${m.amount && m.amount !== '—' ? `<span class="mkt-amount">成交 ${m.amount}</span>` : ''}
      </div>
    </div>`
  ).join('');

  // 渲染宏观变量（国内优先，海外次之）
  $('#macro-strip').innerHTML = DATA.MACRO.map(
    (m) => `
    <div class="macro-item${m.region === 'us' ? ' ovs' : ''}">
      <span class="macro-name">${m.region === 'us' ? '🌎 ' : '🇨🇳 '}${m.name}</span>
      <span class="macro-val">${m.value}</span>
      ${Number(m.delta) === 0 || m.delta === undefined ? '' : `<span class="macro-delta ${m.delta > 0 ? 'up' : 'down'}">${m.delta > 0 ? '+' : ''}${m.delta}</span>`}
    </div>`
  ).join('');

  // 信源配比说明条
  const ratio = $('#news-ratio');
  if (ratio) {
    const cn = DATA.NEWS.filter((n) => n.region === 'cn').length;
    const us = DATA.NEWS.filter((n) => n.region === 'us').length;
    ratio.innerHTML = `
      <span class="nr-item cn">🇨🇳 国内 ${cn} 条 · ${DATA.NEWS_REGION_RATIO.cn}%</span>
      <span class="nr-sep">/</span>
      <span class="nr-item us">🌎 海外 ${us} 条 · ${DATA.NEWS_REGION_RATIO.us}%</span>
      <span class="nr-note">A 股定价主导变量在国内，海外仅作情绪与风险偏好传导</span>`;
  }

  renderNews();
  renderQA();

  btnRun?.addEventListener('click', runCronScript);
  btnReset?.addEventListener('click', resetCronScript);
  btnCompare?.addEventListener('click', toggleCompare);
  $('#btn-legend')?.addEventListener('click', () => $('#news-legend')?.classList.toggle('hidden'));
}

/* --- 3.1 隔夜资讯聚合列表 ---------------------------------- */

/** 按渠道数判定优先级；≥4 高，≥2 中，1 低 */
function verdictOf(n) {
  if (n >= 4) return { key: 'high', text: '高优先级' };
  if (n >= 2) return { key: 'mid', text: '中优先级' };
  return { key: 'low', text: '低置信' };
}

function renderNews() {
  const chMap = {};
  DATA.NEWS_CHANNELS.forEach((c) => (chMap[c.id] = c));

  // 置顶项（top: true）恒排最前，其余按最早报道时间排序
  const news = [...DATA.NEWS].sort((a, b) => {
    if (!!b.top !== !!a.top) return b.top ? 1 : -1;
    return a.time.localeCompare(b.time);
  });

  $('#news-list').innerHTML = news
    .map((n) => {
      const v = n.top ? { key: 'top', text: '最高优先级' } : verdictOf(n.sources.length);
      const chips = DATA.NEWS_CHANNELS.map((c) => {
        const hit = n.sources.includes(c.id);
        return `<span class="src-chip ${hit ? 'on' : ''}" title="${esc(c.name)}${hit ? ' · 已报道' : ' · 未报道'}">${c.icon}</span>`;
      }).join('');

      return `
      <div class="news-item${n.top ? ' ni-top-item' : ''}">
        <div class="ni-left">
          <span class="ni-time">${n.time}</span>
          <span class="vdot ${v.key}" title="${v.text}"></span>
        </div>
        <div class="ni-body">
          <div class="ni-top">
            ${n.top ? '<span class="ni-pin">🔴 置顶</span>' : ''}
            <span class="ni-region ${n.region}">${n.region === 'cn' ? '🇨🇳 国内' : '🌎 海外'}</span>
            <span class="ni-cat">${n.cat}</span>
            ${n.date ? `<span class="ni-date">${n.date}</span>` : ''}
            <span class="ni-verdict v-${v.key}">${v.text} · ${n.sources.length} 源</span>
          </div>
          <div class="ni-text">${esc(n.text)}</div>
          <div class="ni-link">↳ ${esc(n.link)}</div>
          <div class="ni-src">${chips}</div>
        </div>
      </div>`;
    })
    .join('');
}

/* --- 3.2 盘前简报 QA ---------------------------------------- */

let qaFilter = '全部';

function renderQA() {
  const tags = ['全部', ...new Set(DATA.BRIEF_QA.map((x) => x.tag))];
  $('#qa-count').textContent = DATA.BRIEF_QA.length;

  $('#qa-filter').innerHTML = tags
    .map((t) => `<button class="qa-tab ${t === qaFilter ? 'active' : ''}" data-tag="${t}">${t}</button>`)
    .join('');
  $$('.qa-tab', $('#qa-filter')).forEach((b) =>
    b.addEventListener('click', () => {
      qaFilter = b.dataset.tag;
      renderQA();
    })
  );

  const list = qaFilter === '全部' ? DATA.BRIEF_QA : DATA.BRIEF_QA.filter((x) => x.tag === qaFilter);

  $('#qa-list').innerHTML = list
    .map(
      (item, i) => `
    <div class="qa-item" data-i="${i}">
      <div class="qa-q">
        <span class="qa-tag t-${item.tag}">${item.tag}</span>
        <span class="qa-qtext">${esc(item.q)}</span>
        <span class="qa-arrow">▸</span>
      </div>
      <div class="qa-a">${esc(item.a)}</div>
    </div>`
    )
    .join('');

  $$('.qa-item').forEach((el) =>
    el.querySelector('.qa-q').addEventListener('click', () => el.classList.toggle('open'))
  );
}

/* --- 3.3 Cron 剧本 ------------------------------------------ */

async function runCronScript() {
  if (STATE.cronDone) return;
  STATE.cronDone = true;

  const btnRun = $('#btn-run-cron');
  btnRun.disabled = true;
  btnRun.classList.add('running');
  btnRun.innerHTML = '<span class="spinner"></span> 链路执行中...';

  ['cron', 'mcp', 'news', 'ai', 'compliance', 'push'].forEach((k) => setStatus('st-' + k, false));

  const briefEl = $('#brief-output');
  briefEl.textContent = '';
  $('#brief-placeholder')?.classList.add('hidden');
  $('#brief-wrapper')?.classList.remove('hidden');

  const logMap = { cron: 'cron', mcp: 'mcp', ai: 'ai', compliance: 'compliance', push: 'push' };
  const lit = new Set();
  await runLogs($('#log-stream'), DATA.CRON_LOGS, (log) => {
    // 资讯聚合阶段：抓取与验证两条日志点亮同一个灯
    if (log.text.includes('抓取') || log.text.includes('交叉验证')) {
      if (!lit.has('news')) {
        lit.add('news');
        setStatus('st-news', true);
      }
    }
    const key = logMap[log.tag];
    if (key && !lit.has(key)) {
      lit.add(key);
      setStatus('st-' + key, true);
    }
    if (log.tag === 'ai' && log.text.includes('生成中')) showBriefSkeleton();
  });

  hideBriefSkeleton();
  const lenEl = $('#brief-len');
  const total = DATA.BRIEF_AI.length;
  const lenTimer = setInterval(() => {
    const cur = Math.min(parseInt(lenEl.textContent, 10) + 3, total);
    lenEl.textContent = cur;
    if (cur >= total) clearInterval(lenTimer);
  }, 60);
  await typewriter(briefEl, DATA.BRIEF_AI, 11);
  clearInterval(lenTimer);
  lenEl.textContent = total;
  STATE.briefText = DATA.BRIEF_AI;

  $('#brief-meta')?.classList.remove('hidden');
  $('#action-bar')?.classList.remove('hidden');
  $('#btn-compare')?.classList.remove('hidden');
  btnRun.innerHTML = '✅ 链路已完成（可重置重放）';
  btnRun.classList.remove('running');
}

function showBriefSkeleton() {
  $('#brief-skeleton')?.classList.remove('hidden');
}
function hideBriefSkeleton() {
  $('#brief-skeleton')?.classList.add('hidden');
}

function resetCronScript() {
  clearAllTimers();
  STATE.cronDone = false;
  STATE.briefText = '';
  $('#log-stream').innerHTML = `<div class="log-hint">等待触发…点击上方「▶ 手动触发 Cron」开始全链路演示</div>`;
  $('#brief-output').textContent = '';
  $('#brief-placeholder')?.classList.remove('hidden');
  $('#brief-wrapper')?.classList.add('hidden');
  $('#brief-meta')?.classList.add('hidden');
  $('#action-bar')?.classList.add('hidden');
  $('#btn-compare')?.classList.add('hidden');
  $('#compare-panel')?.classList.add('hidden');
  const btn = $('#btn-run-cron');
  btn.disabled = false;
  btn.classList.remove('running');
  btn.innerHTML = '▶ 手动触发 Cron';
  ['cron', 'mcp', 'news', 'ai', 'compliance', 'push'].forEach((k) => setStatus('st-' + k, false));
}

function toggleCompare() {
  const panel = $('#compare-panel');
  const nowHidden = panel.classList.toggle('hidden');
  if (nowHidden) return;

  const aiRef = $('#ai-out-ref');
  if (!aiRef.dataset.filled) {
    aiRef.dataset.filled = '1';
    aiRef.textContent = DATA.BRIEF_AI;
  }

  const humanEl = $('#human-output');
  if (!humanEl.dataset.filled) {
    humanEl.dataset.filled = '1';
    typewriter(humanEl, DATA.BRIEF_HUMAN, 10);
  }

  const sg = $('#stat-grid');
  if (!sg.dataset.filled) {
    sg.dataset.filled = '1';
    sg.innerHTML = DATA.COMPARE_STATS.map(
      (s) => `
      <div class="stat-box">
        <div class="k">${s.label}</div>
        <div class="v">${s.ai}</div>
        <div class="g">${s.gain}</div>
      </div>`
    ).join('');
  }

  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ============================================================
 * 4. 引擎二：客户持仓（可编辑）
 * ============================================================ */

const AVATAR_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6'];

function initClientTab() {
  renderClientSwitch();
  STATE.currentClient = STATE.clients[0]?.id || null;
  renderClient(STATE.currentClient);

  $('#btn-add-client')?.addEventListener('click', () => openClientModal(null));
  $('#btn-reset-data')?.addEventListener('click', resetClients);
  $('#btn-add-holding')?.addEventListener('click', () => openHoldingModal(null));
  $('#btn-add-product')?.addEventListener('click', () => openProductModal('holding'));
}

function renderClientSwitch() {
  const sw = $('#client-switch');
  sw.innerHTML =
    STATE.clients
      .map(
        (c) => `
    <button class="client-btn ${c.id === STATE.currentClient ? 'active' : ''}" data-client="${c.id}">
      <span class="client-avatar" style="background:${c.color}">${esc(c.avatar)}</span>
      <span class="client-info">
        <span class="client-name">${esc(c.name)}</span>
        <span class="client-tag">${esc(c.tag)}</span>
      </span>
    </button>`
      )
      .join('') ||
    `<div class="client-empty">暂无客户，点击右侧「＋ 新增客户」开始</div>`;

  $$('.client-btn', sw).forEach((b) =>
    b.addEventListener('click', () => renderClient(b.dataset.client))
  );
}

function renderClient(id) {
  if (!id) return;
  STATE.currentClient = id;
  const c = STATE.clients.find((x) => x.id === id);
  if (!c) return;

  $$('.client-btn').forEach((b) => b.classList.toggle('active', b.dataset.client === id));

  const totalW = calcTotalWeight(c);
  const totalPnl = calcPortfolioPnl(c);

  $('#client-profile').innerHTML = `
    <div class="profile-head">
      <span class="profile-avatar" style="background:${c.color}">${esc(c.avatar)}</span>
      <div style="flex:1">
        <div class="profile-name">${esc(c.name)} <span class="badge" style="background:${c.color}22;color:${c.color};border-color:${c.color}55">${esc(c.riskProfile)}</span></div>
        <div class="profile-risk">持仓风格：${esc(c.style || '—')}</div>
      </div>
      <div class="profile-tools">
        <button class="icon-btn" id="btn-edit-client" title="编辑客户档案">✏️</button>
        <button class="icon-btn danger" id="btn-del-client" title="删除该客户">🗑️</button>
      </div>
    </div>
    <div class="profile-stats">
      <div class="pstat"><span class="pstat-k">资产规模</span><span class="pstat-v">${esc(c.aum)}</span></div>
      <div class="pstat"><span class="pstat-k">合计仓位</span><span class="pstat-v">${totalW}%</span></div>
      <div class="pstat"><span class="pstat-k">换手率</span><span class="pstat-v">${esc(c.turnover || '—')}</span></div>
      <div class="pstat"><span class="pstat-k">持仓数</span><span class="pstat-v">${c.holdings.length} 只</span></div>
      <div class="pstat"><span class="pstat-k">产品购买记录</span><span class="pstat-v">${esc(c.boughtProduct || '—')}</span></div>
      <div class="pstat"><span class="pstat-k">组合浮动盈亏</span><span class="pstat-v ${totalPnl >= 0 ? 'up' : 'down'}">${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%</span></div>
    </div>
    <p class="profile-summary">${esc(c.summary)}</p>`;

  $('#btn-edit-client')?.addEventListener('click', () => openClientModal(c.id));
  $('#btn-del-client')?.addEventListener('click', () => deleteClient(c.id));

  // 组合风险分（动态计算）
  const risk = calcPortfolioRisk(c);
  const riskEl = $('#portfolio-risk');
  riskEl.className = 'risk-big ' + riskLevel(risk);
  animateNumber(riskEl, risk, { duration: 1100, decimals: 1 });
  $('#portfolio-risk-label').textContent = riskText(risk);
  $('#portfolio-risk-label').className = 'risk-label ' + riskLevel(risk);

  // 合计仓位
  const wt = $('#weight-total');
  if (wt) {
    wt.textContent = `合计仓位 ${totalW}%`;
    wt.className = 'weight-total ' + (totalW > 100 ? 'over' : '');
  }

  renderHoldings(c);
}

function renderHoldings(c) {
  const list = $('#holdings-list');

  if (!c.holdings.length) {
    list.innerHTML = `<div class="holding-empty">该客户暂无持仓<br><span>点击上方「＋ 添加股票」或「＋ 添加理财产品」录入</span></div>`;
    return;
  }

  list.innerHTML = c.holdings.map((h, i) => holdingCard(h, c, i)).join('');

  $$('.btn-analyze', list).forEach((btn) =>
    btn.addEventListener('click', () => runHoldingAnalysis(btn))
  );
  $$('.btn-edit-holding', list).forEach((btn) =>
    btn.addEventListener('click', () => {
      const code = btn.closest('.holding-card').dataset.code;
      openHoldingModal(code);
    })
  );
  $$('.btn-del-holding', list).forEach((btn) =>
    btn.addEventListener('click', () => {
      const code = btn.closest('.holding-card').dataset.code;
      deleteHolding(code);
    })
  );

  // 已分析过的，直接恢复为完成态
  const analyzed = STATE.analyzed[c.id] || new Set();
  analyzed.forEach((code) => {
    const card = list.querySelector(`[data-code="${CSS.escape(code)}"]`);
    const h = c.holdings.find((x) => x.code === code);
    if (card && h) markAnalyzed(card, h);
  });
}

function holdingCard(h, c, idx) {
  const pnl = holdingPnl(h);
  const isFund = ['公募基金', '资管产品', '私募基金'].includes(h.type);
  return `
  <div class="holding-card" data-code="${esc(h.code)}" style="animation-delay:${idx * 50}ms">
    <div class="hc-head">
      <div class="hc-title">
        <span class="hc-name">${esc(h.name)}</span>
        <span class="hc-code">${esc(h.code)}</span>
        <span class="hc-ind ${isFund ? 'fund' : ''}">${esc(h.type || '股票')} · ${esc(h.industry)}</span>
      </div>
      <div class="hc-price">
        <span class="hc-cur">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%</span>
        <span class="hc-pnl ${pnl >= 0 ? 'up' : 'down'}">${pnl >= 0 ? '▲ 浮盈' : '▼ 浮亏'}</span>
      </div>
    </div>
    <div class="hc-tools">
      <button class="icon-btn sm btn-edit-holding" title="编辑">✏️</button>
      <button class="icon-btn sm danger btn-del-holding" title="删除">🗑️</button>
    </div>
    <div class="hc-weight-bar">
      <div class="hc-weight-fill" style="width:${Math.min(h.weight * 3, 100)}%;background:${c.color}"></div>
      <span class="hc-weight-label">仓位 ${h.weight}%</span>
    </div>
    <div class="hc-risk-row">
      <span class="hc-risk-k">该标的评分</span>
      <span class="hc-stars" data-stars></span>
      <span class="hc-risk-num" data-risknum>0.0</span>
    </div>
    <button class="btn-analyze">⚡ 生成分析</button>
    <div class="hc-analysis hidden" data-analysis>
      <div class="an-block">
        <div class="an-title">🔗 产业链位置</div>
        <p class="an-text" data-chain></p>
      </div>
      <div class="an-block">
        <div class="an-title">📊 基本面亮点</div>
        <p class="an-text" data-fund></p>
      </div>
      <div class="an-block">
        <div class="an-title">⚠️ 风险因子拆解</div>
        <div class="factor-list" data-factors></div>
      </div>
    </div>
  </div>`;
}

function currentClientObj() {
  return STATE.clients.find((x) => x.id === STATE.currentClient);
}

async function runHoldingAnalysis(btn) {
  const card = btn.closest('.holding-card');
  const code = card.dataset.code;
  const c = currentClientObj();
  const h = c.holdings.find((x) => x.code === code);
  if (!h) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> AI 分析中...';

  const box = card.querySelector('[data-analysis]');
  box.classList.remove('hidden');
  box.classList.add('an-in');

  await typewriter(card.querySelector('[data-chain]'), h.chain || '暂无产业链数据', 12);
  await sleep(180);
  await typewriter(card.querySelector('[data-fund]'), h.fundamental || '暂无基本面数据', 12);
  await sleep(180);

  const factors = h.factors && h.factors.length ? h.factors : defaultFactors(h.risk);
  const fl = card.querySelector('[data-factors]');
  fl.innerHTML = factors
    .map(
      (f) => `
    <div class="factor">
      <span class="factor-name">${esc(f.name)}</span>
      <div class="factor-bar"><div class="factor-fill lv-${riskLevel(f.score)}" style="width:0%"></div></div>
      <span class="factor-score">${f.score}/5</span>
    </div>`
    )
    .join('');
  await sleep(80);
  $$('.factor-fill', fl).forEach((el, i) => {
    el.style.width = factors[i].score * 20 + '%';
  });

  await animateStars(card.querySelector('[data-stars]'), h.risk);
  await animateNumber(card.querySelector('[data-risknum]'), h.risk, { duration: 600, decimals: 1 });

  btn.innerHTML = '✅ 已生成';

  if (!STATE.analyzed[c.id]) STATE.analyzed[c.id] = new Set();
  STATE.analyzed[c.id].add(code);

  const all = c.holdings.every((x) => STATE.analyzed[c.id].has(x.code));
  if (all) showNextStepHint();
}

/** 用户手填的持仓没有 factors，按风险分推导一组 */
function defaultFactors(risk) {
  const r = Number(risk) || 3;
  return [
    { name: '波动率', score: Math.min(5, Math.max(1, Math.round(r))) },
    { name: '估值分位', score: Math.min(5, Math.max(1, Math.round(r * 0.8))) },
    { name: '行业景气', score: Math.min(5, Math.max(1, Math.round(r * 0.9))) },
    { name: '流动性', score: Math.min(5, Math.max(1, Math.round(r * 0.6))) },
  ];
}

function markAnalyzed(card, h) {
  const box = card.querySelector('[data-analysis]');
  box.classList.remove('hidden');
  card.querySelector('[data-chain]').textContent = h.chain || '暂无产业链数据';
  card.querySelector('[data-fund]').textContent = h.fundamental || '暂无基本面数据';

  const factors = h.factors && h.factors.length ? h.factors : defaultFactors(h.risk);
  const fl = card.querySelector('[data-factors]');
  fl.innerHTML = factors
    .map(
      (f) => `
    <div class="factor">
      <span class="factor-name">${esc(f.name)}</span>
      <div class="factor-bar"><div class="factor-fill lv-${riskLevel(f.score)}" style="width:${f.score * 20}%"></div></div>
      <span class="factor-score">${f.score}/5</span>
    </div>`
    )
    .join('');

  const stars = card.querySelector('[data-stars]');
  stars.innerHTML = Array.from({ length: 5 })
    .map((_, i) => {
      const filled = h.risk >= i + 1;
      const partial = !filled && h.risk > i;
      return `<span class="star ${filled ? 'on' : partial ? 'on half' : ''}">★</span>`;
    })
    .join('');
  card.querySelector('[data-risknum]').textContent = Number(h.risk).toFixed(1);
  const btn = card.querySelector('.btn-analyze');
  btn.innerHTML = '✅ 已生成';
  btn.disabled = true;
}

function showNextStepHint() {
  const hint = $('#next-step-hint');
  if (!hint) return;
  const c = currentClientObj();
  hint.classList.remove('hidden');
  hint.innerHTML = `🎉 ${esc(c.name)} 全部持仓分析完成 —— <button class="link-btn" onclick="switchTab('send')">前往「一键发送」生成服务文案 →</button>`;
}

/* --- 4.1 客户 CRUD ------------------------------------------ */

let editingClientId = null;

function openClientModal(id) {
  editingClientId = id;
  const modal = $('#client-modal');
  const c = id ? STATE.clients.find((x) => x.id === id) : null;

  $('#client-modal-title').textContent = c ? '编辑客户档案' : '新增客户';
  $('#cf-name').value = c ? c.name : '';
  $('#cf-risk').value = c ? (c.riskProfile.match(/C\d/)?.[0] || 'C3') : 'C3';
  $('#cf-aum').value = c ? c.aum : '';
  $('#cf-turnover').value = c ? c.turnover || '' : '';
  $('#cf-style').value = c ? c.style || '' : '';
  $('#cf-bought').value = c ? c.boughtProduct || '无' : '无';
  $('#cf-summary').value = c ? c.summary : '';

  modal.classList.remove('hidden');
  setTimeout(() => $('#cf-name').focus(), 60);
}

function closeClientModal() {
  $('#client-modal')?.classList.add('hidden');
  editingClientId = null;
}

const RISK_TEXT = { C1: '保守型', C2: '稳健型', C3: '平衡型', C4: '成长型', C5: '进取型' };

function saveClient() {
  const name = $('#cf-name').value.trim();
  if (!name) {
    toast('请填写客户姓名', 'warn');
    return;
  }
  const riskKey = $('#cf-risk').value;
  const payload = {
    name,
    tag: RISK_TEXT[riskKey],
    riskProfile: `${riskKey} ${RISK_TEXT[riskKey]}`,
    aum: $('#cf-aum').value.trim() || '—',
    turnover: $('#cf-turnover').value.trim() || '中',
    style: $('#cf-style').value.trim() || '—',
    boughtProduct: $('#cf-bought').value,
    summary: $('#cf-summary').value.trim() || '暂无客户画像描述。',
  };

  if (editingClientId) {
    const c = STATE.clients.find((x) => x.id === editingClientId);
    Object.assign(c, payload);
    toast('客户档案已更新');
  } else {
    const id = 'c' + Date.now();
    STATE.clients.push({
      id,
      ...payload,
      avatar: name.slice(0, 1),
      color: AVATAR_COLORS[STATE.clients.length % AVATAR_COLORS.length],
      holdings: [],
    });
    STATE.currentClient = id;
    toast('客户已新增，请继续录入持仓');
  }

  saveClients();
  renderClientSwitch();
  renderClient(STATE.currentClient);
  initSendTab();
  closeClientModal();
}

function deleteClient(id) {
  const c = STATE.clients.find((x) => x.id === id);
  if (!c) return;
  if (STATE.clients.length <= 1) {
    toast('至少保留一位客户', 'warn');
    return;
  }
  if (!confirm(`确认删除客户「${c.name}」及其全部持仓数据？此操作不可撤销。`)) return;

  STATE.clients = STATE.clients.filter((x) => x.id !== id);
  delete STATE.analyzed[id];
  STATE.currentClient = STATE.clients[0].id;
  saveClients();
  renderClientSwitch();
  renderClient(STATE.currentClient);
  initSendTab();
  toast(`已删除客户「${c.name}」`);
}

/* --- 4.2 持仓 CRUD ------------------------------------------ */

let editingHoldingCode = null;

function openHoldingModal(code) {
  const c = currentClientObj();
  if (!c) return;
  editingHoldingCode = code;
  const h = code ? c.holdings.find((x) => x.code === code) : null;

  $('#holding-modal-title').textContent = h ? '编辑持仓' : '添加持仓';
  $('#holding-modal-sub').textContent = h
    ? `正在编辑「${h.name}」`
    : '填写标的信息。代码填 6 位股票/ETF 代码，或理财产品代码。';

  $('#hf-code').value = h ? h.code : '';
  $('#hf-name').value = h ? h.name : '';
  $('#hf-type').value = h ? (h.type || '股票') : '股票';
  $('#hf-industry').value = h ? h.industry : '';
  $('#hf-weight').value = h ? h.weight : '';
  $('#hf-pnl').value = h ? holdingPnl(h).toFixed(2) : '';
  $('#hf-risk').value = h ? h.risk : '';
  $('#hf-chain').value = h ? h.chain || '' : '';
  $('#hf-fundamental').value = h ? h.fundamental || '' : '';

  $('#holding-modal').classList.remove('hidden');
  setTimeout(() => $('#hf-code').focus(), 60);
}

function closeHoldingModal() {
  $('#holding-modal')?.classList.add('hidden');
  editingHoldingCode = null;
}

function saveHolding() {
  const c = currentClientObj();
  if (!c) return;

  const code = $('#hf-code').value.trim();
  const name = $('#hf-name').value.trim();
  if (!code || !name) {
    toast('代码与名称为必填项', 'warn');
    return;
  }

  const dup = c.holdings.find((x) => x.code === code && x.code !== editingHoldingCode);
  if (dup) {
    toast(`代码 ${code} 已存在`, 'warn');
    return;
  }

  const weight = parseFloat($('#hf-weight').value);
  const pnl = parseFloat($('#hf-pnl').value);
  const risk = parseFloat($('#hf-risk').value);

  const payload = {
    code,
    name,
    type: $('#hf-type').value,
    industry: $('#hf-industry').value.trim() || '—',
    weight: isNaN(weight) ? 0 : weight,
    pnl: isNaN(pnl) ? 0 : pnl,
    risk: isNaN(risk) ? 3 : Math.min(5, Math.max(1, risk)),
    chain: $('#hf-chain').value.trim() || '暂无产业链数据。',
    fundamental: $('#hf-fundamental').value.trim() || '暂无基本面数据。',
  };

  if (editingHoldingCode) {
    const h = c.holdings.find((x) => x.code === editingHoldingCode);
    Object.assign(h, payload);
    toast('持仓已更新');
  } else {
    c.holdings.push(payload);
    toast(`已添加「${name}」`);
  }

  saveClients();
  renderClient(c.id);
  closeHoldingModal();
}

function deleteHolding(code) {
  const c = currentClientObj();
  const h = c.holdings.find((x) => x.code === code);
  if (!h) return;
  if (!confirm(`确认从「${c.name}」的持仓中删除「${h.name}」？`)) return;

  c.holdings = c.holdings.filter((x) => x.code !== code);
  if (STATE.analyzed[c.id]) STATE.analyzed[c.id].delete(code);
  saveClients();
  renderClient(c.id);
  toast(`已删除「${h.name}」`);
}

/* --- 4.3 理财产品选择 --------------------------------------- */

const PRODUCT_CATS = ['全部', '公募', '资管', '私募'];
let pmFilter = '全部';
let pmMode = 'holding'; // holding | send

function openProductModal(mode) {
  pmMode = mode;
  pmFilter = '全部';
  const c = currentClientObj();
  $('#product-modal-sub').textContent =
    mode === 'send'
      ? `从国盛证券产品池中选择要随服务文案推送的产品（客户：${c?.name || '—'}）`
      : `从国盛证券产品池中选择要加入「${c?.name || '—'}」持仓的产品`;
  $('#product-modal').classList.remove('hidden');
  renderProductPicker();
}

function closeProductModal() {
  $('#product-modal')?.classList.add('hidden');
}

function renderProductPicker() {
  const c = currentClientObj();
  const clientLv = c ? DATA.RISK_LEVEL_MAP[c.riskProfile.match(/C\d/)?.[0]] || 3 : 3;

  $('#pm-filter').innerHTML = PRODUCT_CATS.map(
    (t) => `<button class="pf-tab ${t === pmFilter ? 'active' : ''}" data-cat="${t}">${t}</button>`
  ).join('');
  $$('.pf-tab', $('#pm-filter')).forEach((b) =>
    b.addEventListener('click', () => {
      pmFilter = b.dataset.cat;
      renderProductPicker();
    })
  );

  const list = DATA.PRODUCTS.filter((p) => pmFilter === '全部' || p.cat === pmFilter);

  $('#pm-list').innerHTML = list
    .map((p) => {
      const ok = p.riskLevel <= clientLv;
      const picked = STATE.sendProducts.includes(p.id);
      return `
      <div class="pm-item ${ok ? '' : 'blocked'}">
        <div class="pm-main">
          <div class="pm-title">
            <span class="pm-name">${esc(p.name)}</span>
            <span class="pm-code">${esc(p.code)}</span>
          </div>
          <div class="pm-meta">
            <span class="pm-cat c-${p.cat}">${p.cat}</span>
            <span class="pm-sub">${esc(p.sub)}</span>
            <span class="pm-risk r-${p.riskLevel}">${riskLabelLv(p.riskLevel)}</span>
          </div>
          <div class="pm-highlight">${esc(p.highlight)}</div>
        </div>
        <div class="pm-side">
          <button class="btn btn-sm ${ok ? 'btn-primary' : 'btn-disabled'} pm-add" data-id="${p.id}" ${ok ? '' : 'disabled'}>
            ${ok ? (pmMode === 'send' ? (picked ? '✓ 已选' : '＋ 选择') : '＋ 加入持仓') : '适当性不符'}
          </button>
        </div>
      </div>`;
    })
    .join('');

  $$('.pm-add', $('#pm-list')).forEach((btn) =>
    btn.addEventListener('click', () => {
      const p = DATA.PRODUCTS.find((x) => x.id === btn.dataset.id);
      if (!p) return;
      if (pmMode === 'send') {
        const i = STATE.sendProducts.indexOf(p.id);
        if (i >= 0) STATE.sendProducts.splice(i, 1);
        else STATE.sendProducts.push(p.id);
        renderProductPicker();
        renderSendProducts();
        renderProductPanel();
      } else {
        addProductToHoldings(p);
      }
    })
  );
}

function addProductToHoldings(p) {
  const c = currentClientObj();
  if (!c) return;
  if (c.holdings.some((h) => h.code === p.code.split('/')[0])) {
    toast(`「${p.name}」已在持仓中`, 'warn');
    return;
  }

  // 产品默认风险分：由风险等级映射到 1-5 分
  const riskScore = [0, 1.4, 2.0, 2.8, 3.6, 4.3][p.riskLevel] || 3;

  c.holdings.push({
    code: p.code.split('/')[0],
    name: p.name,
    type: p.cat === '公募' ? '公募基金' : p.cat === '资管' ? '资管产品' : '私募基金',
    industry: p.sub,
    weight: 0,
    pnl: 0,
    risk: riskScore,
    chain: `${p.cat}产品 → ${p.sub} → ${p.matchTag}。${p.tradeDay}可下单，${p.minAmount}。`,
    fundamental: p.highlight,
    factors: defaultFactors(riskScore),
  });

  saveClients();
  renderClient(c.id);
  closeProductModal();
  toast(`已添加「${p.name}」，请编辑仓位占比`);
}

/* ============================================================
 * 5. 引擎三：一键发送 + 产品匹配 + 合规
 * ============================================================ */

function initSendTab() {
  const cs = $('#send-client');
  cs.innerHTML =
    STATE.clients
      .map(
        (c) =>
          `<button class="chip ${c.id === STATE.currentClient ? 'active' : ''}" data-client="${c.id}">${esc(c.avatar)} ${esc(c.name)}</button>`
      )
      .join('') || '<span class="chip-empty">暂无客户</span>';

  $$('.chip', cs).forEach((b) =>
    b.addEventListener('click', () => {
      $$('.chip', cs).forEach((x) => x.classList.toggle('active', x === b));
      STATE.currentClient = b.dataset.client;
      resetSendScript(); // 内部已清空 sendProducts，避免残留上一客户的产品
    })
  );

  const ch = $('#channel-list');
  ch.innerHTML = DATA.CHANNELS.map(
    (c, i) => `
    <button class="channel ${i === 0 ? 'active' : ''}" data-channel="${c.id}">
      <span class="ch-icon">${c.icon}</span>
      <span class="ch-name">${c.name}</span>
      <span class="ch-desc">${c.desc}</span>
    </button>`
  ).join('');
  $$('.channel', ch).forEach((b) =>
    b.addEventListener('click', () => {
      $$('.channel', ch).forEach((x) => x.classList.toggle('active', x === b));
    })
  );

  $('#btn-gen-copy')?.addEventListener('click', genCopy);
  $('#btn-add-product-send')?.addEventListener('click', () => openProductModal('send'));
  $('#btn-compliance')?.addEventListener('click', runCompliance);
  $('#btn-send')?.addEventListener('click', doSend);
  $('#btn-egg')?.addEventListener('click', openEggModal);
  $('#btn-egg-run')?.addEventListener('click', runEggCheck);
  $('#egg-close')?.addEventListener('click', () => $('#egg-modal')?.classList.add('hidden'));
  $('#btn-reset-send')?.addEventListener('click', resetSendScript);

  renderProductPanel();
  renderSendProducts();
}

function sendClientId() {
  const active = $('.chip.active', $('#send-client'));
  return active?.dataset.client || STATE.currentClient || STATE.clients[0]?.id;
}

function sendClientObj() {
  return STATE.clients.find((x) => x.id === sendClientId());
}

/* --- 5.1 文案生成 ------------------------------------------- */

/** 依据客户真实持仓动态拼装服务文案（三方融合：简报 + 持仓 + 产品） */
function buildCopy(c) {
  const picked = DATA.PRODUCTS.filter((p) => STATE.sendProducts.includes(p.id));
  const tpl = DATA.COPY_TEMPLATES[c.id];
  if (tpl) return injectProducts(tpl, picked, c); // 六位初始客户使用精写版本

  // 自定义客户：用模板化生成
  const total = calcTotalWeight(c);
  const risk = calcPortfolioRisk(c);
  const pnl = calcPortfolioPnl(c);
  const top = [...c.holdings].sort((a, b) => b.weight - a.weight).slice(0, 3);
  const funds = c.holdings.filter((h) => ['公募基金', '资管产品', '私募基金', 'ETF'].includes(h.type));

  const topDesc = top.length
    ? top.map((h) => `${h.name}（${h.weight}%，${holdingPnl(h) >= 0 ? '+' : ''}${holdingPnl(h).toFixed(2)}%）`).join('、')
    : '（暂无持仓）';

  const fundDesc = funds.length
    ? `其中${funds.map((f) => `「${f.name}」`).join('、')}属于基金及理财产品，起到分散风险与丰富收益来源的作用。`
    : '';

  const base = `${c.name}您好，以下是结合今日盘前简报为您生成的持仓复盘与配置建议。

【一、市场面 · 盘前简报要点】
${DATA.BRIEF_MARKET_SUMMARY}

【二、持仓面 · 组合诊断】
您的组合目前共持有 ${c.holdings.length} 只标的，合计仓位 ${total}%，加权风险评分 ${risk.toFixed(1)} 分（${riskText(risk)}），组合浮动盈亏 ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%，与您 ${c.riskProfile} 的风险承受等级${risk > DATA.RISK_LEVEL_MAP[c.riskProfile.match(/C\d/)?.[0]] ? '存在一定偏离，建议关注' : '匹配良好'}。从持仓结构看，权重最高的三只分别为 ${topDesc}。${fundDesc}

【三、配置建议】
建议维持当前配置思路，不追高、不频繁调仓，把重心放在长期复利积累上。若您希望调整某一类资产的内部结构，我们可以安排一次线上沟通做详细测算。

以上内容由 AI 辅助生成，经投顾复核后发送，仅供您参考，不构成任何投资建议。市场有风险，投资需谨慎。`;

  return injectProducts(base, picked, c);
}

/** 把已选产品清单插入文案正文；无产品时原样返回 */
function injectProducts(text, picked, c) {
  if (!picked.length) return text;
  return text.replace(/(\n*)(以上内容由 AI 辅助生成)/, (m, br, tail) => {
    return `${br}${buildProductSection(picked, c)}${br}${tail}`;
  });
}

/** 产品段落：与合规校验口径一致，均满足「风险等级 ≤ 客户承受等级」 */
function buildProductSection(picked, c) {
  const lines = picked
    .map(
      (p) =>
        `· ${p.name}（${p.code}）｜${p.sub}｜风险等级 ${riskLabelLv(p.riskLevel)}｜${p.minAmount}\n  特点：${p.highlight}`
    )
    .join('\n');

  return `【四、产品匹配 · 结合您的持仓结构筛选】
以下 ${picked.length} 只产品是从国盛证券产品池中，依据您的风险等级（${c ? c.riskProfile : '—'}）与当前持仓结构自动筛选的，均通过适当性校验：

${lines}

以上产品均经过适当性校验（风险等级不高于您的风险承受等级），具体申购安排可另行沟通确认。
`;
}

/** 产品标题行（用于文案区顶部标签） */
function productsBrief(picked) {
  return picked.map((p) => p.name).join('、');
}

async function genCopy() {
  const btn = $('#btn-gen-copy');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 生成中...';

  const c = sendClientObj();
  if (!c) {
    toast('请先选择客户', 'warn');
    btn.disabled = false;
    btn.innerHTML = '⚡ 生成服务文案';
    return;
  }

  // 先定产品，再生成文案：确保文案正文里带上本次要推送的产品
  if (!STATE.sendProducts.length) autoMatchProducts(c, true);

  const copy = buildCopy(c);

  $('#copy-placeholder')?.classList.add('hidden');
  $('#copy-card')?.classList.remove('hidden');

  const lenEl = $('#copy-len');
  let len = 0;
  const lenTimer = setInterval(() => {
    len += Math.ceil(copy.length / 40);
    if (len >= copy.length) {
      len = copy.length;
      clearInterval(lenTimer);
    }
    lenEl.textContent = len;
  }, 30);

  await typewriter($('#copy-output'), copy, 7);

  lenEl.textContent = copy.length;
  $('#copy-meta')?.classList.remove('hidden');
  $('#step-products')?.classList.remove('hidden');
  btn.innerHTML = '✅ 文案已生成';

  renderCopyProducts();
  renderProductPanel();
  renderSendProducts();
}

/** 文案区顶部：三方融合来源 + 本次文案已内嵌的产品清单 */
function renderCopyProducts() {
  const el = $('#copy-products');
  const meta = $('#copy-prod-count');
  if (!el) return;
  const picked = DATA.PRODUCTS.filter((p) => STATE.sendProducts.includes(p.id));

  if (meta) meta.textContent = `🎁 已附带 ${picked.length} 只产品`;

  el.classList.remove('hidden');
  el.innerHTML = `${fusionPanelHTML(picked.length)}${picked.length
    ? `<div class="cp-row"><span class="cp-label">🎁 本次文案已内嵌 ${picked.length} 只产品</span>
    <span class="cp-chips">${picked
      .map((p) => `<span class="cp-chip" title="${esc(p.sub)} · ${esc(p.minAmount)}">${esc(p.name)}</span>`)
      .join('')}</span></div>`
    : ''}`;
}

/** 三方融合来源面板：说明文案由哪三路数据合成，便于投顾核验 */
function fusionPanelHTML(prodCount) {
  const c = sendClientObj();
  if (!c) return '';
  const risk = calcPortfolioRisk(c);
  const pnl = calcPortfolioPnl(c);
  const cn = DATA.NEWS.filter((n) => n.region === 'cn').length;
  const us = DATA.NEWS.filter((n) => n.region === 'us').length;

  return `
  <div class="fusion-panel">
    <div class="fusion-title">🧬 三方融合生成链路 <span>FUSION OF BRIEF · HOLDINGS · PRODUCTS</span></div>
    <div class="fusion-grid">
      <div class="fusion-src">
        <span class="fs-icon">📡</span>
        <span class="fs-name">盘前简报</span>
        <span class="fs-val">${cn + us} 条资讯 · 国内 ${cn} / 海外 ${us}</span>
      </div>
      <div class="fusion-plus">＋</div>
      <div class="fusion-src">
        <span class="fs-icon">💼</span>
        <span class="fs-name">客户持仓</span>
        <span class="fs-val">${c.holdings.length} 只 · 风险 ${risk.toFixed(1)} · 盈亏 ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%</span>
      </div>
      <div class="fusion-plus">＋</div>
      <div class="fusion-src">
        <span class="fs-icon">🏦</span>
        <span class="fs-name">公司产品</span>
        <span class="fs-val">${prodCount} 只 · 适当性已校验</span>
      </div>
      <div class="fusion-plus">→</div>
      <div class="fusion-src out">
        <span class="fs-icon">📤</span>
        <span class="fs-name">推送文案</span>
        <span class="fs-val">四段式 · 含免责声明</span>
      </div>
    </div>
  </div>`;
}

/* --- 5.2 产品匹配推荐 --------------------------------------- */

/** 按适当性规则自动挑选 3 只推荐产品 */
function autoMatchProducts(c, silent) {
  if (STATE.sendProducts.length) return; // 用户已手动选过则不覆盖
  const level = DATA.RISK_LEVEL_MAP[c.riskProfile.match(/C\d/)?.[0]] || 3;

  const eligible = DATA.PRODUCTS.filter((p) => p.riskLevel <= level);
  // 分散在不同类别：每个类别取销售系数最高的一只
  const byCat = {};
  eligible.forEach((p) => {
    // 公募内部再按 sub 细分，避免全是 ETF
    const key = p.cat === '公募' ? '公募·' + p.sub : p.cat;
    if (!byCat[key] || byCat[key].salesCoef < p.salesCoef) byCat[key] = p;
  });

  STATE.sendProducts = Object.values(byCat)
    .sort((a, b) => b.salesCoef - a.salesCoef)
    .slice(0, 3)
    .map((p) => p.id);

  if (silent) return; // 由调用方自行渲染，避免重复刷新
  renderProductPanel();
  renderSendProducts();
}

function renderProductPanel() {
  const c = sendClientObj();
  if (!c) return;
  const level = DATA.RISK_LEVEL_MAP[c.riskProfile.match(/C\d/)?.[0]] || 3;

  const badge = $('#match-badge');
  if (badge) badge.textContent = `${c.riskProfile} · 可售 R1-R${level}`;

  const eligible = DATA.PRODUCTS.filter((p) => p.riskLevel <= level);
  const blocked = DATA.PRODUCTS.length - eligible.length;

  $('#product-filter').innerHTML = `
    <span class="pf-summary">产品池共 <b>${DATA.PRODUCTS.length}</b> 只 · 适当性通过 <b style="color:var(--green)">${eligible.length}</b> 只 · 自动隐藏 <b style="color:var(--red)">${blocked}</b> 只</span>
    <button class="btn btn-sm btn-ghost" id="btn-add-product-send">🛒 从产品池选择</button>`;

  $('#btn-add-product-send')?.addEventListener('click', () => openProductModal('send'));

  const picked = DATA.PRODUCTS.filter((p) => STATE.sendProducts.includes(p.id));

  $('#product-list').innerHTML =
    picked
      .map(
        (p) => `
    <div class="prod-card">
      <div class="prod-head">
        <span class="pm-cat c-${p.cat}">${p.cat}</span>
        <span class="prod-name">${esc(p.name)}</span>
        <span class="pm-risk r-${p.riskLevel}">${riskLabelLv(p.riskLevel)}</span>
      </div>
      <div class="prod-code">${esc(p.code)} · ${esc(p.sub)} · ${esc(p.minAmount)}</div>
      <div class="prod-highlight">${esc(p.highlight)}</div>
      <div class="prod-foot">
        <span class="prod-day">📅 ${esc(p.tradeDay)}</span>
        <button class="icon-btn sm danger prod-remove" data-id="${p.id}" title="移除">🗑️</button>
      </div>
    </div>`
      )
      .join('') ||
    `<div class="product-empty">尚未选择产品，可点击右上角「从产品池选择」，或重新生成文案由系统自动匹配。</div>`;

  // 产品确认完成后解锁合规校验步骤（与文案生成后的状态一致）
  if (picked.length && $('#step-products') && !$('#step-products').classList.contains('hidden')) {
    $('#step-compliance')?.classList.remove('hidden');
  }

  $$('.prod-remove', $('#product-list')).forEach((b) =>
    b.addEventListener('click', () => {
      STATE.sendProducts = STATE.sendProducts.filter((x) => x !== b.dataset.id);
      renderProductPanel();
      renderSendProducts();
    })
  );
}

function renderSendProducts() {
  const el = $('#send-products');
  if (!el) return;
  const picked = DATA.PRODUCTS.filter((p) => STATE.sendProducts.includes(p.id));
  el.textContent = picked.length ? `${picked.length} 只：${picked.map((p) => p.name).join('、')}` : '未选择';
  syncPickedToCopy(picked, el);
}

/**
 * 产品清单变化后，文案正文需要跟着更新，
 * 否则会出现「文案里写着 A、实际推送 B」的一致性问题。
 */
function syncPickedToCopy(picked, sendEl) {
  const out = $('#copy-output');
  if (!out || !out.textContent.trim()) return; // 尚未生成文案
  const c = sendClientObj();
  if (!c) return;

  const next = buildCopy(c);
  if (out.textContent.trim() === next.trim()) return;

  out.textContent = next;
  const lenEl = $('#copy-len');
  if (lenEl) lenEl.textContent = next.length;
  renderCopyProducts();
  if (sendEl) sendEl.dataset.synced = '1';
}

/* --- 5.3 合规校验 ------------------------------------------- */

async function runCompliance() {
  const btn = $('#btn-compliance');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 校验中...';

  const c = sendClientObj();
  const level = DATA.RISK_LEVEL_MAP[c?.riskProfile.match(/C\d/)?.[0]] || 3;
  const picked = DATA.PRODUCTS.filter((p) => STATE.sendProducts.includes(p.id));
  const over = picked.filter((p) => p.riskLevel > level);

  const list = $('#compliance-list');
  list.innerHTML = '';
  $('#step-compliance-result')?.classList.remove('hidden');

  for (const rule of DATA.COMPLIANCE_RULES) {
    await sleep(460);
    const row = document.createElement('div');
    row.className = 'compliance-row log-in';

    let ok = true;
    let detail = rule.detail;

    // 产品适当性这条按实际选择动态判定
    if (rule.id === 'product') {
      if (!picked.length) {
        ok = false;
        detail = '未选择任何产品，本项无对象可校验';
      } else if (over.length) {
        ok = false;
        detail = `检出 ${over.length} 只超风险等级产品：${over.map((p) => p.name).join('、')}`;
      } else {
        detail = `已选 ${picked.length} 只产品，风险等级均 ≤ 客户 ${c.riskProfile}，适当性通过`;
      }
    }

    row.innerHTML = `
      <span class="cmp-icon">⏳</span>
      <span class="cmp-body">
        <span class="cmp-label">${rule.label}</span>
        <span class="cmp-detail">${esc(detail)}</span>
      </span>`;
    list.appendChild(row);
    await sleep(240);
    row.querySelector('.cmp-icon').textContent = ok ? '✅' : '⚠️';
    row.classList.add(ok ? 'ok' : 'warn');
  }

  await sleep(300);
  const pass = document.createElement('div');
  pass.className = 'compliance-pass';
  pass.innerHTML = `<span>🛡️ 合规校验通过</span><span class="pass-sub">${DATA.COMPLIANCE_RULES.length} 项检查全部通过，可进入发送环节</span>`;
  list.appendChild(pass);

  btn.innerHTML = '✅ 合规校验通过';
  $('#step-send')?.classList.remove('hidden');
  updateSendPreview();
}

function updateSendPreview() {
  const c = sendClientObj();
  if (!c) return;
  const chName = $('.channel.active .ch-name')?.textContent || '企业微信';
  $('#send-target').textContent = `${c.name} · ${c.riskProfile}`;
  $('#send-channel').textContent = chName;
  renderSendProducts();
}

/* --- 5.4 发送 ----------------------------------------------- */

async function doSend() {
  const btn = $('#btn-send');
  btn.disabled = true;
  updateSendPreview();

  const c = sendClientObj();
  if (!c) return;

  const bar = $('#send-progress-fill');
  const statusEl = $('#send-status');
  $('#send-progress-wrap')?.classList.remove('hidden');

  const picked = DATA.PRODUCTS.filter((p) => STATE.sendProducts.includes(p.id));
  const steps = [
    { p: 22, s: '正在加密客户信息…' },
    { p: 48, s: `正在装配 ${picked.length} 只产品资料卡片…` },
    { p: 72, s: `正在通过 ${$('.channel.active .ch-name').textContent} 通道下发…` },
    { p: 90, s: '等待客户端回执…' },
    { p: 100, s: '✅ 已送达' },
  ];
  for (const st of steps) {
    await sleep(520);
    bar.style.width = st.p + '%';
    statusEl.textContent = st.s;
  }

  $('#phone-wrap')?.classList.remove('hidden');
  const bubble = $('#phone-bubble');
  bubble.classList.remove('fly-in');
  void bubble.offsetWidth;
  bubble.classList.add('fly-in');
  $('#phone-msg-client').textContent = c.name;
  $('#phone-msg-text').textContent = picked.length
    ? `您的持仓分析报告、服务建议及 ${picked.length} 只匹配产品资料已送达，请查收。如有疑问可随时联系您的专属投顾。`
    : '您的持仓分析报告与服务建议已送达，请查收。如有疑问可随时联系您的专属投顾。';

  await sleep(900);
  $('#phone-badge')?.classList.remove('hidden');
  btn.innerHTML = '✅ 已送达';
  $('#send-receipt')?.classList.remove('hidden');
  $('#receipt-target').textContent = `${c.name}（${c.riskProfile}）`;
  $('#receipt-channel').textContent = $('.channel.active .ch-name').textContent;
  $('#receipt-time').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const rp = $('#receipt-products');
  if (rp) rp.textContent = picked.length ? `${picked.length} 只（${picked.map((p) => p.name).join('、')}）` : '无';
}

function resetSendScript() {
  clearAllTimers();
  // 文案、产品匹配、合规、发送四步必须原子重置：只清 DOM 不清状态会导致
  // 「文案已清空、产品卡片仍挂着上一轮推荐」的合规级不一致。
  STATE.sendProducts = [];
  $('#copy-output').textContent = '';
  $('#copy-placeholder')?.classList.remove('hidden');
  $('#copy-card')?.classList.add('hidden');
  $('#copy-meta')?.classList.add('hidden');
  $('#copy-products')?.classList.add('hidden');
  if ($('#copy-products')) $('#copy-products').innerHTML = '';
  const fp = $('#fusion-panel');
  if (fp) {
    fp.innerHTML = '';
    fp.classList.add('hidden');
  }
  if ($('#copy-prod-count')) $('#copy-prod-count').textContent = '🎁 已附带 0 只产品';
  $('#step-products')?.classList.add('hidden');
  $('#step-compliance')?.classList.add('hidden');
  $('#step-compliance-result')?.classList.add('hidden');
  $('#step-send')?.classList.add('hidden');
  $('#compliance-list').innerHTML = '';
  $('#send-progress-wrap')?.classList.add('hidden');
  if ($('#send-progress-fill')) $('#send-progress-fill').style.width = '0%';
  $('#phone-wrap')?.classList.add('hidden');
  $('#phone-badge')?.classList.add('hidden');
  $('#send-receipt')?.classList.add('hidden');
  const b1 = $('#btn-gen-copy');
  if (b1) {
    b1.disabled = false;
    b1.innerHTML = '⚡ 生成服务文案';
  }
  const b2 = $('#btn-compliance');
  if (b2) {
    b2.disabled = false;
    b2.innerHTML = '🛡️ 合规校验';
  }
  const b3 = $('#btn-send');
  if (b3) {
    b3.disabled = false;
    b3.innerHTML = '📤 一键发送';
  }
  renderProductPanel();
  renderSendProducts();
}

/* --- 5.5 彩蛋：敏感词拦截 ----------------------------------- */

function openEggModal() {
  $('#egg-modal')?.classList.remove('hidden');
  $('#egg-input').value = '这只票稳赚，闭眼买';
  $('#egg-result').innerHTML = '';
  $('#egg-result').classList.add('hidden');
}

async function runEggCheck() {
  const text = $('#egg-input').value || '';
  const res = $('#egg-result');
  res.classList.remove('hidden');
  res.innerHTML = '<div class="egg-scanning">🔍 正在比对合规中台词库（3,847 条）…</div>';

  await sleep(900);

  const hits = DATA.SENSITIVE_WORDS.filter((w) => text.includes(w.word));

  if (hits.length === 0) {
    res.innerHTML = `
      <div class="egg-pass">
        <div class="egg-pass-title">✅ 未检出违规内容</div>
        <div class="egg-pass-sub">该文本可通过合规校验（Demo 提示：试试输入「稳赚」「保本」「必涨」）</div>
      </div>`;
    return;
  }

  res.innerHTML = `
    <div class="egg-blocked">
      <div class="egg-blocked-title">❌ 合规拦截：检测到 ${hits.length} 处违规表述</div>
      ${hits
        .map(
          (h) => `
        <div class="egg-hit">
          <span class="hit-word">${esc(h.word)}</span>
          <span class="hit-tag lv-${h.level}">${h.level === 'high' ? '高危' : '中危'}</span>
          <div class="hit-reason">${esc(h.reason)}</div>
        </div>`
        )
        .join('')}
      <div class="egg-action">
        <div class="egg-action-title">🛡️ 已自动阻断发送</div>
        <div class="egg-action-sub">本条文案未进入下发通道，已回退至投顾人工复核队列。这是真实生产环境的强合规闸门。</div>
      </div>
    </div>`;
}

/* ============================================================
 * 6. 启动
 * ============================================================ */

function bindModalEvents() {
  // 客户弹窗
  $('#client-modal-close')?.addEventListener('click', closeClientModal);
  $('#client-modal-cancel')?.addEventListener('click', closeClientModal);
  $('#client-modal-save')?.addEventListener('click', saveClient);

  // 持仓弹窗
  $('#holding-modal-close')?.addEventListener('click', closeHoldingModal);
  $('#holding-modal-cancel')?.addEventListener('click', closeHoldingModal);
  $('#holding-modal-save')?.addEventListener('click', saveHolding);

  // 产品弹窗
  $('#product-modal-close')?.addEventListener('click', closeProductModal);
  $('#product-modal-cancel')?.addEventListener('click', closeProductModal);

  // 点击遮罩关闭
  $$('.modal-mask').forEach((mask) =>
    mask.addEventListener('click', (e) => {
      if (e.target === mask) mask.classList.add('hidden');
    })
  );

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal-mask').forEach((m) => m.classList.add('hidden'));
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  STATE.clients = loadClients();
  STATE.currentClient = STATE.clients[0]?.id || null;
  STATE.clients.forEach((c) => (STATE.analyzed[c.id] = new Set()));

  initTabs();
  initMarketTab();
  initClientTab();
  initSendTab();
  bindModalEvents();

  const params = new URLSearchParams(location.search);
  const t = params.get('tab');
  if (t && ['market', 'client', 'send'].includes(t)) switchTab(t);

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === '1') switchTab('market');
    if (e.key === '2') switchTab('client');
    if (e.key === '3') switchTab('send');
  });
});
