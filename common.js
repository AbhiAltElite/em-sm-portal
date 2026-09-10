'use strict';
/* Shared helpers for the review page and the coordinator portal. No data is stored on this website:
   everything is loaded from the department's Google Apps Script using the personal code after "#". */

if (window.top !== window.self) {            // never allow the pages to be shown inside another site
  document.documentElement.innerHTML = '';
  throw new Error('This page cannot be embedded.');
}

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach(k => { if (k != null && k !== false) n.append(k instanceof Node ? k : String(k)); });
  return n;
}

const app = () => document.getElementById('app');
const hashParams = () => new URLSearchParams(location.hash.slice(1));
const isApproved = s => /^Approved/.test(String(s));

function status(text) {
  const s = String(text || '');
  const cls = isApproved(s) ? 'ok' : /^Changes/.test(s) ? 'bad' : /^Pending/.test(s) ? 'wait' : 'neutral';
  return el('span', { class: 'st ' + cls }, s === 'FYI' ? 'For information' : s);
}

function roleLabel(role, external) {
  return (role === 'Approver' ? 'Approver' : role === 'Coordinator' ? 'Social Media Team' : 'For information') +
         (external ? ', external' : '');
}

function verb(type) {
  const t = String(type || '');
  if (/^Shared v/.test(t)) return 'Version ' + t.slice(8) + ' shared for review';
  if (/^Revised v/.test(t)) return 'Version ' + t.slice(9) + ' issued';
  return t === 'Approved' ? 'Approved' : t === 'Changes requested' ? 'Requested changes' : 'Remark';
}

/** Calls the Apps Script API. credentials: 'omit' = no Google cookies, so multiple signed-in accounts don't matter. */
async function api(payload) {
  let res;
  try {
    res = await fetch(window.SM_CONFIG.apiUrl, {
      method: 'POST', body: JSON.stringify(payload), credentials: 'omit', redirect: 'follow', cache: 'no-store',
    });
  } catch (e) {
    throw new Error('Could not reach the server. Please check your internet connection and try again.');
  }
  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw new Error('The server returned an unexpected response. Please try again in a minute.');
  }
  if (!body.ok) {
    const err = new Error(body.error || 'Something went wrong. Please try again.');
    err.code = body.code || '';
    throw err;
  }
  return body.data;
}

function showLoading(text) {
  app().replaceChildren(el('div', { class: 'wrap center' }, el('p', { class: 'muted' }, text || 'Loading…')));
}

function showError(err, retry) {
  app().replaceChildren(el('div', { class: 'wrap center' },
    el('h1', {}, err.code === 'link' ? 'This link is not available' : 'The page could not be loaded'),
    el('p', { class: 'lede' }, err.message),
    err.code === 'link' || !retry ? null : el('button', { class: 'btn', type: 'button', onclick: retry }, 'Try again')));
}

function message(kind, text) {
  return el('div', { class: 'msg ' + kind, role: kind === 'err' ? 'alert' : 'status' }, text);
}

function formMessage(form, kind, text) {
  form.querySelectorAll(':scope > .msg').forEach(m => m.remove());
  form.append(message(kind, text));
}

function busy(btn, on, label) {
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = label || 'Please wait…';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}

function historySection(comments) {
  return el('section', { id: 'sec-history' },
    el('h2', {}, 'Review history ', el('span', { class: 'n' }, '(' + comments.length + ')')),
    comments.length ? el('ol', { class: 'log' }, comments.map(c => {
      const version = c.role === 'Coordinator';
      return el('li', { class: 'entry' + (version ? ' version' : '') },
        el('div', { class: 'entry-head' },
          el('span', { class: 'who' }, version ? verb(c.type) : c.name + (c.mine ? ' (you)' : '')),
          el('span', { class: 'role' }, version ? 'by ' + c.name : roleLabel(c.role, c.external)),
          version ? null : status(verb(c.type) === 'Remark' ? 'Remark' : c.type),
          el('time', {}, c.time + ', v' + c.version)),
        c.text ? el('div', { class: 'entry-body' }, c.text) : null);
    })) : el('p', { class: 'muted' }, 'No remarks yet.'));
}

/** Defers private image data until a thumbnail is near the viewport or explicitly opened. */
function photoGrid(photos, loadPhoto) {
  return el('div', { class: 'photos' }, photos.map((ph, i) => {
    const cap = 'Photograph ' + (i + 1) + ' of ' + photos.length;
    const img = el('img', { alt: cap, loading: 'lazy', decoding: 'async' });
    const button = el('button', { class: 'ph', type: 'button', 'aria-label': 'Open ' + cap.toLowerCase() }, 'Loading…');
    let pending;
    const load = () => {
      if (ph.src) return Promise.resolve(ph.src);
      if (!loadPhoto) return Promise.resolve('');
      if (!pending) pending = loadPhoto(ph.id).then(data => {
        ph.src = data.src || '';
        button.replaceChildren(ph.src ? img : document.createTextNode('Unavailable'));
        if (ph.src) img.src = ph.src;
        return ph.src;
      }).catch(() => {
        button.replaceChildren(document.createTextNode('Unavailable'));
        return '';
      });
      return pending;
    };
    button.addEventListener('click', async () => {
      const src = await load();
      if (src) openPhoto(src, cap);
    });
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) { observer.disconnect(); load(); }
      }, { rootMargin: '300px' });
      observer.observe(button);
    } else {
      load();
    }
    return el('figure', {}, button, el('figcaption', {}, 'Photograph ' + (i + 1)));
  }));
}

function openPhoto(src, cap) {
  const v = document.getElementById('viewer');
  v.querySelector('img').src = src;
  v.querySelector('img').alt = cap;
  document.getElementById('viewer-cap').textContent = cap;
  v.hidden = false;
  document.getElementById('viewer-close').focus();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('org').textContent = window.SM_CONFIG.department;
  const v = document.getElementById('viewer');
  const close = () => { v.hidden = true; };
  document.getElementById('viewer-close').addEventListener('click', close);
  v.addEventListener('click', e => { if (e.target.closest('.stage')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
});
