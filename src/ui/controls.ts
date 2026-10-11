/**
 * Generic DOM widgets (DESIGN.md §7).
 *
 * Plain DOM on purpose: there are about a dozen controls, and a framework would add build weight
 * and a render loop of its own for no gain.
 */

export interface SliderSpec {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  /** Shown next to the value, e.g. 'm', 'm/s', 'deg'. */
  readonly unit: string;
  readonly places?: number;
  readonly hint?: string;
}

export interface SliderHandle {
  readonly el: HTMLElement;
  get(): number;
  /** Set without firing onChange — used when another control drives this one. */
  set(v: number): void;
}

export function createSlider(spec: SliderSpec, onChange: (v: number) => void): SliderHandle {
  const places = spec.places ?? 2;

  const wrap = document.createElement('div');
  wrap.className = 'control';

  const head = document.createElement('div');
  head.className = 'control-head';

  const label = document.createElement('label');
  label.textContent = spec.label;
  label.htmlFor = `slider-${spec.id}`;

  const readout = document.createElement('input');
  readout.type = 'number';
  readout.className = 'control-value';
  readout.min = String(spec.min);
  readout.max = String(spec.max);
  readout.step = String(spec.step);
  readout.value = spec.value.toFixed(places);

  const unit = document.createElement('span');
  unit.className = 'control-unit';
  unit.textContent = spec.unit;

  head.append(label, readout, unit);

  const range = document.createElement('input');
  range.type = 'range';
  range.id = `slider-${spec.id}`;
  range.min = String(spec.min);
  range.max = String(spec.max);
  range.step = String(spec.step);
  range.value = String(spec.value);

  wrap.append(head, range);

  if (spec.hint !== undefined) {
    const hint = document.createElement('div');
    hint.className = 'control-hint';
    hint.textContent = spec.hint;
    wrap.append(hint);
  }

  const clamp = (v: number): number => Math.min(spec.max, Math.max(spec.min, v));

  const sync = (v: number, fire: boolean): void => {
    const c = clamp(v);
    range.value = String(c);
    readout.value = c.toFixed(places);
    if (fire) onChange(c);
  };

  range.addEventListener('input', () => sync(Number(range.value), true));
  readout.addEventListener('change', () => sync(Number(readout.value), true));

  return {
    el: wrap,
    get: () => Number(range.value),
    set: (v: number) => sync(v, false),
  };
}

export interface ToggleHandle {
  readonly el: HTMLElement;
  get(): boolean;
  set(v: boolean): void;
}

export function createToggle(
  label: string,
  value: boolean,
  onChange: (v: boolean) => void,
): ToggleHandle {
  const wrap = document.createElement('label');
  wrap.className = 'toggle';

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = value;

  const text = document.createElement('span');
  text.textContent = label;

  wrap.append(box, text);
  box.addEventListener('change', () => onChange(box.checked));

  return {
    el: wrap,
    get: () => box.checked,
    set: (v: boolean) => {
      box.checked = v;
    },
  };
}

export function createButton(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

export function createSection(title: string, ...children: HTMLElement[]): HTMLElement {
  const s = document.createElement('section');
  s.className = 'panel-section';
  const h = document.createElement('h2');
  h.textContent = title;
  s.append(h, ...children);
  return s;
}

export function createRow(...children: HTMLElement[]): HTMLElement {
  const d = document.createElement('div');
  d.className = 'row';
  d.append(...children);
  return d;
}

export function createSelect<T extends string>(
  label: string,
  options: readonly { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'control';

  const head = document.createElement('div');
  head.className = 'control-head';
  const lab = document.createElement('label');
  lab.textContent = label;
  head.append(lab);

  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value as T));

  wrap.append(head, sel);
  return wrap;
}
