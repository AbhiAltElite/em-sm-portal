'use strict';
/* Review page: https://<site>/#t=<personal code> */

const TOKEN = hashParams().get('t') || '';
const THANKS = {
  approve: 'Your approval has been recorded. Thank you.',
  changes: 'Your request for changes has been recorded and shared with the Social Media Team.',
  comment: 'Your remark has been recorded.',
};
let DATA = null;

async function load() {
  showLoading('Loading the post…');
  try {
    if (!/^[0-9a-f]{64}$/.test(TOKEN)) {
      throw Object.assign(new Error('This link is incomplete. Please open the full link from your email.'), { code: 'link' });
    }
    DATA = await api({ op: 'view', t: TOKEN });
    render(null, '');
  } catch (err) {
    showError(err, load);
  }
}

function render(flash, draft) {
  const p = DATA.post;
  const approver = DATA.me.role === 'Approver';
  document.getElementById('ref').replaceChildren('Reference ', el('b', {}, p.id));
  document.title = p.title + ' · Post review';
  app().replaceChildren(
    el('div', { class: 'wrap' },
      el('div', { class: 'titleblock' },
        el('div', { class: 'kicker' }, approver ? 'Approval requested' : 'Shared for information'),
        el('h1', {}, p.title),
        el('div', { class: 'docmeta' }, el('span', {}, 'Version ' + p.version), el('span', {}, 'Last updated ' + p.updated)),
        el('p', { class: 'lede' }, 'Dear ' + DATA.me.name + ', ' + (approver
          ? 'your approval is requested for the social media post below. Please review the text and photographs, then record your decision. Remarks from all reviewers are listed under Review history.'
          : 'the social media post below is shared with you for information. No action is required; you may add remarks if you wish.')),
        p.status === 'Ready' ? el('div', { class: 'notice ok', role: 'status' },
          'All required approvals have been received for version ' + p.version + '.') : null),
      el('div', { class: 'review-grid' },
        el('section', { id: 'sec-text' }, el('h2', {}, 'Post text'), el('div', { class: 'post-text' }, p.text)),
        p.photos.length ? el('section', { id: 'sec-photos' },
          el('h2', {}, 'Photographs ', el('span', { class: 'n' }, '(' + p.photos.length + ')')),
          photoGrid(p.photos, id => api({ op: 'photo', t: TOKEN, photo: id }))) : null,
        respondSection(approver, flash, draft),
        historySection(DATA.comments),
        statusPanel())),
    el('footer', { class: 'pagefoot' }, el('div', { class: 'wrap' },
      'This is a personal review link issued by the ' + DATA.teamName + ', ' + DATA.department +
      '. It opens only this post. Please do not forward it.')));
  if (flash) document.getElementById('sec-respond').scrollIntoView({ block: 'start' });
}

function respondSection(approver, flash, draft) {
  const ta = el('textarea', { id: 'remarks', maxlength: DATA.maxComment, 'aria-describedby': 'remarks-hint' });
  ta.value = draft || '';
  const option = (value, title, desc) => el('label', { class: 'opt' },
    el('input', { type: 'radio', name: 'decision', value: value }), el('span', {}, el('b', {}, title), el('small', {}, desc)));
  const btn = el('button', { class: 'btn', type: 'submit' }, approver ? 'Submit response' : 'Submit remark');
  const form = el('form', { novalidate: true },
    approver ? el('fieldset', {}, el('legend', {}, 'Decision'),
      option('approve', 'Approve', 'The post may be published as shown.'),
      option('changes', 'Request changes', 'Describe the required changes in the remarks.'),
      option('comment', 'Remark only', 'Add a remark without recording a decision.')) : null,
    el('label', { class: 'field', for: 'remarks' }, 'Remarks ', el('span', { class: 'opt-note' }, approver ? '(optional when approving)' : '')),
    ta,
    el('div', { class: 'formfoot' }, btn,
      el('span', { class: 'formhint', id: 'remarks-hint' }, 'Remarks are visible to everyone reviewing this post.')),
    flash ? message(flash.kind, flash.text) : null);

  form.addEventListener('change', () =>
    form.querySelectorAll('.opt').forEach(o => o.classList.toggle('sel', o.querySelector('input').checked)));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const chosen = approver ? form.querySelector('input[name=decision]:checked') : { value: 'comment' };
    const text = ta.value.trim();
    if (!chosen) return formMessage(form, 'err', 'Please select a decision.');
    if (chosen.value !== 'approve' && !text) {
      return formMessage(form, 'err', chosen.value === 'changes'
        ? 'Please describe the required changes in the remarks.' : 'Please enter your remarks.');
    }
    busy(btn, true, 'Submitting…');
    try {
      DATA = await api({ op: 'respond', t: TOKEN, decision: chosen.value, text: text });
      render({ kind: 'ok', text: THANKS[chosen.value] }, '');
    } catch (err) {
      busy(btn, false);
      formMessage(form, 'err', err.message);
    }
  });

  return el('section', { id: 'sec-respond' },
    el('h2', {}, 'Your response'),
    approver ? el('p', { class: 'current' }, 'Your current status: ', status(DATA.me.status)) : null,
    form);
}

function statusPanel() {
  const approvers = DATA.people.filter(p => p.role === 'Approver');
  const done = approvers.filter(p => isApproved(p.status)).length;
  return el('aside', {},
    el('div', { class: 'panel' },
      el('h2', {}, 'Review status'),
      el('p', { class: 'summary' }, done + ' of ' + approvers.length + ' approvals received'),
      el('table', { class: 'people' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Reviewer'), el('th', {}, 'Status'))),
        el('tbody', {}, DATA.people.map(p => el('tr', {},
          el('td', {}, el('div', { class: 'pname' }, p.name + (p.me ? ' (you)' : '')),
                        el('div', { class: 'prole' }, roleLabel(p.role, p.external))),
          el('td', {}, status(p.status),
             p.updated && !/^(Pending|FYI)$/.test(p.status) ? el('span', { class: 'pwhen' }, p.updated) : null)))))),
    el('p', { class: 'linknote' }, 'Links remain active until the post is closed by the Social Media Team.'));
}

document.addEventListener('DOMContentLoaded', load);
window.addEventListener('hashchange', () => location.reload()); // a different link pasted into the same tab
