# LaTeX → MathType Converter (Desktop)

A high-performance desktop application that converts LaTeX equations inside `.docx` files into native Microsoft Word equations (OMML), fully compatible with MathType.

---

## ✨ Features

* Convert LaTeX expressions (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) into Word equations
* Output `.docx` with editable equations (MathType-compatible)
* Fast conversion (hundreds of equations in seconds)
* Works entirely offline
* Desktop app (Electron)

---

## 🧠 How It Works

Pipeline:

```
.docx → unzip → parse XML → detect LaTeX
       → deduplicate → convert → replace → zip → .docx
```

Conversion strategy:

* **Fast path**: custom parser for simple LaTeX (e.g. `x^2`, `\frac{a}{b}`)
* **Fallback**:
  `LaTeX → MathML (KaTeX) → OMML (Word XML via XSLT)`

---

## ⚙️ Tech Stack

* Electron
* TypeScript
* pnpm
* KaTeX
* fast-xml-parser
* yauzl / yazl
* worker_threads

---

## 📦 Installation

### 1. Clone repo

```bash
git clone https://github.com/your-repo/latex-to-mathtype.git
cd latex-to-mathtype
```

### 2. Install dependencies

```bash
pnpm install
```

---

## 🚀 Development

### Run in dev mode

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

### Start app

```bash
pnpm start
```

---

## 🖥️ Usage

1. Open the app
2. Upload or drag a `.docx` file
3. Click **Convert**
4. Download the processed file

---

## 📁 Project Structure

```
src/
  main.ts            # Electron main process
  preload.ts         # IPC bridge
  renderer/          # UI
  core/
    unzip.ts
    parse.ts
    detectLatex.ts
    dedupe.ts
    convert/
      fastParser.ts
      katexToMathML.ts
      mathmlToOmml.ts
    replace.ts
    zip.ts
    worker.ts
```

---

## ⚡ Performance Optimizations

* Deduplicate LaTeX expressions before conversion
* Cache results (`Map<string, string>`)
* Parallel processing with `worker_threads`
* Avoid full XML DOM parsing where possible
* Preload KaTeX and XSLT

---

## ⚠️ Edge Cases

* Escaped `\$` is ignored
* Word may split text across multiple `<w:t>` nodes
* Inline vs block equations handled separately
* Unsupported LaTeX falls back safely

---

## 🧪 Example

Input:

```
The equation is $x^2 + 1 = 0$
```

Output:

* Rendered as a native Word equation (OMML)
* Editable via MathType

---

## 🛠️ Build Desktop App

```bash
pnpm add -D electron-builder
pnpm electron-builder
```

---

## 📌 Notes

* MathType uses a proprietary format, so this project targets **OMML**, which is fully compatible in Word
* No external APIs are used — everything runs locally

---

## 📈 Future Improvements

* Preview equations before export
* Support more complex LaTeX
* CLI mode for batch processing
* Plugin system for custom converters

---

## 📄 License

MIT
