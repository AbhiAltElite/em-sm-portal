'use strict';
/* Coordinator portal: https://<site>/coordinator.html#c=<coordinator code>[&post=<id> | &view=new] */

const TOKEN = hashParams().get('c') || '';
const MAX_PHOTOS = 10;
const base = () => '#c=' + TOKEN;
let pendingFlash = null;
let me = '';

function go(hash, flash) {
  pendingFlash = flash || null;
  if (location.hash === hash) route(); else location.hash = hash;
}

async function route() {
  const p = hashParams();
  if ((p.get('c') || '') !== TOKEN) { location.reload(); return; }
  const flash = pendingFlash;
  pendingFlash = null;
  window.scrollTo(0, 0);
  const view = p.get('view') === 'new' ? 'new' : 'list';
  setNav(view);
  showLoading();
  try {
    if (!/^[0-9a-f]{64}$/.test(TOKEN)) {
      throw Object.assign(new Error('This coordinator link is incomplete. Please open the full link from your email.'), { code: 'link' });
    }
    if (view === 'new') {
      if (!me) setMe((await api({ op: 'coord.list', c: TOKEN })).me);   // checks the link before showing the form
      app().replaceChildren(newView(flash));
    } else if (p.get('post')) {
      const d = await api({ op: 'coord.post', c: TOKEN, post: p.get('post') });
      setMe(d.me);
      app().replaceChildren(postView(d.post, flash));
    } else {
      const d = await api({ op: 'coord.list', c: TOKEN });
      setMe(d.me);
      app().replaceChildren(listView(d.posts, flash));
    }
  } catch (err) {
    showError(err, route);
  }
}

function setNav(view) {
  document.getElementById('nav').replaceChildren(
    el('a', { href: base(), class: view === 'list' ? 'on' : '' }, 'All posts'),
    el('a', { href: base() + '&view=new', class: view === 'new' ? 'on' : '' }, 'New post'),
    el('span', { class: 'who', id: 'me' }, me));
}
function setMe(email) {
  me = email;
  const n = document.getElementById('me');
  if (n) n.textContent = email;
}

function postStatus(p) {
  if (p.status === 'Ready') return el('span', { class: 'st ok' }, 'Ready to post');
  if (p.status === 'Closed') return el('span', { class: 'st neutral' }, 'Closed');
  if (p.changes) return el('span', { class: 'st bad' }, 'Changes requested');
  return el('span', { class: 'st wait' }, 'Awaiting approval');
}

function footer() {
  return el('footer', { class: 'pagefoot' }, el('div', { class: 'wrap' },
    'Coordinator access' + (me ? ' for ' + me : '') + '. This link is personal; do not share or forward it.'));
}

/** Wraps an async form action: validation, busy button, error message. */
function action(form, btn, validate, run) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const problem = validate ? validate() : '';
    if (problem) return formMessage(form, 'err', problem);
    busy(btn, true);
    try {
      await run();
    } catch (err) {
      busy(btn, false);
      formMessage(form, 'err', err.message);
    }
  });
}

// ── All posts
function listView(posts, flash) {
  const filters = [['all', 'All'], ['Open', 'Awaiting approval'], ['Ready', 'Ready to post'], ['Closed', 'Closed']];
  const tbody = el('tbody');
  const fill = key => {
    const rows = posts.filter(p => key === 'all' || p.status === key);
    tbody.replaceChildren(...(rows.length ? rows.map(p => el('tr', {},
      el('td', {}, el('a', { href: base() + '&post=' + encodeURIComponent(p.id) }, p.title),
                   el('span', { class: 'ref' }, p.id + ' · version ' + p.version)),
      el('td', {}, postStatus(p)),
      el('td', { class: 'num' }, p.approved + ' of ' + p.approvers),
      el('td', { class: 'num hide-sm' }, p.updated)))
      : [el('tr', {}, el('td', { colspan: 4, class: 'empty' },
          posts.length ? 'No posts in this view.' : 'No posts yet. Use "New post" to create the first one.'))]));
  };
  const bar = el('div', { class: 'filters', role: 'group', 'aria-label': 'Filter posts' }, filters.map(([key, label], i) =>
    el('button', { type: 'button', class: i === 0 ? 'on' : '', onclick: e => {
      bar.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      e.currentTarget.classList.add('on');
      fill(key);
    } }, label + ' (' + (key === 'all' ? posts.length : posts.filter(p => p.status === key).length) + ')')));
  fill('all');
  return el('div', {},
    el('div', { class: 'wrap' },
      flash ? message(flash.kind, flash.text) : null,
      el('div', { class: 'toolbar' }, el('h1', { class: 'flush' }, 'Posts'),
        el('div', { class: 'toolbar-actions' }, bar, el('a', { href: base() + '&view=new', class: 'btn' }, 'New post'))),
      el('div', { class: 'table-wrap' }, el('table', { class: 'list' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Post'), el('th', {}, 'Status'), el('th', {}, 'Approvals'),
                                     el('th', { class: 'hide-sm' }, 'Last updated'))),
        tbody))),
    footer());
}

// ── One post
function postView(p, flash) {
  const open = p.status !== 'Closed';
  const approvers = p.people.filter(x => x.role === 'Approver');
  const done = approvers.filter(x => isApproved(x.status)).length;
  const pending = approvers.filter(x => !isApproved(x.status));
  const reload = text => go(base() + '&post=' + encodeURIComponent(p.id), { kind: 'ok', text: text });

  const reviewers = el('div', { class: 'panel plain' },
    el('h2', {}, 'Reviewers'),
    el('p', { class: 'summary' }, done + ' of ' + approvers.length + ' approvals received'),
    el('table', { class: 'people' }, el('tbody', {}, p.people.map(x => el('tr', {},
      el('td', {}, el('div', { class: 'pname' }, x.name),
        el('div', { class: 'pmeta' }, roleLabel(x.role, x.external), el('br'), x.email, el('br'),
          x.opened ? 'Opened ' + x.opened : 'Not opened yet',
          x.reminders ? ' · ' + x.reminders + ' reminder' + (x.reminders === 1 ? '' : 's') : '')),
      el('td', {}, status(x.status)))))));

  const panels = [];
  if (open && pending.length) {
    const note = textarea('note', '', 2, 'e.g. We plan to post on Friday; kindly review by Thursday.');
    const btn = el('button', { class: 'btn', type: 'submit' }, 'Send reminder');
    const f = el('form', { class: 'stack', novalidate: true },
      el('div', { class: 'checks' }, pending.map(x => el('label', {},
        el('input', { type: 'checkbox', value: x.email, checked: true }),
        el('span', {}, el('b', {}, x.name), el('span', { class: 'sub' }, x.status + (x.opened ? '' : ' · not opened yet')))))),
      el('label', { class: 'field' }, 'Note ', el('span', { class: 'opt-note' }, '(optional, shown in the mail)'), note),
      btn);
    const emails = () => [...f.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
    action(f, btn, () => (emails().length ? '' : 'Select at least one person.'), async () => {
      const res = await api({ op: 'coord.remind', c: TOKEN, post: p.id, emails: emails(), note: note.value });
      reload('Reminder sent to ' + res.sent + ' ' + (res.sent === 1 ? 'person' : 'people') + '.');
    });
    panels.push(el('div', { class: 'panel' }, el('h3', {}, 'Send reminder'), f));

    const who = el('select', {}, pending.map(x => el('option', { value: x.email }, x.name)));
    const how = el('input', { type: 'text', maxlength: 120, placeholder: 'e.g. by WhatsApp on 10 Sep' });
    const btn2 = el('button', { class: 'btn secondary', type: 'submit' }, 'Record approval');
    const f2 = el('form', { class: 'stack', novalidate: true },
      el('label', { class: 'field' }, 'Approver', who), el('label', { class: 'field' }, 'How it was received', how), btn2);
    action(f2, btn2, () => (how.value.trim() ? '' : 'Say how the approval was received.'), async () => {
      await api({ op: 'coord.offline', c: TOKEN, post: p.id, email: who.value, how: how.value });
      reload('Approval recorded.');
    });
    panels.push(el('details', { class: 'panel' }, el('summary', {}, 'Record an approval received offline'), f2));
  }
  if (open) {
    const text = textarea('text', p.text, 8);
    const photos = photoField('Replace photographs', 'Leave empty to keep the current photographs.');
    const note = textarea('note', '', 2, 'e.g. Corrected the award name as per the certificate.');
    const addA = textarea('approvers', '', 2);
    const addF = textarea('fyi', '', 2);
    const again = el('input', { type: 'checkbox', checked: true });
    const btn = el('button', { class: 'btn', type: 'submit' }, 'Send revised version');
    const f = el('form', { class: 'stack', novalidate: true },
      el('label', { class: 'field' }, 'Post text', text), photos.node,
      el('label', { class: 'field' }, 'What changed? ', el('span', { class: 'opt-note' }, '(shown to reviewers)'), note),
      el('label', { class: 'field' }, 'Add approvers ', el('span', { class: 'opt-note' }, '(optional, one per line: Name, email)'), addA),
      el('label', { class: 'field' }, 'Add people for information ', el('span', { class: 'opt-note' }, '(optional)'), addF),
      el('label', { class: 'inline' }, again, 'Ask approvers to approve again (recommended)'),
      el('span', { class: 'hint' }, 'If unticked, approvals already given carry over to the new version. This is noted in the review history and in the mail.'),
      btn);
    action(f, btn, () => (!text.value.trim() ? 'Post text is required.' : photos.busy ? 'Please wait until the photographs are prepared.' : ''),
      async () => {
        const res = await api({ op: 'coord.revise', c: TOKEN, post: p.id, text: text.value, note: note.value, approvers: addA.value,
                                fyi: addF.value, reapprove: again.checked, photos: photos.values });
        reload('Version ' + res.version + ' sent to ' + res.sent + ' ' + (res.sent === 1 ? 'person' : 'people') + '.');
      });
    panels.push(el('details', { class: 'panel' }, el('summary', {}, 'Revise post'), f));

    const btn3 = el('button', { class: 'btn danger', type: 'submit' }, 'Close post');
    const f3 = el('form', { novalidate: true }, btn3);
    action(f3, btn3, () => (confirm('Close "' + p.title + '"? All review links for it will stop working.') ? '' : 'Not closed.'),
      async () => {
        await api({ op: 'coord.close', c: TOKEN, post: p.id });
        reload('Post closed. All review links for it have stopped working.');
      });
    panels.push(el('div', { class: 'panel plain' }, el('h3', {}, 'Close post'),
      el('p', { class: 'hint' }, 'Close the post after it has been published. All review links for it stop working.'), f3));
  } else {
    panels.push(el('div', { class: 'panel' }, 'This post is closed. Its review links no longer work.'));
  }

  return el('div', {},
    el('div', { class: 'wrap' },
      el('div', { class: 'titleblock' },
        el('a', { href: base(), class: 'back' }, 'Back to all posts'),
        el('div', { class: 'kicker' }, postStatus({ status: p.status, changes: approvers.some(x => /^Changes/.test(x.status)) })),
        el('h1', {}, p.title),
        el('div', { class: 'docmeta' }, el('span', {}, 'Reference ' + p.id), el('span', {}, 'Version ' + p.version),
          el('span', {}, 'Created ' + p.created + (p.createdBy ? ' by ' + p.createdBy : '')), el('span', {}, 'Last updated ' + p.updated)),
        flash ? message(flash.kind, flash.text) : null),
      el('div', { class: 'coord-grid' },
        el('div', { class: 'main' },
          el('section', {}, el('h2', {}, 'Post text'), el('div', { class: 'post-text' }, p.text)),
          p.photos.length ? el('section', {}, el('h2', {}, 'Photographs ', el('span', { class: 'n' }, '(' + p.photos.length + ')')),
            photoGrid(p.photos, id => api({ op: 'coord.photo', c: TOKEN, post: p.id, photo: id }))) : null,
          historySection(p.comments)),
        el('aside', {}, reviewers, panels))),
    footer());
}

// ── New post
function newView(flash) {
  const title = el('input', { type: 'text', maxlength: 150, placeholder: 'e.g. Institute Gold Medal – Guna Sekhar' });
  const text = textarea('text', '', 9, 'Paste the final caption exactly as it will be posted…');
  const count = el('span', { class: 'count' });
  const upd = () => { count.textContent = text.value.length + ' characters (Instagram max 2,200 · LinkedIn max 3,000)'; };
  text.addEventListener('input', upd);
  upd();
  const photos = photoField('Photographs', 'JPG or PNG, up to ' + MAX_PHOTOS +
    '. For photographs with VIPs or chief guests, use PRO-office-approved photographs only.');
  const approvers = textarea('approvers', '', 4, 'Guna Sekhar, guna@iith.ac.in\nDr. Ranapratap, ranapratap@iith.ac.in');
  const fyi = textarea('fyi', '', 2, 'HoD, hod@iith.ac.in');
  const note = textarea('note', '', 2, 'e.g. We plan to post on Friday morning.');
  const btn = el('button', { class: 'btn', type: 'submit' }, 'Send for approval');
  const f = el('form', { class: 'stack', novalidate: true },
    el('label', { class: 'field' }, 'Title', title,
      el('span', { class: 'hint' }, 'Shown to reviewers and in mail subjects. Check names and award titles against the certificate.')),
    el('label', { class: 'field' }, el('span', { class: 'row' }, el('span', {}, 'Post text'), count), text),
    photos.node,
    el('label', { class: 'field' }, 'Approvers ', el('span', { class: 'opt-note' }, '(must approve)'), approvers,
      el('span', { class: 'hint' }, 'One person per line: Name, email. External (non-IITH) addresses are fine. For people added before, the email alone is enough: their saved name and greeting (Contacts tab in the Sheet) are used.')),
    el('details', { class: 'guide' }, el('summary', {}, 'Who should approve?'), el('ul', {},
      el('li', {}, el('b', {}, 'Department-level'), ' (awards recommended by the department, department events): student(s), guide, HoD / DPGC, social media and website coordinators.'),
      el('li', {}, el('b', {}, 'Individual achievement'), ': student, guide / faculty advisor, social media and website coordinators, other direct stakeholders. Add HoD and DPGC (PG/PhD) or DUGC (UG) under For information.'))),
    el('label', { class: 'field' }, 'For information ', el('span', { class: 'opt-note' }, '(optional)'), fyi,
      el('span', { class: 'hint' }, 'They can view and add remarks; their approval is not required.')),
    el('label', { class: 'field' }, 'Message to reviewers ', el('span', { class: 'opt-note' }, '(optional)'), note),
    btn);
  action(f, btn, () => !title.value.trim() ? 'Please enter a title.'
    : !text.value.trim() ? 'Please enter the post text.'
    : !/@/.test(approvers.value) ? 'Please add at least one approver (Name, email).'
    : photos.busy ? 'Please wait until the photographs are prepared.' : '',
    async () => {
      const res = await api({ op: 'coord.create', c: TOKEN, title: title.value, text: text.value, approvers: approvers.value,
                              fyi: fyi.value, note: note.value, photos: photos.values });
      go(base() + '&post=' + encodeURIComponent(res.id),
         { kind: 'ok', text: 'Post created and sent to ' + res.sent + ' ' + (res.sent === 1 ? 'person' : 'people') + '.' });
    });
  return el('div', {},
    el('div', { class: 'wrap' },
      el('div', { class: 'titleblock' }, el('a', { href: base(), class: 'back' }, 'Back to all posts'),
        el('h1', {}, 'New post for approval'), flash ? message(flash.kind, flash.text) : null),
      el('div', { class: 'newform' }, f)),
    footer());
}

function textarea(name, value, rows, placeholder) {
  const t = el('textarea', { name: name, rows: rows, placeholder: placeholder || '' });
  t.value = value || '';
  return t;
}

/** Photos are resized in the browser (max 1280 px JPEG) as soon as they are chosen. */
function photoField(label, hint) {
  const state = { values: [], busy: false };
  const thumbs = el('div', { class: 'thumbs' });
  const note = el('span', { class: 'hint' }, hint);
  const input = el('input', { type: 'file', accept: 'image/jpeg,image/png', multiple: true });
  input.addEventListener('change', async () => {
    const files = [...input.files].slice(0, MAX_PHOTOS);
    state.values = [];
    thumbs.replaceChildren();
    if (!files.length) { note.textContent = hint; return; }
    state.busy = true;
    note.textContent = 'Preparing ' + files.length + ' photograph' + (files.length === 1 ? '' : 's') + '…';
    try {
      for (const file of files) {
        const url = await resize(file);
        state.values.push(url);
        thumbs.append(el('img', { src: url, alt: file.name }));
      }
      note.textContent = files.length + ' photograph' + (files.length === 1 ? '' : 's') + ' ready' +
        (input.files.length > MAX_PHOTOS ? ' (only the first ' + MAX_PHOTOS + ' are used).' : '.');
    } catch (err) {
      state.values = [];
      thumbs.replaceChildren();
      input.value = '';
      note.textContent = err.message;
    }
    state.busy = false;
  });
  state.node = el('div', {}, el('label', { class: 'field' }, label, input), note, thumbs);
  return state;
}

function resize(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Could not read "' + file.name + '". Please use JPG or PNG photographs.'));
    img.src = url;
  });
}

window.addEventListener('hashchange', route);
document.addEventListener('DOMContentLoaded', route);
