'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // ---- DOM references ----
  const weekdaysNav = document.querySelector('.weekdays');
  const calDaysEl = document.querySelector('#calendar-days');
  const calTitleEl = document.querySelector('#cal-month-label');
  const calPrevBtn = document.querySelector('.cal-prev');
  const calNextBtn = document.querySelector('.cal-next');

  const form = document.querySelector('.task-input');
  const input = document.querySelector('#new-task');
  const errorEl = document.querySelector('#task-error');
  const listEl = document.querySelector('.todo-list');
  const selectedDateLabel = document.querySelector('#selected-date');

  const progressBar = document.querySelector('.progress-bar');
  const progressFill = document.querySelector('.progress');

  // ---- Locale (force English) ----
  const LOCALE = 'en-US';

  // ---- Storage keys ----
  const K_TASKS = 'mpa.v2.tasks';
  const K_SELECTED = 'mpa.v2.selectedDate';
  const K_MONTH = 'mpa.v2.currentMonth'; // YYYY-MM

  // ---- Date helpers ----
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const ymd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const parseYMD = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, (m - 1), d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  // Monday-based week start (1=Mon, 0=Sun)
  const startOfWeek = (date, weekStartsOn = 1) => {
    const d = startOfDay(date);
    const day = d.getDay(); // 0..6 (Sun..Sat)
    const diff = (day - weekStartsOn + 7) % 7;
    return addDays(d, -diff);
  };

  const toHuman = (d) => {
    const fmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    return fmt.format(d);
  };
  const monthHuman = (d) => {
    const fmt = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });
    return fmt.format(d);
  };

  // ---- Token parsing (@today, @tomorrow, @mon, ...) ----
  // Only English tokens are supported to keep the app fully in English.
  const tokenMap = new Map([
    // relative
    ['today', { type: 'rel', days: 0 }],
    ['tomorrow', { type: 'rel', days: 1 }],
    ['tmrw', { type: 'rel', days: 1 }],
    // weekdays EN (0=Sun..6=Sat)
    ['sun', { type: 'wd', wd: 0 }], ['sunday', { type: 'wd', wd: 0 }],
    ['mon', { type: 'wd', wd: 1 }], ['monday', { type: 'wd', wd: 1 }],
    ['tue', { type: 'wd', wd: 2 }], ['tuesday', { type: 'wd', wd: 2 }],
    ['wed', { type: 'wd', wd: 3 }], ['wednesday', { type: 'wd', wd: 3 }],
    ['thu', { type: 'wd', wd: 4 }], ['thursday', { type: 'wd', wd: 4 }],
    ['fri', { type: 'wd', wd: 5 }], ['friday', { type: 'wd', wd: 5 }],
    ['sat', { type: 'wd', wd: 6 }], ['saturday', { type: 'wd', wd: 6 }],
  ]);

  // Returns { text: cleanedText, date: Date|null } based on the ending token
  const parseTokenDate = (rawText, baseDate) => {
    const re = /(?:^|\s)@?([a-zA-Z]{2,})\s*$/; // last word as token (English letters only)
    const m = rawText.match(re);
    if (!m) return { text: rawText.trim(), date: null };
    const token = m[1].toLowerCase();
    const info = tokenMap.get(token);
    if (!info) return { text: rawText.trim(), date: null };

    let target = null;
    if (info.type === 'rel') {
      target = addDays(baseDate, info.days);
    } else if (info.type === 'wd') {
      // Weekday token is anchored to the CURRENT WEEK of selectedDate
      const weekStart = startOfWeek(selectedDate, 1); // Monday start
      const offset = info.wd === 0 ? 6 : (info.wd - 1); // Sun->6, Mon->0, ...
      target = addDays(weekStart, offset);
    }

    const text = rawText.replace(re, '').trim();
    return { text, date: target ? startOfDay(target) : null };
  };

  // ---- In-memory state ----
  const today = startOfDay(new Date());
  let selectedDate = startOfDay(new Date());
  let currentMonth = startOfDay(new Date()); currentMonth.setDate(1);

  /** @type {{id:string,text:string,done:boolean,created:number,date:string}[]} */
  let tasks = [];

  // ---- Persistence ----
  const saveState = () => {
    localStorage.setItem(K_TASKS, JSON.stringify(tasks));
    localStorage.setItem(K_SELECTED, ymd(selectedDate));
    localStorage.setItem(K_MONTH, ym(currentMonth));
  };
  const loadState = () => {
    const sd = localStorage.getItem(K_SELECTED);
    selectedDate = sd ? parseYMD(sd) : today;

    const cm = localStorage.getItem(K_MONTH);
    currentMonth = cm
      ? new Date(Number(cm.split('-')[0]), Number(cm.split('-')[1]) - 1, 1)
      : new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);

    const raw = localStorage.getItem(K_TASKS);
    if (raw) {
      try { tasks = JSON.parse(raw) || []; } catch { tasks = []; }
    } else {
      // First run: hydrate initial tasks from DOM and assign them to today
      const items = document.querySelectorAll('.todo-item');
      tasks = Array.from(items).map((li, idx) => {
        const label = li.querySelector('label');
        const cb = li.querySelector('input[type="checkbox"]');
        return {
          id: 't-init-' + idx,
          text: (label?.textContent || `Task ${idx + 1}`).trim(),
          done: !!(cb && cb.checked),
          created: Date.now() + idx,
          date: ymd(today),
        };
      });
    }
  };

  // ---- Rendering ----
  function renderCalendar() {
    calTitleEl.textContent = monthHuman(currentMonth);
    calDaysEl.innerHTML = '';

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const first = new Date(year, month, 1);
    const firstW = first.getDay(); // 0..6 (Sun..Sat)
    const lastDay = new Date(year, month + 1, 0).getDate();

    // Leading pads for the first week
    for (let i = 0; i < firstW; i++) {
      const pad = document.createElement('span');
      pad.className = 'pad';
      calDaysEl.appendChild(pad);
    }

    // Month days
    for (let d = 1; d <= lastDay; d++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day';
      btn.textContent = String(d);

      const date = new Date(year, month, d);
      const key = ymd(date);
      btn.dataset.date = key;

      if (ymd(date) === ymd(today)) btn.classList.add('is-today');
      if (ymd(date) === ymd(selectedDate)) btn.classList.add('is-selected');

      btn.setAttribute('aria-label', String(d));
      calDaysEl.appendChild(btn);
    }
  }

  function renderTasks() {
    if (selectedDateLabel) selectedDateLabel.textContent = `Selected: ${toHuman(selectedDate)}`;

    const key = ymd(selectedDate);
    const items = tasks.filter(t => t.date === key);

    listEl.innerHTML = '';
    for (const t of items) listEl.appendChild(renderTaskItem(t));

    updateProgress(items);
  }

  function renderTaskItem(task) {
    const li = document.createElement('li');
    li.className = 'todo-item';
    li.dataset.id = task.id;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = task.id;
    cb.checked = !!task.done;

    const label = document.createElement('label');
    label.setAttribute('for', task.id);
    label.textContent = task.text;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remove';
    btn.setAttribute('aria-label', 'Delete task');
    btn.textContent = '✖';

    li.append(cb, label, btn);
    return li;
  }

  function updateProgress(visibleTasks) {
    const total = visibleTasks.length;
    const done = visibleTasks.filter(t => t.done).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    progressFill.style.width = pct + '%';
    progressBar.setAttribute('aria-valuenow', String(pct));
  }

  function updateWeekdaysActive() {
    if (!weekdaysNav) return;
    const currentWD = selectedDate.getDay(); // 0..6 (Sun..Sat)
    weekdaysNav.querySelectorAll('button[data-wd]').forEach(btn => {
      const bwd = Number(btn.dataset.wd);
      btn.classList.toggle('active', bwd === currentWD);
    });
  }

  function refreshAll() {
    renderCalendar();
    renderTasks();
    updateWeekdaysActive();
    saveState();
  }

  // ---- Validation helpers ----
  function showError(msg) {
    input.setAttribute('aria-invalid', 'true');
    errorEl.textContent = msg;
  }
  function clearError() {
    input.removeAttribute('aria-invalid');
    errorEl.textContent = '';
  }

  // ---- Init ----
  (function init() {
    loadState();
    refreshAll();
  })();

  // ---- Events ----
  // Calendar day select (delegated)
  calDaysEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.day');
    if (!btn || !btn.dataset.date) return;
    selectedDate = parseYMD(btn.dataset.date);
    currentMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    refreshAll();
  });

  // Month navigation
  calPrevBtn.addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    refreshAll();
  });
  calNextBtn.addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    refreshAll();
  });

  // Weekdays quick jump — within CURRENT WEEK of selectedDate
  weekdaysNav.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-wd]');
    if (!b) return;
    const wd = Number(b.dataset.wd); // 1..6 or 0 (Sun)
    const weekStart = startOfWeek(selectedDate, 1); // Monday-based week
    const offset = (wd === 0) ? 6 : (wd - 1);       // Mon->0, Tue->1, ..., Sun->6
    selectedDate = addDays(weekStart, offset);
    currentMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    refreshAll();
  });

  // Add task
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = (input.value || '').trim();
    if (!raw) { showError('Please enter a task name.'); input.focus(); return; }

    // Parse optional token at the end; weekday tokens are anchored to CURRENT WEEK
    const { text, date } = parseTokenDate(raw, selectedDate);
    const assigned = startOfDay(date || selectedDate);

    if (!text) { showError('Task name cannot be empty.'); input.focus(); return; }
    clearError();

    const newTask = {
      id: 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      text,
      done: false,
      created: Date.now(),
      date: ymd(assigned),
    };
    tasks.push(newTask);
    saveState();

    // If the task belongs to the currently selected date, reflect it immediately
    if (newTask.date === ymd(selectedDate)) {
      listEl.appendChild(renderTaskItem(newTask));
      updateProgress(tasks.filter(t => t.date === newTask.date));
    }

    input.value = '';
    input.focus();
  });

  // Clear error as the user types
  input.addEventListener('input', () => { if (input.value.trim()) clearError(); });

  // Toggle done / remove — delegated handlers
  listEl.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    const li = cb.closest('.todo-item'); if (!li) return;
    const id = li.dataset.id;
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    t.done = !!cb.checked;
    saveState();
    updateProgress(tasks.filter(x => x.date === t.date));
  });

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove');
    if (!btn) return;
    const li = btn.closest('.todo-item'); if (!li) return;
    const id = li.dataset.id;
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    tasks = tasks.filter(x => x.id !== id);
    li.remove();
    saveState();
    updateProgress(tasks.filter(x => x.date === (t?.date || ymd(selectedDate))));
  });
});
