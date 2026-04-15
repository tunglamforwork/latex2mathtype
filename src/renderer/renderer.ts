/**
 * renderer.ts
 * UI logic for the LaTeX → MathType converter.
 * Communicates with the main process via window.electronAPI (injected by preload).
 */

/// <reference path="../types.d.ts" />

import type { ElectronAPI } from '../preload';
import type { ProgressInfo, PipelineResult } from '../core/pipeline';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// ── Elements ─────────────────────────────────────────────────────────────────

const dropZone       = document.getElementById('drop-zone')!;
const filenameLabel  = document.getElementById('filename-label')!;
const btnSelect      = document.getElementById('btn-select') as HTMLButtonElement;
const btnConvert     = document.getElementById('btn-convert') as HTMLButtonElement;
const progressPanel  = document.getElementById('progress-panel')!;
const progressBar    = document.getElementById('progress-bar')!;
const statusBadge    = document.getElementById('status-badge')!;
const progressStatus = document.getElementById('progress-status')!;
const statConverted  = document.getElementById('stat-converted')!;
const statFailed     = document.getElementById('stat-failed')!;
const statTotal      = document.getElementById('stat-total')!;
const resultRow      = document.getElementById('result-row')!;
const resTotal       = document.getElementById('res-total')!;
const resConverted   = document.getElementById('res-converted')!;
const resFailed      = document.getElementById('res-failed')!;
const resTime        = document.getElementById('res-time')!;
const errorMsg       = document.getElementById('error-msg')!;
const successRow     = document.getElementById('success-row')!;
const btnOpenFolder  = document.getElementById('btn-open-folder') as HTMLButtonElement;

// ── State ─────────────────────────────────────────────────────────────────────

let selectedFilePath: string | null = null;
let outputFilePath: string | null = null;
let isConverting = false;

// ── File selection ────────────────────────────────────────────────────────────

function setFile(filePath: string) {
  selectedFilePath = filePath;
  const name = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
  filenameLabel.textContent = name;
  btnConvert.disabled = false;
  resetProgress();
}

async function selectFile() {
  const result = await window.electronAPI.openDialog();
  if (!result.canceled && result.filePaths.length > 0) {
    setFile(result.filePaths[0]);
  }
}

// ── Drag & drop ───────────────────────────────────────────────────────────────

dropZone.addEventListener('click', selectFile);

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const f = files[0];
    // Electron exposes the real path via the non-standard .path property
    const p = (f as unknown as { path: string }).path;
    if (p && p.toLowerCase().endsWith('.docx')) {
      setFile(p);
    } else {
      showError('Please drop a .docx file.');
    }
  }
});

// ── Button handlers ───────────────────────────────────────────────────────────

btnSelect.addEventListener('click', (e) => {
  e.stopPropagation(); // prevent drop zone click
  selectFile();
});

btnConvert.addEventListener('click', startConversion);

btnOpenFolder.addEventListener('click', () => {
  if (outputFilePath) {
    window.electronAPI.showItemInFolder(outputFilePath);
  }
});

// ── Conversion ────────────────────────────────────────────────────────────────

async function startConversion() {
  if (!selectedFilePath || isConverting) return;

  // Ask where to save
  const inputName = selectedFilePath.replace(/\\/g, '/').split('/').pop() ?? 'output.docx';
  const defaultOut = inputName.replace(/\.docx$/i, '_converted.docx');
  const saveResult = await window.electronAPI.saveDialog(defaultOut);
  if (saveResult.canceled || !saveResult.filePath) return;

  outputFilePath = saveResult.filePath;
  isConverting = true;
  btnConvert.disabled = true;
  btnSelect.disabled = true;
  resetProgress();
  showProgress();

  window.electronAPI.removeProgressListeners();
  window.electronAPI.onProgress((info: ProgressInfo) => updateProgress(info));

  const result: PipelineResult = await window.electronAPI.convert(
    selectedFilePath,
    outputFilePath,
  );

  isConverting = false;
  btnConvert.disabled = false;
  btnSelect.disabled = false;

  showResult(result);
}

// ── Progress UI ───────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  scanning:   'Scanning document…',
  converting: 'Converting equations…',
  replacing:  'Rebuilding document…',
  zipping:    'Writing output file…',
  done:       'Done',
  error:      'Error',
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  scanning:   'badge-scanning',
  converting: 'badge-converting',
  replacing:  'badge-replacing',
  zipping:    'badge-zipping',
  done:       'badge-done',
  error:      'badge-error',
};

function updateProgress(info: ProgressInfo) {
  const { status, total, converted, failed } = info;

  // Badge
  statusBadge.className = `badge ${STATUS_BADGE_CLASSES[status] ?? 'badge-scanning'}`;
  statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);

  progressStatus.textContent = STATUS_LABELS[status] ?? status;

  // Bar
  const pct = total > 0 ? Math.round((converted / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;

  // Stats
  statConverted.textContent = `${converted} converted`;
  statFailed.textContent = `${failed} failed`;
  statTotal.textContent = `${total} total`;
}

function showProgress() {
  progressPanel.classList.add('visible');
  resultRow.style.display = 'none';
  errorMsg.style.display = 'none';
  successRow.style.display = 'none';
}

function resetProgress() {
  progressPanel.classList.remove('visible');
  progressBar.style.width = '0%';
  resultRow.style.display = 'none';
  errorMsg.style.display = 'none';
  successRow.style.display = 'none';
}

function showResult(result: PipelineResult) {
  if (!result.success) {
    statusBadge.className = 'badge badge-error';
    statusBadge.textContent = 'Error';
    progressStatus.textContent = 'Conversion failed';
    errorMsg.textContent = result.error ?? 'Unknown error';
    errorMsg.style.display = 'block';
    return;
  }

  const { total, converted, failed, durationMs } = result.stats;
  statusBadge.className = 'badge badge-done';
  statusBadge.textContent = 'Done';
  progressStatus.textContent = total === 0
    ? 'No LaTeX equations found in document.'
    : `Converted ${converted} of ${total} equations.`;
  progressBar.style.width = '100%';

  resTotal.textContent     = String(total);
  resConverted.textContent = String(converted);
  resFailed.textContent    = String(failed);
  resTime.textContent      = String(durationMs);
  resultRow.style.display  = 'flex';

  if (total > 0) {
    successRow.style.display = 'flex';
  }
}

function showError(msg: string) {
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
}
