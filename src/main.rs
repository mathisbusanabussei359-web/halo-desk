#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod bot;
mod data;
mod desktop;
mod services;
mod ui;

use eframe::egui;
use fs2::FileExt;

fn main() -> eframe::Result<()> {
    let storage = data::Storage::load();
    let lock_path = storage.path.with_file_name("process.lock");
    let lock = (|| -> std::io::Result<std::fs::File> {
        std::fs::create_dir_all(lock_path.parent().unwrap())?;
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(lock_path)?;
        file.try_lock_exclusive()?;
        Ok(file)
    })();
    let _lock = match lock {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(()),
        Err(error) => {
            eprintln!("Impossible de démarrer Halo Desk : {error}");
            return Ok(());
        }
    };
    let icon = eframe::icon_data::from_png_bytes(include_bytes!("../assets/icon.png")).ok();
    let mut viewport = egui::ViewportBuilder::default()
        .with_title("Halo Desk")
        .with_decorations(false)
        .with_transparent(true)
        .with_inner_size([156.0, 42.0])
        .with_min_inner_size([1.0, 1.0])
        .with_position([64.0, 12.0])
        .with_resizable(false)
        .with_window_level(egui::WindowLevel::AlwaysOnTop)
        .with_active(false);
    if let Some(icon) = icon {
        viewport = viewport.with_icon(icon);
    }
    eframe::run_native(
        "Halo Desk",
        eframe::NativeOptions {
            viewport,
            ..Default::default()
        },
        Box::new(move |context| Ok(Box::new(ui::Halo::new(context, storage)))),
    )
}
