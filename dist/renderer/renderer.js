"use strict";
(() => {
  // src/renderer/renderer.ts
  var dropZone = document.getElementById("drop-zone");
  var filenameLabel = document.getElementById("filename-label");
  var btnSelect = document.getElementById("btn-select");
  var btnConvert = document.getElementById("btn-convert");
  var progressPanel = document.getElementById("progress-panel");
  var progressBar = document.getElementById("progress-bar");
  var statusBadge = document.getElementById("status-badge");
  var progressStatus = document.getElementById("progress-status");
  var statConverted = document.getElementById("stat-converted");
  var statFailed = document.getElementById("stat-failed");
  var statTotal = document.getElementById("stat-total");
  var resultRow = document.getElementById("result-row");
  var resTotal = document.getElementById("res-total");
  var resConverted = document.getElementById("res-converted");
  var resFailed = document.getElementById("res-failed");
  var resTime = document.getElementById("res-time");
  var errorMsg = document.getElementById("error-msg");
  var warningMsg = document.getElementById("warning-msg");
  var successRow = document.getElementById("success-row");
  var btnOpenFolder = document.getElementById("btn-open-folder");
  var selectedFilePath = null;
  var outputFilePath = null;
  var isConverting = false;
  function setFile(filePath) {
    selectedFilePath = filePath;
    const name = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
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
  dropZone.addEventListener("click", selectFile);
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const f = files[0];
      const p = f.path;
      if (p && p.toLowerCase().endsWith(".docx")) {
        setFile(p);
      } else {
        showError("Please drop a .docx file.");
      }
    }
  });
  btnSelect.addEventListener("click", (e) => {
    e.stopPropagation();
    selectFile();
  });
  btnConvert.addEventListener("click", startConversion);
  btnOpenFolder.addEventListener("click", () => {
    if (outputFilePath) {
      window.electronAPI.showItemInFolder(outputFilePath);
    }
  });
  async function startConversion() {
    if (!selectedFilePath || isConverting) return;
    const inputName = selectedFilePath.replace(/\\/g, "/").split("/").pop() ?? "output.docx";
    const defaultOut = inputName.replace(/\.docx$/i, "_converted.docx");
    const saveResult = await window.electronAPI.saveDialog(defaultOut);
    if (saveResult.canceled || !saveResult.filePath) return;
    outputFilePath = saveResult.filePath;
    isConverting = true;
    btnConvert.disabled = true;
    btnSelect.disabled = true;
    resetProgress();
    showProgress();
    window.electronAPI.removeProgressListeners();
    window.electronAPI.onProgress((info) => updateProgress(info));
    const result = await window.electronAPI.convert(
      selectedFilePath,
      outputFilePath
    );
    isConverting = false;
    btnConvert.disabled = false;
    btnSelect.disabled = false;
    showResult(result);
  }
  var STATUS_LABELS = {
    scanning: "Scanning document\u2026",
    converting: "Converting equations\u2026",
    replacing: "Rebuilding document\u2026",
    zipping: "Writing output file\u2026",
    postprocessing: "Applying MathType format\u2026",
    done: "Done",
    error: "Error"
  };
  var STATUS_BADGE_CLASSES = {
    scanning: "badge-scanning",
    converting: "badge-converting",
    replacing: "badge-replacing",
    zipping: "badge-zipping",
    postprocessing: "badge-zipping",
    done: "badge-done",
    error: "badge-error"
  };
  function updateProgress(info) {
    const { status, total, converted, failed, message } = info;
    statusBadge.className = `badge ${STATUS_BADGE_CLASSES[status] ?? "badge-scanning"}`;
    statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    progressStatus.textContent = message ?? STATUS_LABELS[status] ?? status;
    const pct = total > 0 ? Math.round(converted / total * 100) : 0;
    progressBar.style.width = `${pct}%`;
    statConverted.textContent = `${converted} converted`;
    statFailed.textContent = `${failed} failed`;
    statTotal.textContent = `${total} total`;
  }
  function showProgress() {
    progressPanel.classList.add("visible");
    resultRow.style.display = "none";
    errorMsg.style.display = "none";
    warningMsg.style.display = "none";
    successRow.style.display = "none";
  }
  function resetProgress() {
    progressPanel.classList.remove("visible");
    progressBar.style.width = "0%";
    resultRow.style.display = "none";
    errorMsg.style.display = "none";
    warningMsg.style.display = "none";
    successRow.style.display = "none";
  }
  function showResult(result) {
    if (!result.success) {
      statusBadge.className = "badge badge-error";
      statusBadge.textContent = "Error";
      progressStatus.textContent = "Conversion failed";
      errorMsg.textContent = result.error ?? "Unknown error";
      errorMsg.style.display = "block";
      return;
    }
    const { total, converted, failed, durationMs } = result.stats;
    statusBadge.className = "badge badge-done";
    statusBadge.textContent = "Done";
    progressStatus.textContent = total === 0 ? "No LaTeX equations found in document." : `Converted ${converted} of ${total} equations.`;
    if (result.warning) {
      progressStatus.textContent += " MathType post-process had warnings.";
      warningMsg.textContent = result.warning;
      warningMsg.style.display = "block";
    }
    progressBar.style.width = "100%";
    resTotal.textContent = String(total);
    resConverted.textContent = String(converted);
    resFailed.textContent = String(failed);
    resTime.textContent = String(durationMs);
    resultRow.style.display = "flex";
    if (total > 0) {
      successRow.style.display = "flex";
    }
  }
  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = "block";
  }
})();
//# sourceMappingURL=renderer.js.map
