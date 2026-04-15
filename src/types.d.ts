// Type declarations for yauzl (v3 uses same callback API as v2)
declare module 'yauzl' {
  import { EventEmitter } from 'events';
  import { Readable } from 'stream';

  interface Options {
    autoClose?: boolean;
    lazyEntries?: boolean;
    decodeStrings?: boolean;
    validateEntrySizes?: boolean;
    strictFileNames?: boolean;
  }

  interface Entry {
    fileName: string;
    extraFields: Array<{ id: number; data: Buffer }>;
    comment: string;
    versionMadeBy: number;
    versionNeededToExtract: number;
    generalPurposeBitFlag: number;
    compressionMethod: number;
    lastModFileTime: number;
    lastModFileDate: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
    fileNameLength: number;
    extraFieldLength: number;
    fileCommentLength: number;
    internalFileAttributes: number;
    externalFileAttributes: number;
    relativeOffsetOfLocalHeader: number;
  }

  interface ZipFile extends EventEmitter {
    readEntry(): void;
    openReadStream(entry: Entry, callback: (err: Error | null, stream: Readable) => void): void;
    close(): void;
    entryCount: number;
    comment: string;
  }

  function open(path: string, options: Options, callback: (err: Error | null, zipfile: ZipFile) => void): void;
  function open(path: string, callback: (err: Error | null, zipfile: ZipFile) => void): void;
}

// Type declarations for yazl
declare module 'yazl' {
  import { EventEmitter } from 'events';
  import { Readable, PassThrough } from 'stream';

  interface Options {
    mtime?: Date;
    mode?: number;
    compress?: boolean;
    forceZip64Format?: boolean;
    fileComment?: string;
  }

  interface FinalSizeOptions {
    forceZip64Format?: boolean;
  }

  class ZipFile extends EventEmitter {
    outputStream: PassThrough;
    addFile(realPath: string, metadataPath: string, options?: Options): void;
    addReadStream(input: Readable, metadataPath: string, options?: Options): void;
    addBuffer(buffer: Buffer, metadataPath: string, options?: Options): void;
    addEmptyDirectory(metadataPath: string, options?: Options): void;
    end(options?: FinalSizeOptions, finalSizeCallback?: (finalSize: number) => void): void;
  }
}

// KaTeX types (bundled but let's be explicit)
declare module 'katex' {
  interface KatexOptions {
    displayMode?: boolean;
    output?: 'html' | 'mathml' | 'htmlAndMathml';
    leqno?: boolean;
    fleqn?: boolean;
    throwOnError?: boolean;
    errorColor?: string;
    macros?: Record<string, string>;
    minRuleThickness?: number;
    colorIsTextColor?: boolean;
    maxSize?: number;
    maxExpand?: number;
    strict?: boolean | string | ((errorCode: string, errorMsg: string, token: unknown) => string | boolean);
    trust?: boolean | ((context: { command: string; url: string; protocol: string }) => boolean);
    globalGroup?: boolean;
  }

  function renderToString(expression: string, options?: KatexOptions): string;
  function renderToDomNode(expression: string, options?: KatexOptions): HTMLElement;
  const version: string;
}
