/**
 * main.ts
 * Electron main process.
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import { pipeline, ProgressInfo } from './core/pipeline';

// ── Window ─────────────────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 700,
    height: 560,
    resizable: false,
    title: 'LaTeX → MathType Converter',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Open DevTools in dev mode
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const win = createWindow();

  // ── IPC handlers ────────────────────────────────────────────────────────────

  ipcMain.handle('open-dialog', async () => {
    return dialog.showOpenDialog(win, {
      title: 'Select a .docx file',
      properties: ['openFile'],
      filters: [
        { name: 'Word Documents', extensions: ['docx'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
  });

  ipcMain.handle('save-dialog', async (_event, defaultName: string) => {
    return dialog.showSaveDialog(win, {
      title: 'Save converted .docx',
      defaultPath: defaultName,
      filters: [{ name: 'Word Documents', extensions: ['docx'] }],
    });
  });

  ipcMain.handle('show-item-in-folder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle(
    'convert',
    async (_event, inputPath: string, outputPath: string): Promise<unknown> => {
      return pipeline(inputPath, outputPath, (info: ProgressInfo) => {
        // Forward progress updates to renderer
        if (!win.isDestroyed()) {
          win.webContents.send('progress', info);
        }
      });
    },
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
