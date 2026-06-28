/**
 * SVG graph visualization for aerodynamic MLP [2 → 128 → 64 → 2]
 * Circular neurons, base edges + hover highlight, layer-by-layer animation.
 */

const INPUT_LABELS = ['δ', 'α'];
const LAYER_NAMES = ['Input', 'Hidden 1', 'Hidden 2', 'Output'];
const LAYER_X = [110, 340, 610, 860];
const PAD_Y = 48;
const INPUT_GAP = 78;
const HIDDEN_GAP = 11;

function fmtNum(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function nodeRadius(layerIdx) {
  if (layerIdx === 0) return 14;
  if (layerIdx === 3) return 16;
  return 4.5;
}

function activationFill(value, maxVal) {
  const t = maxVal > 0 ? Math.min(1, Math.max(0, value / maxVal)) : 0;
  const g = Math.round(70 + t * 145);
  const b = Math.round(130 + t * 125);
  return `rgb(0, ${g}, ${b})`;
}

export class MlpForwardAnimation {
  constructor(container) {
    this.container = container;
    this.passData = null;
    this.activeHead = 'cl';
    this._tooltip = null;
    this._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._buildPlaceholder();
  }

  async loadWeights() {
    try {
      const res = await fetch('/api/mlp-weights');
      const data = await res.json();
      if (data.success) {
        const tag = document.getElementById('mlpArchTag');
        if (tag && data.architecture) {
          tag.textContent = `[${data.architecture.join(' → ')}]`;
        }
      }
    } catch (err) {
      console.warn('MLP metadata load failed:', err);
    }
  }

  _buildPlaceholder() {
    this.container.innerHTML = `
      <div class="mlp-empty">
        <i class="fas fa-network-wired"></i>
        <p>Click <strong>Predict Aerodynamics</strong> to animate the network graph. Hover a neuron to highlight its edges and weights.</p>
      </div>`;
  }

  async play(sample = null) {
    if (!sample) return;

    this.container.innerHTML = `
      <div class="mlp-empty mlp-empty--loading">
        <i class="fas fa-circle-notch fa-spin"></i>
        <p>Computing forward pass…</p>
      </div>`;

    try {
      const res = await fetch('/api/mlp-forward-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deflection_mm: sample.deflection_mm,
          alpha_deg: sample.alpha_deg,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Forward pass failed');

      this.passData = data;
      this._render();
      this._animateGraph(
        this.container.querySelector(`.mlp-head-panel[data-head-panel="${this.activeHead}"]`),
      );
    } catch (err) {
      console.warn('MLP forward pass failed:', err);
      this.container.innerHTML = `
        <div class="mlp-empty mlp-empty--error">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Could not load network values: ${err.message}</p>
        </div>`;
    }
  }

  _render() {
    const { inputs_raw: raw, inputs_scaled: scaled, heads } = this.passData;
    const headKeys = Object.keys(heads);

    this.container.innerHTML = `
      <div class="mlp-shell">
        <div class="mlp-summary">
          <span>δ = <strong>${fmtNum(raw[0], 3)} mm</strong></span>
          <span>α = <strong>${fmtNum(raw[1], 1)}°</strong></span>
          <span>scaled = [${scaled.map((v) => fmtNum(v, 4)).join(', ')}]</span>
          <span>C_L = <strong>${fmtNum(heads.cl.output_value, 5)}</strong></span>
          <span>C_D = <strong>${fmtNum(heads.cd.output_value, 5)}</strong></span>
        </div>

        <div class="mlp-head-tabs" role="tablist">
          ${headKeys.map((key) => `
            <button type="button" class="mlp-head-tab ${key === this.activeHead ? 'active' : ''}"
              data-head="${key}" role="tab" aria-selected="${key === this.activeHead}">
              ${heads[key].label}
            </button>`).join('')}
        </div>

        <div class="mlp-head-panels">
          ${headKeys.map((key) => `
            <div class="mlp-head-panel ${key === this.activeHead ? 'active' : ''}" data-head-panel="${key}">
              ${this._renderGraph(heads[key], raw, key)}
            </div>`).join('')}
        </div>

        <div class="mlp-weight-tooltip" hidden aria-hidden="true"></div>
      </div>`;

    this._tooltip = this.container.querySelector('.mlp-weight-tooltip');

    this.container.querySelectorAll('.mlp-head-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeHead = btn.dataset.head;
        this.container.querySelectorAll('.mlp-head-tab').forEach((b) => {
          b.classList.toggle('active', b.dataset.head === this.activeHead);
          b.setAttribute('aria-selected', b.dataset.head === this.activeHead);
        });
        this.container.querySelectorAll('.mlp-head-panel').forEach((panel) => {
          panel.classList.toggle('active', panel.dataset.headPanel === this.activeHead);
        });
        this._hideTooltip();
        this._clearActiveEdges();
        this._animateGraph(
          this.container.querySelector(`.mlp-head-panel[data-head-panel="${this.activeHead}"]`),
        );
      });
    });

    headKeys.forEach((key) => {
      const panel = this.container.querySelector(`[data-head-panel="${key}"]`);
      this._bindGraphInteractions(panel, heads[key], raw);
    });
  }

  _layerGap(layerIdx) {
    if (layerIdx === 0) return INPUT_GAP;
    if (layerIdx === 3) return 0;
    return HIDDEN_GAP;
  }

  _computeLayout(activations) {
    const sizes = activations.map((layer) => layer.length);
    const layerSpans = sizes.map((count, layerIdx) => {
      if (count <= 1) return 0;
      return (count - 1) * this._layerGap(layerIdx);
    });
    const height = PAD_Y * 2 + Math.max(...layerSpans, INPUT_GAP) + 36;
    const midY = height / 2;

    const positions = sizes.map((count, layerIdx) => {
      const span = layerSpans[layerIdx];
      const y0 = midY - span / 2;
      const gap = this._layerGap(layerIdx);
      const r = nodeRadius(layerIdx);

      return Array.from({ length: count }, (_, i) => ({
        x: LAYER_X[layerIdx],
        y: count === 1 ? midY : y0 + i * gap,
        r,
      }));
    });

    return { sizes, height, positions };
  }

  _renderLayerBands(sizes, height) {
    const bandW = 72;
    return sizes.map((_, layerIdx) => {
      const positions = this._computeLayout(Array(sizes.length).fill([])).positions;
      // compute y range for this layer from positions - pass positions instead
      return '';
    });
  }

  _layerYRange(positions, layerIdx) {
    const ys = positions[layerIdx].map((p) => p.y);
    const rs = positions[layerIdx][0]?.r ?? 4;
    return { top: Math.min(...ys) - rs - 8, bottom: Math.max(...ys) + rs + 8 };
  }

  _renderBaseEdges(head, positions, gradId) {
    const lines = [];

    // Input → Hidden 1 (always visible, faint)
    for (let i = 0; i < positions[0].length; i++) {
      for (let j = 0; j < positions[1].length; j++) {
        const from = positions[0][i];
        const to = positions[1][j];
        lines.push({ from, to, opacity: 0.035, width: 0.35 });
      }
    }

    // Hidden 1 → Hidden 2 (subsample sources for performance)
    for (let i = 0; i < positions[1].length; i += 4) {
      for (let j = 0; j < positions[2].length; j++) {
        const from = positions[1][i];
        const to = positions[2][j];
        lines.push({ from, to, opacity: 0.02, width: 0.3 });
      }
    }

    // Hidden 2 → Output
    for (let i = 0; i < positions[2].length; i++) {
      const from = positions[2][i];
      const to = positions[3][0];
      lines.push({ from, to, opacity: 0.045, width: 0.4 });
    }

    return lines.map(({ from, to, opacity, width }) => `
      <line class="mlp-edge mlp-edge--base" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
        stroke="url(#${gradId})" stroke-opacity="${opacity}" stroke-width="${width}"/>`).join('');
  }

  _renderGraph(head, raw, uid = 'mlp') {
    const { activations, output_label } = head;
    const { sizes, height, positions } = this._computeLayout(activations);
    const maxAct = Math.max(...activations.flat().map(Math.abs), 0.001);
    const gradId = `${uid}-edge-grad`;
    const viewW = 960;

    let nodesHtml = '';
    let labelsHtml = '';
    let bandsHtml = '';

    sizes.forEach((count, layerIdx) => {
      const { top, bottom } = this._layerYRange(positions, layerIdx);
      bandsHtml += `
        <rect class="mlp-layer-band" x="${LAYER_X[layerIdx] - 36}" y="${top}"
          width="72" height="${bottom - top}" rx="10"/>`;

      labelsHtml += `
        <text class="mlp-col-label" data-col="${layerIdx}" x="${LAYER_X[layerIdx]}" y="28" text-anchor="middle">
          ${LAYER_NAMES[layerIdx]} · ×${count}
        </text>`;

      for (let i = 0; i < count; i++) {
        const { x, y, r } = positions[layerIdx][i];
        const act = activations[layerIdx][i];
        const fill = activationFill(act, maxAct);

        nodesHtml += `
          <g class="mlp-node-group" data-layer="${layerIdx}" data-neuron="${i}" tabindex="0" role="button">
            <circle class="mlp-node" cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>
            <circle class="mlp-node-ring" cx="${x}" cy="${y}" r="${r + 4}" />
          </g>`;

        if (layerIdx === 0) {
          labelsHtml += `
            <text class="mlp-node-tag mlp-node-tag--left" x="${x - r - 14}" y="${y - 2}" text-anchor="end">${INPUT_LABELS[i]}</text>
            <text class="mlp-node-val mlp-node-val--left" x="${x - r - 14}" y="${y + 12}" text-anchor="end">${fmtNum(act, 3)}</text>`;
        } else if (layerIdx === 3) {
          labelsHtml += `
            <text class="mlp-node-tag mlp-node-tag--right" x="${x + r + 14}" y="${y - 2}" text-anchor="start">${output_label}</text>
            <text class="mlp-node-val mlp-node-val--right" x="${x + r + 14}" y="${y + 12}" text-anchor="start">${fmtNum(act, 4)}</text>`;
        }
      }
    });

    const baseEdges = this._renderBaseEdges(head, positions, gradId);

    return `
      <div class="mlp-graph-wrap">
        <svg class="mlp-graph" viewBox="0 0 ${viewW} ${height}" preserveAspectRatio="xMidYMid meet" role="img"
          aria-label="Neural network graph for ${head.label}" data-graph-id="${uid}">
          <defs>
            <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#22d3ee"/>
              <stop offset="100%" stop-color="#a78bfa"/>
            </linearGradient>
          </defs>
          <g class="mlp-layer-bands">${bandsHtml}</g>
          <g class="mlp-edges-base">${baseEdges}</g>
          <g class="mlp-edges-active"></g>
          <g class="mlp-nodes">${nodesHtml}</g>
          <g class="mlp-labels">${labelsHtml}</g>
        </svg>
      </div>
      <p class="mlp-caption">Hover a neuron to highlight connections &amp; weights · ${head.label}</p>`;
  }

  _getNeuronWeightInfo(head, layerIdx, neuronIdx, raw) {
    const { weights, biases, activations, output_label } = head;

    if (layerIdx === 0) {
      return {
        title: `${INPUT_LABELS[neuronIdx]} · act ${fmtNum(activations[0][neuronIdx], 4)}`,
        subtitle: `raw ${fmtNum(raw[neuronIdx], neuronIdx === 0 ? 3 : 1)}`,
        weights: weights[0]?.[neuronIdx] ?? [],
        label: 'Outgoing weights → H1',
      };
    }
    if (layerIdx === 1) {
      return {
        title: `Hidden 1 · #${neuronIdx} · act ${fmtNum(activations[1][neuronIdx], 4)}`,
        subtitle: `bias ${fmtNum(biases[0]?.[neuronIdx], 4)}`,
        weights: weights[1]?.[neuronIdx] ?? [],
        label: 'Outgoing weights → H2',
      };
    }
    if (layerIdx === 2) {
      return {
        title: `Hidden 2 · #${neuronIdx} · act ${fmtNum(activations[2][neuronIdx], 4)}`,
        subtitle: `bias ${fmtNum(biases[1]?.[neuronIdx], 4)}`,
        weights: weights[2]?.[neuronIdx] ?? [],
        label: 'Outgoing weights → output',
      };
    }
    return {
      title: `${output_label} · act ${fmtNum(activations[3][0], 4)}`,
      subtitle: `bias ${fmtNum(biases[2]?.[0], 4)}`,
      weights: weights[2]?.map((row) => row[0]) ?? [],
      label: 'Incoming weights ← H2',
    };
  }

  _bindGraphInteractions(panel, head, raw) {
    const svg = panel.querySelector('.mlp-graph');
    if (!svg) return;

    const { positions } = this._computeLayout(head.activations);
    panel._mlpPositions = positions;
    panel._mlpHead = head;
    panel._mlpRaw = raw;

    panel.querySelectorAll('.mlp-node-group').forEach((el) => {
      const layerIdx = Number(el.dataset.layer);
      const neuronIdx = Number(el.dataset.neuron);

      el.addEventListener('mouseenter', () => {
        this._highlightNeuron(panel, layerIdx, neuronIdx);
      });
      el.addEventListener('mouseleave', () => {
        this._clearActiveEdges(panel);
        this._hideTooltip();
        panel.querySelectorAll('.mlp-node-group').forEach((n) => n.classList.remove('mlp-node-group--hover'));
      });
      el.addEventListener('focus', () => {
        this._highlightNeuron(panel, layerIdx, neuronIdx);
      });
      el.addEventListener('blur', () => {
        this._clearActiveEdges(panel);
        this._hideTooltip();
        panel.querySelectorAll('.mlp-node-group').forEach((n) => n.classList.remove('mlp-node-group--hover'));
      });
    });
  }

  _highlightNeuron(panel, layerIdx, neuronIdx) {
    const head = panel._mlpHead;
    const raw = panel._mlpRaw;
    const positions = panel._mlpPositions;
    const svg = panel.querySelector('.mlp-graph');
    if (!head || !positions || !svg) return;

    panel.querySelectorAll('.mlp-node-group').forEach((n) => n.classList.remove('mlp-node-group--hover'));
    const nodeEl = panel.querySelector(`.mlp-node-group[data-layer="${layerIdx}"][data-neuron="${neuronIdx}"]`);
    nodeEl?.classList.add('mlp-node-group--hover');

    this._drawEdges(svg, head, positions, layerIdx, neuronIdx);

    const info = this._getNeuronWeightInfo(head, layerIdx, neuronIdx, raw);
    if (!this._tooltip) return;

    const weightText = info.weights.map((w) => fmtNum(w, 4)).join(', ');
    this._tooltip.innerHTML = `
      <div class="mlp-weight-tooltip-title">${info.title}</div>
      ${info.subtitle ? `<div class="mlp-weight-tooltip-sub">${info.subtitle}</div>` : ''}
      <div class="mlp-weight-tooltip-label">${info.label} (${info.weights.length})</div>
      <div class="mlp-weight-tooltip-body">${weightText}</div>`;
    this._tooltip.hidden = false;
    this._tooltip.setAttribute('aria-hidden', 'false');

    const circle = nodeEl?.querySelector('.mlp-node');
    if (circle) this._positionTooltip(circle);
  }

  _drawEdges(svg, head, positions, layerIdx, neuronIdx) {
    const g = svg.querySelector('.mlp-edges-active');
    if (!g) return;
    g.innerHTML = '';

    const gradId = `${svg.dataset.graphId}-edge-grad`;
    const lines = [];

    if (layerIdx < 3) {
      const weights = head.weights[layerIdx]?.[neuronIdx] ?? [];
      const maxW = Math.max(...weights.map((w) => Math.abs(w)), 1e-9);
      weights.forEach((w, j) => {
        const from = positions[layerIdx][neuronIdx];
        const to = positions[layerIdx + 1][j];
        const norm = Math.abs(w) / maxW;
        lines.push({ from, to, opacity: 0.25 + norm * 0.65, width: 0.6 + norm * 2.2 });
      });
    }

    if (layerIdx > 0) {
      const W = head.weights[layerIdx - 1];
      const col = neuronIdx;
      const incoming = W.map((row) => row[col]);
      const maxW = Math.max(...incoming.map((w) => Math.abs(w)), 1e-9);
      incoming.forEach((w, k) => {
        const from = positions[layerIdx - 1][k];
        const to = positions[layerIdx][neuronIdx];
        const norm = Math.abs(w) / maxW;
        lines.push({ from, to, opacity: 0.15 + norm * 0.45, width: 0.45 + norm * 1.5 });
      });
    }

    g.innerHTML = lines.map(({ from, to, opacity, width }) => `
      <line class="mlp-edge mlp-edge--active" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
        stroke="url(#${gradId})" stroke-opacity="${opacity.toFixed(3)}"
        stroke-width="${width.toFixed(2)}"/>`).join('');
  }

  _clearActiveEdges(panel = null) {
    const panels = panel
      ? [panel]
      : [...this.container.querySelectorAll('.mlp-head-panel')];
    panels.forEach((p) => {
      p.querySelector('.mlp-edges-active')?.replaceChildren();
    });
  }

  _positionTooltip(circleEl) {
    if (!this._tooltip) return;
    const rect = circleEl.getBoundingClientRect();
    const tip = this._tooltip;

    tip.style.visibility = 'hidden';
    tip.hidden = false;

    const tipRect = tip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    let top = rect.top - tipRect.height - 12;

    if (top < 12) top = rect.bottom + 12;
    if (left < 12) left = 12;
    if (left + tipRect.width > window.innerWidth - 12) {
      left = window.innerWidth - tipRect.width - 12;
    }

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.visibility = 'visible';
  }

  _hideTooltip() {
    if (!this._tooltip) return;
    this._tooltip.hidden = true;
    this._tooltip.setAttribute('aria-hidden', 'true');
  }

  _animateGraph(panel) {
    if (!panel) return;
    const svg = panel.querySelector('.mlp-graph');
    if (!svg) return;

    svg.classList.remove('mlp-graph--lit');
    svg.querySelectorAll('.mlp-node-group').forEach((n) => {
      n.classList.remove('mlp-node-group--pulse', 'mlp-node-group--lit');
    });
    svg.querySelectorAll('.mlp-col-label').forEach((l) => l.classList.remove('mlp-col-label--active'));
    svg.querySelectorAll('.mlp-layer-band').forEach((b) => b.classList.remove('mlp-layer-band--active'));

    if (this._reducedMotion) {
      svg.classList.add('mlp-graph--lit');
      svg.querySelectorAll('.mlp-node-group').forEach((n) => n.classList.add('mlp-node-group--lit'));
      return;
    }

    for (let layer = 0; layer < 4; layer++) {
      setTimeout(() => {
        svg.querySelectorAll('.mlp-node-group').forEach((n) => n.classList.remove('mlp-node-group--pulse'));
        svg.querySelectorAll('.mlp-col-label').forEach((l) => l.classList.remove('mlp-col-label--active'));
        svg.querySelectorAll('.mlp-layer-band').forEach((b) => b.classList.remove('mlp-layer-band--active'));

        svg.querySelectorAll(`.mlp-node-group[data-layer="${layer}"]`).forEach((n) => {
          n.classList.add('mlp-node-group--pulse');
        });
        svg.querySelector(`.mlp-col-label[data-col="${layer}"]`)?.classList.add('mlp-col-label--active');
        svg.querySelectorAll('.mlp-layer-band')[layer]?.classList.add('mlp-layer-band--active');

        if (layer === 3) {
          setTimeout(() => {
            svg.classList.add('mlp-graph--lit');
            svg.querySelectorAll('.mlp-node-group').forEach((n) => {
              n.classList.remove('mlp-node-group--pulse');
              n.classList.add('mlp-node-group--lit');
            });
          }, 320);
        }
      }, layer * 380);
    }
  }
}
