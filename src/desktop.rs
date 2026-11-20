use std::path::Path;

#[cfg(target_os = "macos")]
pub fn reduced_motion() -> bool {
    objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
}

#[cfg(target_os = "windows")]
pub fn reduced_motion() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION,
    };
    let mut enabled = 1_i32;
    let result = unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            (&mut enabled as *mut i32).cast(),
            0,
        )
    };
    result != 0 && enabled == 0
}

#[cfg(target_os = "linux")]
pub fn reduced_motion() -> bool {
    std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "enable-animations"])
        .output()
        .is_ok_and(|result| {
            result.status.success() && String::from_utf8_lossy(&result.stdout).trim() == "false"
        })
}

pub fn reveal(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("Ce fichier a été déplacé ou supprimé.".into());
    }
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ());
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", path.display()))
        .spawn()
        .map(|_| ());
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = open::that(path.parent().unwrap_or(path));
    result.map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
pub fn fullscreen() -> bool {
    use std::process::Command;
    let Ok(root) = Command::new("xprop")
        .args([
            "-root",
            "-f",
            "_NET_ACTIVE_WINDOW",
            "32x",
            "_NET_ACTIVE_WINDOW",
        ])
        .output()
    else {
        return false;
    };
    let text = String::from_utf8_lossy(&root.stdout);
    let Some(id) = text.split_whitespace().find(|part| {
        part.starts_with("0x")
            && part.len() <= 18
            && part[2..].chars().all(|ch| ch.is_ascii_hexdigit())
            && part != &"0x0"
    }) else {
        return false;
    };
    Command::new("xprop")
        .args(["-id", id, "_NET_WM_STATE"])
        .output()
        .is_ok_and(|window| {
            String::from_utf8_lossy(&window.stdout)
                .split(|ch: char| ch == ',' || ch.is_whitespace())
                .any(|part| part == "_NET_WM_STATE_FULLSCREEN")
        })
}

#[cfg(target_os = "windows")]
pub fn fullscreen() -> bool {
    use windows_sys::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId},
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == std::process::id() {
            return false;
        }
        let mut rect: RECT = std::mem::zeroed();
        let mut monitor: MONITORINFO = std::mem::zeroed();
        monitor.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetWindowRect(hwnd, &mut rect) == 0
            || GetMonitorInfoW(
                MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST),
                &mut monitor,
            ) == 0
        {
            return false;
        }
        let bounds = monitor.rcMonitor;
        [
            (rect.left, bounds.left),
            (rect.top, bounds.top),
            (rect.right, bounds.right),
            (rect.bottom, bounds.bottom),
        ]
        .into_iter()
        .all(|(a, b)| a.abs_diff(b) <= 2)
    }
}

#[cfg(target_os = "macos")]
pub fn fullscreen() -> bool {
    use std::ffi::c_void;
    type CfObject = *const c_void;
    #[repr(C)]
    struct Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, id: u32) -> CfObject;
        fn CGMainDisplayID() -> u32;
        fn CGDisplayBounds(display: u32) -> Rect;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFPropertyListCreateData(
            allocator: CfObject,
            property_list: CfObject,
            format: isize,
            options: u64,
            error: *mut CfObject,
        ) -> CfObject;
        fn CFDataGetLength(data: CfObject) -> isize;
        fn CFDataGetBytePtr(data: CfObject) -> *const u8;
        fn CFRelease(object: CfObject);
    }
    // CoreGraphics fournit les rectangles des fenêtres visibles, dans l’ordre d’empilement.
    // Le contenu des fenêtres n’est jamais demandé.
    let (bounds, bytes) = unsafe {
        let windows = CGWindowListCopyWindowInfo(17, 0);
        if windows.is_null() {
            return false;
        }
        let encoded =
            CFPropertyListCreateData(std::ptr::null(), windows, 200, 0, std::ptr::null_mut());
        CFRelease(windows);
        if encoded.is_null() {
            return false;
        }
        let bytes = std::slice::from_raw_parts(
            CFDataGetBytePtr(encoded),
            CFDataGetLength(encoded) as usize,
        )
        .to_vec();
        CFRelease(encoded);
        (CGDisplayBounds(CGMainDisplayID()), bytes)
    };
    let Ok(value) = plist::Value::from_reader(std::io::Cursor::new(bytes)) else {
        return false;
    };
    let Some(windows) = value.as_array() else {
        return false;
    };
    let number = |value: &plist::Value| {
        value
            .as_real()
            .or_else(|| value.as_signed_integer().map(|n| n as f64))
    };
    windows
        .iter()
        .filter_map(plist::Value::as_dictionary)
        .filter(|window| {
            window
                .get("kCGWindowLayer")
                .and_then(plist::Value::as_signed_integer)
                == Some(0)
        })
        .filter(|window| {
            window
                .get("kCGWindowOwnerPID")
                .and_then(plist::Value::as_unsigned_integer)
                != Some(std::process::id() as u64)
        })
        .filter_map(|window| {
            window
                .get("kCGWindowBounds")
                .and_then(plist::Value::as_dictionary)
        })
        .find(|rect| {
            rect.get("X")
                .and_then(number)
                .is_some_and(|x| x >= bounds.x && x < bounds.x + bounds.width)
        })
        .is_some_and(|rect| {
            [
                ("X", bounds.x),
                ("Y", bounds.y),
                ("Width", bounds.width),
                ("Height", bounds.height),
            ]
            .into_iter()
            .all(|(key, expected)| {
                rect.get(key)
                    .and_then(number)
                    .is_some_and(|actual| (actual - expected).abs() <= 2.0)
            })
        })
}
