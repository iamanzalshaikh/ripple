use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct ScreenshotOcrParams {
    pub hwnd: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ScreenshotOcrResult {
    pub text: String,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "lineCount")]
    pub line_count: usize,
}

#[cfg(windows)]
struct CapturedBgra {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

/// GPU-composited windows (Chrome, Electron/Cursor) return blank images from
/// plain BitBlt. Detect a near-uniform capture so callers can fall back.
#[cfg(windows)]
fn is_mostly_blank(px: &[u8]) -> bool {
    if px.len() < 4 {
        return true;
    }
    let pixel_count = px.len() / 4;
    let step = (pixel_count / 4096).max(1) * 4;
    let (mut min_b, mut min_g, mut min_r) = (255u8, 255u8, 255u8);
    let (mut max_b, mut max_g, mut max_r) = (0u8, 0u8, 0u8);
    let mut i = 0usize;
    while i + 3 < px.len() {
        let (b, g, r) = (px[i], px[i + 1], px[i + 2]);
        min_b = min_b.min(b);
        min_g = min_g.min(g);
        min_r = min_r.min(r);
        max_b = max_b.max(b);
        max_g = max_g.max(g);
        max_r = max_r.max(r);
        i += step;
    }
    (max_b - min_b) < 8 && (max_g - min_g) < 8 && (max_r - min_r) < 8
}

#[cfg(windows)]
unsafe fn read_bitmap_pixels(
    mem_dc: windows::Win32::Graphics::Gdi::HDC,
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    use windows::Win32::Graphics::Gdi::{
        GetDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };

    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };

    let stride = (width * 4) as usize;
    let mut pixels = vec![0u8; stride * height as usize];
    let lines = GetDIBits(
        mem_dc,
        bitmap,
        0,
        height,
        Some(pixels.as_mut_ptr() as *mut _),
        &mut info,
        DIB_RGB_COLORS,
    );
    if lines == 0 {
        return Err("get_dibits_failed".into());
    }
    Ok(pixels)
}

#[cfg(windows)]
fn capture_hwnd(hwnd: windows::Win32::Foundation::HWND) -> Result<CapturedBgra, String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        ReleaseDC, SelectObject, SRCCOPY,
    };
    use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

    // PW_CLIENTONLY (0x1) | PW_RENDERFULLCONTENT (0x2) — required for
    // GPU-composited windows (Chrome, Electron/Cursor) that BitBlt captures as blank.
    const PW_CLIENT_FULL: PRINT_WINDOW_FLAGS = PRINT_WINDOW_FLAGS(0x1 | 0x2);

    unsafe {
        if hwnd.0.is_null() {
            return Err("invalid_hwnd".into());
        }

        let mut rect = RECT::default();
        if GetClientRect(hwnd, &mut rect).is_err() {
            return Err("get_client_rect_failed".into());
        }

        let width = (rect.right - rect.left).max(0) as u32;
        let height = (rect.bottom - rect.top).max(0) as u32;
        if width == 0 || height == 0 {
            return Err("empty_window".into());
        }
        if width > 4096 || height > 4096 {
            return Err("window_too_large".into());
        }

        let window_dc = GetDC(hwnd);
        if window_dc.is_invalid() {
            return Err("get_dc_failed".into());
        }

        let mem_dc = CreateCompatibleDC(window_dc);
        if mem_dc.is_invalid() {
            let _ = ReleaseDC(hwnd, window_dc);
            return Err("create_compatible_dc_failed".into());
        }

        let bitmap = CreateCompatibleBitmap(window_dc, width as i32, height as i32);
        if bitmap.is_invalid() {
            let _ = DeleteDC(mem_dc);
            let _ = ReleaseDC(hwnd, window_dc);
            return Err("create_compatible_bitmap_failed".into());
        }

        let old = SelectObject(mem_dc, bitmap);

        let print_ok = PrintWindow(hwnd, mem_dc, PW_CLIENT_FULL).as_bool();
        let mut pixels = if print_ok {
            read_bitmap_pixels(mem_dc, bitmap, width, height).ok()
        } else {
            None
        };

        let blank = pixels.as_deref().map(is_mostly_blank).unwrap_or(true);

        if blank {
            let _ = BitBlt(mem_dc, 0, 0, width as i32, height as i32, window_dc, 0, 0, SRCCOPY);
            pixels = read_bitmap_pixels(mem_dc, bitmap, width, height).ok();
        }

        let _ = SelectObject(mem_dc, old);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(mem_dc);
        let _ = ReleaseDC(hwnd, window_dc);

        match pixels {
            Some(pixels) => Ok(CapturedBgra {
                width,
                height,
                pixels,
            }),
            None => Err("capture_read_failed".into()),
        }
    }
}

/// Full primary-screen capture — fallback when window capture is blank
/// (GPU windows) or unreadable. Screen DC always contains composited pixels.
#[cfg(windows)]
fn capture_screen() -> Result<CapturedBgra, String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        ReleaseDC, SelectObject, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

    unsafe {
        let width = GetSystemMetrics(SM_CXSCREEN).max(0) as u32;
        let height = GetSystemMetrics(SM_CYSCREEN).max(0) as u32;
        if width == 0 || height == 0 {
            return Err("screen_metrics_failed".into());
        }
        if width > 8192 || height > 8192 {
            return Err("screen_too_large".into());
        }

        let desktop = HWND(std::ptr::null_mut());
        let screen_dc = GetDC(desktop);
        if screen_dc.is_invalid() {
            return Err("get_screen_dc_failed".into());
        }

        let mem_dc = CreateCompatibleDC(screen_dc);
        if mem_dc.is_invalid() {
            let _ = ReleaseDC(desktop, screen_dc);
            return Err("create_compatible_dc_failed".into());
        }

        let bitmap = CreateCompatibleBitmap(screen_dc, width as i32, height as i32);
        if bitmap.is_invalid() {
            let _ = DeleteDC(mem_dc);
            let _ = ReleaseDC(desktop, screen_dc);
            return Err("create_compatible_bitmap_failed".into());
        }

        let old = SelectObject(mem_dc, bitmap);
        let _ = BitBlt(mem_dc, 0, 0, width as i32, height as i32, screen_dc, 0, 0, SRCCOPY);
        let pixels = read_bitmap_pixels(mem_dc, bitmap, width, height);

        let _ = SelectObject(mem_dc, old);
        let _ = DeleteObject(bitmap);
        let _ = DeleteDC(mem_dc);
        let _ = ReleaseDC(desktop, screen_dc);

        Ok(CapturedBgra {
            width,
            height,
            pixels: pixels?,
        })
    }
}

#[cfg(windows)]
fn recognize_bgra(capture: &CapturedBgra) -> Result<String, String> {
    use windows::Foundation::AsyncStatus;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("ocr_engine_failed:{e}"))?;

    let writer = DataWriter::new().map_err(|e| format!("data_writer_failed:{e}"))?;
    writer
        .WriteBytes(&capture.pixels)
        .map_err(|e| format!("write_bytes_failed:{e}"))?;
    let buffer = writer
        .DetachBuffer()
        .map_err(|e| format!("detach_buffer_failed:{e}"))?;

    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        capture.width as i32,
        capture.height as i32,
    )
    .map_err(|e| format!("software_bitmap_failed:{e}"))?;

    let op = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("ocr_recognize_failed:{e}"))?;

    loop {
        let status = op.Status().map_err(|e| format!("ocr_status_failed:{e}"))?;
        match status {
            AsyncStatus::Started => {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            AsyncStatus::Completed => break,
            AsyncStatus::Error => return Err("ocr_async_error".into()),
            AsyncStatus::Canceled => return Err("ocr_async_canceled".into()),
            _ => std::thread::sleep(std::time::Duration::from_millis(5)),
        }
    }

    let result = op
        .GetResults()
        .map_err(|e| format!("ocr_results_failed:{e}"))?;
    Ok(result.Text().unwrap_or_default().to_string())
}

#[cfg(windows)]
pub fn screenshot_ocr(params: &ScreenshotOcrParams) -> Result<ScreenshotOcrResult, String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let hwnd = if let Some(h) = params.hwnd {
        HWND(h as isize as *mut _)
    } else {
        unsafe { GetForegroundWindow() }
    };

    // Window capture first; fall back to full-screen capture when the window
    // capture fails, comes back blank, or yields no OCR text (GPU windows,
    // wrong hwnd, occluded overlay windows).
    let window_capture = if hwnd.0.is_null() {
        Err("no_target_window".to_string())
    } else {
        capture_hwnd(hwnd)
    };

    let (mut capture, used_screen) = match window_capture {
        Ok(c) if !is_mostly_blank(&c.pixels) => (c, false),
        _ => (capture_screen()?, true),
    };

    let mut text = recognize_bgra(&capture)?;
    if text.trim().is_empty() && !used_screen {
        if let Ok(screen) = capture_screen() {
            if let Ok(screen_text) = recognize_bgra(&screen) {
                if !screen_text.trim().is_empty() {
                    capture = screen;
                    text = screen_text;
                }
            }
        }
    }

    let line_count = if text.is_empty() {
        0
    } else {
        text.lines().count()
    };

    Ok(ScreenshotOcrResult {
        text,
        width: capture.width,
        height: capture.height,
        line_count,
    })
}

#[cfg(not(windows))]
pub fn screenshot_ocr(_params: &ScreenshotOcrParams) -> Result<ScreenshotOcrResult, String> {
    Err("ocr_requires_windows".into())
}

pub fn screenshot_ocr_from_value(params: Value) -> Result<ScreenshotOcrResult, String> {
    let parsed: ScreenshotOcrParams =
        serde_json::from_value(params).map_err(|e| format!("bad_params:{e}"))?;
    screenshot_ocr(&parsed)
}

pub fn is_ocr_available() -> bool {
    #[cfg(windows)]
    {
        use windows::Media::Ocr::OcrEngine;
        OcrEngine::TryCreateFromUserProfileLanguages().is_ok()
    }
    #[cfg(not(windows))]
    {
        false
    }
}
