(() => {
  const appEl = document.getElementById('app');
  const lightbox = document.getElementById('lightbox');
  const lightboxImage = document.getElementById('lightbox-image');

  const state = {
    view: 'home',
    items: [],
    itemsRaw: '[]',
    bankHash: '',
    history: [],
    info: null,
    error: null,
    session: null,
    exam: null,
    editor: { search: '', selectedId: null },
    autoSnapshot: true,
    lastSummary: null,
    keyboardEnabled: true
  };

  const letters = ['A', 'B', 'C', 'D', 'E'];

  const qb = (() => {
    let counter = 0;
    const pending = new Map();

    function send(action, payload = {}) {
      const id = 'js-' + (++counter);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.webkit?.messageHandlers?.qbBridge?.postMessage({ id, action, payload });
      });
    }

    window.qbBridge = window.qbBridge || {};
    window.qbBridge.onNativeMessage = function (message) {
      if (!message) return;
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.success) {
          resolve(message.payload);
        } else {
          reject(message.error || 'Unknown bridge error');
        }
      } else if (!message.id && message.success && message.payload?.type === 'autosnapshot') {
        showToast('Auto-snapshot saved: ' + (message.payload.files || []).join(', '));
      }
    };

    return {
      ensureDataDirs: () => send('ensureDataDirs', {}),
      readTextFile: (path) => send('readTextFile', { path }),
      writeTextFile: (path, content) => send('writeTextFile', { path, content }),
      appendHistory: (record) => send('appendHistory', { record }),
      listMedia: (kind) => send('listMedia', { kind }),
      copyImages: () => send('copyIntoMedia', { kind: 'images' }),
      copyAudio: () => send('copyIntoMedia', { kind: 'audio' }),
      exportFile: (suggestedName, content) => send('exportFile', { suggestedName, content }),
      importFile: (accept) => send('importFile', { accept }),
      snapshotNow: () => send('snapshotNow', {}),
      getAppInfo: () => send('getAppInfo', {}),
      setAutoSnapshots: (enabled) => send('setAutoSnapshots', { enabled })
    };
  })();

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'card';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.zIndex = '1001';
    toast.style.maxWidth = '320px';
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 4000);
  }

  async function loadApp() {
    try {
      const info = await qb.ensureDataDirs();
      state.info = info;
      state.autoSnapshot = info.autoSnapshots !== false;
      const itemsResponse = await qb.readTextFile('items.json');
      state.itemsRaw = itemsResponse.content || '[]';
      state.items = JSON.parse(state.itemsRaw);
      state.bankHash = window.sha256(state.itemsRaw);
      const historyResponse = await qb.readTextFile('history.json');
      state.history = JSON.parse(historyResponse.content || '[]');
      state.lastSummary = state.history.length ? state.history[state.history.length - 1].summary : null;
    } catch (err) {
      state.error = 'Failed to load data: ' + err;
    }
    render();
  }

  function setView(view) {
    state.view = view;
    if (view !== 'practice') state.session = null;
    if (view !== 'exam') state.exam = null;
    render();
  }

  function render() {
    if (state.error) {
      appEl.innerHTML = `<div class="alert">${escapeHtml(state.error)}</div>`;
      return;
    }
    let content = '';
    content += renderNavbar();
    switch (state.view) {
      case 'home':
        content += renderHome();
        break;
      case 'practice':
        content += renderPractice();
        break;
      case 'exam':
        content += renderExam();
        break;
      case 'editor':
        content += renderEditor();
        break;
      case 'import':
        content += renderImportExport();
        break;
      case 'settings':
        content += renderSettings();
        break;
      default:
        content += '<p>Unknown view</p>';
    }
    appEl.innerHTML = content;
    attachHandlers();
  }

  function renderNavbar() {
    return `
      <div class="navbar">
        <button class="primary" data-action="nav" data-view="home">Home</button>
        <button data-action="nav" data-view="practice">Practice</button>
        <button data-action="nav" data-view="exam">Exam</button>
        <button data-action="nav" data-view="editor">Editor</button>
        <button data-action="nav" data-view="import">Import / Export</button>
        <button data-action="nav" data-view="settings">Settings</button>
      </div>
    `;
  }

  function renderHome() {
    const count = state.items.length;
    const last = state.lastSummary;
    return `
      <div class="card">
        <h1>QBankLite</h1>
        <p>Bank size: <strong>${count}</strong> items.</p>
        ${last ? `<p>Last session: ${last.correct}/${last.total} correct (${last.percent}%).</p>` : '<p>No sessions yet.</p>'}
        <div class="toolbar">
          <button class="primary" data-action="start-practice">Start Practice</button>
          <button data-action="start-exam">Start Exam</button>
        </div>
      </div>
      <div class="card">
        <h2>Data folder</h2>
        <p>${escapeHtml(state.info?.dataPath || '')}</p>
      </div>
    `;
  }

  function renderPractice() {
    if (!state.session) {
      return `
        <div class="card">
          <h2>Practice Session</h2>
          <p>Randomized order, instant feedback.</p>
          <button class="primary" data-action="begin-practice">Begin</button>
        </div>
      `;
    }
    const session = state.session;
    const currentId = session.order[session.index];
    const item = state.items.find(it => it.id === currentId);
    if (!item) {
      return '<div class="card"><p>Question missing.</p></div>';
    }
    const response = session.responses[currentId] || { selected: null, revealed: false, confidence: 1, reviewed: false };
    const choices = item.choices.map((choice, idx) => {
      const letter = letters[idx];
      const isSelected = response.selected === letter;
      let classes = 'choice';
      if (isSelected) classes += ' selected';
      if (response.revealed) {
        if (letter === item.answer_key) classes += ' correct';
        else if (isSelected) classes += ' incorrect';
      }
      return `
        <div class="${classes}" data-action="select-choice" data-letter="${letter}">
          <div class="choice-label">${letter}</div>
          <div>${escapeHtml(choice)}</div>
        </div>
      `;
    }).join('');

    const status = response.revealed
      ? `<p class="${response.selected === item.answer_key ? 'badge success' : 'badge danger'}">${response.selected === item.answer_key ? 'Correct' : 'Incorrect'}</p>`
      : '';

    return `
      <div class="card">
        <div class="flex-between">
          <h2>Practice (${session.index + 1}/${session.order.length})</h2>
          <div>
            <span class="badge">Confidence: ${response.confidence}</span>
            ${response.reviewed ? '<span class="badge warning">Marked for review</span>' : ''}
          </div>
        </div>
        <p>${escapeHtml(item.stem)}</p>
        ${item.image ? `<div class="space-top"><img src="qb://media/images/${encodeURIComponent(item.image)}" alt="Question image" class="practice-image" data-action="open-image" data-src="qb://media/images/${encodeURIComponent(item.image)}" style="max-width:100%;border-radius:12px;cursor:zoom-in;"></div>` : ''}
        ${item.audio ? `<div class="space-top"><audio controls src="qb://media/audio/${encodeURIComponent(item.audio)}"></audio></div>` : ''}
        <div class="space-top">${choices}</div>
        <div class="space-top toolbar">
          <button class="primary" data-action="reveal" ${response.revealed ? 'disabled' : ''}>Reveal</button>
          <button data-action="prev">Prev (K)</button>
          <button data-action="next">Next (J)</button>
          <button data-action="toggle-review">Toggle Review (R)</button>
          <button data-action="cycle-confidence">Confidence (C)</button>
          <button data-action="end-session">End Session</button>
        </div>
        ${status}
        ${response.revealed ? `<div class="card" style="margin-top:16px;"><h3>Explanation</h3><p>${escapeHtml(item.explanation || 'No explanation provided.')}</p></div>` : ''}
      </div>
    `;
  }

  function renderExam() {
    if (!state.exam) {
      const count = Math.min(25, state.items.length);
      return `
        <div class="card">
          <h2>Exam Mode</h2>
          <p>You will receive ${count} questions, no feedback until submission.</p>
          <button class="primary" data-action="begin-exam">Begin Exam</button>
        </div>
      `;
    }
    const exam = state.exam;
    if (exam.submitted) {
      return renderExamSummary();
    }
    const currentId = exam.order[exam.index];
    const item = state.items.find(it => it.id === currentId);
    const response = exam.responses[currentId] || { selected: null, confidence: 1, reviewed: false };
    const choices = item.choices.map((choice, idx) => {
      const letter = letters[idx];
      const isSelected = response.selected === letter;
      return `
        <div class="choice${isSelected ? ' selected' : ''}" data-action="exam-select" data-letter="${letter}">
          <div class="choice-label">${letter}</div>
          <div>${escapeHtml(choice)}</div>
        </div>
      `;
    }).join('');
    return `
      <div class="card">
        <div class="flex-between">
          <h2>Exam (${exam.index + 1}/${exam.order.length})</h2>
          <div>
            <span class="badge">Confidence: ${response.confidence}</span>
            ${response.reviewed ? '<span class="badge warning">Marked</span>' : ''}
          </div>
        </div>
        <p>${escapeHtml(item.stem)}</p>
        ${item.image ? `<div class="space-top"><img src="qb://media/images/${encodeURIComponent(item.image)}" alt="Question image" class="practice-image" data-action="open-image" data-src="qb://media/images/${encodeURIComponent(item.image)}" style="max-width:100%;border-radius:12px;cursor:zoom-in;"></div>` : ''}
        ${item.audio ? `<div class="space-top"><audio controls src="qb://media/audio/${encodeURIComponent(item.audio)}"></audio></div>` : ''}
        <div class="space-top">${choices}</div>
        <div class="space-top toolbar">
          <button data-action="exam-prev">Prev (K)</button>
          <button data-action="exam-next">Next (J)</button>
          <button data-action="exam-toggle-review">Toggle Review (R)</button>
          <button data-action="exam-cycle-confidence">Confidence (C)</button>
          <button class="primary" data-action="submit-exam">Submit Exam (Enter)</button>
        </div>
      </div>
    `;
  }

  function renderExamSummary() {
    const exam = state.exam;
    const summary = exam.summary;
    const misses = summary.misses.map(record => {
      const item = state.items.find(it => it.id === record.id);
      if (!item) return '';
      return `
        <div class="card" data-action="review-miss" data-id="${record.id}">
          <h3>${escapeHtml(item.stem)}</h3>
          <p>Correct answer: <strong>${item.answer_key}</strong></p>
          <p>Your answer: <strong>${record.selected || '—'}</strong></p>
          <p>${escapeHtml(item.explanation || '')}</p>
        </div>
      `;
    }).join('');
    return `
      <div class="card">
        <h2>Exam Summary</h2>
        <p>${summary.correct}/${summary.total} correct (${summary.percent}%).</p>
        <button class="primary" data-action="nav" data-view="home">Back to Home</button>
      </div>
      <div>${misses || '<p>No incorrect answers!</p>'}</div>
    `;
  }

  function renderEditor() {
    const list = state.items
      .filter(item => item.stem.toLowerCase().includes(state.editor.search.toLowerCase()))
      .map(item => `
        <div class="card" data-action="select-item" data-id="${item.id}" style="cursor:pointer;">
          <h3>${escapeHtml(item.stem.slice(0, 120))}</h3>
          <div class="small">Answer: ${item.answer_key} · Difficulty: ${item.difficulty}</div>
        </div>
      `).join('');
    const selected = state.items.find(item => item.id === state.editor.selectedId);
    const form = selected ? renderEditorForm(selected) : '<p>Select an item to edit.</p>';
    return `
      <div class="card">
        <div class="flex-between">
          <h2>Question Editor</h2>
          <button data-action="new-item">New Item</button>
        </div>
        <input type="text" id="editor-search" placeholder="Search" value="${escapeHtml(state.editor.search)}">
        <div class="grid" style="margin-top:16px; grid-template-columns: 1fr 2fr; gap:24px;">
          <div class="list-scroll">${list || '<p>No items</p>'}</div>
          <div>${form}</div>
        </div>
      </div>
    `;
  }

  function renderEditorForm(item) {
    return `
      <form id="editor-form" data-id="${item.id}">
        <label>Stem<textarea name="stem" required>${escapeHtml(item.stem)}</textarea></label>
        ${item.choices.map((choice, idx) => `
          <label>Choice ${letters[idx]}<input type="text" name="choice-${idx}" value="${escapeHtml(choice)}" required></label>
        `).join('')}
        <label>Answer Key<input type="text" name="answer" value="${item.answer_key}" maxlength="1" required></label>
        <label>Explanation<textarea name="explanation">${escapeHtml(item.explanation || '')}</textarea></label>
        <label>Tags<input type="text" name="tags" value="${escapeHtml(item.tags.join(', '))}"></label>
        <label>Difficulty<input type="number" name="difficulty" min="1" max="5" value="${item.difficulty}"></label>
        <label>References<input type="text" name="references" value="${escapeHtml(item.references.join('; '))}"></label>
        <div class="toolbar">
          <button type="button" data-action="pick-image">Attach Image</button>
          <button type="button" data-action="pick-audio">Attach Audio</button>
        </div>
        <p class="small">Image: ${item.image || 'None'} · Audio: ${item.audio || 'None'}</p>
        <div class="toolbar">
          <button class="primary" type="submit">Save</button>
          <button type="button" data-action="delete-item" class="danger">Delete</button>
        </div>
      </form>
    `;
  }

  function renderImportExport() {
    return `
      <div class="card">
        <h2>Import / Export</h2>
        <div class="toolbar">
          <button data-action="import-json-merge">Import JSON (Merge)</button>
          <button data-action="import-json-replace">Import JSON (Replace)</button>
          <button data-action="import-csv">Import CSV</button>
          <button data-action="export-json">Export JSON</button>
          <button data-action="export-csv">Export CSV</button>
        </div>
        <p class="small">CSV import supports text fields only; media fields remain empty.</p>
      </div>
    `;
  }

  function renderSettings() {
    return `
      <div class="card">
        <h2>Settings</h2>
        <p>Data path: ${escapeHtml(state.info?.dataPath || '')}</p>
        <label><input type="checkbox" id="toggle-snapshots" ${state.autoSnapshot ? 'checked' : ''}> Enable auto snapshots</label>
        <div class="toolbar" style="margin-top:16px;">
          <button data-action="snapshot-now">Snapshot now</button>
        </div>
      </div>
    `;
  }

  function attachHandlers() {
    appEl.querySelectorAll('[data-action="nav"]').forEach(btn => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });

    const mapping = {
      'start-practice': startPractice,
      'start-exam': startExam,
      'begin-practice': beginPractice,
      'select-choice': (_, target) => selectPracticeChoice(target.dataset.letter),
      'reveal': revealPractice,
      'next': () => movePractice(1),
      'prev': () => movePractice(-1),
      'cycle-confidence': cyclePracticeConfidence,
      'toggle-review': togglePracticeReview,
      'end-session': endPractice,
      'open-image': (_, target) => openLightbox(target.dataset.src),
      'begin-exam': beginExam,
      'exam-select': (_, target) => selectExamChoice(target.dataset.letter),
      'exam-next': () => moveExam(1),
      'exam-prev': () => moveExam(-1),
      'exam-toggle-review': toggleExamReview,
      'exam-cycle-confidence': cycleExamConfidence,
      'submit-exam': submitExam,
      'select-item': (_, target) => selectEditorItem(target.dataset.id),
      'new-item': createEditorItem,
      'import-json-merge': () => importJSON(true),
      'import-json-replace': () => importJSON(false),
      'import-csv': importCSV,
      'export-json': exportJSON,
      'export-csv': exportCSV,
      'snapshot-now': manualSnapshot
    };

    appEl.querySelectorAll('[data-action]').forEach(el => {
      const action = el.dataset.action;
      if (action === 'nav' || action === 'open-image') return;
      el.addEventListener('click', ev => {
        const handler = mapping[action];
        if (handler) handler(ev, el);
      });
    });

    const search = document.getElementById('editor-search');
    if (search) {
      search.addEventListener('input', () => {
        state.editor.search = search.value;
        render();
      });
    }

    const form = document.getElementById('editor-form');
    if (form) {
      form.addEventListener('submit', handleEditorSave);
      form.querySelectorAll('[data-action="pick-image"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            const result = await qb.copyImages();
            if (result.files?.length) {
              const item = getEditorItem(form.dataset.id);
              item.image = result.files[0];
              await saveItems();
              render();
            }
          } catch (err) {
            if (String(err) !== 'cancelled') {
              alert(err);
            }
          }
        });
      });
      form.querySelectorAll('[data-action="pick-audio"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            const result = await qb.copyAudio();
            if (result.files?.length) {
              const item = getEditorItem(form.dataset.id);
              item.audio = result.files[0];
              await saveItems();
              render();
            }
          } catch (err) {
            if (String(err) !== 'cancelled') {
              alert(err);
            }
          }
        });
      });
      form.querySelectorAll('[data-action="delete-item"]').forEach(btn => {
        btn.addEventListener('click', () => deleteEditorItem(form.dataset.id));
      });
    }

    const toggle = document.getElementById('toggle-snapshots');
    if (toggle) {
      toggle.addEventListener('change', async () => {
        state.autoSnapshot = toggle.checked;
        await qb.setAutoSnapshots(toggle.checked);
      });
    }

    setupLightbox();
  }

  function setupLightbox() {
    if (!lightbox.dataset.bound) {
      lightbox.dataset.bound = 'true';
      lightbox.addEventListener('click', closeLightbox);
      lightbox.addEventListener('wheel', event => {
        event.preventDefault();
        const scale = Math.max(0.5, Math.min(5, (parseFloat(lightboxImage.dataset.scale || '1') + event.deltaY * -0.001)));
        lightboxImage.style.transform = `scale(${scale})`;
        lightboxImage.dataset.scale = scale;
      }, { passive: false });
    }
  }

  function openLightbox(src) {
    lightboxImage.src = src;
    lightboxImage.style.transform = 'scale(1)';
    lightboxImage.dataset.scale = '1';
    lightbox.classList.remove('hidden');
    lightbox.focus();
  }

  function closeLightbox() {
    lightbox.classList.add('hidden');
  }

  function startPractice() {
    setView('practice');
  }

  function beginPractice() {
    if (!state.items.length) {
      alert('No questions available. Import or create items first.');
      return;
    }
    const order = shuffle(state.items.map(item => item.id));
    state.session = {
      mode: 'practice',
      order,
      index: 0,
      responses: {},
      startedAt: new Date(),
      version: state.bankHash
    };
    render();
  }

  function selectPracticeChoice(letter) {
    if (!state.session) return;
    const id = state.session.order[state.session.index];
    const current = state.session.responses[id] || { confidence: 1, reviewed: false, revealed: false };
    state.session.responses[id] = { ...current, selected: letter };
    render();
  }

  function revealPractice() {
    if (!state.session) return;
    const id = state.session.order[state.session.index];
    const item = state.items.find(it => it.id === id);
    if (!item) return;
    const current = state.session.responses[id] || { confidence: 1, reviewed: false };
    if (!current.selected) return;
    const correct = current.selected === item.answer_key;
    state.session.responses[id] = { ...current, revealed: true, correct };
    render();
  }

  function movePractice(step) {
    if (!state.session) return;
    const length = state.session.order.length;
    state.session.index = (state.session.index + step + length) % length;
    render();
  }

  function cyclePracticeConfidence() {
    if (!state.session) return;
    const id = state.session.order[state.session.index];
    const current = state.session.responses[id] || { confidence: 1, reviewed: false };
    const next = current.confidence ? ((current.confidence) % 3) + 1 : 1;
    state.session.responses[id] = { ...current, confidence: next };
    render();
  }

  function togglePracticeReview() {
    if (!state.session) return;
    const id = state.session.order[state.session.index];
    const current = state.session.responses[id] || { confidence: 1, reviewed: false };
    state.session.responses[id] = { ...current, reviewed: !current.reviewed };
    render();
  }

  async function endPractice() {
    if (!state.session) return;
    const record = buildSessionRecord(state.session);
    await finalizeSession(record);
    state.session = null;
    setView('home');
  }

  function startExam() {
    setView('exam');
  }

  function beginExam() {
    if (!state.items.length) {
      alert('No questions available. Import or create items first.');
      return;
    }
    const order = shuffle(state.items.map(item => item.id)).slice(0, Math.min(25, state.items.length));
    state.exam = {
      mode: 'exam',
      order,
      index: 0,
      responses: {},
      startedAt: new Date(),
      version: state.bankHash,
      submitted: false,
      summary: null
    };
    render();
  }

  function selectExamChoice(letter) {
    if (!state.exam || state.exam.submitted) return;
    const id = state.exam.order[state.exam.index];
    const current = state.exam.responses[id] || { confidence: 1, reviewed: false };
    state.exam.responses[id] = { ...current, selected: letter };
    render();
  }

  function moveExam(step) {
    if (!state.exam || state.exam.submitted) return;
    const length = state.exam.order.length;
    state.exam.index = (state.exam.index + step + length) % length;
    render();
  }

  function toggleExamReview() {
    if (!state.exam || state.exam.submitted) return;
    const id = state.exam.order[state.exam.index];
    const current = state.exam.responses[id] || { confidence: 1, reviewed: false };
    state.exam.responses[id] = { ...current, reviewed: !current.reviewed };
    render();
  }

  function cycleExamConfidence() {
    if (!state.exam || state.exam.submitted) return;
    const id = state.exam.order[state.exam.index];
    const current = state.exam.responses[id] || { confidence: 1, reviewed: false };
    const next = current.confidence ? ((current.confidence) % 3) + 1 : 1;
    state.exam.responses[id] = { ...current, confidence: next };
    render();
  }

  async function submitExam() {
    if (!state.exam || state.exam.submitted) return;
    const record = buildSessionRecord(state.exam);
    await finalizeSession(record);
    const summary = summarizeResults(record.results);
    const misses = record.results.filter(r => !r.correct);
    state.exam.summary = { ...summary, misses };
    state.exam.submitted = true;
    render();
  }

  async function manualSnapshot() {
    try {
      const result = await qb.snapshotNow();
      showToast('Snapshot written: ' + (result.files || []).join(', '));
    } catch (err) {
      alert(err);
    }
  }

  function summarizeResults(results) {
    const total = results.length;
    const correct = results.filter(r => r.correct).length;
    const percent = total ? Math.round((correct / total) * 100) : 0;
    return { total, correct, percent };
  }

  function buildSessionRecord(session) {
    const now = new Date();
    const responses = session.responses;
    const results = session.order.map(id => {
      const item = state.items.find(it => it.id === id);
      const response = responses[id] || { selected: null, confidence: 1, reviewed: false };
      const selected = response.selected || null;
      const correct = selected ? selected === item.answer_key : false;
      const confidence = Math.min(3, Math.max(1, response.confidence || 1));
      return {
        id,
        selected,
        correct,
        confidence,
        reviewed: !!response.reviewed
      };
    });
    const summary = summarizeResults(results);
    return {
      session_id: crypto.randomUUID(),
      started_at: session.startedAt.toISOString(),
      ended_at: now.toISOString(),
      mode: session.mode,
      version: session.version,
      question_order: session.order,
      results,
      summary
    };
  }

  async function finalizeSession(record) {
    try {
      await qb.appendHistory(record);
      state.history.push(record);
      state.lastSummary = record.summary;
      await qb.writeTextFile('history.json', JSON.stringify(state.history, null, 2));
      showToast('Session saved. Correct: ' + record.summary.correct + '/' + record.summary.total);
      await qb.snapshotNow();
    } catch (err) {
      alert('Failed to save history: ' + err);
    }
  }

  function selectEditorItem(id) {
    state.editor.selectedId = id;
    render();
  }

  function getEditorItem(id) {
    return state.items.find(item => item.id === id);
  }

  function handleEditorSave(event) {
    event.preventDefault();
    const form = event.target;
    const id = form.dataset.id;
    const item = getEditorItem(id);
    if (!item) return;
    const formData = new FormData(form);
    item.stem = formData.get('stem') || '';
    item.choices = item.choices.map((_, idx) => formData.get(`choice-${idx}`) || '');
    item.answer_key = (formData.get('answer') || 'A').toUpperCase();
    item.explanation = formData.get('explanation') || '';
    item.tags = (formData.get('tags') || '').split(',').map(s => s.trim()).filter(Boolean);
    item.difficulty = clamp(Number(formData.get('difficulty') || 1), 1, 5);
    item.references = (formData.get('references') || '').split(';').map(s => s.trim()).filter(Boolean);
    if (!letters.includes(item.answer_key)) {
      alert('Answer key must be A-E.');
      return;
    }
    saveItems().then(render);
  }

  function deleteEditorItem(id) {
    if (!confirm('Delete this item?')) return;
    const index = state.items.findIndex(item => item.id === id);
    if (index >= 0) {
      state.items.splice(index, 1);
      state.editor.selectedId = null;
      saveItems().then(render);
    }
  }

  function createEditorItem() {
    const newItem = {
      id: crypto.randomUUID(),
      stem: 'New question',
      choices: ['Option A', 'Option B', 'Option C', 'Option D', 'Option E'],
      answer_key: 'A',
      explanation: '',
      tags: [],
      difficulty: 1,
      references: [],
      image: null,
      audio: null
    };
    state.items.unshift(newItem);
    state.editor.selectedId = newItem.id;
    saveItems().then(render);
  }

  async function saveItems() {
    try {
      await qb.writeTextFile('items.json', JSON.stringify(state.items, null, 2));
      state.itemsRaw = JSON.stringify(state.items, null, 2);
      state.bankHash = window.sha256(state.itemsRaw);
    } catch (err) {
      alert('Failed to save items: ' + err);
    }
  }

  async function importJSON(merge) {
    try {
      const result = await qb.importFile(['.json']);
      const incoming = JSON.parse(result.content);
      if (!Array.isArray(incoming)) throw new Error('JSON must be an array of items.');
      const normalized = incoming.map(normalizeItem);
      if (merge) {
        const map = new Map(state.items.map(item => [item.id, item]));
        normalized.forEach(item => {
          map.set(item.id, item);
        });
        state.items = Array.from(map.values());
      } else {
        state.items = normalized;
      }
      await saveItems();
      render();
    } catch (err) {
      if (String(err) !== 'cancelled') {
        alert('Import failed: ' + err);
      }
    }
  }

  async function importCSV() {
    try {
      const result = await qb.importFile(['.csv']);
      const parsed = parseCSV(result.content);
      parsed.forEach(row => {
        const item = {
          id: crypto.randomUUID(),
          stem: row.stem || '',
          choices: [row.A, row.B, row.C, row.D, row.E].map(value => value || ''),
          answer_key: (row.answer_key || 'A').toUpperCase(),
          explanation: row.explanation || '',
          tags: (row.tags || '').split(',').map(s => s.trim()).filter(Boolean),
          difficulty: clamp(Number(row.difficulty || 1), 1, 5),
          references: (row.references || '').split(';').map(s => s.trim()).filter(Boolean),
          image: null,
          audio: null
        };
        if (!letters.includes(item.answer_key)) {
          item.answer_key = 'A';
        }
        state.items.push(item);
      });
      await saveItems();
      render();
    } catch (err) {
      if (String(err) !== 'cancelled') {
        alert('CSV import failed: ' + err);
      }
    }
  }

  async function exportJSON() {
    try {
      await qb.exportFile('qbank_items.json', JSON.stringify(state.items, null, 2));
      showToast('JSON export saved.');
    } catch (err) {
      if (String(err) !== 'cancelled') {
        alert('Export failed: ' + err);
      }
    }
  }

  async function exportCSV() {
    try {
      const csv = toCSV(state.items);
      await qb.exportFile('qbank_items.csv', csv);
      showToast('CSV export saved.');
    } catch (err) {
      if (String(err) !== 'cancelled') {
        alert('CSV export failed: ' + err);
      }
    }
  }

  function normalizeItem(raw) {
    const item = { ...raw };
    if (!item.id) item.id = crypto.randomUUID();
    item.stem = item.stem || '';
    item.choices = Array.isArray(item.choices) ? item.choices.slice(0, 5) : [];
    while (item.choices.length < 5) item.choices.push('');
    item.answer_key = (item.answer_key || 'A').toUpperCase();
    if (!letters.includes(item.answer_key)) item.answer_key = 'A';
    item.explanation = item.explanation || '';
    item.tags = Array.isArray(item.tags) ? item.tags : [];
    item.difficulty = clamp(Number(item.difficulty || 1), 1, 5);
    item.references = Array.isArray(item.references) ? item.references : [];
    item.image = item.image || null;
    item.audio = item.audio || null;
    return item;
  }

  function parseCSV(text) {
    const rows = [];
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return rows;
    const headers = splitCSVLine(lines[0]);
    for (let i = 1; i < lines.length; i++) {
      const values = splitCSVLine(lines[i]);
      const row = {};
      headers.forEach((header, index) => {
        row[header.trim()] = values[index] || '';
      });
      rows.push(row);
    }
    return rows;
  }

  function splitCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result.map(value => value.trim());
  }

  function toCSV(items) {
    const headers = ['stem', 'A', 'B', 'C', 'D', 'E', 'answer_key', 'explanation', 'tags', 'difficulty', 'references'];
    const lines = [headers.join(',')];
    items.forEach(item => {
      const row = [
        item.stem,
        item.choices[0] || '',
        item.choices[1] || '',
        item.choices[2] || '',
        item.choices[3] || '',
        item.choices[4] || '',
        item.answer_key,
        item.explanation || '',
        item.tags.join(', '),
        item.difficulty,
        item.references.join('; ')
      ].map(value => escapeCSV(value));
      lines.push(row.join(','));
    });
    return lines.join('\n');
  }

  function escapeCSV(value) {
    const str = String(value);
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function clamp(value, min, max) {
    if (Number.isNaN(value)) return min;
    return Math.min(Math.max(value, min), max);
  }

  function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function shuffle(array) {
    const clone = array.slice();
    for (let i = clone.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
  }

  function handleKeydown(event) {
    if (!state.keyboardEnabled) return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const key = event.key.toLowerCase();
    const letterIndex = ['1', '2', '3', '4', '5'].indexOf(event.key);
    if (letterIndex >= 0 && letterIndex < letters.length) {
      if (state.view === 'practice') selectPracticeChoice(letters[letterIndex]);
      if (state.view === 'exam') selectExamChoice(letters[letterIndex]);
      event.preventDefault();
    } else if (key === 'enter') {
      if (state.view === 'practice') {
        revealPractice();
      } else if (state.view === 'exam') {
        submitExam();
      }
      event.preventDefault();
    } else if (key === 'j') {
      if (state.view === 'practice') movePractice(1);
      if (state.view === 'exam') moveExam(1);
      event.preventDefault();
    } else if (key === 'k') {
      if (state.view === 'practice') movePractice(-1);
      if (state.view === 'exam') moveExam(-1);
      event.preventDefault();
    } else if (key === 'c') {
      if (state.view === 'practice') cyclePracticeConfidence();
      if (state.view === 'exam') cycleExamConfidence();
      event.preventDefault();
    } else if (key === 'r') {
      if (state.view === 'practice') togglePracticeReview();
      if (state.view === 'exam') toggleExamReview();
      event.preventDefault();
    }
  }

  window.addEventListener('keydown', handleKeydown);
  loadApp();
})();
