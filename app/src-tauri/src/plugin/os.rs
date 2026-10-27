use std::path::Path;

#[cfg(windows)]
pub fn thumbnail(src: &Path, edge: u32) -> Result<Vec<u8>, String> {
    use std::ffi::c_void;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject, GetDC,
        GetDIBits, GetObjectW, HGDIOBJ, ReleaseDC,
    };
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
        SIIGBF_THUMBNAILONLY,
    };
    use windows::core::HSTRING;

    let err = |e: &dyn std::fmt::Display| {
        format!("{}: OS のサムネイル生成に失敗しました：{e}", src.display())
    };
    // エクスプローラーと同じサムネイル。中身を読めない形式はアイコンになるので、サムネイルだけを頼む
    let (w, h, mut px) = unsafe {
        // 同じスレッドで何度呼んでもよい（2 回目からは S_FALSE）
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let item: IShellItemImageFactory =
            SHCreateItemFromParsingName(&HSTRING::from(src.as_os_str()), None)
                .map_err(|e| err(&e))?;
        let size = SIZE {
            cx: edge as i32,
            cy: edge as i32,
        };
        let hbm = item
            .GetImage(size, SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK)
            .map_err(|e| err(&e))?;
        let mut bm = BITMAP::default();
        GetObjectW(
            HGDIOBJ(hbm.0),
            size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut BITMAP as *mut c_void),
        );
        let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                // 負の高さで上から順に受け取る
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut px = vec![0u8; (w * h * 4).max(0) as usize];
        let dc = GetDC(None);
        let lines = GetDIBits(
            dc,
            hbm,
            0,
            h as u32,
            Some(px.as_mut_ptr() as *mut c_void),
            &mut info,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, dc);
        let _ = DeleteObject(HGDIOBJ(hbm.0));
        if lines == 0 || w <= 0 || h <= 0 {
            return Err(err(&"画像データを取得できません"));
        }
        (w as u32, h as u32, px)
    };
    // BGRA を RGBA に。透明度を持たない絵は、透明度がすべて 0 で届く
    let opaque = px.chunks_exact(4).all(|p| p[3] == 0);
    for p in px.chunks_exact_mut(4) {
        p.swap(0, 2);
        if opaque {
            p[3] = 255;
        }
    }
    let img =
        image::RgbaImage::from_raw(w, h, px).ok_or_else(|| err(&"画像サイズが一致しません"))?;
    crate::thumb::encode(image::DynamicImage::ImageRgba8(img), edge).map_err(|e| err(&e))
}

#[cfg(not(windows))]
pub fn thumbnail(src: &Path, _edge: u32) -> Result<Vec<u8>, String> {
    Err(format!(
        "{}: この OS は OS のサムネイル生成に対応していません",
        src.display()
    ))
}
