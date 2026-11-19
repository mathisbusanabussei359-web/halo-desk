const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const run = promisify(execFile)

const macScript = `
ObjC.import('AppKit')
ObjC.import('CoreGraphics')
const pid = $.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier
const windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(17, 0)) || []
JSON.stringify(windows.filter(w => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0).map(w => w.kCGWindowBounds))
`

const windowsScript = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HaloWindow {
  [StructLayout(LayoutKind.Sequential)]
  public struct Rect { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct Monitor { public int size; public Rect full, work; public uint flags; }
  [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr monitor, ref Monitor info);
  public static void Init() { SetProcessDPIAware(); }
  public static bool Fullscreen(uint haloPid) {
    IntPtr hwnd = GetForegroundWindow();
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    if (hwnd == IntPtr.Zero || pid == haloPid) return false;
    Rect window;
    Monitor monitor = new Monitor { size = Marshal.SizeOf(typeof(Monitor)) };
    if (!GetWindowRect(hwnd, out window) || !GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref monitor)) return false;
    Rect full = monitor.full;
    return Math.Abs(window.left - full.left) <= 2 && Math.Abs(window.top - full.top) <= 2
      && Math.Abs(window.right - full.right) <= 2 && Math.Abs(window.bottom - full.bottom) <= 2;
  }
}
'@
[HaloWindow]::Init()
while ($true) {
  [Console]::WriteLine([HaloWindow]::Fullscreen(${process.pid}))
  Start-Sleep -Milliseconds 750
}
`

function coversDisplay(window, display) {
  return Math.abs(window.X - display.x) <= 2 &&
    Math.abs(window.Y - display.y) <= 2 &&
    Math.abs(window.Width - display.width) <= 2 &&
    Math.abs(window.Height - display.height) <= 2
}

function watchFullscreen(onChange, getDisplay) {
  if (process.platform === 'win32') {
    const encoded = Buffer.from(windowsScript, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    })
    const lines = require('node:readline').createInterface({ input: child.stdout })
    lines.on('line', line => {
      if (/^(true|false)$/i.test(line.trim())) onChange(/^true$/i.test(line.trim()))
    })
    child.on('error', () => onChange(false))
    child.on('close', () => onChange(false))
    return () => { lines.close(); child.kill() }
  }

  if (process.platform !== 'darwin' && (process.platform !== 'linux' || !process.env.DISPLAY)) return () => {}
  let running = false
  let stopped = false
  const options = { timeout: 1800, maxBuffer: 65536 }
  async function sample() {
    if (running) return
    running = true
    try {
      let fullscreen = false
      if (process.platform === 'darwin') {
        const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macScript], options)
        fullscreen = JSON.parse(stdout).some(window => coversDisplay(window, getDisplay()))
      } else {
        const { stdout } = await run('xprop', ['-root', '-f', '_NET_ACTIVE_WINDOW', '32x', '_NET_ACTIVE_WINDOW'], options)
        const id = stdout.match(/0x[0-9a-f]+/i)?.[0]
        if (id && id !== '0x0') {
          const properties = await run('xprop', ['-id', id, '_NET_WM_STATE'], options)
          fullscreen = /\b_NET_WM_STATE_FULLSCREEN\b/.test(properties.stdout)
        }
      }
      if (!stopped) onChange(fullscreen)
    } catch (error) {
      if (!stopped) onChange(false)
      if (error.code === 'ENOENT') clearInterval(interval)
    } finally {
      running = false
    }
  }
  const interval = setInterval(sample, 900)
  sample()
  return () => { stopped = true; clearInterval(interval) }
}

module.exports = { watchFullscreen }
