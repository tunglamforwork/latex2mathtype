import { execFile } from 'child_process';
import * as path from 'path';

export interface MathTypeResult {
  applied: boolean;
  error?: string;
  details?: string;
}

function runPowerShellScript(script: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 90_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      },
    );
  });
}

function cleanPowerShellError(raw: string): string {
  return raw
    .replace(/^#<\s*CLIXML[\s\S]*?<S S="Error">/g, '')
    .replace(/<\/S>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/_x000D__x000A_/g, '\n')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Convert OMML equations in a DOCX to MathType OLE objects using
 * Microsoft Word + MathType Word add-in automation.
 */
export async function applyMathTypeToDocx(docxPath: string): Promise<MathTypeResult> {
  if (process.platform !== 'win32') {
    return { applied: false, error: 'MathType post-processing is only supported on Windows.' };
  }

  const absPath = path.resolve(docxPath).replace(/\//g, '\\');
  const ps = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$docPath = ${psString(absPath)}
$word = $null
$doc = $null
$applied = $false
$attemptLog = @()

function Try-Run([scriptblock]$fn, [string]$name) {
  try {
    & $fn
    $script:attemptLog += "OK: $name"
    return $true
  } catch {
    $script:attemptLog += "FAIL: $name :: $($_.Exception.Message)"
    return $false
  }
}

try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($docPath, $false, $false)
  $doc.Activate() | Out-Null

  # MathType macro: convert OMML (type 3) → MathType OLE (type 1)
  # DoConvertEquations(bEntireDoc, iFromType, bConvertText, bShowDlg, sTranslator, lReserved, iToType)
  if (-not $applied) {
    $applied = Try-Run {
      $word.Run('MTCommandsMain.DoConvertEquations', $true, 3, $false, $false, '', 0, 1) | Out-Null
    } 'MTCommandsMain.DoConvertEquations(OMML->MathType)'
  }

  # Fallback: no args (lets MathType use its own defaults/dialog suppressed)
  if (-not $applied) {
    $applied = Try-Run { $word.Run('MTCommandsMain.DoConvertEquations') | Out-Null } 'MTCommandsMain.DoConvertEquations()'
  }

  # Fallback attempt: template-qualified macro names (MathType Word templates vary by version)
  if (-not $applied) {
    $templateCandidates = @()
    foreach ($tpl in $word.Templates) {
      $name = ''
      try { $name = [string]$tpl.Name } catch {}
      if ($name -match 'MathType|WordCmds|Equation') {
        $templateCandidates += $name
      }
    }
    $macroNames = @(
      'MTCommandsMain.DoConvertEquations',
      'DoConvertEquations',
      'MTCommand_ConvertEquations',
      'MTConvertEquations'
    )
    foreach ($tplName in $templateCandidates) {
      foreach ($macro in $macroNames) {
        $qualified = "$tplName!$macro"
        # Try with correct OMML→MathType args first, then no args
        if (Try-Run { $word.Run($qualified, $true, 3, $false, $false, '', 0, 1) | Out-Null } "Run macro (OMML->MT): $qualified") {
          $applied = $true
          break
        }
        if (Try-Run { $word.Run($qualified) | Out-Null } "Run macro (no args): $qualified") {
          $applied = $true
          break
        }
      }
      if ($applied) { break }
    }
  }

  function Invoke-MathTypeControl([object]$controls) {
    foreach ($ctrl in $controls) {
      $caption = ''
      $tooltip = ''
      try { $caption = [string]$ctrl.Caption } catch {}
      try { $tooltip = [string]$ctrl.TooltipText } catch {}
      $text = "$caption $tooltip"
      if (
        ($text -match 'MathType' -and $text -match 'Convert') -or
        ($text -match 'Convert Equations')
      ) {
        if (Try-Run { $ctrl.Execute() | Out-Null } "CommandBar Execute: $text") {
          return $true
        }
      }
      try {
        if ($ctrl.Controls -and $ctrl.Controls.Count -gt 0) {
          if (Invoke-MathTypeControl $ctrl.Controls) {
            return $true
          }
        }
      } catch {}
    }
    return $false
  }

  # Fallback attempt: execute command bar controls related to MathType conversion
  if (-not $applied) {
    foreach ($bar in $word.CommandBars) {
      if (Invoke-MathTypeControl $bar.Controls) {
        $applied = $true
        break
      }
    }
  }

  if ($applied) {
    $doc.Save() | Out-Null
    Write-Output "APPLIED"
  } else {
    $attempts = [string]::Join(" || ", $attemptLog)
    throw "Could not invoke MathType conversion macro in Word. Attempts: $attempts"
  }
} finally {
  if ($doc -ne $null) {
    try { $doc.Close($true) | Out-Null } catch {}
  }
  if ($word -ne $null) {
    try { $word.Quit() | Out-Null } catch {}
  }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
`;

  async function runOnce(): Promise<MathTypeResult> {
    const { stdout } = await runPowerShellScript(ps);
    const applied = stdout.includes('APPLIED');
    if (!applied) {
      return {
        applied: false,
        error: 'MathType conversion did not report success.',
        details: stdout,
      };
    }
    return { applied: true, details: stdout };
  }

  try {
    return await runOnce();
  } catch (e) {
    const firstError = cleanPowerShellError((e as Error).message);
    // Word COM can transiently fail with RPC errors if Word/add-ins are busy starting.
    if (/RPC server is unavailable|0x800706BA/i.test(firstError)) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        return await runOnce();
      } catch (e2) {
        const secondError = cleanPowerShellError((e2 as Error).message);
        return { applied: false, error: `${secondError} (after retry)` };
      }
    }
    return { applied: false, error: firstError };
  }
}

