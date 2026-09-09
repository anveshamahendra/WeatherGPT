// ==========================================================================
// WeatherGPT — Accessible dropdown (listbox pattern)
// Every instance: opens/closes, full keyboard nav, outside-click + Escape
// close, visible focus, and calls onSelect with the chosen option's value.
// ==========================================================================

let openInstance = null;

export class Dropdown {
  /**
   * @param {HTMLElement} root - container with [data-dd-button] and [data-dd-list]
   * @param {Object} opts
   * @param {Function} opts.onSelect - (value, option) => void
   * @param {Function} [opts.onOpen] - called when the list opens (e.g. to lazy-populate)
   * @param {boolean} [opts.searchable]
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.button = root.querySelector('[data-dd-button]');
    this.list = root.querySelector('[data-dd-list]');
    this.labelEl = root.querySelector('[data-dd-label]');
    this.searchInput = root.querySelector('[data-dd-search]');
    this.opts = opts;
    this.activeIndex = -1;

    this.button.addEventListener('click', () => this.toggle());
    this.button.addEventListener('keydown', (e) => this.onButtonKeydown(e));
    this.list.addEventListener('keydown', (e) => this.onListKeydown(e));
    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) this.close();
    });
    if (this.searchInput) {
      this.searchInput.addEventListener('input', () => {
        if (this.opts.onSearch) this.opts.onSearch(this.searchInput.value);
      });
      this.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { this.close(); this.button.focus(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); this.focusOption(0); }
      });
    }
  }

  get options() {
    return Array.from(this.list.querySelectorAll('[data-dd-option]'));
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  get isOpen() { return this.button.getAttribute('aria-expanded') === 'true'; }

  open() {
    if (openInstance && openInstance !== this) openInstance.close();
    this.button.setAttribute('aria-expanded', 'true');
    this.list.hidden = false;
    openInstance = this;
    if (this.opts.onOpen) this.opts.onOpen();
    if (this.searchInput) {
      this.searchInput.value = '';
      requestAnimationFrame(() => this.searchInput.focus());
    }
    this.activeIndex = -1;
  }

  close() {
    this.button.setAttribute('aria-expanded', 'false');
    this.list.hidden = true;
    if (openInstance === this) openInstance = null;
  }

  setLabel(text) {
    if (this.labelEl) this.labelEl.textContent = text;
  }

  focusOption(i) {
    const opts = this.options;
    if (!opts.length) return;
    this.activeIndex = (i + opts.length) % opts.length;
    opts.forEach((o, idx) => o.classList.toggle('is-active', idx === this.activeIndex));
    opts[this.activeIndex].scrollIntoView({ block: 'nearest' });
    opts[this.activeIndex].focus({ preventScroll: true });
  }

  onButtonKeydown(e) {
    if (['ArrowDown', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      this.open();
      if (!this.searchInput) this.focusOption(0);
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  onListKeydown(e) {
    const opts = this.options;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.focusOption(this.activeIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.focusOption(this.activeIndex - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); this.close(); this.button.focus(); }
    else if (e.key === 'Tab') { this.close(); }
    else if (e.key === 'Enter' && this.activeIndex >= 0 && opts[this.activeIndex]) {
      e.preventDefault();
      opts[this.activeIndex].click();
    }
  }

  /** Render option elements from a list of {value,label,sub} */
  renderOptions(items, selectedValue) {
    if (!items.length) {
      this.list.innerHTML = '<p class="dd__empty">No matches found.</p>';
      return;
    }
    this.list.querySelectorAll('.dd__group').forEach((n) => n.remove());
    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'dd__option';
      el.setAttribute('data-dd-option', '');
      el.setAttribute('role', 'option');
      el.tabIndex = -1;
      el.setAttribute('aria-selected', String(item.value === selectedValue));
      el.innerHTML = `<span>${item.label}</span>${item.sub ? `<span class="dd__option-sub">${item.sub}</span>` : ''}`;
      el.addEventListener('click', () => {
        this.close();
        this.button.focus();
        this.opts.onSelect(item.value, item);
      });
      frag.appendChild(el);
    });
    const existing = this.list.querySelector('.dd__empty');
    if (existing) existing.remove();
    // Clear previous options only (preserve search input node if present)
    this.options.forEach((o) => o.remove());
    this.list.appendChild(frag);
  }
}
