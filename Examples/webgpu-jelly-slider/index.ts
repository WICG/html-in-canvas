import { d } from 'typegpu';

const body = document.querySelector('body') as HTMLBodyElement;
body.style.display = 'flex';
body.style.flexDirection = 'column';
body.style.alignItems = 'center';
body.style.height = '100vh';
body.style.gap = '1.5rem';
body.style.margin = '0';
body.style.boxSizing = 'border-box';
body.style.padding = '1rem';

// Resize canvases
for (const canvas of document.querySelectorAll('canvas')) {
  if ('width' in canvas.attributes || 'height' in canvas.attributes) {
    continue; // custom canvas, not replacing with resizable
  }

  const container = document.createElement('div');
  const frame = document.createElement('div');

  canvas.parentElement?.replaceChild(container, canvas);

  frame.appendChild(canvas);
  container.appendChild(frame);

  container.style.display = 'flex';
  container.style.flex = '1';
  container.style.justifyContent = 'center';
  container.style.alignItems = 'top';
  container.style.width = '100%';

  container.style.containerType = 'size';

  frame.style.position = 'relative';

  if (canvas.dataset.fitToContainer !== undefined) {
    frame.style.width = '100%';
    frame.style.height = '100%';
  } else {
    const aspectRatio = canvas.dataset.aspectRatio ?? '1';
    frame.style.aspectRatio = aspectRatio;
    frame.style.height = `min(calc(min(100cqw, 100cqh)/(${aspectRatio})), min(100cqw, 100cqh))`;
  }

  canvas.style.position = 'absolute';
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  const onResize = () => {
    canvas.width = frame.clientWidth * window.devicePixelRatio;
    canvas.height = frame.clientHeight * window.devicePixelRatio;
  };

  onResize();
  new ResizeObserver(onResize).observe(container);
}

const controlsPanel = document.createElement('div');
controlsPanel.style.display = 'grid';
controlsPanel.style.gridTemplateColumns = '1fr 1fr';
controlsPanel.style.gap = '1rem';
if (body.firstChild) {
  body.insertBefore(controlsPanel, body.firstChild);
} else {
  body.appendChild(controlsPanel);
}

// Execute example
const example = await import('./src/index.ts');

// Create example controls
for (const controls of Object.values(example)) {
  if (typeof controls === 'function') {
    continue;
  }

  for (const [label, params] of Object.entries(controls as Record<string, ExampleControlParam>)) {
    if ('onButtonClick' in params) {
      const button = document.createElement('button');
      button.innerText = label;
      button.style.gridColumn = 'span 2';
      button.addEventListener('click', () => params.onButtonClick());
      controlsPanel.appendChild(button);
    } else {
      const controlRow = document.createElement('div');
      controlRow.style.display = 'contents';
      const labelDiv = document.createElement('div');
      labelDiv.innerText = label;
      controlRow.appendChild(labelDiv);

      if ('onSliderChange' in params) {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = `${params.min}`;
        slider.max = `${params.max}`;
        slider.step = `${params.step ?? 0.1}`;
        slider.value = `${params.initial}`;
        slider.addEventListener('input', () => {
          params.onSliderChange(Number.parseFloat(slider.value));
        });

        controlRow.appendChild(slider);
        params.onSliderChange(Number.parseFloat(slider.value));
      }

      if ('onSelectChange' in params) {
        const select = document.createElement('select');
        select.innerHTML = params.options
          .map((option) => `<option value="${option}">${option}</option>`)
          .join('');
        select.value = params.initial;

        select.addEventListener('change', () => {
          params.onSelectChange(select.value);
        });

        controlRow.appendChild(select);
        params.onSelectChange(select.value);
      }

      if ('onVectorSliderChange' in params) {
        const sliderContainer = document.createElement('div');
        sliderContainer.style.display = 'flex';
        sliderContainer.style.flexDirection = 'column';
        sliderContainer.style.gap = '0.2rem';

        const currentValues = params.initial;
        const length = params.min.length;
        const labels = ['x', 'y', 'z', 'w'];

        for (let i = 0; i < length; i++) {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '0.2rem';

          const labelSpan = document.createElement('span');
          labelSpan.innerText = labels[i];

          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = `${params.min[i]}`;
          slider.max = `${params.max[i]}`;
          slider.step = `${params.step[i] ?? 0.1}`;
          slider.value = `${currentValues[i]}`;

          slider.addEventListener('input', () => {
            currentValues[i] = Number.parseFloat(slider.value);
            (params.onVectorSliderChange as (value: d.v2f | d.v3f | d.v4f) => void)(currentValues);
          });

          row.appendChild(labelSpan);
          row.appendChild(slider);
          sliderContainer.appendChild(row);
        }

        (params.onVectorSliderChange as (value: d.v2f | d.v3f | d.v4f) => void)(currentValues);
        controlRow.appendChild(sliderContainer);
      }

      if ('onColorChange' in params) {
        const input = document.createElement('input');
        input.type = 'color';

        const initial = params.initial ?? [0, 0, 0];
        input.value = rgbToHex(initial);

        input.addEventListener('input', () => {
          params.onColorChange(hexToRgb(input.value));
        });

        params.onColorChange(initial);
        controlRow.appendChild(input);
      }

      if ('onToggleChange' in params) {
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = params.initial ?? false;

        toggle.addEventListener('change', () => {
          params.onToggleChange(toggle.checked);
        });

        controlRow.appendChild(toggle);
        params.onToggleChange(toggle.checked);
      }

      if ('onTextChange' in params) {
        const input = document.createElement('input');
        input.value = params.initial ?? '';

        input.addEventListener('input', () => {
          params.onTextChange(input.value);
        });

        controlRow.appendChild(input);
        params.onTextChange(input.value);
      }

      controlsPanel.appendChild(controlRow);
    }
  }
}

type SelectControlParam = {
  onSelectChange: (newValue: string) => void;
  initial: string;
  options: string[];
};

type ToggleControlParam = {
  onToggleChange: (newValue: boolean) => void;
  initial: boolean;
};

type SliderControlParam = {
  onSliderChange: (newValue: number) => void;
  initial: number;
  min?: number;
  max?: number;
  step?: number;
};

type VectorSliderControlParam<T extends d.v2f | d.v3f | d.v4f> = {
  onVectorSliderChange: (newValue: T) => void;
  initial: T;
  min: T;
  max: T;
  step: T;
};

type ColorPickerControlParam = {
  onColorChange: (newValue: d.v3f) => void;
  initial: d.v3f;
};

type ButtonControlParam = {
  onButtonClick: (() => void) | (() => Promise<void>);
};

type TextAreaControlParam = {
  onTextChange: (newValue: string) => void;
  initial: string;
};

type ExampleControlParam =
  | SelectControlParam
  | ToggleControlParam
  | SliderControlParam
  | ButtonControlParam
  | TextAreaControlParam
  | VectorSliderControlParam<d.v2f>
  | VectorSliderControlParam<d.v3f>
  | VectorSliderControlParam<d.v4f>
  | ColorPickerControlParam;

function hexToRgb(hex: string): d.v3f {
  return d.vec3f(
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  );
}

function componentToHex(c: number) {
  const hex = (c * 255).toString(16);
  return hex.length === 1 ? `0${hex}` : hex;
}

function rgbToHex(rgb: d.v3f) {
  return `#${rgb.map(componentToHex).join('')}`;
}
