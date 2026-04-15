/**
 * preload.ts
 * Exposes a safe, typed API to the renderer via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { ProgressInfo, PipelineResult } from './core/pipeline';

export interface ElectronAPI {
  openDialog(): Promise<Electron.OpenDialogReturnValue>;
  saveDialog(defaultName: string): Promise<Electron.SaveDialogReturnValue>;
  convert(inputPath: string, outputPath: string): Promise<PipelineResult>;
  onProgress(callback: (info: ProgressInfo) => void): void;
  removeProgressListeners(): void;
  showItemInFolder(filePath: string): Promise<void>;
}

contextBridge.exposeInMainWorld('electronAPI', {
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  saveDialog: (defaultName: string) => ipcRenderer.invoke('save-dialog', defaultName),
  convert: (inputPath: string, outputPath: string) =>
    ipcRenderer.invoke('convert', inputPath, outputPath),
  onProgress: (callback: (info: ProgressInfo) => void) => {
    ipcRenderer.on('progress', (_event, info: ProgressInfo) => callback(info));
  },
  removeProgressListeners: () => {
    ipcRenderer.removeAllListeners('progress');
  },
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('show-item-in-folder', filePath),
} satisfies ElectronAPI);
