/* KCNA Prep — router + views. */
(function () {
  const appEl = document.getElementById('app');
  let session = null;   // active quiz session
  let sIdx = 0;         // quiz question index
  let sAnswers = [];    // quiz answers
  let sTimer = null;    // mock timer interval
  let sEndsAt = 0;
  let deck = null;      // active flashcard session
  let dIdx = 0;
  let dPhase = 'answer'; // 'answer' | 'review'
  let dSel = null;       // selected MC option index
  let dTyped = '';       // typed answer (hard mode)
  let dVerdict = null;   // typed-answer grading result
  function resetCardState() { dPhase = 'answer'; dSel = null; dTyped = ''; dVerdict = null; }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Only allow in-app hash routes and http(s)/mailto links in an href; anything
  // else (javascript:, data:, …) collapses to '#'. Defense-in-depth for any link
  // that might ever come from user/imported data rather than a static template.
  function safeUrl(u) {
    u = String(u == null ? '' : u).trim();
    return /^(#\/|https?:\/\/|mailto:)/i.test(u) ? u : '#';
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(sel, ev, fn) { $all(sel).forEach((e) => e.addEventListener(ev, fn)); }
  function go(hash) { window.location.hash = hash; }

  // Translate an English UI string into the active language (English fallback).
  // Kept short because it wraps nearly every user-visible string below.
  function tr(s, vars) { return window.I18n ? I18n.t(s, vars) : s; }
  // Session/quiz titles are stored in English (stable across languages); this
  // translates them for display, including the "<Domain> — Practice" pattern.
  function trTitle(s) {
    if (!s) return '';
    const m = /^(.*) — Practice$/.exec(s);
    if (m) return esc(m[1]) + ' — ' + tr('Practice');
    return esc(tr(s));
  }

  function parseRoute() {
    let h = window.location.hash.replace(/^#/, '') || '/dashboard';
    const qi = h.indexOf('?');
    let params = {};
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach((kv) => {
        const p = kv.split('='); params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
      h = h.slice(0, qi);
    }
    const parts = h.split('/').filter(Boolean);
    return { path: '/' + parts.join('/'), parts, params };
  }

  function letter(i) { return String.fromCharCode(65 + i); }

  function gauge(pct, big) {
    const r = 60, c = 2 * Math.PI * r;
    const off = c * (1 - pct / 100);
    const col = pct >= 75 ? '#92dd23' : pct >= 55 ? '#ff9178' : pct >= 1 ? '#e14e35' : '#3a3a40';
    const size = big ? 150 : 110;
    return '<div class="gauge" role="img" aria-label="' + esc(tr('Readiness {pct} percent', { pct: pct })) + '" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg viewBox="0 0 150 150" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false">' +
      '<circle class="gauge-track" cx="75" cy="75" r="' + r + '" fill="none" stroke-width="13"/>' +
      '<circle cx="75" cy="75" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="13" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 75 75)"/></svg>' +
      '<div class="val"><div><span class="num">' + pct + '</span><div class="lbl">' + tr('readiness') + '</div></div></div></div>';
  }

  function bar(pct, cls) {
    return '<div class="bar ' + (cls || '') + '" role="progressbar" aria-valuenow="' + Math.round(pct) +
      '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + Math.max(2, pct) + '%"></span></div>';
  }

  function notReady() {
    return '<div class="empty-state"><div class="big">⏳</div>' +
      '<h2>' + tr('Study content is being generated') + '</h2>' +
      '<p class="muted">' + tr('The notes, flashcards and question bank are still being written.') + '<br>' +
      tr('Reload this page once generation finishes.') + '</p>' +
      '<button class="btn primary mt" data-act="reload">' + tr('Reload') + '</button></div>';
  }

  function render(html) { appEl.innerHTML = html; window.scrollTo(0, 0); }
  function announce(msg) { const s = document.getElementById('route-status'); if (s) s.textContent = msg; }

  function setNav(route) {
    $all('.mainnav a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('data-route') === route);
    });
    $('#mainnav').classList.remove('open');
    const tb = $('#nav-toggle'); if (tb) tb.setAttribute('aria-expanded', 'false');
  }

  function updateChrome() {
    const cd = StudyPlan.countdown();
    const short = cd.exam.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    $('#brand-countdown').textContent = tr('{days} days · pass by {date}', { days: cd.days, date: short });
    if (KCNA.ready()) {
      const c = KCNA.counts();
      $('#foot-stats').textContent = tr('{questions} questions · {flashcards} flashcards · {notes} notes', { questions: c.questions, flashcards: c.flashcards, notes: c.notes });
    }
    // Show the active difficulty in the top bar so users always know their level.
    const lvl = (window.Settings && Settings.level) ? Settings.level() : 'light';
    const opt = LEVEL_OPTS.find((o) => o[0] === lvl);
    const ll = $('#level-label');
    if (ll && opt) ll.textContent = tr(opt[1]);
    const lb = $('#level-btn');
    if (lb && opt) {
      lb.title = tr('Difficulty: {label} — click to change', { label: tr(opt[1]) });
      lb.setAttribute('aria-label', tr('Difficulty: {label} — change', { label: tr(opt[1]) }));
    }
  }

  /* ================= DASHBOARD ================= */
  // Deadline reminder — dismissible with the ✕ (persists; re-show in Settings).
  function schedulingBanner() {
    if (Settings.get().deadlineDismissed) return '';
    const cd = StudyPlan.countdown();
    const short = cd.exam.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    const urgent = cd.days <= 30;
    return '<div class="banner schedule-banner' + (urgent ? ' banner-bad' : '') + '" role="alert">' +
      '<div><strong>' + (urgent ? '🚨' : '⚠️') + ' ' +
        tr('Company deadline — pass the KCNA by {date} ({days} days left).', { date: esc(short), days: cd.days }) + '</strong> ' +
      (urgent ? tr('Remember to schedule your exam in time — book it now.') : tr('Remember to schedule your exam in time.')) + '</div>' +
      '<button class="banner-x" id="dismiss-deadline" aria-label="' + esc(tr('Close deadline warning')) + '" title="' + esc(tr('Close')) + '">✕</button>' +
      '</div>';
  }

  function viewDashboard() {
    const cd = StudyPlan.countdown();
    const r = Readiness.compute();
    const plan = StudyPlan.build();
    const cur = plan.weeks.find((w) => w.isCurrent) || plan.weeks[0];
    const fc = KCNA.ready() ? Flashcards.stats(null) : { due: 0, total: 0, mastered: 0 };
    const hist = Progress.history();
    const bestMock = hist.filter((h) => h.mode === 'mock').reduce((m, h) => Math.max(m, h.pct), 0);
    const st = Progress.streak();

    const domainRows = r.perDomain.map((d) => {
      const cls = d.answered < 3 ? '' : Readiness.colorClass(d.masteryPct);
      return '<div class="domain-row"><div class="meta"><span class="name">' + esc(d.name) + '</span>' +
        '<span class="pill">' + d.weight + '%</span></div>' +
        '<div class="domain-score">' + (d.answered ? d.masteryPct + '%' : '—') + '</div>' +
        bar(d.answered ? d.masteryPct : 0, cls) + '</div>';
    }).join('');

    render(
      schedulingBanner() +
      '<div class="hero">' +
        '<div class="card pad-lg readiness-card">' +
          '<div class="eyebrow">' + tr('Your readiness') + '</div>' +
          '<div class="gauge-wrap">' + gauge(r.readiness, true) +
            '<div><div class="row"><span class="pill ' + r.levelClass + '">' + tr(r.level) + '</span></div>' +
            '<p class="muted mt" style="margin:8px 0 0">' +
              (r.totalAnswered < 20
                ? tr('Take the <strong>Diagnostic</strong> to assess where you stand. You have answered {n} questions so far.', { n: r.totalAnswered })
                : tr('Predicted exam score <strong>~{score}%</strong> · pass mark {pass}%. Pass likelihood: <span class="{cls}">{likelihood}</span>.', { score: r.predictedScore, pass: r.passPct, cls: r.likelihoodClass, likelihood: tr(r.likelihood) })) +
            '</p>' +
            '<div class="btn-row mt"><a class="btn primary sm" href="#/readiness">' + tr('Full analysis') + '</a>' +
            '<a class="btn sm" href="#/practice?diagnostic=1">' + tr('Run diagnostic') + '</a></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="card countdown-card">' +
          '<div class="eyebrow">' + tr('Company deadline') + '</div>' +
          '<div class="countdown-num">' + cd.days + '</div>' +
          '<div class="sub">' + tr('days to pass by') + '</div>' +
          '<div class="countdown-date">' + cd.examLabel + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="stat-row">' +
        stat(r.totalAnswered, 'questions answered') +
        stat(fc.due, 'flashcards due') +
        stat(bestMock ? bestMock + '%' : '—', 'best mock score') +
        stat(plan.doneTasks + '/' + plan.totalTasks, 'plan tasks done') +
        stat((st.current ? '🔥 ' : '') + st.current, 'day study streak') +
      '</div>' +

      '<div class="grid cols-2">' +
        '<div class="card"><h2>' + tr('Domain mastery') + '</h2>' + (KCNA.ready() ? domainRows : '<p class="muted">' + tr('Content loading…') + '</p>') + '</div>' +
        '<div class="card"><div class="spread"><h2 style="margin:0">' + tr('This week — Week {n}', { n: cur.num }) + '</h2><span class="pill accent">' + cur.range + '</span></div>' +
          '<p class="muted" style="margin:8px 0 12px">' + esc(tr(cur.focus)) + '</p>' +
          '<div>' + cur.tasks.map((t) =>
            '<div class="task ' + (t.done ? 'done' : '') + '"><input type="checkbox" data-task="' + t.id + '" ' + (t.done ? 'checked' : '') + '>' +
            '<label>' + esc(tr(t.text)) + ' <a href="' + esc(safeUrl(t.link)) + '">' + tr('open ›') + '</a></label></div>').join('') +
          '</div>' +
          '<a class="btn sm mt" href="#/plan">' + tr('Full study plan ›') + '</a>' +
        '</div>' +
      '</div>' +

      '<div class="card mt-lg"><div class="spread"><h2 style="margin:0">' + tr('Jump in') + '</h2></div>' +
        '<div class="btn-row mt">' +
          '<a class="btn primary" href="#/learn">📚 ' + tr('Study notes') + '</a>' +
          '<a class="btn" href="#/cards">🃏 ' + tr('Flashcards') + (fc.due ? ' (' + tr('{n} due', { n: fc.due }) + ')' : '') + '</a>' +
          '<a class="btn" href="#/practice?mock=1">📝 ' + tr('Full mock exam') + '</a>' +
          '<a class="btn" href="#/practice">⚡ ' + tr('Quick practice') + '</a>' +
          '<a class="btn" href="#/report">📄 ' + tr('Progress report') + '</a>' +
        '</div></div>'
    );
    bindPlanChecks();
    const dx = $('#dismiss-deadline');
    if (dx) dx.addEventListener('click', function () { Settings.set({ deadlineDismissed: true }); viewDashboard(); });
  }
  function stat(n, l) { return '<div class="stat"><div class="n">' + n + '</div><div class="l">' + tr(l) + '</div></div>'; }

  /* ================= LEARN ================= */
  function viewLearn() {
    if (!KCNA.ready()) return render(notReady());
    const stats = Progress.stats();
    const cards = KCNA.all().map((d) => {
      const st = stats[d.id] || { answered: 0, correct: 0 };
      const acc = st.answered ? Math.round((st.correct / st.answered) * 100) : 0;
      return '<a class="card domain-card" href="#/learn/' + d.id + '">' +
        '<div class="spread"><strong>' + esc(d.name) + '</strong><span class="pill accent">' + tr('{weight}% of exam', { weight: d.weight }) + '</span></div>' +
        '<p class="muted" style="margin:8px 0 12px">' + tr('{notes} notes · {cards} cards · {questions} questions', { notes: (d.notes || []).length, cards: (d.flashcards || []).length, questions: (d.questions || []).length }) + '</p>' +
        (st.answered ? bar(acc, Readiness.colorClass(acc)) + '<div class="wt mt">' + tr('Mastery {pct}% · {answered} answered', { pct: acc, answered: st.answered }) + '</div>' : '<div class="wt">' + tr('Not started yet') + '</div>') +
        '</a>';
    }).join('');
    render('<div class="page-head"><h1>' + tr('Learn') + '</h1><p>' + tr('Concise, exam-focused notes across all five KCNA domains. Ordered by exam weight.') + '</p></div>' +
      '<div class="grid cols-2">' + cards + '</div>');
  }

  function viewLearnDomain(id) {
    if (!KCNA.ready()) return render(notReady());
    const d = KCNA.domain(id);
    if (!d) return render('<div class="empty-state">' + tr('Domain not found.') + ' <a href="#/learn">' + tr('Back to Learn') + '</a></div>');
    const notes = (d.notes || []).map((n, i) =>
      '<li><a href="#/note/' + d.id + '/' + i + '"><span><span class="note-num">' + (i + 1) + '</span>' + esc(n.title) + '</span><span class="faint">' + tr('read ›') + '</span></a></li>').join('');
    const refs = KCNA.references ? KCNA.references(d.id) : [];
    const refsHtml = refs.length ? '<div class="card mt-lg"><h2>📖 ' + tr('Further reading — official docs') + '</h2>' +
      '<ul class="ref-list">' + refs.map((r) =>
        '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) +
        ' <span class="ext">↗</span></a><div class="faint">' + esc(r.note || '') + '</div></li>').join('') +
      '</ul></div>' : '';
    render('<div class="crumbs"><a href="#/learn">' + tr('Learn') + '</a> › ' + esc(d.name) + '</div>' +
      '<div class="page-head"><div class="spread"><div><h1>' + esc(d.name) + '</h1><p>' + tr('{weight}% of the exam · {notes} notes', { weight: d.weight, notes: (d.notes || []).length }) + '</p></div></div></div>' +
      '<div class="btn-row" style="margin-bottom:18px">' +
        '<a class="btn primary" href="#/practice?domain=' + d.id + '">📝 ' + tr('Quiz this domain') + '</a>' +
        '<a class="btn" href="#/cards?domain=' + d.id + '">🃏 ' + tr('Flashcards') + '</a></div>' +
      '<div class="card"><ul class="note-list">' + notes + '</ul></div>' + refsHtml);
  }

  function viewNote(id, idx) {
    if (!KCNA.ready()) return render(notReady());
    const d = KCNA.domain(id);
    if (!d) return render('<div class="empty-state">' + tr('Not found.') + ' <a href="#/learn">' + tr('Back') + '</a></div>');
    idx = parseInt(idx, 10) || 0;
    const n = (d.notes || [])[idx];
    if (!n) return render('<div class="empty-state">' + tr('Note not found.') + ' <a href="#/learn/' + id + '">' + tr('Back') + '</a></div>');
    const prev = idx > 0 ? '<a class="btn sm" href="#/note/' + id + '/' + (idx - 1) + '">' + tr('‹ Previous') + '</a>' : '<span></span>';
    const next = idx < d.notes.length - 1 ? '<a class="btn sm primary" href="#/note/' + id + '/' + (idx + 1) + '">' + tr('Next ›') + '</a>' : '<a class="btn sm primary" href="#/practice?domain=' + id + '">' + tr('Quiz this domain ›') + '</a>';
    render('<div class="crumbs"><a href="#/learn">' + tr('Learn') + '</a> › <a href="#/learn/' + id + '">' + esc(d.name) + '</a> › ' + esc(n.title) + '</div>' +
      '<div class="card pad-lg"><div class="row" style="gap:8px;margin-bottom:6px"><span class="pill accent">' + esc(n.topic) + '</span></div>' +
      '<h1 style="margin:4px 0 16px;font-size:24px">' + esc(n.title) + '</h1>' +
      '<div class="note-body">' + n.html + '</div></div>' +
      '<div class="quiz-nav">' + prev + next + '</div>');
  }

  /* ================= FLASHCARDS ================= */
  const MODES = {
    easy: { label: 'Easy', sub: 'Multiple choice', pill: 'good' },
    hard: { label: 'Hard', sub: 'Type the answer', pill: 'bad' },
    flip: { label: 'Flip', sub: 'Review only', pill: '' },
  };
  function fcMode() {
    const m = Store.get('fcMode', null);
    if (m && MODES[m]) return m; // respect an explicit choice
    // default by experience: experienced users type answers, others get MC.
    const lvl = (window.Settings && Settings.level) ? Settings.level() : 'light';
    return lvl === 'heavy' ? 'hard' : 'easy';
  }

  function viewCards(params) {
    if (!KCNA.ready()) return render(notReady());
    if (params.domain || params.start) { startDeck(params.domain || null); return; }
    const all = Flashcards.stats(null);
    const mode = fcMode();
    const modeBtns = Object.keys(MODES).map((k) =>
      '<button data-fcmode="' + k + '" class="' + (k === mode ? 'active' : '') + '">' + tr(MODES[k].label) +
      '<span style="display:block;font-weight:400;font-size:11px;color:var(--text-faint)">' + tr(MODES[k].sub) + '</span></button>').join('');
    const perDomain = KCNA.all().map((d) => {
      const s = Flashcards.stats(d.id);
      return '<div class="choice" data-deck="' + d.id + '"><div class="ct">' + esc(d.name) + '</div>' +
        '<div class="cd">' + tr('{n} cards', { n: s.total }) + ' · <span class="' + (s.due ? 'tag-medium' : 'muted') + '">' + tr('{n} due', { n: s.due }) + '</span> · ' + tr('{n} mastered', { n: s.mastered }) + '</div></div>';
    }).join('');
    render('<div class="page-head"><h1>' + tr('Flashcards') + '</h1><p>' + tr('Spaced repetition — cards you find hard come back sooner. {due} due now of {total} total.', { due: all.due, total: all.total }) + '</p></div>' +
      '<div class="card" style="margin-bottom:18px"><div class="spread wrap"><div><h2 style="margin:0 0 4px">' + tr('Answer mode') + '</h2>' +
        '<p class="muted" style="margin:0;font-size:13px">' + tr('Choose how you want to be quizzed. Applies to every deck.') + '</p></div>' +
        '<div class="fc-mode" id="fcmode">' + modeBtns + '</div></div></div>' +
      '<div class="card"><div class="spread"><h2 style="margin:0">' + tr('Study all due') + '</h2><span class="pill ' + (all.due ? 'warn' : 'good') + '">' + tr('{n} due', { n: all.due }) + '</span></div>' +
        '<p class="muted" style="margin:8px 0 0">' + tr('Mix of every domain. {mastered} mastered · {learning} learning · {fresh} new.', { mastered: all.mastered, learning: all.learning, fresh: all.fresh }) + '</p>' +
        '<button class="btn primary mt" data-deck="all">' + tr('Start session ›') + '</button></div>' +
      '<h2 style="margin:24px 0 12px">' + tr('By domain') + '</h2><div class="choice-grid">' + perDomain + '</div>');
    on('[data-fcmode]', 'click', function () { Store.set('fcMode', this.getAttribute('data-fcmode')); viewCards({}); });
    on('[data-deck]', 'click', function () { const dk = this.getAttribute('data-deck'); startDeck(dk === 'all' ? null : dk); });
  }

  function startDeck(domainId) {
    deck = { domainId, mode: fcMode(), cards: Flashcards.queue(domainId, 25) };
    dIdx = 0; resetCardState();
    if (!deck.cards.length) {
      render('<div class="empty-state"><div class="big">✅</div><h2>' + tr('No cards due right now') + '</h2>' +
        '<p class="muted">' + (domainId
          ? tr('Great — you are caught up for this domain. Come back later or pick another deck.')
          : tr('Great — you are caught up. Come back later or pick another deck.')) + '</p>' +
        '<a class="btn primary mt" href="#/cards">' + tr('Back to decks') + '</a></div>');
      return;
    }
    renderCard();
  }

  function deckHeader() {
    const total = deck.cards.length;
    const m = MODES[deck.mode] || MODES.flip;
    return '<div class="quiz-top"><div class="row" style="gap:8px"><a class="btn sm ghost" href="#/cards">' + tr('‹ Decks') + '</a>' +
      '<span class="pill ' + m.pill + '">' + tr(m.label) + ' · ' + tr(m.sub) + '</span></div>' +
      '<div class="qprogress">' + bar(Math.round(dIdx / total * 100)) + '</div>' +
      '<div class="pill">' + (dIdx + 1) + ' / ' + total + '</div></div>';
  }
  function ratingRow(suggest) {
    const tag = (g, label, hint) => '<button class="btn' + (g === 2 ? ' good' : '') + (g === suggest ? ' suggested' : '') + '" data-grade="' + g + '">' + esc(tr(label)) + '<small>' + esc(tr(hint)) + '</small></button>';
    return '<div class="rate-hint">' + tr('How well did you recall it?') + '</div><div class="rate-row">' +
      tag(0, 'Again', '< 1 min') + tag(1, 'Hard', 'soon') +
      tag(2, 'Good', 'days') + tag(3, 'Easy', 'longer') + '</div>';
  }
  function qPanel(c) {
    return '<div class="fc-q"><span class="label">' + tr('Question') + '</span><span class="topic">' + esc(c.domainName) + '</span><div class="q">' + esc(c.front) + '</div></div>';
  }
  function bindRating() {
    on('[data-grade]', 'click', function () {
      Flashcards.review(deck.cards[dIdx].id, parseInt(this.getAttribute('data-grade'), 10));
      dIdx++; resetCardState();
      if (dIdx >= deck.cards.length) finishDeck(); else renderCard();
    });
  }

  function renderCard() {
    const c = deck.cards[dIdx];
    if (deck.mode === 'easy') return renderCardMC(c);
    if (deck.mode === 'hard') return renderCardType(c);
    return renderCardFlip(c);
  }

  function renderCardFlip(c) {
    const flipped = dPhase === 'review';
    render(deckHeader() +
      '<div class="flashcard' + (flipped ? ' flipped' : '') + '" id="fcard">' +
        '<div class="flashcard-inner">' +
          '<div class="flash-face flash-front"><span class="label">' + tr('Question') + '</span><span class="topic">' + esc(c.domainName) + '</span><div class="q">' + esc(c.front) + '</div></div>' +
          '<div class="flash-face flash-back"><span class="label">' + tr('Answer') + '</span><span class="topic">' + esc(c.topic || '') + '</span><div class="a">' + esc(c.back) + '</div></div>' +
        '</div></div>' +
      (flipped ? ratingRow(-1) : '<div class="flash-hint">' + tr('Click the card to reveal the answer') + '</div>'));
    $('#fcard').addEventListener('click', function () { if (dPhase === 'answer') { dPhase = 'review'; renderCard(); } });
    if (flipped) bindRating();
  }

  function renderCardMC(c) {
    if (!c._mc) c._mc = Flashcards.mcOptions(c);
    const correct = c._mc.correctIndex;
    const answered = dPhase === 'review';
    const opts = c._mc.options.map((o, i) => {
      let cls = 'option';
      if (answered) { if (i === correct) cls += ' correct'; else if (i === dSel) cls += ' incorrect'; }
      return '<div class="' + cls + '" data-opt="' + i + '"><span class="key">' + letter(i) + '</span><div>' + esc(o) + '</div></div>';
    }).join('');
    let tail = '';
    if (answered) {
      const right = dSel === correct;
      tail = '<div class="verdict ' + (right ? 'good' : 'bad') + '"><span class="vh">' + (right ? '✓ ' + tr('Correct') : '✗ ' + tr('Incorrect')) + '</span>' +
        (right ? '' : ' — ' + tr('the right answer is highlighted above.')) + '</div>' + ratingRow(right ? 2 : 0);
    } else {
      tail = '<div class="flash-hint">' + tr('Pick the answer you think is correct') + '</div>';
    }
    render(deckHeader() + qPanel(c) + '<div class="options" id="opts">' + opts + '</div>' + tail);
    if (!answered) on('[data-opt]', 'click', function () { dSel = parseInt(this.getAttribute('data-opt'), 10); dPhase = 'review'; renderCard(); });
    else bindRating();
  }

  function renderCardType(c) {
    const answered = dPhase === 'review';
    let body;
    if (!answered) {
      body = '<input class="fc-input" id="fcinput" placeholder="' + esc(tr('Type your answer…')) + '" aria-label="' + esc(tr('Your answer')) + '" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(dTyped) + '">' +
        '<div class="btn-row mt"><button class="btn primary" id="fccheck">' + tr('Check answer') + '</button>' +
        '<button class="btn ghost" id="fcreveal">' + tr('Skip / reveal') + '</button></div>' +
        '<div class="flash-hint">' + tr('Spelling and capitalization are forgiven — just get the idea across.') + '</div>';
    } else {
      const v = dVerdict || { match: false };
      const cls = v.match ? 'good' : (v.partial ? 'warn' : 'bad');
      const head = v.empty ? '✗ ' + tr('No answer') : (v.match ? '✓ ' + tr('Correct (close enough)') : (v.partial ? '◐ ' + tr('Partially right') : '✗ ' + tr('Not quite')));
      const suggest = v.match ? 2 : (v.partial ? 1 : 0);
      body = '<div class="verdict ' + cls + '"><span class="vh">' + head + '</span>' +
        (v.empty ? '' : ' <span class="faint" style="font-size:12px">· ' + tr('{pct}% of key terms matched', { pct: v.coverage }) + '</span>') + '</div>' +
        (dTyped ? '<div class="ans-reveal"><div class="lbl">' + tr('Your answer') + '</div><div class="val">' + esc(dTyped) + '</div></div>' : '') +
        '<div class="ans-reveal"><div class="lbl">' + tr('Correct answer') + '</div><div class="val correct-ans">' + esc(c.back) + '</div></div>' +
        ratingRow(suggest);
    }
    render(deckHeader() + qPanel(c) + body);
    if (!answered) {
      const input = $('#fcinput');
      const submit = function () { dTyped = input.value.trim(); dVerdict = Flashcards.checkTyped(dTyped, c.back); dPhase = 'review'; renderCard(); };
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      $('#fccheck').addEventListener('click', submit);
      $('#fcreveal').addEventListener('click', function () { dTyped = input.value.trim(); dVerdict = Flashcards.checkTyped(dTyped, c.back); dPhase = 'review'; renderCard(); });
      input.focus();
    } else bindRating();
  }

  function finishDeck() {
    const s = Flashcards.stats(deck.domainId);
    render('<div class="empty-state"><div class="big">🎉</div><h2>' + tr('Session complete') + '</h2>' +
      '<p class="muted">' + tr('You reviewed {n} cards. {due} still due · {mastered} mastered.', { n: deck.cards.length, due: s.due, mastered: s.mastered }) + '</p>' +
      '<div class="btn-row center mt" style="justify-content:center">' +
      '<a class="btn primary" href="#/cards">' + tr('More flashcards') + '</a>' +
      '<a class="btn" href="#/practice">' + tr('Practice questions') + '</a></div></div>');
    maybeSuggestLevelUp();
  }

  /* ================= PRACTICE / EXAMS ================= */
  function viewPractice(params) {
    if (!KCNA.ready()) return render(notReady());
    if (params.mock) return startSession({ mode: 'mock' });
    if (params.diagnostic) return startSession({ mode: 'diagnostic', count: 25 });
    if (params.domain) return startSession({ mode: 'practice', domainId: params.domain, count: parseInt(params.count, 10) || 15 });

    const domainChoices = KCNA.all().map((d) =>
      '<div class="choice" data-mode="practice" data-domain="' + d.id + '"><div class="ct">' + esc(d.name) + '</div>' +
      '<div class="cd">' + tr('{weight}% · {questions} questions', { weight: d.weight, questions: (d.questions || []).length }) + '</div></div>').join('');
    render('<div class="page-head"><h1>' + tr('Practice') + '</h1><p>' + tr('Quiz by domain, run a diagnostic, or sit a full timed mock exam (60 questions, 90 minutes, pass at 75%).') + '</p></div>' +
      '<div class="grid cols-2">' +
        '<div class="card"><h2>📝 ' + tr('Full Mock Exam') + '</h2><p class="muted">' + tr('60 questions, weighted exactly like the real KCNA, 90-minute timer. No feedback until the end — just like exam day.') + '</p>' +
          '<button class="btn primary mt" data-mode="mock">' + tr('Start mock exam ›') + '</button></div>' +
        '<div class="card"><h2>🎯 ' + tr('Diagnostic') + '</h2><p class="muted">' + tr('25 balanced questions to assess where you stand and seed your readiness score. Best taken first.') + '</p>' +
          '<button class="btn primary mt" data-mode="diagnostic">' + tr('Run diagnostic ›') + '</button></div>' +
      '</div>' +
      '<h2 style="margin:24px 0 12px">' + tr('Practice by domain') + '</h2>' +
      '<p class="muted" style="margin:-6px 0 14px">' + tr('Immediate feedback after each question.') + '</p>' +
      '<div class="choice-grid">' + domainChoices + '</div>' +
      '<div class="card mt-lg"><div class="spread"><h2 style="margin:0">⚡ ' + tr('Mixed quick quiz') + '</h2></div>' +
        '<p class="muted" style="margin:8px 0 0">' + tr('20 questions across all domains.') + '</p>' +
        '<button class="btn mt" data-mode="practice" data-mixed="1">' + tr('Start mixed quiz ›') + '</button></div>');
    on('[data-mode]', 'click', function () {
      const mode = this.getAttribute('data-mode');
      const domain = this.getAttribute('data-domain');
      const mixed = this.getAttribute('data-mixed');
      if (mode === 'mock') startSession({ mode: 'mock' });
      else if (mode === 'diagnostic') startSession({ mode: 'diagnostic', count: 25 });
      else if (domain) startSession({ mode: 'practice', domainId: domain, count: 15 });
      else if (mixed) startSession({ mode: 'practice', count: 20 });
    });
  }

  function startSession(opts) {
    session = Exams.build(opts);
    sIdx = 0; sAnswers = new Array(session.questions.length).fill(null);
    if (sTimer) { clearInterval(sTimer); sTimer = null; }
    if (session.minutes > 0) {
      sEndsAt = Date.now() + session.minutes * 60000;
      sTimer = setInterval(tickTimer, 1000);
    }
    if (!session.questions.length) {
      render('<div class="empty-state">' + tr('No questions available yet.') + ' <a href="#/practice">' + tr('Back') + '</a></div>');
      return;
    }
    renderQuestion();
  }

  function renderQuestion() {
    const q = session.questions[sIdx];
    const total = session.questions.length;
    const answered = sAnswers[sIdx];
    const showFeedback = session.mode === 'practice' && answered != null;
    const timerHtml = session.minutes > 0
      ? '<div class="timer" id="timer">' + fmtTime(Math.max(0, sEndsAt - Date.now())) + '</div>' : '';

    const opts = q.options.map((o, i) => {
      let cls = 'option';
      if (showFeedback) {
        if (i === q.correctIndex) cls += ' correct';
        else if (i === answered) cls += ' incorrect';
      } else if (i === answered) cls += ' selected';
      return '<div class="' + cls + '" data-opt="' + i + '"><span class="key">' + letter(i) + '</span><div>' + esc(o) + '</div></div>';
    }).join('');

    const diffTag = q.difficulty ? '<span class="pill tag-' + q.difficulty + '">' + tr(q.difficulty) + '</span>' : '';

    render('<div class="quiz-top">' +
        '<div class="row"><span class="pill accent">' + trTitle(session.title) + '</span><span class="pill">' + esc(q.domainName) + '</span>' + diffTag + '</div>' +
        timerHtml +
      '</div>' +
      '<div class="qprogress" style="margin-bottom:16px">' + bar(Math.round(sIdx / total * 100)) + '<div class="faint mt" style="font-size:12.5px">' + tr('Question {n} of {total}', { n: sIdx + 1, total: total }) + '</div></div>' +
      '<div class="card pad-lg"><div class="qtext">' + esc(q.question) + '</div>' +
        '<div class="options" id="opts">' + opts + '</div>' +
        (showFeedback ? '<div class="explain"><div class="lbl">' + (answered === q.correctIndex ? '✓ ' + tr('Correct') : '✗ ' + tr('Incorrect — answer: {letter}', { letter: letter(q.correctIndex) })) + '</div><div class="mt" style="margin-top:6px">' + esc(q.explanation) + '</div></div>' : '') +
      '</div>' +
      '<div class="quiz-nav">' +
        (sIdx > 0 ? '<button class="btn" id="prev">' + tr('‹ Previous') + '</button>' : '<span></span>') +
        (sIdx < total - 1
          ? '<button class="btn primary" id="next">' + tr('Next ›') + '</button>'
          : '<button class="btn good" id="finish">' + tr('Finish & score ›') + '</button>') +
      '</div>');

    on('[data-opt]', 'click', function () {
      const i = parseInt(this.getAttribute('data-opt'), 10);
      if (session.mode === 'practice' && sAnswers[sIdx] != null) return; // lock after answer in practice
      sAnswers[sIdx] = i;
      if (session.mode === 'practice') renderQuestion(); // show feedback
      else { $all('#opts .option').forEach((o) => o.classList.remove('selected')); this.classList.add('selected'); }
    });
    const prev = $('#prev'); if (prev) prev.addEventListener('click', () => { sIdx--; renderQuestion(); });
    const next = $('#next'); if (next) next.addEventListener('click', () => { sIdx++; renderQuestion(); });
    const fin = $('#finish'); if (fin) fin.addEventListener('click', finishSession);
  }

  function tickTimer() {
    const left = sEndsAt - Date.now();
    const t = $('#timer');
    if (t) { t.textContent = fmtTime(Math.max(0, left)); if (left < 5 * 60000) t.classList.add('danger'); }
    if (left <= 0) { clearInterval(sTimer); sTimer = null; finishSession(); }
  }
  function fmtTime(ms) {
    const s = Math.floor(ms / 1000); const m = Math.floor(s / 60);
    return (m < 10 ? '0' : '') + m + ':' + ((s % 60) < 10 ? '0' : '') + (s % 60);
  }

  function finishSession() {
    if (sTimer) { clearInterval(sTimer); sTimer = null; }
    const res = Exams.grade(session, sAnswers);
    const pillClass = res.passed ? 'good' : 'bad';
    const perDomain = Object.keys(res.perDomain).map((id) => {
      const p = res.perDomain[id]; const pct = Math.round(p.correct / p.total * 100);
      return '<div class="domain-row"><div class="meta"><span class="name">' + esc(p.name) + '</span></div>' +
        '<div class="domain-score">' + p.correct + '/' + p.total + '</div>' + bar(pct, Readiness.colorClass(pct)) + '</div>';
    }).join('');

    const review = res.detail.map((d, i) => {
      const q = d.q;
      const opts = q.options.map((o, oi) => {
        let cls = 'option';
        if (oi === q.correctIndex) cls += ' correct';
        else if (oi === d.sel && !d.isRight) cls += ' incorrect';
        return '<div class="' + cls + '"><span class="key">' + letter(oi) + '</span><div>' + esc(o) + '</div></div>';
      }).join('');
      return '<div class="review-q"><div class="qh"><span class="pill ' + (d.isRight ? 'good' : 'bad') + '">' + (d.isRight ? '✓' : '✗') + '</span>' +
        '<div><div class="faint" style="font-size:12px">' + esc(q.domainName) + ' · ' + esc(q.topic || '') + '</div>' +
        '<strong>' + (i + 1) + '. ' + esc(q.question) + '</strong></div></div>' +
        '<div class="options mt">' + opts + '</div>' +
        '<div class="explain"><div class="lbl">' + tr('Explanation') + '</div><div style="margin-top:6px">' + esc(q.explanation) + '</div></div></div>';
    }).join('');

    render('<div class="card pad-lg center">' +
        '<div class="eyebrow">' + trTitle(session.title) + ' — ' + tr('result') + '</div>' +
        '<div class="scorebig ' + (res.passed ? 'tag-easy' : 'tag-hard') + '">' + res.pct + '%</div>' +
        '<div class="row" style="justify-content:center;gap:10px;margin-top:8px"><span class="pill ' + pillClass + '">' + (res.passed ? tr('PASS') : tr('Below pass mark')) + '</span>' +
        '<span class="muted">' + tr('{correct} / {total} correct · pass mark {pass}%', { correct: res.correct, total: res.total, pass: KCNA.meta.passPct }) + '</span></div>' +
        (session.mode === 'mock' || session.mode === 'diagnostic'
          ? '<p class="muted mt">' + tr('Your readiness score has been updated.') + ' <a href="#/readiness">' + tr('See full analysis ›') + '</a></p>' : '') +
      '</div>' +
      '<div class="card mt-lg"><h2>' + tr('By domain') + '</h2>' + perDomain + '</div>' +
      '<div class="btn-row mt-lg"><a class="btn primary" href="#/practice">' + tr('Another round') + '</a>' +
        '<a class="btn" href="#/readiness">' + tr('Readiness') + '</a><a class="btn" href="#/dashboard">' + tr('Dashboard') + '</a></div>' +
      '<h2 style="margin:26px 0 12px">' + tr('Review all {total} questions', { total: res.total }) + '</h2>' + review);
    maybeSuggestLevelUp();
  }

  /* ================= READINESS ================= */
  function viewReadiness() {
    const r = Readiness.compute();
    const hist = Progress.history();

    const domainRows = r.perDomain.map((d) => {
      const cls = d.answered < 3 ? '' : Readiness.colorClass(d.masteryPct);
      return '<div class="domain-row"><div class="meta"><span class="name">' + esc(d.name) + '</span><span class="pill">' + tr('{weight}% weight', { weight: d.weight }) + '</span></div>' +
        '<div class="domain-score">' + (d.answered ? d.masteryPct + '%' : '—') + '</div>' +
        bar(d.answered ? d.masteryPct : 0, cls) +
        '<div class="faint" style="grid-column:1/-1;font-size:12px;margin-top:4px">' +
          (d.answered ? tr('{answered} answered · coverage {coverage}%', { answered: d.answered, coverage: d.coverage }) : tr('Not practiced yet')) +
          ' · <a href="#/practice?domain=' + d.id + '">' + tr('quiz ›') + '</a></div></div>';
    }).join('');

    const recs = [];
    const ap = StudyPlan.approach();
    recs.push('<strong>' + tr('{label} track:', { label: esc(tr(ap.label)) }) + '</strong> ' + esc(tr(ap.blurb)) + ' <a href="#/settings">' + tr('Change ›') + '</a>');
    if (r.totalAnswered < 20) recs.push(tr('Take the {link} to establish your baseline.', { link: '<a href="#/practice?diagnostic=1">' + tr('25-question Diagnostic') + '</a>' }));
    r.unassessed.forEach((d) => recs.push(tr('You have not practiced {name} ({weight}% of the exam) yet — {link}', { name: '<strong>' + esc(d.name) + '</strong>', weight: d.weight, link: '<a href="#/practice?domain=' + d.id + '">' + tr('start a quiz ›') + '</a>' })));
    r.weakest.filter((d) => d.masteryPct < 75).forEach((d) =>
      recs.push(tr('Weak area: {name} at {pct}% — {reread} then {requiz}.', { name: '<strong>' + esc(d.name) + '</strong>', pct: d.masteryPct, reread: '<a href="#/learn/' + d.id + '">' + tr('re-read notes') + '</a>', requiz: '<a href="#/practice?domain=' + d.id + '">' + tr('re-quiz') + '</a>' })));
    if (r.readiness >= 78) recs.push(tr('You are tracking well — keep mock scores above {pass}% and flashcards green through exam day.', { pass: r.passPct }));
    if (!recs.length) recs.push(tr('Keep practicing across all domains and sit a {link}.', { link: '<a href="#/practice?mock=1">' + tr('full mock exam') + '</a>' }));

    const histRows = hist.length ? hist.slice(0, 12).map((h) => {
      const dt = new Date(h.date);
      return '<div class="domain-row"><div class="meta"><span class="name">' + (h.title ? trTitle(h.title) : esc(tr(h.mode))) + '</span>' +
        '<span class="faint" style="font-size:12px">' + dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span></div>' +
        '<div class="domain-score"><span class="' + (h.pct >= KCNA.meta.passPct ? 'tag-easy' : 'tag-hard') + '">' + h.pct + '%</span></div></div>';
    }).join('') : '<p class="muted">' + tr('No attempts yet. Take a quiz or mock to populate your history.') + '</p>';

    render('<div class="page-head"><div class="spread wrap"><div><h1>' + tr('Readiness analysis') + '</h1><p>' + tr('An honest read on whether you are ready to pass the KCNA before the Oct 1 deadline.') + '</p></div>' +
      '<a class="btn" href="#/report">📄 ' + tr('Progress report') + '</a></div></div>' +
      '<div class="hero">' +
        '<div class="card pad-lg"><div class="gauge-wrap">' + gauge(r.readiness, true) +
          '<div><span class="pill ' + r.levelClass + '">' + tr(r.level) + '</span>' +
          '<div class="mt-lg"><div class="spread"><span class="muted">' + tr('Predicted exam score') + '</span><strong>' + (r.totalAnswered < 20 ? '—' : '~' + r.predictedScore + '%') + '</strong></div>' +
          '<div class="spread mt"><span class="muted">' + tr('Pass likelihood') + '</span><span class="pill ' + r.likelihoodClass + '">' + tr(r.likelihood) + '</span></div>' +
          '<div class="spread mt"><span class="muted">' + tr('Questions answered') + '</span><strong>' + r.totalAnswered + '</strong></div>' +
          '<div class="spread mt"><span class="muted">' + tr('Material assessed') + '</span><strong>' + Math.round(r.assessedShare * 100) + '%</strong></div></div></div></div></div>' +
        '<div class="card"><h2>' + tr('What to do next') + '</h2><ul style="padding-left:18px;line-height:1.9;margin:0">' +
          recs.map((x) => '<li>' + x + '</li>').join('') + '</ul></div>' +
      '</div>' +
      '<div class="card mt-lg"><h2>' + tr('Mastery by domain') + '</h2>' + (KCNA.ready() ? domainRows : '<p class="muted">' + tr('Content loading…') + '</p>') + '</div>' +
      '<div class="card mt-lg"><h2>' + tr('Attempt history') + '</h2>' + histRows + '</div>' +
      '<div class="card mt-lg"><div class="spread"><div><h2 style="margin:0">' + tr('Reset progress') + '</h2><p class="muted" style="margin:6px 0 0">' + tr('Clears flashcard schedule, quiz stats, and plan checkboxes.') + '</p></div>' +
        '<button class="btn" id="reset">' + tr('Reset all') + '</button></div></div>');

    const rb = $('#reset');
    if (rb) rb.addEventListener('click', function () {
      if (confirm(tr('Reset all your progress? This cannot be undone.'))) { Store.reset(); go('#/dashboard'); location.reload(); }
    });
  }

  /* ================= PLAN ================= */
  function viewPlan() {
    const plan = StudyPlan.build();
    const pct = plan.totalTasks ? Math.round(plan.doneTasks / plan.totalTasks * 100) : 0;
    const weeks = plan.weeks.map((w) => {
      const wpct = w.total ? Math.round(w.doneCount / w.total * 100) : 0;
      const done = w.doneCount === w.total && w.total > 0;
      return '<div class="week ' + (w.isCurrent ? 'current' : '') + ' ' + (done ? 'done' : '') + '">' +
        '<div class="wh"><div><span class="wk">' + tr('Week {n}', { n: w.num }) + '</span> ' + (w.isCurrent ? '<span class="pill accent">' + tr('this week') + '</span>' : '') + (done ? ' <span class="pill good">' + tr('done') + '</span>' : '') +
          '<div class="muted" style="margin-top:2px">' + esc(tr(w.focus)) + '</div></div>' +
          '<div class="dates">' + w.range + ' · ' + w.doneCount + '/' + w.total + '</div></div>' +
        '<p class="faint" style="margin:0 0 10px;font-size:13px">🎯 ' + esc(tr(w.goal)) + '</p>' +
        w.tasks.map((t) => '<div class="task ' + (t.done ? 'done' : '') + '"><input type="checkbox" data-task="' + t.id + '" ' + (t.done ? 'checked' : '') + '>' +
          '<label>' + esc(tr(t.text)) + (t.link ? ' <a href="' + esc(safeUrl(t.link)) + '">' + tr('open ›') + '</a>' : '') + '</label></div>').join('') +
        '</div>';
    }).join('');

    const ap = plan.approach;
    render('<div class="page-head"><div class="spread"><div><h1>' + tr('Study plan') + '</h1><p>' + tr('{days} days until the Oct 1 deadline.', { days: plan.daysLeft }) + '</p></div>' +
      '<span class="pill accent">' + tr('{done} / {total} tasks', { done: plan.doneTasks, total: plan.totalTasks }) + '</span></div></div>' +
      '<div class="card approach-card" style="margin-bottom:18px"><div class="spread wrap"><div>' +
        '<div class="eyebrow">' + tr('Tailored for · {label}', { label: esc(tr(ap.label)) }) + '</div>' +
        '<p class="muted" style="margin:2px 0 0;max-width:62ch">' + esc(tr(ap.blurb)) + '</p></div>' +
        '<div class="approach-meta"><span class="pill accent">' + esc(tr(ap.hours)) + '</span></div>' +
      '</div><div class="btn-row mt"><a class="btn sm ghost" href="#/settings">' + tr('Change level ›') + '</a></div></div>' +
      '<div class="card" style="margin-bottom:18px"><div class="spread"><strong>' + tr('Overall progress') + '</strong><span>' + pct + '%</span></div><div class="mt">' + bar(pct) + '</div>' +
      '<p class="muted mt" style="font-size:13px;margin-bottom:0">' + tr('Check tasks off as you go — progress is saved on this device and feeds your dashboard.') + '</p></div>' +
      weeks);
    bindPlanChecks();
  }

  function bindPlanChecks() {
    on('[data-task]', 'change', function () {
      StudyPlan.toggle(this.getAttribute('data-task'), this.checked);
      const route = parseRoute();
      if (route.path === '/plan') viewPlan();
      else if (route.path === '/dashboard') viewDashboard();
    });
  }

  /* ================= REFERENCE / KNOWLEDGE BASE ================= */
  // Stable, well-known official resources (used if data/references.js omits them).
  const OFFICIAL = [
    { title: 'KCNA exam & registration (Linux Foundation)', url: 'https://training.linuxfoundation.org/certification/kubernetes-cloud-native-associate-kcna/', note: 'Official exam page — book your seat here.' },
    { title: 'CNCF certification curriculum', url: 'https://github.com/cncf/curriculum', note: 'The authoritative domain/competency outline.' },
    { title: 'Candidate handbook', url: 'https://docs.linuxfoundation.org/tc-docs/certification/lf-handbook2', note: 'Exam-day rules, system requirements, retakes.' },
    { title: 'Kubernetes documentation', url: 'https://kubernetes.io/docs/home/', note: 'Primary source for everything Kubernetes.' },
    { title: 'CNCF Cloud Native Glossary', url: 'https://glossary.cncf.io/', note: 'Plain-language definitions of cloud native terms.' },
    { title: 'CNCF Landscape', url: 'https://landscape.cncf.io/', note: 'Map of the cloud native ecosystem and projects.' },
  ];

  function examFactsCard() {
    const m = KCNA.meta;
    const rows = [
      [tr('Format'), tr('{n} multiple-choice questions', { n: m.examQuestions })],
      [tr('Duration'), tr('{n} minutes', { n: m.examMinutes })],
      [tr('Passing score'), m.passPct + '%'],
      [tr('Delivery'), tr('Online, remotely proctored')],
      [tr('Cost / validity'), tr('See the official exam page (includes free retake)')],
    ];
    return '<div class="card"><h2>📋 ' + tr('Exam at a glance') + '</h2>' +
      '<div class="facts">' + rows.map((r) =>
        '<div class="fact"><span class="fk">' + esc(r[0]) + '</span><span class="fv">' + esc(r[1]) + '</span></div>').join('') +
      '</div>' +
      '<h3 style="margin-top:16px">' + tr('Domain weights') + '</h3>' +
      KCNA.all().map((d) => '<div class="domain-row"><div class="meta"><span class="name">' + esc(d.name) + '</span></div>' +
        '<div class="domain-score">' + d.weight + '%</div>' + bar(d.weight, '') + '</div>').join('') +
      '</div>';
  }

  function glossarySection(filter) {
    if (!KCNA.hasGlossary || !KCNA.hasGlossary()) {
      return '<p class="muted">' + tr('Glossary is being compiled. Check back after the next update.') + '</p>';
    }
    const q = (filter || '').trim().toLowerCase();
    const terms = KCNA.glossary().filter((t) => !q || t.term.toLowerCase().indexOf(q) >= 0 || t.definition.toLowerCase().indexOf(q) >= 0);
    if (!terms.length) return '<p class="muted">' + tr('No glossary terms match “{q}”.', { q: esc(filter) }) + '</p>';
    return '<div class="glossary" id="glossary-list">' + terms.map((t) => {
      const dn = (KCNA.domain(t.domain) || {}).name || '';
      return '<div class="gterm" id="term-' + esc(slug(t.term)) + '"><div class="spread"><strong>' + esc(t.term) + '</strong>' +
        (dn ? '<span class="pill">' + esc(dn) + '</span>' : '') + '</div>' +
        '<p class="muted" style="margin:6px 0 0">' + esc(t.definition) + '</p>' +
        (t.sourceUrl ? '<a class="faint gsrc" href="' + esc(t.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + tr('source ↗') + '</a>' : '') +
        '</div>';
    }).join('') + '</div>';
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function viewReference(params) {
    if (!KCNA.ready()) return render(notReady());
    const official = (KCNA.references && KCNA.references('official').length) ? KCNA.references('official') : OFFICIAL;
    const officialHtml = official.map((r) =>
      '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + ' <span class="ext">↗</span></a>' +
      '<div class="faint">' + esc(r.note || '') + '</div></li>').join('');

    const perDomain = KCNA.all().map((d) => {
      const refs = KCNA.references ? KCNA.references(d.id) : [];
      if (!refs.length) return '';
      return '<div class="card"><div class="spread"><h3 style="margin:0">' + esc(d.name) + '</h3><span class="pill accent">' + d.weight + '%</span></div>' +
        '<ul class="ref-list mt">' + refs.map((r) =>
          '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + ' <span class="ext">↗</span></a>' +
          (r.note ? '<div class="faint">' + esc(r.note) + '</div>' : '') + '</li>').join('') + '</ul></div>';
    }).join('');

    render('<div class="page-head"><h1>' + tr('Reference & knowledge base') + '</h1><p>' + tr('Exam facts, a searchable glossary, and authoritative documentation for every domain.') + '</p></div>' +
      '<div class="grid cols-2">' + examFactsCard() +
        '<div class="card"><h2>🔗 ' + tr('Official resources') + '</h2><ul class="ref-list">' + officialHtml + '</ul></div>' +
      '</div>' +
      '<div class="card mt-lg"><div class="spread wrap"><h2 style="margin:0">📚 ' + tr('Glossary') + '</h2>' +
        '<input class="fc-input gloss-search" id="gloss-search" placeholder="' + esc(tr('Filter terms…')) + '" autocomplete="off" aria-label="' + esc(tr('Filter glossary terms')) + '" style="max-width:280px" value="' + esc(params.q || '') + '"></div>' +
        '<div id="gloss-wrap" class="mt">' + glossarySection(params.q || '') + '</div></div>' +
      (perDomain ? '<h2 style="margin:26px 0 14px">' + tr('Documentation by domain') + '</h2><div class="grid cols-2">' + perDomain + '</div>' : ''));

    const gs = $('#gloss-search');
    if (gs) {
      gs.addEventListener('input', function () { $('#gloss-wrap').innerHTML = glossarySection(this.value); });
      if (params.term) {
        const el = document.getElementById('term-' + slug(params.term));
        if (el) { el.classList.add('hl'); el.scrollIntoView({ block: 'center' }); }
      }
    }
  }

  /* ================= SETTINGS ================= */
  function seg(name, current, opts) {
    return '<div class="seg" data-seg="' + name + '">' + opts.map((o) =>
      '<button data-val="' + o[0] + '" class="' + (o[0] === current ? 'active' : '') + '">' + esc(tr(o[1])) + '</button>').join('') + '</div>';
  }

  function viewSettings() {
    const s = Settings.get();
    const m = KCNA.meta;
    const canInstall = window.PWA && PWA.canInstall();
    render('<div class="page-head"><h1>' + tr('Settings') + '</h1><p>' + tr('Personalize KCNA Prep. Everything is stored only on this device.') + '</p></div>' +
      '<div class="card"><h2>' + tr('Appearance') + '</h2>' +
        '<div class="setting"><div><strong>' + tr('Theme') + '</strong><div class="faint">' + tr('Auto follows your operating system.') + '</div></div>' +
          seg('theme', s.theme, [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']]) + '</div>' +
        '<div class="setting"><div><strong>' + tr('Motion') + '</strong><div class="faint">' + tr('Reduce animations and transitions.') + '</div></div>' +
          seg('reducedMotion', s.reducedMotion, [['auto', 'Auto'], ['on', 'Reduced'], ['off', 'Full']]) + '</div>' +
      '</div>' +

      '<div class="card mt-lg"><h2>' + tr('Language') + '</h2>' +
        '<p class="muted" style="margin-top:0">' + tr('Choose the language for the app interface.') + '</p>' +
        '<div class="setting"><strong>' + tr('Display language') + '</strong>' +
          '<div class="seg" data-seg="lang">' + I18n.LANGS.map(function (o) {
            return '<button data-val="' + o.code + '" lang="' + o.code + '" class="' + (o.code === Settings.lang() ? 'active' : '') + '">' + esc(o.native) + '</button>';
          }).join('') + '</div></div>' +
        (contentPackAvailable() ?
          '<div class="setting"><div><strong>' + tr('Study content') + '</strong><div class="faint">' +
            tr('The KCNA exam is in English, so notes, flashcards and questions stay in English by default. Translating them is a study aid — the exact English terms are still what you will see on exam day.') +
          '</div></div>' +
          seg('contentLang', Settings.contentLang(), [['en', 'English'], ['follow', 'Display language']]) + '</div>' : '') +
        '</div>' +

      '<div class="card mt-lg"><h2>' + tr('Kubernetes experience') + '</h2>' +
        '<p class="muted" style="margin-top:0">' + tr('Tailors your study plan, flashcard default, and practice question difficulty.') + '</p>' +
        '<div class="setting"><strong>' + tr('Experience level') + '</strong>' +
          seg('level', Settings.level(), [['none', 'New'], ['light', 'Some'], ['heavy', 'Experienced']]) + '</div>' +
        '<p class="faint" style="margin:10px 0 0">' + esc(tr(StudyPlan.approach().blurb)) + '</p></div>' +

      '<div class="card mt-lg"><h2>' + tr('Deadline & plan') + '</h2>' +
        '<p class="muted" style="margin-top:0">' + tr('Changing these updates your countdown, study plan, and readiness.') + '</p>' +
        '<div class="setting"><div><strong>' + tr('Deadline (pass by)') + '</strong><div class="faint">' + tr('Company deadline to pass the KCNA.') + '</div></div>' +
          '<input type="date" id="exam-date" aria-label="' + esc(tr('Deadline date')) + '" class="fc-input" style="max-width:200px" value="' + esc(m.examDate) + '"></div>' +
        '<div class="setting"><label for="plan-start"><strong>' + tr('Plan start') + '</strong></label>' +
          '<input type="date" id="plan-start" class="fc-input" style="max-width:200px" value="' + esc(m.planStart) + '"></div>' +
        '<div class="setting"><div><strong>' + tr('Deadline warning') + '</strong><div class="faint">' + tr('Show or hide the dashboard deadline reminder.') + '</div></div>' +
          seg('deadlineWarn', s.deadlineDismissed ? 'off' : 'on', [['on', 'Show'], ['off', 'Hidden']]) + '</div>' +
        '<div class="btn-row mt"><button class="btn primary" id="save-dates">' + tr('Save dates') + '</button>' +
          '<button class="btn ghost" id="reset-dates">' + tr('Reset to defaults') + '</button></div></div>' +

      '<div class="card mt-lg"><h2>' + tr('Your progress') + '</h2>' +
        '<p class="muted" style="margin-top:0">' + tr('Save or load your session from the <strong>save icon</strong> in the top bar — handy when several people share this device. Progress is stored on this device until you save it to a file.') + '</p>' +
        '<div class="btn-row"><button class="btn" id="reset-progress">' + tr('Reset progress') + '</button></div>' +
        '<div id="settings-msg" class="mt" aria-live="polite"></div></div>' +

      (canInstall ? '<div class="card mt-lg"><h2>' + tr('Install') + '</h2><p class="muted" style="margin-top:0">' + tr('Install KCNA Prep as an app for offline study and a home-screen icon.') + '</p>' +
        '<button class="btn primary" id="install">📲 ' + tr('Install app') + '</button></div>' : '') +

      '<div class="card mt-lg"><h2>' + tr('About') + '</h2>' +
        '<div class="facts"><div class="fact"><span class="fk">' + tr('Version') + '</span><span class="fv">' + esc(m.version || '1.0.0') + '</span></div>' +
        '<div class="fact"><span class="fk">' + tr('Content') + '</span><span class="fv">' + tr('{questions} questions · {flashcards} cards · {notes} notes', { questions: KCNA.counts().questions, flashcards: KCNA.counts().flashcards, notes: KCNA.counts().notes }) + '</span></div>' +
        '<div class="fact"><span class="fk">' + tr('Offline') + '</span><span class="fv">' + (window.PWA && PWA.isStandalone() ? tr('Installed app') : tr('Works offline after first load')) + '</span></div></div>' +
        '<div class="btn-row mt"><a class="btn sm" href="#/reference">' + tr('Reference') + '</a>' +
        '<button class="btn sm ghost" id="show-shortcuts">⌨️ ' + tr('Keyboard shortcuts') + '</button></div></div>');

    // appearance
    on('[data-seg="theme"] button', 'click', function () { Settings.set({ theme: this.getAttribute('data-val') }); viewSettings(); });
    on('[data-seg="reducedMotion"] button', 'click', function () { Settings.set({ reducedMotion: this.getAttribute('data-val') }); viewSettings(); });
    on('[data-seg="deadlineWarn"] button', 'click', function () { Settings.set({ deadlineDismissed: this.getAttribute('data-val') === 'off' }); viewSettings(); });
    on('[data-seg="level"] button', 'click', function () { Settings.set({ level: this.getAttribute('data-val') }); updateChrome(); viewSettings(); });
    on('[data-seg="lang"] button', 'click', function () { Settings.set({ lang: this.getAttribute('data-val') }); updateChrome(); viewSettings(); syncContentLang(); });
    on('[data-seg="contentLang"] button', 'click', function () { Settings.set({ contentLang: this.getAttribute('data-val') }); viewSettings(); syncContentLang(); });

    // dates
    $('#save-dates').addEventListener('click', function () {
      const ed = $('#exam-date').value, ps = $('#plan-start').value;
      Settings.set({ examDate: ed || null, planStart: ps || null });
      settingsMsg(tr('Saved. Countdown and plan updated.'), 'good');
      updateChrome();
    });
    $('#reset-dates').addEventListener('click', function () {
      Settings.set({ examDate: null, planStart: null });
      location.reload();
    });

    // progress
    $('#reset-progress').addEventListener('click', function () {
      if (confirm(tr('Reset your study progress? Settings (theme, dates) are kept. This cannot be undone.'))) {
        Settings.resetProgress(); settingsMsg(tr('Progress reset.'), 'good'); setTimeout(() => location.reload(), 700);
      }
    });

    const inst = $('#install');
    if (inst) inst.addEventListener('click', function () { PWA.promptInstall().then(() => viewSettings()); });
    $('#show-shortcuts').addEventListener('click', showShortcutsHelp);
  }
  function settingsMsg(text, cls) { const el = $('#settings-msg'); if (el) el.innerHTML = '<span class="pill ' + (cls || '') + '">' + esc(text) + '</span>'; }

  /* ================= SEARCH OVERLAY ================= */
  let searchOpen = false;
  function openSearch() {
    if (searchOpen || !KCNA.ready()) return;
    searchOpen = true;
    const ov = document.createElement('div');
    ov.className = 'search-overlay'; ov.id = 'search-overlay';
    ov.innerHTML = '<div class="search-box" role="dialog" aria-label="' + esc(tr('Search')) + '">' +
      '<input class="search-input" id="search-input" placeholder="' + esc(tr('Search notes, glossary, topics…')) + '" autocomplete="off" aria-label="' + esc(tr('Search')) + '">' +
      '<div class="search-results" id="search-results"><p class="muted search-hint">' + tr('Type at least 2 characters. Press Esc to close.') + '</p></div></div>';
    document.body.appendChild(ov);
    const input = $('#search-input');
    const results = $('#search-results');
    let active = -1, items = [];
    function renderResults() {
      const list = Search.query(input.value, 12); items = list; active = list.length ? 0 : -1;
      if (!input.value.trim() || input.value.trim().length < 2) {
        results.innerHTML = '<p class="muted search-hint">' + tr('Type at least 2 characters. Press Esc to close.') + '</p>'; return;
      }
      if (!list.length) { results.innerHTML = '<p class="muted search-hint">' + tr('No results for “{q}”.', { q: esc(input.value) }) + '</p>'; return; }
      results.innerHTML = list.map((r, i) =>
        '<a class="search-result' + (i === 0 ? ' active' : '') + '" data-route="' + esc(r.route) + '" data-i="' + i + '">' +
        '<span class="sr-type">' + esc(tr(r.type)) + '</span><span class="sr-title">' + esc(r.title) + '</span>' +
        (r.snippet ? '<span class="sr-snip">' + esc(r.snippet) + '</span>' : '') + '</a>').join('');
      $all('.search-result', results).forEach((el) => el.addEventListener('click', function () { goResult(this.getAttribute('data-route')); }));
    }
    function setActive(n) {
      const els = $all('.search-result', results); if (!els.length) return;
      active = (n + els.length) % els.length;
      els.forEach((e, i) => e.classList.toggle('active', i === active));
      els[active].scrollIntoView({ block: 'nearest' });
    }
    function goResult(route) { closeSearch(); go(route); }
    input.addEventListener('input', renderResults);
    ov.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) goResult(items[active].route); }
    });
    ov.addEventListener('click', function (e) { if (e.target === ov) closeSearch(); });
    input.focus();
  }
  function closeSearch() { const ov = $('#search-overlay'); if (ov) ov.remove(); searchOpen = false; }

  /* ================= SESSION MENU (save / load) ================= */
  function appToast(msg) {
    document.querySelectorAll('.pwa-toast').forEach((n) => n.remove());
    const t = document.createElement('div');
    t.id = 'app-toast'; t.className = 'pwa-toast'; t.setAttribute('role', 'status');
    const span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
    const x = document.createElement('button');
    x.className = 'pwa-toast-x'; x.setAttribute('aria-label', tr('Dismiss')); x.textContent = '✕';
    x.addEventListener('click', () => t.remove());
    t.appendChild(x);
    document.body.appendChild(t);
    setTimeout(() => { if (document.getElementById('app-toast') === t) t.remove(); }, 5000);
  }

  function closeSessionMenu() {
    const m = document.getElementById('session-menu'); if (m) m.remove();
    const b = $('#session-btn'); if (b) b.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outsideSessionClick);
    document.removeEventListener('keydown', sessionMenuKey);
  }
  function outsideSessionClick(e) {
    const m = document.getElementById('session-menu'); const b = $('#session-btn');
    if (m && !m.contains(e.target) && b && !b.contains(e.target)) closeSessionMenu();
  }
  function sessionMenuKey(e) {
    if (e.key === 'Escape') { closeSessionMenu(); const b = $('#session-btn'); if (b) b.focus(); }
  }
  function toggleSessionMenu() {
    if (document.getElementById('session-menu')) { closeSessionMenu(); return; }
    const btn = $('#session-btn');
    const menu = document.createElement('div');
    menu.id = 'session-menu'; menu.className = 'menu'; menu.setAttribute('role', 'menu');
    menu.innerHTML =
      '<button role="menuitem" data-sess="save">' +
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>' +
        tr('Save session…') + '</button>' +
      '<button role="menuitem" data-sess="load">' +
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
        tr('Load session…') + '</button>';
    btn.parentNode.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true');
    on('#session-menu [data-sess]', 'click', function () {
      const act = this.getAttribute('data-sess');
      closeSessionMenu();
      if (act === 'save') doSaveSession(); else doLoadSession();
    });
    setTimeout(() => document.addEventListener('click', outsideSessionClick), 0);
    document.addEventListener('keydown', sessionMenuKey);
    const first = menu.querySelector('button'); if (first) first.focus();
  }

  function doSaveSession() {
    Settings.saveSession().then(function (r) {
      if (!r || r.cancelled) return;
      if (r.ok) appToast(r.method === 'download' ? tr('Session downloaded: {name}', { name: r.name }) : tr('Session saved: {name}', { name: r.name }));
      else appToast(r.error ? tr('Could not save session: {error}', { error: r.error }) : tr('Could not save session.'));
    });
  }
  function doLoadSession() {
    Settings.loadSession().then(function (r) {
      if (!r || r.cancelled) return;
      if (r.ok) { appToast(tr('Loaded session ({count} items). Reloading…', { count: r.count })); setTimeout(() => location.reload(), 850); }
      else appToast(r.error ? tr('Could not load session: {error}', { error: r.error }) : tr('Could not load session.'));
    });
  }

  /* ================= DIFFICULTY MENU (experience level) ================= */
  const LEVEL_OPTS = [
    ['none', 'New to Kubernetes', 'Start from the basics'],
    ['light', 'Some experience', 'Reinforce the fundamentals'],
    ['heavy', 'Experienced', 'Diagnose-first · harder questions'],
  ];
  function closeLevelMenu() {
    const m = document.getElementById('level-menu'); if (m) m.remove();
    const b = $('#level-btn'); if (b) b.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outsideLevelClick);
    document.removeEventListener('keydown', levelMenuKey);
  }
  function outsideLevelClick(e) {
    const m = document.getElementById('level-menu'); const b = $('#level-btn');
    if (m && !m.contains(e.target) && b && !b.contains(e.target)) closeLevelMenu();
  }
  function levelMenuKey(e) {
    if (e.key === 'Escape') { closeLevelMenu(); const b = $('#level-btn'); if (b) b.focus(); }
  }
  function toggleLevelMenu() {
    if (document.getElementById('level-menu')) { closeLevelMenu(); return; }
    const btn = $('#level-btn');
    const cur = Settings.level();
    const menu = document.createElement('div');
    menu.id = 'level-menu'; menu.className = 'menu menu-wide'; menu.setAttribute('role', 'menu');
    menu.innerHTML = '<div class="menu-head">' + tr('Difficulty') + '</div>' + LEVEL_OPTS.map(function (o) {
      const on = o[0] === cur;
      return '<button role="menuitemradio" aria-checked="' + (on ? 'true' : 'false') + '" data-setlevel="' + o[0] + '" class="' + (on ? 'cur' : '') + '">' +
        '<span class="menu-check" aria-hidden="true">' + (on ? '✓' : '') + '</span>' +
        '<span class="menu-main"><strong>' + esc(tr(o[1])) + '</strong><span class="menu-sub">' + esc(tr(o[2])) + '</span></span></button>';
    }).join('');
    btn.parentNode.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true');
    on('#level-menu [data-setlevel]', 'click', function () {
      const v = this.getAttribute('data-setlevel');
      const label = this.querySelector('strong').textContent;
      closeLevelMenu();
      Settings.set({ level: v });
      updateChrome(); route();
      appToast(tr('Difficulty: {label}', { label: label }));
    });
    setTimeout(function () { document.addEventListener('click', outsideLevelClick); }, 0);
    document.addEventListener('keydown', levelMenuKey);
    const c = menu.querySelector('.cur') || menu.querySelector('button'); if (c) c.focus();
  }

  // Does a translated study-content pack ship for the current display language?
  // The Study-content setting only appears when the choice would do something.
  function contentPackAvailable() {
    return !!(window.ContentI18n && window.Settings && ContentI18n.shipsFor(Settings.lang()));
  }

  /* ---- Study-content language: load the pack, re-render if it changed ----
   * Rendering is never blocked on the fetch — the chrome is already translated,
   * so the page paints immediately and the study text swaps in when the pack
   * lands (instantly on repeat visits: the service worker caches it). */
  function syncContentLang() {
    if (!window.ContentI18n || !window.Settings) return;
    const before = ContentI18n.active();
    ContentI18n.ensure(Settings.contentLangEffective()).then(function (now) {
      if (now !== before) { updateChrome(); route(); }
    });
  }

  /* ================= LANGUAGE MENU ================= */
  function closeLangMenu() {
    const m = document.getElementById('lang-menu'); if (m) m.remove();
    const b = $('#lang-btn'); if (b) b.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outsideLangClick);
    document.removeEventListener('keydown', langMenuKey);
  }
  function outsideLangClick(e) {
    const m = document.getElementById('lang-menu'); const b = $('#lang-btn');
    if (m && !m.contains(e.target) && b && !b.contains(e.target)) closeLangMenu();
  }
  function langMenuKey(e) {
    if (e.key === 'Escape') { closeLangMenu(); const b = $('#lang-btn'); if (b) b.focus(); }
  }
  function toggleLangMenu() {
    if (document.getElementById('lang-menu')) { closeLangMenu(); return; }
    if (!window.I18n) return;
    const btn = $('#lang-btn');
    const cur = Settings.lang();
    const menu = document.createElement('div');
    menu.id = 'lang-menu'; menu.className = 'menu menu-wide menu-scroll'; menu.setAttribute('role', 'menu');
    menu.innerHTML = '<div class="menu-head">' + tr('Language') + '</div>' + I18n.LANGS.map(function (o) {
      const on = o.code === cur;
      return '<button role="menuitemradio" aria-checked="' + (on ? 'true' : 'false') + '" data-setlang="' + o.code + '" lang="' + o.code + '" class="' + (on ? 'cur' : '') + '">' +
        '<span class="menu-check" aria-hidden="true">' + (on ? '✓' : '') + '</span>' +
        '<span class="menu-main"><strong>' + esc(o.native) + '</strong><span class="menu-sub">' + esc(o.label) + '</span></span></button>';
    }).join('');
    btn.parentNode.appendChild(menu);
    btn.setAttribute('aria-expanded', 'true');
    on('#lang-menu [data-setlang]', 'click', function () {
      const code = this.getAttribute('data-setlang');
      const native = this.querySelector('strong').textContent;
      closeLangMenu();
      Settings.set({ lang: code });   // Settings.apply() syncs I18n + <html lang/dir>
      updateChrome(); route(); syncContentLang();
      appToast(tr('Language') + ': ' + native);
    });
    setTimeout(function () { document.addEventListener('click', outsideLangClick); }, 0);
    document.addEventListener('keydown', langMenuKey);
    const c = menu.querySelector('.cur') || menu.querySelector('button'); if (c) c.focus();
  }

  /* ---- Adaptive difficulty: offer to level up when performance is strong ---- */
  function maybeSuggestLevelUp() {
    if (!window.Settings) return;
    const lvl = Settings.level();
    if (lvl === 'heavy') return;                 // already at the top
    const asked = Store.get('levelUpAsked', {});
    if (asked[lvl]) return;                       // only offer once per level
    // practice/exam signal
    const stats = Progress.stats();
    let answered = 0, correct = 0;
    Object.keys(stats).forEach(function (k) { answered += stats[k].answered || 0; correct += stats[k].correct || 0; });
    const pAcc = answered ? correct / answered : 0;
    // flashcard signal
    const cs = (Progress.cardStats) ? Progress.cardStats() : { answered: 0, acc: 0 };
    const strongPractice = answered >= 20 && pAcc >= 0.85;
    const strongCards = cs.answered >= 15 && cs.acc >= 0.80;
    if (strongPractice && strongCards) showLevelUpPrompt(lvl);
  }
  function showLevelUpPrompt(curLevel) {
    if (document.getElementById('levelup-overlay')) return;
    const next = curLevel === 'none' ? 'light' : 'heavy';
    const nextLabel = next === 'heavy' ? 'Experienced' : 'Some experience';
    const asked = Store.get('levelUpAsked', {}); asked[curLevel] = true; Store.set('levelUpAsked', asked);
    const ov = document.createElement('div');
    ov.className = 'search-overlay'; ov.id = 'levelup-overlay';
    ov.innerHTML = '<div class="search-box onboard-box" role="dialog" aria-label="' + esc(tr('Level up?')) + '">' +
      '<h2 style="margin:2px 4px 6px">🚀 ' + tr('You\'re on a roll!') + '</h2>' +
      '<p class="muted" style="margin:0 4px 16px">' + tr('You\'ve been scoring high on practice and flashcards. Want to step up to {label} — harder questions and type-the-answer flashcards?', { label: '<strong>' + esc(tr(nextLabel)) + '</strong>' }) + '</p>' +
      '<div class="btn-row" style="justify-content:flex-end">' +
        '<button class="btn ghost" data-lvlup="no">' + tr('Keep current') + '</button>' +
        '<button class="btn primary" data-lvlup="yes">' + tr('Yes, level up') + '</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    on('#levelup-overlay [data-lvlup]', 'click', function () {
      const yes = this.getAttribute('data-lvlup') === 'yes';
      ov.remove();
      if (yes) { Settings.set({ level: next }); updateChrome(); route(); appToast(tr('Difficulty bumped to {label} 💪', { label: tr(nextLabel) })); }
    });
    ov.addEventListener('keydown', function (e) { if (e.key === 'Escape') ov.remove(); });
    ov.tabIndex = -1; ov.focus();
  }

  /* ================= KEYBOARD SHORTCUTS ================= */
  function showShortcutsHelp() {
    const ov = document.createElement('div');
    ov.className = 'search-overlay'; ov.id = 'shortcuts-overlay';
    const rows = [
      ['⌘K / Ctrl K', 'Open search'],
      ['1 – 9', 'Select an answer (quiz & flashcards)'],
      ['Enter', 'Next question / reveal flashcard'],
      ['Space', 'Flip flashcard'],
      ['G then D', 'Go to Dashboard'],
      ['?', 'Show this help'],
      ['Esc', 'Close overlay'],
    ];
    ov.innerHTML = '<div class="search-box" role="dialog" aria-label="' + esc(tr('Keyboard shortcuts')) + '"><h2 style="margin:4px 4px 12px">' + tr('Keyboard shortcuts') + '</h2>' +
      '<div class="kbd-list">' + rows.map((r) => '<div class="kbd-row"><kbd>' + esc(r[0]) + '</kbd><span>' + esc(tr(r[1])) + '</span></div>').join('') + '</div>' +
      '<div class="btn-row mt" style="justify-content:flex-end"><button class="btn sm" data-act="close-ov">' + tr('Close') + '</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov || (e.target.getAttribute && e.target.getAttribute('data-act') === 'close-ov')) ov.remove(); });
    ov.addEventListener('keydown', function (e) { if (e.key === 'Escape') ov.remove(); });
    ov.tabIndex = -1; ov.focus();
  }

  let gPressed = false;
  function handleKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

    // Cmd/Ctrl+K — search (works even while typing elsewhere)
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); searchOpen ? closeSearch() : openSearch(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === '?') { e.preventDefault(); showShortcutsHelp(); return; }
    if (e.key === 'Escape') { closeSearch(); return; }

    // g d → dashboard
    if (e.key === 'g') { gPressed = true; setTimeout(() => { gPressed = false; }, 700); return; }
    if (gPressed) {
      gPressed = false;
      const map = { d: '#/dashboard', l: '#/learn', c: '#/cards', p: '#/practice', r: '#/readiness', s: '#/settings', k: '#/reference' };
      if (map[e.key]) { e.preventDefault(); go(map[e.key]); return; }
    }

    const route = parseRoute().parts[0];

    // Quiz answering
    if (route === 'practice' && session) {
      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const opt = $all('#opts .option')[idx];
        if (opt) { e.preventDefault(); opt.click(); }
      } else if (e.key === 'Enter') {
        const b = $('#next') || $('#finish'); if (b) { e.preventDefault(); b.click(); }
      } else if (e.key === 'ArrowLeft') { const b = $('#prev'); if (b) b.click(); }
      return;
    }

    // Flashcards
    if (route === 'cards' && deck) {
      if (dPhase === 'answer') {
        if (deck.mode === 'flip' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); const c = $('#fcard'); if (c) c.click(); }
        else if (deck.mode === 'easy' && /^[1-9]$/.test(e.key)) { const opt = $all('#opts .option')[parseInt(e.key, 10) - 1]; if (opt) { e.preventDefault(); opt.click(); } }
      } else { // review phase → rating
        if (/^[1-4]$/.test(e.key)) { const b = $all('[data-grade]')[parseInt(e.key, 10) - 1]; if (b) { e.preventDefault(); b.click(); } }
      }
    }
  }

  /* ================= PROGRESS REPORT (for your manager) ================= */
  // Self-contained styles — injected on-page (CSP allows inline <style>) and
  // reused for the standalone HTML download so the file looks identical.
  const REPORT_CSS =
    ".rp-doc{background:#fff;color:#1a1a1a;max-width:840px;margin:0 auto;padding:40px 44px;border-radius:12px;box-shadow:0 12px 44px rgba(0,0,0,.28);font-family:'Montserrat',Arial,Helvetica,sans-serif;line-height:1.5}" +
    ".rp-doc *{box-sizing:border-box}" +
    ".rp-brand{display:flex;align-items:center;gap:13px;border-bottom:3px solid #7855fa;padding-bottom:16px;margin-bottom:18px}" +
    ".rp-mark{width:42px;height:42px;border-radius:10px;background:linear-gradient(135deg,#9278fb,#5615be);color:#fff;display:grid;place-items:center;font-weight:800;font-size:21px;flex:none}" +
    ".rp-title{font-size:21px;font-weight:800;margin:0;color:#131313}" +
    ".rp-sub{color:#6a6a6a;font-size:12.5px;margin:2px 0 0}" +
    ".rp-meta{display:flex;flex-wrap:wrap;gap:6px 26px;font-size:12.5px;color:#555;margin-bottom:20px}" +
    ".rp-meta b{color:#131313}" +
    ".rp-callout{background:#f3efff;border:1px solid #d9cdfb;border-left:4px solid #7855fa;border-radius:8px;padding:14px 16px;margin:0 0 22px;font-size:14.5px;color:#2a2150}" +
    ".rp-verdict{font-weight:800;display:block;margin-bottom:3px;color:#3a1e8a}" +
    ".rp-section{margin:22px 0}" +
    ".rp-section h2{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:#7855fa;margin:0 0 12px}" +
    ".rp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}" +
    ".rp-stat{border:1px solid #e4e4ea;border-radius:9px;padding:12px 14px}" +
    ".rp-n{font-size:21px;font-weight:800;color:#131313}" +
    ".rp-l{font-size:11.5px;color:#6a6a6a;margin-top:2px}" +
    ".rp-table{width:100%;border-collapse:collapse;font-size:13.5px}" +
    ".rp-table th,.rp-table td{text-align:left;padding:8px 10px;border-bottom:1px solid #eee;vertical-align:middle}" +
    ".rp-table th{color:#6a6a6a;font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.4px}" +
    ".rp-table td.rp-num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}" +
    ".rp-bar{height:8px;background:#ededf2;border-radius:99px;overflow:hidden;width:120px;display:inline-block;vertical-align:middle;margin-right:8px}" +
    ".rp-bar>span{display:block;height:100%;background:linear-gradient(90deg,#7855fa,#1fdde9)}" +
    ".rp-bar.good>span{background:#2e9e5a}.rp-bar.warn>span{background:#c98a1a}.rp-bar.bad>span{background:#cc3f37}" +
    ".rp-pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11.5px;font-weight:700}" +
    ".rp-pill.good{background:#e4f6ec;color:#1c7a45}.rp-pill.warn{background:#fbf0d8;color:#8a610a}.rp-pill.bad{background:#fbe3e0;color:#b5352d}.rp-pill.muted{background:#eee;color:#666}" +
    ".rp-foot{margin-top:26px;padding-top:14px;border-top:1px solid #eee;font-size:10.5px;color:#9a9a9a}";

  function pct1(n, d) { return d ? Math.round((n / d) * 100) : 0; }
  function rpBarCls(p) { return p >= 75 ? 'good' : p >= 55 ? 'warn' : 'bad'; }
  function rpBar(p) { return '<span class="rp-bar ' + rpBarCls(p) + '"><span style="width:' + Math.max(2, p) + '%"></span></span>'; }

  // Self-contained SVG line chart of mock scores over time (inline colors so it
  // works on-page, in the downloaded HTML, and in print).
  function rpMockChart(mocks) {
    if (!mocks.length) return '';
    const data = mocks.slice(0, 15).reverse(); // most-recent 15, oldest → newest
    const W = 720, H = 200, padL = 32, padR = 16, padT = 16, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = data.length;
    const x = (i) => padL + (n === 1 ? plotW / 2 : plotW * i / (n - 1));
    const y = (v) => padT + plotH * (1 - v / 100);
    let grid = '';
    [0, 25, 50, 75, 100].forEach((v) => {
      const gy = y(v).toFixed(1);
      grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="#eee" stroke-width="1"/>' +
        '<text x="' + (padL - 6) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end" font-size="10" fill="#9a9a9a">' + v + '</text>';
    });
    const passY = y(75).toFixed(1);
    const passLine = '<line x1="' + padL + '" y1="' + passY + '" x2="' + (W - padR) + '" y2="' + passY + '" stroke="#2e9e5a" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      '<text x="' + (W - padR) + '" y="' + (y(75) - 5).toFixed(1) + '" text-anchor="end" font-size="10" fill="#2e9e5a">' + esc(tr('pass {pct}%', { pct: 75 })) + '</text>';
    const pts = data.map((m, i) => x(i).toFixed(1) + ',' + y(m.pct).toFixed(1)).join(' ');
    const line = n >= 2 ? '<polyline points="' + pts + '" fill="none" stroke="#7855fa" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' : '';
    let dots = '';
    data.forEach((m, i) => {
      const cx = x(i).toFixed(1), cy = y(m.pct).toFixed(1);
      dots += '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="' + (m.passed ? '#2e9e5a' : '#e14e35') + '"/>' +
        '<text x="' + cx + '" y="' + (y(m.pct) - 9).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="700" fill="#444">' + m.pct + '%</text>';
    });
    const dlabel = (i, anchor) => { const dt = new Date(data[i].date); return '<text x="' + x(i).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="' + anchor + '" font-size="10" fill="#9a9a9a">' + (dt.getMonth() + 1) + '/' + dt.getDate() + '</text>'; };
    let xlabels = dlabel(0, n === 1 ? 'middle' : 'start');
    if (n > 1) xlabels += dlabel(n - 1, 'end');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(tr('Mock exam scores over time')) + '" style="display:block;max-width:100%;margin:0 0 14px;font-family:inherit">' +
      grid + passLine + line + dots + xlabels + '</svg>';
  }

  function gatherReportData() {
    const r = Readiness.compute();
    const cd = StudyPlan.countdown();
    const plan = StudyPlan.build();
    const hist = Progress.history();
    const mocks = hist.filter((h) => h && h.mode === 'mock')
      .map((h) => Object.assign({}, h, { pct: Number(h.pct) || 0, passed: !!h.passed }));
    const bestMock = mocks.reduce((m, h) => Math.max(m, h.pct), 0);
    const stats = Progress.stats();
    let ans = 0, cor = 0;
    Object.keys(stats).forEach((k) => { ans += stats[k].answered || 0; cor += stats[k].correct || 0; });
    const fc = Flashcards.stats(null);
    const st = Progress.streak();
    const s = Settings.get();
    const today = new Date();
    return {
      r, cd, plan, mocks, bestMock,
      answered: ans, practiceAcc: pct1(cor, ans),
      fc, streak: st,
      name: (s.reportName || '').trim(),
      booked: s.examBookedDate || null,
      level: StudyPlan.approach().label,
      dateStr: today.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      narrative: reportNarrative(r, cd.days),
    };
  }

  function reportNarrative(r, days) {
    if (r.totalAnswered < 20) {
      return { verdict: tr('Getting started'), text: tr('Baseline assessment is in progress. A reliable readiness estimate will firm up after the diagnostic and a bit more practice.') };
    }
    const margin = r.predictedScore - r.passPct;
    const verdict = r.likelihood === 'High' ? tr('On track to pass')
      : r.likelihood === 'Moderate' ? tr('On pace')
      : r.likelihood === 'Building' ? tr('Building toward readiness')
      : tr('Early progress');
    const marginText = margin >= 0
      ? tr('{n} points above the line', { n: margin })
      : tr('{n} points below the line', { n: Math.abs(margin) });
    const text = tr('Current readiness is {readiness}% with a predicted exam score of ~{predicted}% against a {pass}% pass mark — {margin}, with {days} days before the deadline.',
      { readiness: r.readiness, predicted: r.predictedScore, pass: r.passPct, margin: marginText, days: days });
    return { verdict, text };
  }

  function buildReportDoc(d) {
    const stat = (n, l) => '<div class="rp-stat"><div class="rp-n">' + n + '</div><div class="rp-l">' + l + '</div></div>';
    const likeCls = d.r.likelihoodClass === 'good' ? 'good' : d.r.likelihoodClass === 'bad' ? 'bad' : d.r.likelihoodClass === 'warn' ? 'warn' : 'muted';
    const assessed = d.r.totalAnswered >= 20;

    const domainRows = d.r.perDomain.map((dm) => {
      const has = dm.answered > 0;
      return '<tr><td>' + esc(dm.name) + '</td><td class="rp-num">' + dm.weight + '%</td>' +
        '<td>' + (has ? rpBar(dm.masteryPct) + dm.masteryPct + '%' : '<span class="rp-pill muted">' + tr('not started') + '</span>') + '</td>' +
        '<td class="rp-num">' + dm.answered + '</td></tr>';
    }).join('');

    const mockRows = d.mocks.slice(0, 6).map((m) => {
      const dt = new Date(m.date);
      return '<tr><td>' + dt.toLocaleDateString() + '</td><td class="rp-num">' + m.pct + '%</td>' +
        '<td><span class="rp-pill ' + (m.passed ? 'good' : 'warn') + '">' + (m.passed ? tr('Pass') : tr('Below pass')) + '</span></td></tr>';
    }).join('');

    return '<div class="rp-doc" id="rp-doc">' +
      '<div class="rp-brand"><div class="rp-mark">K</div><div><h1 class="rp-title">' + tr('KCNA Certification — Progress Report') + '</h1>' +
        '<p class="rp-sub">Kubernetes &amp; Cloud Native Associate · ' + tr('prepared with KCNA Prep') + '</p></div></div>' +
      '<div class="rp-meta">' +
        '<span>' + tr('Prepared by {name}', { name: '<b id="rp-prepared">' + (d.name ? esc(d.name) : '—') + '</b>' }) + '</span>' +
        '<span>' + tr('Generated {date}', { date: '<b>' + esc(d.dateStr) + '</b>' }) + '</span>' +
        '<span>' + tr('Target <b>pass by {date}</b>', { date: esc(d.cd.examLabel) }) + '</span>' +
        '<span>' + tr('{days} days remaining', { days: '<b>' + d.cd.days + '</b>' }) + '</span>' +
        '<span>' + tr('Exam {status}', { status: '<b id="rp-booked-val">' + (d.booked ? tr('scheduled for {date}', { date: esc(d.booked) }) : tr('not yet scheduled')) + '</b>' }) + '</span>' +
      '</div>' +
      '<div class="rp-callout"><span class="rp-verdict">' + esc(d.narrative.verdict) + '</span>' + esc(d.narrative.text) + '</div>' +

      '<div class="rp-section"><h2>' + tr('Readiness') + '</h2><div class="rp-grid">' +
        stat(d.r.readiness + '%', tr('Overall readiness')) +
        stat(assessed ? '~' + d.r.predictedScore + '%' : '—', tr('Predicted exam score')) +
        stat('<span class="rp-pill ' + likeCls + '">' + esc(tr(d.r.likelihood)) + '</span>', tr('Pass likelihood')) +
        stat(esc(tr(d.level)), tr('Study track')) +
      '</div></div>' +

      '<div class="rp-section"><h2>' + tr('Study activity') + '</h2><div class="rp-grid">' +
        stat(d.answered, tr('Questions answered')) +
        stat(d.answered ? d.practiceAcc + '%' : '—', tr('Practice accuracy')) +
        stat(d.bestMock ? d.bestMock + '%' : '—', tr('Best mock score')) +
        stat(d.mocks.length, tr('Mock exams taken')) +
        stat(d.fc.mastered + ' / ' + d.fc.total, tr('Flashcards mastered')) +
        stat(tr('{n} days', { n: d.streak.current }), tr('Current study streak')) +
        stat(d.plan.doneTasks + ' / ' + d.plan.totalTasks, tr('Study-plan tasks done')) +
      '</div></div>' +

      '<div class="rp-section"><h2>' + tr('Domain mastery (by exam weight)') + '</h2><table class="rp-table">' +
        '<thead><tr><th>' + tr('Domain') + '</th><th class="rp-num">' + tr('Weight') + '</th><th>' + tr('Mastery') + '</th><th class="rp-num">' + tr('Answered') + '</th></tr></thead>' +
        '<tbody>' + domainRows + '</tbody></table></div>' +

      (d.mocks.length ? '<div class="rp-section"><h2>' + tr('Mock exam scores over time') + '</h2>' + rpMockChart(d.mocks) +
        '<table class="rp-table"><thead><tr><th>' + tr('Date') + '</th><th class="rp-num">' + tr('Score') + '</th><th>' + tr('Result') + '</th></tr></thead><tbody>' + mockRows + '</tbody></table></div>' : '') +

      '<div class="rp-foot">' + tr('Generated by KCNA Prep — an independent study app. Progress reflects in-app practice and is self-reported; it is not affiliated with or endorsed by the CNCF, the Linux Foundation, or Nutanix.') + '</div>' +
      '</div>';
  }

  function buildReportText(d) {
    const lines = [];
    lines.push(tr('KCNA Certification — Progress Report') + (d.name ? ' — ' + d.name : ''));
    lines.push(tr('Generated {date}', { date: d.dateStr }));
    lines.push(tr('Target: pass by {date} ({days} days remaining)', { date: d.cd.examLabel, days: d.cd.days }));
    lines.push(tr('Exam: {status}', { status: d.booked ? tr('scheduled for {date}', { date: d.booked }) : tr('not yet scheduled') }));
    lines.push('');
    lines.push(d.narrative.verdict + '. ' + d.narrative.text);
    lines.push('');
    lines.push(tr('Readiness: {readiness}%  |  Predicted score: {predicted}  |  Pass likelihood: {likelihood}', { readiness: d.r.readiness, predicted: (d.r.totalAnswered >= 20 ? '~' + d.r.predictedScore + '%' : tr('n/a')), likelihood: tr(d.r.likelihood) }));
    lines.push(tr('Questions answered: {n}', { n: d.answered }) + (d.answered ? ' ' + tr('({pct}% correct)', { pct: d.practiceAcc }) : ''));
    lines.push(tr('Best mock score: {score} across {n} mock exams', { score: (d.bestMock ? d.bestMock + '%' : tr('n/a')), n: d.mocks.length }));
    lines.push(tr('Flashcards mastered: {mastered} / {total}  |  Study streak: {days} days', { mastered: d.fc.mastered, total: d.fc.total, days: d.streak.current }));
    lines.push(tr('Study plan: {done} / {total} tasks done', { done: d.plan.doneTasks, total: d.plan.totalTasks }));
    lines.push('');
    lines.push(tr('Domain mastery (by exam weight):'));
    d.r.perDomain.forEach((dm) => {
      lines.push('  - ' + dm.name + ' (' + dm.weight + '%): ' + (dm.answered ? dm.masteryPct + '%' : tr('not started')));
    });
    return lines.join('\n');
  }

  function buildStandaloneHtml(d) {
    const lc = window.I18n ? I18n.active() : 'en';
    const dir = window.I18n ? I18n.dirFor(lc) : 'ltr';
    return '<!DOCTYPE html><html lang="' + lc + '" dir="' + dir + '"><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri \'none\'; form-action \'none\'">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(tr('KCNA Progress Report')) + (d.name ? ' — ' + esc(d.name) : '') + '</title>' +
      '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">' +
      '<style>body{margin:0;background:#eceef3;padding:24px}' + REPORT_CSS +
      '@media print{body{background:#fff;padding:0}.rp-doc{box-shadow:none;border-radius:0;max-width:none}}</style></head>' +
      '<body>' + buildReportDoc(d) + '</body></html>';
  }

  function reportFilename(name) {
    const who = (name || 'You').replace(/[^\w \-]/g, '').trim() || 'You';
    const stamp = new Date().toISOString().slice(0, 10);
    return 'KCNA Progress Report - ' + who + ' - ' + stamp + '.html';
  }
  function rpMsg(text) { const el = $('#rp-msg'); if (el) el.innerHTML = '<span class="pill good">' + esc(text) + '</span>'; }

  function refreshReportDoc() {
    const cur = document.getElementById('rp-doc');
    if (cur) cur.outerHTML = buildReportDoc(gatherReportData());
  }

  function viewReport() {
    if (!KCNA.ready()) return render(notReady());
    const d = gatherReportData();
    render('<div class="page-head no-print"><h1>' + tr('Progress report') + '</h1><p>' + tr('A clean summary for your manager — print it, download it to email, or copy a text version.') + '</p></div>' +
      '<style>' + REPORT_CSS + '</style>' +
      '<div class="card rp-controls no-print"><div class="rp-fields">' +
        '<label class="rp-field"><span>' + tr('Prepared by') + '</span><input id="rp-name" class="fc-input" placeholder="' + esc(tr('Your name')) + '" autocomplete="name" value="' + esc(d.name) + '"></label>' +
        '<label class="rp-field"><span>' + tr('Exam scheduled for (optional)') + '</span><input id="rp-booked" type="date" class="fc-input" value="' + esc(d.booked || '') + '"></label>' +
      '</div>' +
      '<div class="btn-row mt"><button class="btn primary" id="rp-print">🖨️ ' + tr('Print / Save as PDF') + '</button>' +
        '<button class="btn" id="rp-download">⬇️ ' + tr('Download (.html)') + '</button>' +
        '<button class="btn" id="rp-copy">📋 ' + tr('Copy summary') + '</button></div>' +
      '<div id="rp-msg" class="mt" aria-live="polite"></div></div>' +
      buildReportDoc(d));

    let rpNameT;
    $('#rp-name').addEventListener('input', function () {
      const v = this.value;
      clearTimeout(rpNameT);
      rpNameT = setTimeout(function () { Settings.set({ reportName: v }); refreshReportDoc(); }, 250);
    });
    $('#rp-booked').addEventListener('change', function () { Settings.set({ examBookedDate: this.value || null }); refreshReportDoc(); });
    $('#rp-print').addEventListener('click', function () { window.print(); });
    $('#rp-download').addEventListener('click', function () {
      const data = gatherReportData();
      const blob = new Blob([buildStandaloneHtml(data)], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = reportFilename(data.name);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      rpMsg(tr('Report downloaded.'));
    });
    $('#rp-copy').addEventListener('click', function () {
      const text = buildReportText(gatherReportData());
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { rpMsg(tr('Summary copied to clipboard.')); },
          function () { rpMsg(tr('Copy failed — select the downloaded file instead.')); });
      } else { rpMsg(tr('Clipboard not available — use Download instead.')); }
    });
  }

  /* ================= ROUTER ================= */
  /* ================= ABOUT / README / CONTRIBUTORS / CHANGELOG (in-app) ================= */
  const REPO_URL = 'https://github.com/seanyfresh/kcna-prep';

  function viewAbout() {
    const v = (window.KCNA && KCNA.meta && KCNA.meta.version) || '';
    render('<div class="page-head"><h1>' + tr('About KCNA Prep') + '</h1><p>' + tr('A free, offline-capable study app for the Kubernetes & Cloud Native Associate exam.') + '</p></div>' +
      '<div class="card prose">' +
        '<p>' + tr('KCNA Prep bundles exam-focused study notes, spaced-repetition flashcards, weighted practice and mock exams, an honest readiness model, a searchable knowledge base, and a deadline-aware study plan — all running entirely in your browser. Your progress is stored only on this device.') + '</p>' +
        '<p>' + tr('It is an independent, open-source project, and is not affiliated with or endorsed by the CNCF, the Linux Foundation, or Nutanix.') + '</p>' +
      '</div>' +
      '<div class="card mt"><div class="btn-row">' +
        '<a class="btn" href="#/readme">📖 README</a>' +
        '<a class="btn" href="#/changelog">🗒️ ' + tr('Changelog') + '</a>' +
        '<a class="btn" href="#/contributors">👥 ' + tr('Contributors') + '</a>' +
        '<a class="btn ghost" href="' + REPO_URL + '" target="_blank" rel="noopener noreferrer">' + tr('View source on GitHub ↗') + '</a>' +
      '</div>' + (v ? '<p class="muted mt" style="font-size:13px;margin-bottom:0">' + tr('Version {v}', { v: esc(v) }) + '</p>' : '') + '</div>');
  }

  // Names, roles, companies and bios are biographical content and stay in the
  // contributor's own language (English); the page chrome around them is localized.
  const CONTRIBUTORS = [
    {
      name: 'Sean Keenan', role: 'Systems Engineering Manager', company: 'Nutanix',
      linkedin: 'https://www.linkedin.com/in/seanyfresh/',
      bio: 'Sean came up keeping mission-critical systems running in the Air National Guard, then spent years designing and operating hyper-converged infrastructure before moving into leadership. Today he leads a systems engineering team at Nutanix, where the job is less about being at the keyboard and more about clearing the path for the people who are. He built and maintains KCNA Prep.',
    },
    {
      name: 'Michael Gaspard', role: 'Sr Presales Systems Engineer', company: 'Nutanix',
      linkedin: 'https://www.linkedin.com/in/michael-gaspard/',
      bio: 'Michael is a Senior Presales Systems Engineer at Nutanix. With over 20 years in enterprise IT — spanning roles as CTO, IT Director, Enterprise Architect, and Principal Solutions Architect — he brings a full-stack perspective, having lived the infrastructure problem from every angle. His core expertise spans virtualization platform migration, large-scale datacenter transformation, and infrastructure modernization, and he is a Nutanix Certified Professional (NCP-MCI 6). On KCNA Prep, Michael prompted the CSRF / SSRF / XSS security review that hardened the app.',
    },
    {
      name: 'Ross Davies', role: 'Advisory Systems Engineer', company: 'Nutanix',
      linkedin: 'https://www.linkedin.com/in/grdavies/',
      bio: 'Ross is an Advisory Systems Engineer at Nutanix in Phoenix, Arizona, with deep experience across virtualization, storage, and cloud infrastructure and a particular focus on the Nutanix Kubernetes Platform, which he actively champions with customers. On KCNA Prep, his product instincts shaped the experience: he proposed surfacing the difficulty level in the top bar and dropping the unused Offline pill, after breezing through a session and noting it was too easy.',
    },
  ];
  const LINKEDIN_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
    '<rect width="24" height="24" rx="4" fill="#0a66c2"/>' +
    '<path fill="#fff" d="M8.34 18.34V9.6H5.45v8.74h2.89zM6.9 8.4a1.68 1.68 0 1 0 0-3.36 1.68 1.68 0 0 0 0 3.36zm11.44 9.94v-4.79c0-2.56-1.37-3.75-3.19-3.75a2.76 2.76 0 0 0-2.5 1.37h-.04V9.6H9.72c.04.82 0 8.74 0 8.74h2.89v-4.87c0-.26.02-.52.09-.7.21-.51.68-1.05 1.48-1.05 1.05 0 1.47.8 1.47 1.97v4.65h2.89z"/></svg>';

  function viewContributors() {
    const cards = CONTRIBUTORS.map(function (c) {
      const initial = esc((c.name.trim().charAt(0) || '?').toUpperCase());
      const roleLine = esc(c.role) + (c.company ? ' · ' + esc(c.company) : '');
      const nameHtml = c.linkedin
        ? '<a class="contrib-name-link" href="' + esc(safeUrl(c.linkedin)) + '" target="_blank" rel="noopener noreferrer">' + esc(c.name) + '</a>'
        : esc(c.name);
      const badge = c.linkedin
        ? '<a class="contrib-li" href="' + esc(safeUrl(c.linkedin)) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(c.name) + ' ' + esc(tr('on LinkedIn')) + '">' + LINKEDIN_SVG + '</a>'
        : '';
      return '<div class="contrib-card">' +
        '<div class="contrib-head">' +
          '<div class="contrib-avatar" aria-hidden="true">' + initial + '</div>' +
          '<div class="contrib-id"><div class="contrib-name">' + nameHtml + '</div>' +
          '<div class="contrib-role">' + roleLine + '</div></div>' +
          badge +
        '</div>' +
        '<p class="contrib-bio">' + esc(c.bio) + '</p>' +
        '</div>';
    }).join('');
    render('<div class="page-head"><h1>' + tr('Contributors') + '</h1><p>' + tr('KCNA Prep is built in the open. Thanks to everyone who has helped make it better.') + '</p></div>' +
      '<div class="contrib-list">' + cards + '</div>' +
      '<div class="card mt"><p class="muted" style="font-size:13px;margin:0">' + tr('See the full commit history on {link}.', { link: '<a href="' + REPO_URL + '/graphs/contributors" target="_blank" rel="noopener noreferrer">' + tr('GitHub ↗') + '</a>' }) + '</p></div>');
  }

  /* ---- minimal, escape-first Markdown renderer for the bundled .md files ---- */
  function mdInline(raw) {
    const codes = [], Z = String.fromCharCode(0);
    let s = String(raw).replace(/`([^`]+)`/g, function (m, c) { codes.push(c); return Z + (codes.length - 1) + Z; });
    s = esc(s);
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');                       // drop images (badges are external / CSP-blocked)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, function (m, txt, url) {
      return '<a href="' + esc(safeUrl(url)) + '"' + (/^https?:/i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + txt + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
         .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
         .replace(/(^|[^\w*])_([^_\s][^_]*?)_(?=[^\w*]|$)/g, '$1<em>$2</em>');  // _emphasis_ (intraword-safe)
    s = s.replace(new RegExp(Z + '(\\d+)' + Z, 'g'), function (m, i) { return '<code>' + esc(codes[+i]) + '</code>'; });
    return s;
  }
  function mdToHtml(src) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const N = lines.length;
    const rawHtml = /^\s*<\/?(div|img|p|br|center|span|a|picture|source|table|tr|td|th|h[1-6])\b[^>]*>\s*$/i;
    const badgeOnly = /^\s*\[?!\[[^\]]*\]\([^)]*\)\]?(\([^)]*\))?\s*$/;
    const ulRe = /^\s*[-*]\s+(.*)$/, olRe = /^\s*\d+\.\s+(.*)$/;
    const blank = function (l) { return /^\s*$/.test(l); };
    // A line that begins a new block ends the current paragraph/list-item, so we
    // know where to stop gathering soft-wrapped (hard-wrapped) continuation lines.
    const startsBlock = function (l) {
      return blank(l) || /^\s*```/.test(l) || /^\s*#{1,6}\s+/.test(l) ||
        /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) || /^\s*>\s?/.test(l) ||
        ulRe.test(l) || olRe.test(l) || /^\s*\|.*\|\s*$/.test(l) ||
        rawHtml.test(l) || badgeOnly.test(l);
    };
    let html = '', i = 0;
    while (i < N) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {                                     // fenced code block
        i++; const code = [];
        while (i < N && !/^\s*```/.test(lines[i])) { code.push(esc(lines[i])); i++; }
        i++; html += '<pre><code>' + code.join('\n') + '</code></pre>'; continue;
      }
      if (rawHtml.test(line) || badgeOnly.test(line) || blank(line)) { i++; continue; } // strip / skip
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < N && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
        const parseRow = function (l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
        const head = parseRow(line); i += 2; let body = '';
        while (i < N && /^\s*\|.*\|\s*$/.test(lines[i])) {
          body += '<tr>' + parseRow(lines[i]).map(function (c) { return '<td>' + mdInline(c) + '</td>'; }).join('') + '</tr>'; i++;
        }
        html += '<div class="prose-table-wrap"><table class="prose-table"><thead><tr>' +
          head.map(function (c) { return '<th>' + mdInline(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>';
        continue;
      }
      let m;
      if ((m = line.match(/^\s*(#{1,6})\s+(.*)$/))) { const lv = Math.min(m[1].length, 4); html += '<h' + lv + '>' + mdInline(m[2]) + '</h' + lv + '>'; i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { html += '<hr>'; i++; continue; }
      if (/^\s*>\s?/.test(line)) {                                    // blockquote (gather lines)
        const q = [];
        while (i < N && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        html += '<blockquote>' + mdInline(q.join(' ')) + '</blockquote>'; continue;
      }
      if (ulRe.test(line) || olRe.test(line)) {                       // list (gather items + soft-wrapped continuations)
        const ordered = olRe.test(line), re = ordered ? olRe : ulRe;
        let items = '', ml;
        while (i < N && (ml = lines[i].match(re))) {
          let text = ml[1]; i++;
          while (i < N && !startsBlock(lines[i])) { text += ' ' + lines[i].trim(); i++; }
          items += '<li>' + mdInline(text) + '</li>';
        }
        html += '<' + (ordered ? 'ol' : 'ul') + '>' + items + '</' + (ordered ? 'ol' : 'ul') + '>'; continue;
      }
      const para = [line]; i++;                                       // paragraph (gather soft-wrapped lines)
      while (i < N && !startsBlock(lines[i])) { para.push(lines[i]); i++; }
      html += '<p>' + mdInline(para.join(' ')) + '</p>';
    }
    return html;
  }

  let mdReq = 0;
  function viewMarkdown(title, sub, file, ghUrl) {
    const token = ++mdReq;
    render('<div class="page-head"><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p></div>' +
      '<div class="card"><div id="md-body" class="prose"><p class="muted">' + tr('Loading…') + '</p></div>' +
      '<p class="muted mt" style="font-size:13px;margin-bottom:0">' + tr('View the original on {link}.', { link: '<a href="' + esc(ghUrl) + '" target="_blank" rel="noopener noreferrer">' + tr('GitHub ↗') + '</a>' }) + '</p></div>');
    fetch(file).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (text) { if (token !== mdReq) return; const el = document.getElementById('md-body'); if (el) el.innerHTML = mdToHtml(text); })
      .catch(function () { if (token !== mdReq) return; const el = document.getElementById('md-body'); if (el) el.innerHTML = '<p class="muted">' + tr('This needs a connection to load. {link}', { link: '<a href="' + esc(ghUrl) + '" target="_blank" rel="noopener noreferrer">' + tr('Open it on GitHub ↗') + '</a>' }) + '</p>'; });
  }
  function viewReadme() { viewMarkdown('README', tr('About this project, straight from the repository.'), 'README.md', REPO_URL + '/blob/main/README.md'); }
  function viewChangelog() { viewMarkdown(tr('Changelog'), tr('Every notable change, newest first.'), 'CHANGELOG.md', REPO_URL + '/blob/main/CHANGELOG.md'); }

  const ROUTE_TITLES = {
    dashboard: 'Dashboard', learn: 'Learn', note: 'Study note', cards: 'Flashcards',
    practice: 'Practice', readiness: 'Readiness', plan: 'Study plan',
    reference: 'Reference & knowledge base', settings: 'Settings', report: 'Progress report',
    about: 'About', readme: 'README', contributors: 'Contributors', changelog: 'Changelog',
  };

  function route() {
    // Leaving a view: stop any running mock timer so it can't grade a stale session.
    if (sTimer) { clearInterval(sTimer); sTimer = null; }
    const r = parseRoute();
    updateChrome();
    const top = r.parts[0] || 'dashboard';
    if (top !== 'practice') session = null;
    if (top !== 'cards') deck = null;
    setNav(['learn', 'note'].indexOf(top) >= 0 ? 'learn' : top);
    switch (top) {
      case 'dashboard': viewDashboard(); break;
      case 'learn': r.parts[1] ? viewLearnDomain(r.parts[1]) : viewLearn(); break;
      case 'note': viewNote(r.parts[1], r.parts[2]); break;
      case 'cards': viewCards(r.params); break;
      case 'practice': viewPractice(r.params); break;
      case 'readiness': viewReadiness(); break;
      case 'plan': viewPlan(); break;
      case 'reference': viewReference(r.params); break;
      case 'settings': viewSettings(); break;
      case 'report': viewReport(); break;
      case 'about': viewAbout(); break;
      case 'readme': viewReadme(); break;
      case 'contributors': viewContributors(); break;
      case 'changelog': viewChangelog(); break;
      default: viewDashboard();
    }
    // Move focus to main and announce the route for assistive tech.
    try { appEl.focus({ preventScroll: true }); } catch (e) { appEl.focus(); }
    announce(tr('{page} loaded', { page: tr(ROUTE_TITLES[top] || 'Page') }));
  }

  function toggleNav(open) {
    const nav = $('#mainnav'), btn = $('#nav-toggle');
    const isOpen = open == null ? !nav.classList.contains('open') : open;
    nav.classList.toggle('open', isOpen);
    if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  window.addEventListener('hashchange', route);
  $('#nav-toggle').addEventListener('click', () => toggleNav());
  $('#search-btn').addEventListener('click', openSearch);
  $('#session-btn').addEventListener('click', toggleSessionMenu);
  $('#level-btn').addEventListener('click', toggleLevelMenu);
  const langBtn = $('#lang-btn'); if (langBtn) langBtn.addEventListener('click', toggleLangMenu);
  appEl.addEventListener('click', function (e) {
    const t = e.target.closest && e.target.closest('[data-act="reload"]');
    if (t) location.reload();
  });
  document.addEventListener('keydown', handleKey);
  if (window.Settings) Settings.apply();
  updateChrome();
  route();
  syncContentLang();
})();
