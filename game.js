// Search! Mark! — 웹 버전
// 5×5 칸에 10면체 주사위 숫자를 적고 깃발(지뢰 표시)을 꽂는 1인 플레이.
(() => {
  const N = 5;
  const RE_MAX = 3;
  const PM_MAX = 6;
  const FLAG_ITEMS = 3;

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const itemsEl = $('items');
  const dieBtn = $('dieBtn');
  const dieEl = $('die');
  const hintEl = $('hint');
  const valueLineEl = $('valueLine');
  const modal = $('modal');
  const modalCard = $('modalCard');

  // ---------- 상태 ----------
  // phase: roll(굴릴 차례) | choose0(0 나옴, 숫자 고르기) | place(칸 클릭) | flagging(깃발 아이템으로 꽂는 중) | done
  let S;
  let history = [];      // 되돌리기용 스냅숏. 주사위를 굴리면 비운다(굴림은 되돌릴 수 없음).
  let rolling = false;
  let lastPlaced = -1;
  let freshItem = null;  // 방금 얻은 아이템 칸 (팝 애니메이션)
  let newMarks = new Set();

  function newGame() {
    S = {
      cells: Array(N * N).fill(null),   // null | {t:'num', v} | {t:'flag'}
      status: Array(N * N).fill(null),  // 숫자 칸: null | 'ok' | 'bad'
      flagItems: Array(FLAG_ITEMS).fill('have'),
      re: Array(RE_MAX).fill('none'),
      pm: Array(PM_MAX).fill('none'),
      phase: 'roll',
      die: null,     // 굴려서 나온 값
      value: null,   // ±1·0 선택까지 반영된 지금 값
      flagLeft: 0,
      pending: 0,    // 아직 고르지 않은 아이템 보상 수
      pmDir: 0,      // 이번 값에 쓴 ±1 방향. 한 번 정하면 같은 방향만 (+1만 / −1만)
      turn: 0,
    };
    history = [];
    lastPlaced = -1;
    closeModal();
    render();
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const push = () => history.push(clone(S));

  function undo() {
    if (rolling || !history.length) return;
    S = history.pop();
    lastPlaced = -1;
    closeModal();
    render();
    afterRenderModal();
  }

  // ---------- 판 계산 ----------
  function neighbors(i) {
    const r = Math.floor(i / N), c = i % N, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(rr * N + cc);
    }
    return out;
  }
  const emptyCount = () => S.cells.filter((x) => !x).length;
  const countHave = (arr) => arr.filter((x) => x === 'have').length;
  const hasNone = (arr) => arr.includes('none');

  function useOne(arr) { const k = arr.indexOf('have'); if (k >= 0) arr[k] = 'used'; return k; }
  function gainOne(arr) { const k = arr.indexOf('none'); if (k >= 0) arr[k] = 'have'; return k; }

  // 주변 칸이 다 찬 숫자를 채점한다. 맞으면 동그라미 + 아이템 보상.
  function evaluate() {
    S.cells.forEach((cell, i) => {
      if (!cell || cell.t !== 'num' || S.status[i]) return;
      const nb = neighbors(i);
      if (nb.some((j) => !S.cells[j])) return;
      const flags = nb.filter((j) => S.cells[j].t === 'flag').length;
      S.status[i] = flags === cell.v ? 'ok' : 'bad';
      newMarks.add(i);
      if (S.status[i] === 'ok') S.pending++;
    });
    if (S.pending && !hasNone(S.re) && !hasNone(S.pm)) {
      S.pending = 0;
      toast('맞혔어요! 아이템 칸이 다 차서 더 받을 수 없어요.');
    }
  }

  function score() {
    const ok = S.cells.map((c, i) => (S.status[i] === 'ok' ? c.v : null)).filter((v) => v !== null);
    return { hits: ok.length, max: ok.length ? Math.max(...ok) : 0, total: ok.length ? ok.length + Math.max(...ok) : 0 };
  }

  // ---------- 행동 ----------
  function roll(fromReroll = false) {
    if (rolling) return;
    if (!fromReroll) {
      if (S.phase !== 'roll' || S.pending) return;
      S.turn++;
    }
    const v = Math.floor(Math.random() * 10);
    rolling = true;
    history = [];
    render();
    animateDie(v, () => {
      rolling = false;
      S.die = v;
      S.value = v;
      S.pmDir = 0;
      S.phase = v === 0 ? 'choose0' : 'place';
      render();
      if (v === 0) openZeroPicker();
    });
  }

  function reroll() {
    if (rolling || !canReroll()) return;
    useOne(S.re);
    roll(true);
  }

  function chooseZero(n) {
    push();
    S.value = n;
    S.phase = 'place';
    closeModal();
    render();
  }

  function adjust(d) {
    if (!canAdjust(d)) return;
    push();
    useOne(S.pm);
    S.value += d;
    S.pmDir = d;
    render();
  }

  function useFlagItem() {
    if (!canFlagItem()) return;
    push();
    useOne(S.flagItems);
    S.phase = 'flagging';
    S.flagLeft = Math.min(S.value, emptyCount());
    render();
  }

  function clickCell(i) {
    if (rolling || S.cells[i] || S.pending) return;
    if (S.phase === 'place') {
      push();
      S.cells[i] = S.value === 9 ? { t: 'flag' } : { t: 'num', v: S.value };
      lastPlaced = i;
      finishTurn();
    } else if (S.phase === 'flagging') {
      push();
      S.cells[i] = { t: 'flag' };
      lastPlaced = i;
      S.flagLeft--;
      if (S.flagLeft <= 0 || !emptyCount()) finishTurn();
      else { evaluate(); render(); afterRenderModal(); }
    }
  }

  function finishTurn() {
    evaluate();
    S.phase = emptyCount() ? 'roll' : 'done';
    S.flagLeft = 0;
    render();
    afterRenderModal();
  }

  function takeReward(kind) {
    const arr = kind === 're' ? S.re : S.pm;
    const k = gainOne(arr);
    if (k < 0) return;
    freshItem = `${kind}-${k}`;
    S.pending--;
    if (S.pending && !hasNone(S.re) && !hasNone(S.pm)) S.pending = 0;
    closeModal();
    render();
    afterRenderModal();
  }

  // ---------- 가능 여부 ----------
  const inChoice = () => (S.phase === 'place' || S.phase === 'choose0') && !S.pending && !rolling;
  const canReroll = () => inChoice() && countHave(S.re) > 0;
  const canAdjust = (d) => S.phase === 'place' && !S.pending && !rolling && countHave(S.pm) > 0
    && (!S.pmDir || S.pmDir === d)
    && S.value >= 1 && S.value <= 8 && S.value + d >= 1 && S.value + d <= 8;
  const canFlagItem = () => S.phase === 'place' && !S.pending && !rolling && countHave(S.flagItems) > 0
    && S.value >= 1 && S.value <= 8;

  // ---------- 그리기 ----------
  // 아이템 글자는 폰트 대신 픽셀 그림으로 (작은 칸에서도 또렷하게)
  const pixGlyph = (rows, w, h) => {
    let r = '';
    rows.forEach((line, y) => [...line].forEach((ch, x) => { if (ch === '#') r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
    return `<svg viewBox="-1 -1 ${w + 2} ${h + 2}" shape-rendering="crispEdges" fill="currentColor">${r}</svg>`;
  };
  const RE_SVG = pixGlyph([
    '####......',
    '#...#.....',
    '#...#.##..',
    '####.#..#.',
    '#.#..####.',
    '#..#.#....',
    '#...#.###.'], 10, 7);
  const PM_SVG = pixGlyph([
    '..#.....#.',
    '..#....##.',
    '#####...#.',
    '..#.....#.',
    '..#.....#.',
    '........#.',
    '#####..###'], 10, 7);
  const FLAG_SVG = `<svg class="flag" viewBox="0 0 10 10" shape-rendering="crispEdges"><rect x="4" y="1" width="1" height="7" fill="#111"/><rect x="5" y="1" width="3" height="1" fill="#fe000d"/><rect x="5" y="2" width="4" height="1" fill="#fe000d"/><rect x="5" y="3" width="2" height="1" fill="#fe000d"/><rect x="3" y="8" width="4" height="1" fill="#111"/><rect x="2" y="9" width="6" height="1" fill="#111"/></svg>`;
  const CIRCLE = (draw) => `<svg class="mark${draw ? ' draw' : ''}" viewBox="0 0 100 100"><path d="M52 8 C24 6 8 28 10 52 C12 78 32 93 54 91 C78 89 93 70 91 46 C89 24 72 9 46 12"/></svg>`;
  const SLASH = (draw) => `<svg class="mark${draw ? ' draw' : ''}" viewBox="0 0 100 100"><path d="M86 10 L14 90"/></svg>`;

  function render() {
    // 판
    const placing = (S.phase === 'place' || S.phase === 'flagging') && !S.pending && !rolling;
    const ghostFlag = S.phase === 'flagging' || S.value === 9;
    boardEl.classList.toggle('locked', !placing);
    boardEl.innerHTML = '';
    S.cells.forEach((cell, i) => {
      const b = document.createElement('button');
      b.className = 'cell';
      b.dataset.i = i;
      if (!cell) {
        if (placing) {
          b.classList.add('can');
          if (ghostFlag) b.classList.add('ghost-flag');
          else b.dataset.ghost = S.value;
        }
        b.setAttribute('aria-label', `${Math.floor(i / N) + 1}행 ${i % N + 1}열 빈 칸`);
      } else {
        b.classList.add('filled');
        if (cell.t === 'flag') {
          b.innerHTML = FLAG_SVG;
          b.setAttribute('aria-label', '깃발');
        } else {
          const st = S.status[i];
          b.innerHTML = `<span class="num">${cell.v}</span>` + (st === 'ok' ? CIRCLE(newMarks.has(i)) : st === 'bad' ? SLASH(newMarks.has(i)) : '');
          b.setAttribute('aria-label', `숫자 ${cell.v}${st === 'ok' ? ' 맞음' : st === 'bad' ? ' 틀림' : ''}`);
          b.addEventListener('mouseenter', () => highlight(i, true));
          b.addEventListener('mouseleave', () => highlight(i, false));
        }
        if (i === lastPlaced) b.classList.add('placed');
      }
      b.addEventListener('click', () => clickCell(i));
      boardEl.appendChild(b);
    });
    newMarks.clear();
    lastPlaced = -1;

    // 아이템 3×4 (깃발 / Re / ±1 ±1)
    itemsEl.innerHTML = '';
    const addItem = (kind, k, state, face, onClick, ready) => {
      const b = document.createElement('button');
      b.className = `item ${state}${ready ? ' ready' : ''}`;
      if (state === 'none') b.classList.add('empty');
      if (freshItem === `${kind}-${k}`) b.classList.add('fresh');
      b.innerHTML = `<span class="face">${face}</span>`;
      const names = { flag: '깃발', re: '리롤', pm: '±1' };
      b.setAttribute('aria-label', `${names[kind]} ${state === 'have' ? '있음' : state === 'used' ? '사용함' : '없음'}`);
      if (onClick) b.addEventListener('click', onClick);
      itemsEl.appendChild(b);
    };
    S.flagItems.forEach((st, k) => addItem('flag', k, st, FLAG_SVG, st === 'have' ? useFlagItem : null, st === 'have' && canFlagItem()));
    S.re.forEach((st, k) => addItem('re', k, st, RE_SVG, st === 'have' ? reroll : null, st === 'have' && canReroll()));
    S.pm.forEach((st, k) => addItem('pm', k, st, PM_SVG, st === 'have' ? usePm : null, st === 'have' && (canAdjust(1) || canAdjust(-1))));
    freshItem = null;

    // 점수 (헤더, 실시간)
    const sc = score();
    const numEl = $('scoreNum');
    if (numEl.textContent !== String(sc.total)) {
      numEl.textContent = sc.total;
      numEl.classList.remove('bump'); void numEl.offsetWidth; numEl.classList.add('bump');
    }
    $('scoreSub').textContent = sc.hits ? `맞힌 ${sc.hits}개 + 최대 ${sc.max}` : '';

    // 주사위
    if (!rolling) drawDie(S.die ?? 0);
    dieBtn.classList.toggle('idle', S.phase === 'roll' && !S.pending && !rolling);
    dieBtn.disabled = !(S.phase === 'roll' && !S.pending) || rolling;

    // 값 줄
    let vl = '';
    if (S.die !== null && !rolling && S.phase !== 'roll' && S.phase !== 'done') {
      vl = `<span class="chip">${S.die}</span>`;
      if (S.value !== S.die) vl += `<span class="arrow">→</span><span class="chip big">${S.value}</span>`;
      if (S.phase === 'flagging') vl += `<span class="arrow">깃발 ${S.flagLeft}개 남음</span>`;
    }
    valueLineEl.innerHTML = vl;

    $('btnUndo').disabled = !history.length || rolling;

    hintEl.textContent = hintText();
  }

  function hintText() {
    if (rolling) return '데구르르…';
    if (S.pending) return '숫자를 맞혔어요! 아이템을 골라 주세요.';
    switch (S.phase) {
      case 'roll': return S.turn ? '주사위를 눌러 다음 숫자를 굴리세요.' : '빈 칸 속 숫자와 지뢰를 찾아볼까요? 주사위를 눌러 시작하세요.';
      case 'choose0': return '0이 나왔어요. 원하는 숫자를 고르세요.';
      case 'place':
        if (S.value === 9) return '9! 원하는 칸에 깃발을 하나 꽂으세요.';
        return `칸을 눌러 ${S.value}을(를) 적으세요. 아래 아이템 칸을 눌러 쓸 수도 있어요.`;
      case 'flagging': return `깃발을 꽂을 칸을 누르세요. ${S.flagLeft}개 남았어요.`;
      case 'done': return '게임 끝! 판이 다 찼어요.';
    }
    return '';
  }

  function highlight(i, on) {
    neighbors(i).forEach((j) => boardEl.children[j]?.classList.toggle('near', on));
  }

  // ---------- 모달 ----------
  // 창은 끌어서 옮길 수 있다. 옮긴 자리는 다음 창에도 이어진다(판을 보며 고르도록).
  let drag = { x: 0, y: 0 };
  function placeCard() {
    const r = modalCard.getBoundingClientRect();
    const bx = (window.innerWidth - r.width) / 2, by = (window.innerHeight - r.height) / 2;
    drag.x = Math.max(-bx, Math.min(bx, drag.x));
    drag.y = Math.max(-by, Math.min(by, drag.y));
    modalCard.style.translate = `${drag.x}px ${drag.y}px`;
  }
  modalCard.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, a, input')) return;
    const sx = e.clientX - drag.x, sy = e.clientY - drag.y;
    modalCard.setPointerCapture(e.pointerId);
    modalCard.classList.add('dragging');
    const move = (ev) => { drag.x = ev.clientX - sx; drag.y = ev.clientY - sy; placeCard(); };
    const up = () => {
      modalCard.classList.remove('dragging');
      modalCard.removeEventListener('pointermove', move);
      modalCard.removeEventListener('pointerup', up);
      modalCard.removeEventListener('pointercancel', up);
    };
    modalCard.addEventListener('pointermove', move);
    modalCard.addEventListener('pointerup', up);
    modalCard.addEventListener('pointercancel', up);
  });
  window.addEventListener('resize', () => { if (!modal.hidden) placeCard(); });

  function openModal(html) {
    modalCard.innerHTML = '<div class="grip" aria-hidden="true">⋮⋮ 끌어서 옮기기</div>' + html;
    modal.hidden = false;
    placeCard();
  }
  function closeModal() { clearTimeout(rb.timer); modal.hidden = true; modalCard.innerHTML = ''; modalCard.classList.remove('wide'); }

  // 화면을 그린 뒤 떠야 할 창(보상 고르기, 0 고르기, 결과)을 띄운다.
  function afterRenderModal() {
    if (S.pending) return openReward();
    if (S.phase === 'choose0') return openZeroPicker();
    if (S.phase === 'done') return openResult();
  }

  function openReward() {
    const reOk = hasNone(S.re), pmOk = hasNone(S.pm);
    openModal(`
      <h2>Mark!</h2>
      <p>숫자 주변 깃발 수가 딱 맞았어요. 아이템을 하나 고르세요.${S.pending > 1 ? ` (${S.pending}개 남음)` : ''}</p>
      <div class="choice-row">
        <button class="choice" data-k="re" ${reOk ? '' : 'disabled'}>Re<small>리롤 ${countHave(S.re) + S.re.filter((x) => x === 'used').length}/${RE_MAX}</small></button>
        <button class="choice" data-k="pm" ${pmOk ? '' : 'disabled'}>±1<small>더하기·빼기 ${PM_MAX - S.pm.filter((x) => x === 'none').length}/${PM_MAX}</small></button>
      </div>
      <div class="modal-foot"><button class="act ghost" data-undo>↶ 되돌리기</button></div>`);
    modalCard.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => takeReward(b.dataset.k)));
    modalCard.querySelector('[data-undo]').addEventListener('click', undo);
  }

  function openZeroPicker() {
    const reN = countHave(S.re);
    openModal(`
      <h2>0 = ?</h2>
      <p>1~8 중 원하는 숫자를 고르세요. 숫자를 고른 뒤 깃발 아이템으로 그 수만큼 깃발을 꽂을 수도 있어요.</p>
      <div class="num-grid">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<button class="choice" data-n="${n}">${n}</button>`).join('')}</div>
      <div class="modal-foot">${reN ? `<button class="act" data-re>Re 리롤 <span class="count">${reN}</span></button>` : ''}</div>`);
    modalCard.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => chooseZero(+b.dataset.n)));
    modalCard.querySelector('[data-re]')?.addEventListener('click', () => { closeModal(); reroll(); });
  }

  // ±1 아이템 칸을 누르면: 이번 값에 이미 방향을 정했으면 그 방향으로 바로, 아니면 고르는 창.
  function usePm() {
    if (S.pmDir) return adjust(S.pmDir);
    openPmPicker();
  }

  function openPmPicker() {
    if (!canAdjust(1) && !canAdjust(-1)) return;
    openModal(`
      <h2>±1</h2>
      <p>지금 값 ${S.value}. 1 아래·8 위로는 갈 수 없어요. 고른 방향으로만 이어서 쓸 수 있어요.</p>
      <div class="choice-row">
        <button class="choice" data-d="-1" ${canAdjust(-1) ? '' : 'disabled'}>−1<small>${S.value - 1}</small></button>
        <button class="choice" data-d="1" ${canAdjust(1) ? '' : 'disabled'}>+1<small>${S.value + 1}</small></button>
      </div>
      <div class="modal-foot"><button class="act ghost" data-x>닫기</button></div>`);
    modalCard.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { closeModal(); adjust(+b.dataset.d); }));
    modalCard.querySelector('[data-x]').addEventListener('click', closeModal);
  }

  function openResult() {
    const sc = score();
    openModal(`
      <h2>Game Over</h2>
      <p>맞힌 숫자 ${sc.hits}개 + 맞힌 숫자 중 가장 큰 수 ${sc.max}</p>
      <div class="final-score">${sc.total}</div>
      <div class="modal-foot">
        <button class="act ghost" data-undo>↶ 되돌리기</button>
        <button class="act" data-x>판 보기</button>
        <button class="act" data-new>새 게임</button>
      </div>`);
    modalCard.querySelector('[data-undo]').addEventListener('click', undo);
    modalCard.querySelector('[data-x]').addEventListener('click', closeModal);
    modalCard.querySelector('[data-new]').addEventListener('click', newGame);
  }

  // ---------- 룰북 ----------
  // 한 장에 한 규칙. 장마다 3×3 예시 판이 저절로 움직인다(움짤 대신 실제 칸으로).
  // 프레임은 앞 프레임에 덧붙는 변화: set(칸 값, 'F'=깃발), mk(동그라미 ok/빗금 bad), hl(둘레 강조), die, roll, tag, cap, t(머무는 ms)
  const CHIP = (v, big) => `<span class="rb-chip${big ? ' big' : ''}">${v}</span>`;
  const AR = '<span class="rb-ar">→</span>';
  const RING = [0, 1, 2, 3, 5, 6, 7, 8];
  const RB_PAGES = [
    { title: '주사위를 굴려요', text: '10면체 주사위를 굴리고, 나온 숫자를 원하는 빈 칸에 적어요.',
      frames: [
        { die: 7, dim: true, t: 700 },
        { die: 3, roll: true, dim: false, t: 700 },
        { tag: CHIP(3), t: 700 },
        { set: { 4: 3 }, t: 1600 },
      ] },
    { title: '숫자 = 둘레의 지뢰 수', text: '숫자 둘레 8칸에는 그 숫자만큼 지뢰가 있어요. 지뢰라고 생각하는 칸에는 깃발을 꽂아요.',
      frames: [
        { set: { 4: 3 }, t: 600 },
        { hl: RING, t: 900 },
        { set: { 0: 'F' }, cap: '깃발 1', t: 600 },
        { set: { 5: 'F' }, cap: '깃발 2', t: 600 },
        { set: { 7: 'F' }, cap: '깃발 3 = 숫자 3', t: 1800 },
      ] },
    { title: 'Mark! 맞으면 동그라미', text: '둘레 8칸이 다 차면 채점해요. 깃발 수가 숫자와 같으면 동그라미, 그리고 아이템을 하나 받아요.',
      frames: [
        { set: { 4: 2, 1: 'F' }, hl: RING, t: 700 },
        { set: { 6: 'F', 0: 5 }, t: 600 },
        { set: { 2: 4, 3: 1 }, t: 600 },
        { set: { 5: 7, 7: 3, 8: 6 }, t: 700 },
        { hl: [], mk: { 4: 'ok' }, cap: '깃발 2개 = 2 → 동그라미', t: 900 },
        { tag: '<span class="rb-item">' + RE_SVG + '</span><span class="rb-plus">+1</span>', t: 1800 },
      ] },
    { title: '틀리면 빗금', text: '깃발 수가 숫자와 다르면 빗금. 빗금 친 숫자는 점수가 없어요.',
      frames: [
        { set: { 4: 2, 0: 'F', 2: 'F' }, hl: RING, t: 700 },
        { set: { 8: 'F', 1: 6, 3: 3 }, t: 600 },
        { set: { 5: 5, 6: 1, 7: 4 }, t: 700 },
        { hl: [], mk: { 4: 'bad' }, cap: '깃발 3개 ≠ 2 → 빗금', t: 2000 },
      ] },
    { title: '9가 나오면', text: '9는 숫자로 적지 않아요. 대신 원하는 칸에 깃발을 하나 꽂아요.',
      frames: [
        { die: 9, roll: true, t: 800 },
        { tag: CHIP(9) + AR + '<span class="rb-item">' + FLAG_SVG + '</span>', t: 800 },
        { set: { 4: 'F' }, t: 1800 },
      ] },
    { title: '0이 나오면', text: '0은 1~8 중 원하는 숫자로 바꿔 적어요. 9는 고를 수 없어요.',
      frames: [
        { die: 0, roll: true, t: 800 },
        { cap: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => CHIP(n)).join(''), t: 900 },
        { cap: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => CHIP(n, n === 5)).join(''), t: 700 },
        { tag: CHIP(0) + AR + CHIP(5, true), cap: '', set: { 4: 5 }, t: 1800 },
      ] },
    { title: '깃발 아이템 (처음 3개)', text: '깃발 아이템을 쓰면 나온 숫자만큼 깃발을 꽂아요. 숫자를 적는 대신이에요.',
      frames: [
        { die: 3, roll: true, t: 800 },
        { tag: CHIP(3) + AR + '<span class="rb-item on">' + FLAG_SVG + '</span>', t: 800 },
        { set: { 1: 'F' }, t: 450 },
        { set: { 3: 'F' }, t: 450 },
        { set: { 8: 'F' }, cap: '깃발 3개', t: 1800 },
      ] },
    { title: 'Re · ±1', text: 'Re는 주사위를 다시 굴려요. ±1은 값에 1을 더하거나 빼요(1~8 안에서). 여러 개 쓸 때는 한 방향으로만.',
      frames: [
        { die: 2, roll: true, t: 800 },
        { tag: '<span class="rb-item on">' + RE_SVG + '</span>', cap: 'Re: 다시 굴리기', t: 800 },
        { die: 6, roll: true, tag: CHIP(6), t: 1000 },
        { tag: CHIP(6) + '<span class="rb-item on">' + PM_SVG + '</span>', cap: '±1: 6 → 7', t: 800 },
        { tag: CHIP(6) + AR + CHIP(7, true), set: { 4: 7 }, cap: '', t: 1800 },
      ] },
    { title: '점수', text: '판이 다 차면 끝. 점수 = 동그라미 숫자 개수 + 동그라미 숫자 중 가장 큰 수.',
      frames: [
        { set: { 0: 'F', 1: 2, 2: 1, 3: 2, 4: 'F', 5: 5, 6: 1, 7: 3, 8: 'F' }, t: 500 },
        { mk: { 1: 'ok', 2: 'ok', 3: 'ok', 6: 'ok', 5: 'bad', 7: 'bad' }, t: 900 },
        { cap: '동그라미 4개', t: 900 },
        { cap: '동그라미 4개 + 가장 큰 수 2', t: 1000 },
        { cap: '4 + 2 = <b>6점</b> (빗금 친 5는 안 쳐요)', t: 2200 },
      ] },
    { title: '웹에서는', html: `
        <ul class="rb-list">
          <li><img src="assets/logo.png" alt=""> 해를 누르면 새 게임</li>
          <li><span class="rb-ico">${FLAG_SVG}</span> 아이템은 왼쪽 칸을 눌러 써요. 파란 테두리 = 지금 쓸 수 있음</li>
          <li><span class="rb-ico">${document.querySelector('.undo-ico')?.outerHTML || '↶'}</span> 되돌리기 (⌘Z). 주사위 굴림은 되돌릴 수 없어요</li>
          <li><span class="rb-ico">⋮⋮</span> 창은 위쪽을 끌어 옮길 수 있어요</li>
        </ul>` },
  ];

  let rb = { page: 0, timer: null, st: null };
  function openRules() {
    openModal(`
      <div class="rb">
        <div class="rb-count" id="rbCount"></div>
        <h2 id="rbTitle"></h2>
        <div class="rb-demo" id="rbDemo">
          <div class="rb-side"><div class="rb-die" id="rbDie"></div><div class="rb-tag" id="rbTag"></div></div>
          <div class="rb-board" id="rbBoard">${'<div class="rb-cell"></div>'.repeat(9)}</div>
        </div>
        <div class="rb-cap" id="rbCap"></div>
        <div class="rb-text" id="rbText"></div>
        <div class="rb-nav">
          <button class="act" data-prev aria-label="이전">◀</button>
          <div class="rb-dots">${RB_PAGES.map((_, k) => `<button class="rb-dot" data-go="${k}" aria-label="${k + 1}쪽"></button>`).join('')}</div>
          <button class="act" data-next aria-label="다음">▶</button>
        </div>
      </div>
      <div class="modal-foot"><button class="act" data-x>닫기</button></div>`);
    modalCard.classList.add('wide');
    modalCard.querySelector('[data-prev]').addEventListener('click', () => rbGo(rb.page - 1));
    modalCard.querySelector('[data-next]').addEventListener('click', () => rbGo(rb.page + 1));
    modalCard.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => rbGo(+b.dataset.go)));
    modalCard.querySelector('[data-x]').addEventListener('click', () => { closeModal(); afterRenderModal(); });
    rbGo(0);
  }
  function rbGo(n) {
    if (n < 0 || n >= RB_PAGES.length) return;
    clearTimeout(rb.timer);
    rb.page = n;
    const pg = RB_PAGES[n];
    $('rbCount').textContent = `${n + 1} / ${RB_PAGES.length}`;
    $('rbTitle').textContent = pg.title;
    const demo = $('rbDemo'), text = $('rbText');
    demo.hidden = !pg.frames;
    modalCard.querySelector('.rb-side').hidden = !pg.frames || !pg.frames.some((f) => 'die' in f || 'tag' in f);
    $('rbCap').hidden = !pg.frames;
    text.innerHTML = pg.html || pg.text;
    modalCard.querySelectorAll('.rb-dot').forEach((d, k) => d.classList.toggle('on', k === n));
    modalCard.querySelector('[data-prev]').disabled = n === 0;
    modalCard.querySelector('[data-next]').disabled = n === RB_PAGES.length - 1;
    if (pg.frames) rbPlay(pg, 0);
  }
  function rbPlay(pg, k) {
    if (k === 0) rb.st = { c: Array(9).fill(null), mk: {}, hl: [], die: null, dim: false, tag: '', cap: '' };
    const st = rb.st, f = pg.frames[k];
    const fresh = new Set(), freshMk = new Set();
    if (f.set) for (const [i, v] of Object.entries(f.set)) { st.c[i] = v; fresh.add(+i); }
    if (f.mk) for (const [i, v] of Object.entries(f.mk)) { st.mk[i] = v; freshMk.add(+i); }
    for (const key of ['hl', 'die', 'dim', 'tag', 'cap']) if (key in f) st[key] = f[key];
    // 판
    $('rbBoard').querySelectorAll('.rb-cell').forEach((el, i) => {
      if (k === 0 || fresh.has(i) || freshMk.has(i)) {
        const v = st.c[i], m = st.mk[i];
        el.innerHTML = v === 'F' ? FLAG_SVG : v === null ? '' :
          `<span class="num">${v}</span>` + (m === 'ok' ? CIRCLE(freshMk.has(i)) : m === 'bad' ? SLASH(freshMk.has(i)) : '');
        if (fresh.has(i)) { el.classList.remove('placed'); void el.offsetWidth; el.classList.add('placed'); }
      }
      el.classList.toggle('hl', st.hl.includes(i));
      el.classList.toggle('center', i === 4 && st.hl.length > 0);
    });
    // 주사위·표시
    const dieBox = $('rbDie');
    dieBox.hidden = st.die === null;
    if (st.die !== null && ('die' in f || k === 0)) {
      dieBox.innerHTML = dieSVG(st.die, 'rb');
      if (f.roll) { dieBox.classList.remove('roll'); void dieBox.offsetWidth; dieBox.classList.add('roll'); }
    }
    dieBox.classList.toggle('dim', !!st.dim);
    $('rbTag').innerHTML = st.tag;
    $('rbCap').innerHTML = st.cap;
    const last = k === pg.frames.length - 1;
    rb.timer = setTimeout(() => rbPlay(pg, last ? 0 : k + 1), f.t || 900);
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- 10면체 주사위 ----------
  // 빨간 반투명 d10. 면은 반쯤 비치고, 뒤쪽 모서리가 흐리게 보이며, 빛이 아래쪽에 모인다.
  function numText(n, x, y, size, rot = 0, op = 1) {
    const u = n === 6 || n === 9
      ? `<rect x="${x - size * 0.26}" y="${y + size * 0.1}" width="${size * 0.52}" height="${size * 0.08}" fill="#fff" stroke="#6d000c" stroke-width="${size * 0.06}" paint-order="stroke"/>` : '';
    return `<g transform="rotate(${rot} ${x} ${y})" opacity="${op}"><text x="${x}" y="${y}" font-family="'Arial Black', Arial, Helvetica, sans-serif" font-weight="900" font-size="${size}" fill="#fff" stroke="#6d000c" stroke-width="${size * 0.09}" stroke-linejoin="round" paint-order="stroke" text-anchor="middle">${n}</text>${u}</g>`;
  }
  const DIE_OUT = '50,3 94,40 86,72 50,97 14,72 6,40';
  // p: 같은 화면에 주사위가 여럿일 때(룰북) 그라데이션 id가 겹치지 않게
  function dieSVG(v, p = 'd') {
    const a = (v + 3) % 10, b = (v + 7) % 10, c = (9 - v + 10) % 10;
    return `
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <clipPath id="${p}dClip"><polygon points="${DIE_OUT}"/></clipPath>
          <linearGradient id="${p}gF" x1=".2" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#ff5a5f" stop-opacity=".78"/><stop offset=".6" stop-color="#e8101e" stop-opacity=".72"/><stop offset="1" stop-color="#c00714" stop-opacity=".8"/></linearGradient>
          <linearGradient id="${p}gR" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d0101c" stop-opacity=".82"/><stop offset="1" stop-color="#7a0010" stop-opacity=".9"/></linearGradient>
          <linearGradient id="${p}gL" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f02a34" stop-opacity=".75"/><stop offset="1" stop-color="#a3000f" stop-opacity=".85"/></linearGradient>
          <linearGradient id="${p}gB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8000f" stop-opacity=".85"/><stop offset="1" stop-color="#5e000a" stop-opacity=".92"/></linearGradient>
          <radialGradient id="${p}gGlow" cx=".5" cy=".78" r=".42"><stop offset="0" stop-color="#ffb08a" stop-opacity=".85"/><stop offset=".45" stop-color="#ff4a3a" stop-opacity=".45"/><stop offset="1" stop-color="#ff2020" stop-opacity="0"/></radialGradient>
          <linearGradient id="${p}gSpec" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
        </defs>
        <!-- 비쳐 보이는 몸통 -->
        <polygon points="${DIE_OUT}" fill="#c4000f" fill-opacity=".35"/>
        <!-- 뒤쪽 모서리 (흐리게) -->
        <g fill="none" stroke="#5a0008" stroke-opacity=".4" stroke-width=".9" stroke-linejoin="round">
          <polyline points="6,40 30,26 50,3"/><polyline points="94,40 70,26 50,3"/>
          <polyline points="30,26 50,97 70,26"/><polyline points="30,26 50,36 70,26"/>
        </g>
        <!-- 앞쪽 면 -->
        <polygon points="50,3 94,40 86,72 76,56" fill="url(#${p}gR)"/>
        <polygon points="50,3 24,56 14,72 6,40" fill="url(#${p}gL)"/>
        <polygon points="24,56 50,72 50,97 14,72" fill="url(#${p}gB)"/>
        <polygon points="50,72 76,56 86,72 50,97" fill="url(#${p}gB)" fill-opacity=".9"/>
        <polygon points="50,3 76,56 50,72 24,56" fill="url(#${p}gF)"/>
        <!-- 안에 모인 빛 -->
        <g clip-path="url(#${p}dClip)"><ellipse cx="50" cy="76" rx="34" ry="24" fill="url(#${p}gGlow)"/></g>
        <!-- 숫자 -->
        ${numText(a, 80, 43, 12, 38, .8)}
        ${numText(b, 20, 43, 12, -38, .8)}
        ${numText(c, 66, 83, 10, 160, .55)}
        ${numText(v, 50, 57, 34)}
        <!-- 모서리 빛·윤곽 -->
        <g fill="none" stroke="#ffd0cf" stroke-opacity=".75" stroke-width=".9" stroke-linejoin="round">
          <polyline points="24,56 50,3 76,56"/><polyline points="24,56 50,72 76,56"/>
          <line x1="50" y1="72" x2="50" y2="97"/><line x1="76" y1="56" x2="86" y2="72"/><line x1="24" y1="56" x2="14" y2="72"/>
        </g>
        <polygon points="${DIE_OUT}" fill="none" stroke="#4a0007" stroke-width="1.3" stroke-linejoin="round"/>
        <!-- 반짝임 -->
        <polygon points="49,7 28,48 33,49 50,12" fill="url(#${p}gSpec)"/>
        <polygon points="52,6 90,39 88,43 54,10" fill="#fff" opacity=".35"/>
        <circle cx="45" cy="16" r="1.6" fill="#fff" opacity=".95"/>
        <ellipse cx="80" cy="64" rx="2.4" ry="1" transform="rotate(55 80 64)" fill="#fff" opacity=".5"/>
      </svg>`;
  }
  function drawDie(v) { dieEl.innerHTML = dieSVG(v); }

  function animateDie(final, done) {
    dieBtn.classList.remove('idle', 'rolling');
    void dieBtn.offsetWidth;
    dieBtn.classList.add('rolling');
    // 탭이 뒤에 있어도 멈추지 않게 requestAnimationFrame 대신 타이머로 돈다.
    let elapsed = 0;
    const tick = () => {
      if (elapsed < 760) {
        const gap = 50 + (elapsed / 950) * 120;   // 점점 느리게 바뀜
        drawDie(Math.floor(Math.random() * 10));
        elapsed += gap;
        setTimeout(tick, gap);
      } else {
        drawDie(final);
        setTimeout(() => { dieBtn.classList.remove('rolling'); done(); }, 210);
      }
    };
    tick();
  }

  // ---------- 이벤트 ----------
  dieBtn.addEventListener('click', () => roll());
  $('btnUndo').addEventListener('click', undo);
  $('btnNew').addEventListener('click', () => {
    if (S.turn && S.phase !== 'done' && !confirmNew()) return;
    newGame();
  });
  $('btnRules').addEventListener('click', openRules);
  document.addEventListener('keydown', (e) => {
    if (!modal.hidden && modalCard.querySelector('.rb') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); rbGo(rb.page + (e.key === 'ArrowRight' ? 1 : -1)); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key === ' ' && S.phase === 'roll' && modal.hidden) { e.preventDefault(); roll(); }
  });

  // 새 게임 확인은 브라우저 confirm 대신 화면 안 창으로.
  let newArmed = false;
  function confirmNew() {
    if (newArmed) { newArmed = false; return true; }
    newArmed = true;
    toast('진행 중인 판이 있어요. 해를 한 번 더 누르면 새로 시작해요.');
    setTimeout(() => (newArmed = false), 2600);
    return false;
  }

  newGame();
})();
