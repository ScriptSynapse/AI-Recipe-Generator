/**
 * components.js
 * ---------------------------------------------------------------------
 * Small shared UI pieces built with safe DOM calls only (textContent,
 * createElement) -- never innerHTML. Used instead of alert()/confirm().
 *   Components.el(tag, { class, text, attrs }, children)
 *   Components.toast(message, kind)          kind: 'info' | 'success' | 'error'
 *   Components.confirm({ title, message, confirmLabel, cancelLabel, danger }) -> Promise<boolean>
 */
(function (root) {
  function el(tag, opts, children) {
    const node = document.createElement(tag);
    const o = opts || {};
    if (o.class) node.className = o.class;
    if (o.text != null) node.textContent = String(o.text);
    Object.entries(o.attrs || {}).forEach(([k, v]) => node.setAttribute(k, String(v)));
    (children || []).forEach((c) => { if (c) node.appendChild(c); });
    return node;
  }

  function toastRegion() {
    let region = document.getElementById('toast-region');
    if (!region) {
      region = el('div', { class: 'toast-region', attrs: { id: 'toast-region', role: 'status', 'aria-live': 'polite' } });
      document.body.appendChild(region);
    }
    return region;
  }

  function toast(message, kind, ms) {
    const region = toastRegion();
    const t = el('div', { class: `toast-item toast-${kind || 'info'}`, text: message });
    region.appendChild(t);
    const remove = () => { if (t.parentNode) t.parentNode.removeChild(t); };
    setTimeout(remove, ms || 4000);
    return t;
  }

  function confirmDialog(options) {
    const o = options || {};
    return new Promise((resolve) => {
      const previouslyFocused = document.activeElement;
      const titleId = 'confirm-title';
      const cancel = el('button', { class: 'btn btn-ghost', text: o.cancelLabel || 'Cancel', attrs: { type: 'button' } });
      const ok = el('button', {
        class: `btn ${o.danger ? 'btn-primary btn-danger-solid' : 'btn-primary'}`,
        text: o.confirmLabel || 'Confirm', attrs: { type: 'button' },
      });
      const dialog = el('div', { class: 'modal', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId } }, [
        el('h3', { text: o.title || 'Are you sure?', attrs: { id: titleId } }),
        el('p', { text: o.message || '' }),
        el('div', { class: 'modal-actions' }, [cancel, ok]),
      ]);
      const backdrop = el('div', { class: 'modal-backdrop visible' }, [dialog]);

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
        if (e.key === 'Tab') {              // keep focus inside the dialog
          e.preventDefault();
          (document.activeElement === ok ? cancel : ok).focus();
        }
      }
      cancel.addEventListener('click', () => close(false));
      ok.addEventListener('click', () => close(true));
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(backdrop);
      cancel.focus();                       // the safe choice is focused first
    });
  }

  root.Components = { el, toast, confirm: confirmDialog };
}(typeof self !== 'undefined' ? self : this));
