use crate::{
    bot,
    data::{self, Data, Place, Position, SavedFile, Storage},
    desktop,
    services::{self, Forecast, Playback},
};
use device_query::{DeviceQuery, DeviceState};
use eframe::egui::{self, Color32, RichText, Vec2, ViewportCommand};
use global_hotkey::{
    hotkey::{Code, HotKey, Modifiers},
    GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState,
};
use std::{
    path::PathBuf,
    sync::mpsc,
    time::{Duration, Instant},
};

const PAGES: &[(&str, &str)] = &[
    ("assistant", "Halo"),
    ("tasks", "Tâches"),
    ("notes", "Notes"),
    ("files", "Fichiers"),
    ("music", "Musique"),
    ("weather", "Météo"),
    ("settings", "Réglages"),
];
const COMPACT: Vec2 = Vec2::new(156.0, 42.0);
const EXPANDED: Vec2 = Vec2::new(520.0, 574.0);
const MINT: Color32 = Color32::from_rgb(171, 242, 211);
const MUTED: Color32 = Color32::from_rgb(169, 169, 176);

enum Background {
    Files(bool, Vec<PathBuf>),
    Places(Result<Vec<Place>, String>),
    Weather(Place, Result<Forecast, String>),
}

pub struct Halo {
    storage: Storage,
    page: &'static str,
    expanded: bool,
    manually_hidden: bool,
    fullscreen: bool,
    passthrough: bool,
    geometry: Option<(Vec2, egui::Pos2)>,
    input: String,
    task: String,
    note: String,
    chat: Vec<(bool, String)>,
    feedback: Option<(String, Instant)>,
    mascot: egui::TextureHandle,
    reaction: Option<(&'static str, Instant)>,
    finished: Option<Instant>,
    pointer: Option<DeviceState>,
    last_point: Option<(i32, i32)>,
    last_motion: Instant,
    last_desktop: Instant,
    shortcuts: Option<GlobalHotKeyManager>,
    tray: Option<tray_icon::TrayIcon>,
    tray_menu: Option<(tray_icon::menu::MenuId, tray_icon::menu::MenuId)>,
    tray_initialized: bool,
    reduced_motion: bool,
    playback: Option<(String, Playback)>,
    city: String,
    places: Vec<Place>,
    weather: Option<(Place, Forecast)>,
    weather_status: String,
    weather_busy: bool,
    dialog_busy: bool,
    sender: mpsc::Sender<Background>,
    receiver: mpsc::Receiver<Background>,
}

impl Halo {
    pub fn new(context: &eframe::CreationContext<'_>, storage: Storage) -> Self {
        let ctx = &context.egui_ctx;
        let mut visuals = egui::Visuals::dark();
        visuals.panel_fill = Color32::TRANSPARENT;
        visuals.window_fill = Color32::from_rgb(15, 15, 17);
        visuals.extreme_bg_color = Color32::from_rgb(16, 16, 18);
        visuals.selection.bg_fill = Color32::from_rgb(49, 79, 70);
        visuals.widgets.inactive.weak_bg_fill = Color32::from_rgb(30, 30, 34);
        visuals.widgets.inactive.fg_stroke.color = Color32::from_gray(230);
        visuals.widgets.hovered.weak_bg_fill = Color32::from_rgb(45, 45, 51);
        ctx.set_visuals(visuals);
        let image = image::load_from_memory(include_bytes!("../assets/halo-bot.webp"))
            .unwrap()
            .into_rgba8();
        let size = [image.width() as usize, image.height() as usize];
        let mascot = ctx.load_texture(
            "Halo",
            egui::ColorImage::from_rgba_unmultiplied(size, &image),
            egui::TextureOptions::LINEAR,
        );
        let modifiers = if cfg!(target_os = "macos") {
            Modifiers::SUPER
        } else {
            Modifiers::CONTROL
        };
        let shortcut = HotKey::new(Some(modifiers | Modifiers::SHIFT), Code::Space);
        let shortcuts = GlobalHotKeyManager::new()
            .ok()
            .filter(|manager| manager.register(shortcut).is_ok());
        #[cfg(target_os = "linux")]
        let pointer = DeviceState::checked_new();
        #[cfg(not(target_os = "linux"))]
        let pointer = Some(DeviceState::new());
        let (sender, receiver) = mpsc::channel();
        let warning = storage
            .warning
            .clone()
            .map(|message| (message, Instant::now()));
        Self {
            storage,
            page: "assistant",
            expanded: false,
            manually_hidden: false,
            fullscreen: false,
            passthrough: false,
            geometry: None,
            input: String::new(),
            task: String::new(),
            note: String::new(),
            chat: vec![(
                false,
                "Dis-moi ce que je peux faire. Essaie « lance un minuteur de 5 minutes ».".into(),
            )],
            feedback: warning,
            mascot,
            reaction: None,
            finished: None,
            pointer,
            last_point: None,
            last_motion: Instant::now(),
            last_desktop: Instant::now() - Duration::from_secs(1),
            shortcuts,
            tray: None,
            tray_menu: None,
            tray_initialized: false,
            reduced_motion: desktop::reduced_motion(),
            playback: None,
            city: String::new(),
            places: vec![],
            weather: None,
            weather_status: String::new(),
            weather_busy: false,
            dialog_busy: false,
            sender,
            receiver,
        }
    }

    fn feedback(&mut self, message: impl Into<String>) {
        self.feedback = Some((message.into(), Instant::now()));
    }

    fn change(&mut self, callback: impl FnOnce(&mut Data)) -> bool {
        match self.storage.change(callback) {
            Ok(()) => true,
            Err(error) => {
                self.feedback(format!("Enregistrement impossible : {error}"));
                false
            }
        }
    }

    fn react(&mut self, face: &'static str, millis: u64) {
        self.reaction = Some((face, Instant::now() + Duration::from_millis(millis)));
    }

    fn log(&mut self, request: bool, text: String) {
        self.chat.push((request, text));
        if self.chat.len() > 80 {
            self.chat.remove(0);
        }
    }

    fn command(&mut self, ctx: &egui::Context, input: String, show_in_chat: bool) -> bool {
        if input.trim().is_empty() {
            return false;
        }
        if show_in_chat {
            self.log(true, input.clone());
        }
        let mut next = self.storage.data.clone();
        let reply = bot::run(&input, &mut next, data::now());
        let saved = !reply.changed || self.change(|data| *data = next);
        if !saved {
            return false;
        }
        if let Some(text) = reply.copy {
            ctx.copy_text(text);
        }
        if let Some(url) = reply.url {
            if let Err(error) = open::that(url) {
                self.feedback(format!("Ouverture impossible : {error}"));
            }
        }
        if show_in_chat {
            self.log(false, reply.message);
            if let Some(view) = reply.view {
                self.page = view;
            }
        } else {
            self.feedback(reply.message);
        }
        self.react(
            if reply.cheer {
                "Bien joué !"
            } else {
                "Et voilà !"
            },
            1500,
        );
        reply.changed
    }

    fn check_timer(&mut self) {
        if !self
            .storage
            .data
            .timer
            .as_ref()
            .and_then(|timer| timer.end)
            .is_some_and(|end| end <= data::now())
        {
            return;
        }
        let label = self.storage.data.timer.as_ref().unwrap().label.clone();
        let alerts = self.storage.data.settings.notifications;
        if self.change(|data| data.timer = None) {
            let message = format!("{label} terminé.");
            if alerts {
                let notice = message.clone();
                std::thread::spawn(move || {
                    let _ = notify_rust::Notification::new()
                        .summary("Halo Desk")
                        .body(&notice)
                        .show();
                });
            }
            self.log(false, message);
            self.finished = Some(Instant::now());
            self.react("Bien joué !", 4000);
        }
    }

    fn desktop(&mut self, ctx: &egui::Context) {
        if self.last_desktop.elapsed() >= Duration::from_millis(850) {
            self.last_desktop = Instant::now();
            self.fullscreen = self.storage.data.settings.fullscreen && desktop::fullscreen();
        }
        if self.pointer.is_none() {
            if ctx.input(|input| input.pointer.delta() != Vec2::ZERO) {
                self.last_motion = Instant::now();
            }
        } else if let Some(point) = self
            .pointer
            .as_ref()
            .map(|device| device.get_mouse().coords)
        {
            if self.last_point != Some(point) {
                if self.sleeping() {
                    self.react("Coucou !", 1400);
                }
                self.last_point = Some(point);
                self.last_motion = Instant::now();
            }
        }
        for event in GlobalHotKeyEvent::receiver().try_iter() {
            if self.shortcuts.is_some() && event.state == HotKeyState::Pressed {
                self.manually_hidden = !self.manually_hidden;
            }
        }
        if let Some((toggle, quit)) = &self.tray_menu {
            for event in tray_icon::menu::MenuEvent::receiver().try_iter() {
                if &event.id == toggle {
                    self.manually_hidden = !self.manually_hidden;
                }
                if &event.id == quit {
                    ctx.send_viewport_cmd(ViewportCommand::Close);
                }
            }
        }
    }

    fn init_tray(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        use tray_icon::menu::{Menu, MenuItem};
        let icon = image::load_from_memory(include_bytes!("../assets/icon.png"))?
            .thumbnail(32, 32)
            .into_rgba8();
        let (width, height) = icon.dimensions();
        let icon = tray_icon::Icon::from_rgba(icon.into_raw(), width, height)?;
        let toggle = MenuItem::new("Afficher / masquer", true, None);
        let quit = MenuItem::new("Quitter Halo Desk", true, None);
        let menu = Menu::new();
        menu.append_items(&[&toggle, &quit])?;
        self.tray = Some(
            tray_icon::TrayIconBuilder::new()
                .with_icon(icon)
                .with_tooltip("Halo Desk")
                .with_menu(Box::new(menu))
                .build()?,
        );
        self.tray_menu = Some((toggle.id().clone(), quit.id().clone()));
        Ok(())
    }

    fn sleeping(&self) -> bool {
        self.storage.data.settings.sleep && self.last_motion.elapsed() >= Duration::from_secs(30)
    }

    fn request(
        &self,
        ctx: &egui::Context,
        operation: impl FnOnce() -> Background + Send + 'static,
    ) {
        let sender = self.sender.clone();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let _ = sender.send(operation());
            ctx.request_repaint();
        });
    }

    fn background(&mut self) {
        while let Ok(message) = self.receiver.try_recv() {
            match message {
                Background::Files(audio, paths) => {
                    self.dialog_busy = false;
                    if paths.is_empty() {
                        continue;
                    }
                    self.change(|data| {
                        let list = if audio {
                            &mut data.tracks
                        } else {
                            &mut data.files
                        };
                        for path in paths {
                            if list.len() >= 100 {
                                break;
                            }
                            let supported = path
                                .extension()
                                .and_then(|ext| ext.to_str())
                                .is_some_and(|ext| {
                                    services::AUDIO_EXTENSIONS
                                        .iter()
                                        .any(|kind| ext.eq_ignore_ascii_case(kind))
                                });
                            if path.is_file()
                                && (!audio || supported)
                                && !list.iter().any(|file| file.path == path)
                            {
                                list.push(SavedFile {
                                    id: uuid::Uuid::new_v4().to_string(),
                                    path,
                                });
                            }
                        }
                    });
                }
                Background::Places(result) => {
                    self.weather_busy = false;
                    match result {
                        Ok(places) => {
                            self.weather_status = if places.is_empty() {
                                "Aucune ville trouvée."
                            } else {
                                "Choisis une ville."
                            }
                            .into();
                            self.places = places;
                        }
                        Err(error) => self.weather_status = error,
                    }
                }
                Background::Weather(place, result) => {
                    self.weather_busy = false;
                    match result {
                        Ok(weather) => {
                            self.weather_status.clear();
                            self.places.clear();
                            if self.storage.data.place.as_ref() != Some(&place) {
                                self.change(|data| data.place = Some(place.clone()));
                            }
                            self.weather = Some((place, weather));
                        }
                        Err(error) => self.weather_status = error,
                    }
                }
            }
        }
    }

    fn load_weather(&mut self, ctx: &egui::Context, place: Place) {
        self.weather_busy = true;
        self.weather_status = "Chargement de la météo…".into();
        self.request(ctx, move || {
            let result = services::forecast(&place)
                .map_err(|_| "Météo indisponible. Réessaie dans un instant.".into());
            Background::Weather(place, result)
        });
    }

    fn select_page(&mut self, ctx: &egui::Context, page: &'static str) {
        self.page = page;
        if page == "weather" && self.weather.is_none() && !self.weather_busy {
            if let Some(place) = self.storage.data.place.clone() {
                self.load_weather(ctx, place);
            }
        }
    }

    fn geometry(&mut self, ctx: &egui::Context, hidden: f32, progress: f32) {
        let screen = ctx
            .input(|input| input.viewport().monitor_size)
            .unwrap_or(Vec2::new(1280.0, 800.0));
        let normal = egui::lerp(COMPACT..=EXPANDED, progress);
        let size = if hidden > 0.995 {
            Vec2::splat(1.0)
        } else {
            normal
                .min(egui::vec2(screen.x.max(1.0), (screen.y - 52.0).max(1.0)))
                .round()
        };
        let edge = (screen.x - size.x).clamp(0.0, 14.0);
        let x = match self.storage.data.settings.position {
            Position::Left => edge,
            Position::Right => screen.x - size.x - edge,
            Position::Center => (screen.x - size.x) / 2.0,
        };
        let top = if cfg!(target_os = "macos") {
            34.0
        } else {
            10.0
        };
        let position = egui::pos2(x.round(), (top - 22.0 * hidden).round());
        if self.geometry != Some((size, position)) {
            self.geometry = Some((size, position));
            ctx.send_viewport_cmd(ViewportCommand::InnerSize(size));
            ctx.send_viewport_cmd(ViewportCommand::OuterPosition(position));
        }
        let passthrough = hidden > 0.995;
        if self.passthrough != passthrough {
            self.passthrough = passthrough;
            ctx.send_viewport_cmd(ViewportCommand::MousePassthrough(passthrough));
        }
    }

    fn header(&mut self, ui: &mut egui::Ui, fully_open: bool) {
        let size = egui::vec2(ui.available_width(), 36.0);
        let (rectangle, response) = ui.allocate_exact_size(size, egui::Sense::click());
        response.widget_info(|| {
            egui::WidgetInfo::labeled(
                egui::WidgetType::Button,
                true,
                "Ouvrir ou refermer Halo Desk",
            )
        });
        if response.clicked() {
            self.expanded = !self.expanded;
            if self.expanded {
                self.react("Coucou !", 1450);
            }
        }
        let painter = ui.painter();
        let white = Color32::from_gray(238);
        let font = egui::FontId::proportional(13.0);
        if self.storage.data.settings.clock {
            painter.text(
                if fully_open {
                    egui::pos2(rectangle.right() - 12.0, rectangle.center().y)
                } else {
                    rectangle.center()
                },
                if fully_open {
                    egui::Align2::RIGHT_CENTER
                } else {
                    egui::Align2::CENTER_CENTER
                },
                chrono::Local::now().format("%H:%M"),
                font.clone(),
                white,
            );
        }
        if fully_open {
            let text = self.storage.data.timer.as_ref().map_or_else(
                || {
                    if self
                        .finished
                        .is_some_and(|time| time.elapsed() < Duration::from_secs(15))
                    {
                        "Temps écoulé".into()
                    } else {
                        "Halo Desk".into()
                    }
                },
                |timer| {
                    let seconds = timer
                        .remaining
                        .or_else(|| timer.end.map(|time| time.saturating_sub(data::now())))
                        .unwrap_or_default()
                        .div_ceil(1000);
                    let time = if seconds >= 3600 {
                        format!(
                            "{:02}:{:02}:{:02}",
                            seconds / 3600,
                            seconds / 60 % 60,
                            seconds % 60
                        )
                    } else {
                        format!("{:02}:{:02}", seconds / 60, seconds % 60)
                    };
                    let title = if timer.remaining.is_some() {
                        "En pause"
                    } else {
                        &timer.label
                    };
                    format!("{title} · {time}")
                },
            );
            painter.text(
                egui::pos2(rectangle.left() + 12.0, rectangle.center().y),
                egui::Align2::LEFT_CENTER,
                text,
                font,
                white,
            );
        }
    }

    fn assistant(&mut self, ctx: &egui::Context, ui: &mut egui::Ui) {
        let sleeping = self.sleeping();
        let motion = self.storage.data.settings.motion && !self.reduced_motion;
        let reactive = self.reaction.filter(|(_, until)| *until > Instant::now());
        let mood = reactive.map(|(name, _)| name).unwrap_or(if sleeping {
            "Petite sieste…"
        } else if self
            .storage
            .data
            .timer
            .as_ref()
            .and_then(|timer| timer.end)
            .is_some()
        {
            "En pleine concentration"
        } else if self.input.is_empty() {
            "Prêt à t’aider"
        } else {
            "Je t’écoute…"
        });
        surface().show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.horizontal(|ui| {
                let (rect, _) =
                    ui.allocate_exact_size(egui::vec2(72.0, 54.0), egui::Sense::hover());
                let phase = ctx.input(|input| input.time) as f32;
                let oscillation = if !motion {
                    0.0
                } else if reactive.is_some() {
                    (phase * 11.0).sin() * 3.0
                } else if sleeping {
                    (phase * 2.3).sin() * 1.7
                } else {
                    0.0
                };
                let drift = if motion {
                    ctx.pointer_hover_pos().map_or(0.0, |point| {
                        (point.x - rect.center().x).clamp(-90.0, 90.0) * 0.045
                    })
                } else {
                    0.0
                };
                let image = egui::Rect::from_center_size(
                    rect.center() + egui::vec2(drift, oscillation),
                    egui::Vec2::splat(54.0),
                );
                ui.painter().image(
                    self.mascot.id(),
                    image,
                    egui::Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1.0, 1.0)),
                    if sleeping {
                        Color32::from_gray(156)
                    } else {
                        Color32::WHITE
                    },
                );
                if sleeping {
                    ui.painter().text(
                        rect.right_top() + egui::vec2(-7.0, 3.0 + oscillation),
                        egui::Align2::RIGHT_TOP,
                        "Z z",
                        egui::FontId::proportional(12.0),
                        MINT,
                    );
                }
                ui.vertical(|ui| {
                    ui.label(RichText::new("Halo").strong().size(16.0));
                    ui.label(RichText::new(mood).color(MUTED));
                });
            });
        });
        ui.horizontal_wrapped(|ui| {
            if ui.button("Focus 25 min").clicked() {
                self.command(ctx, "focus 25m".into(), true);
            }
            if ui.button("Minuteur 5 min").clicked() {
                self.command(ctx, "minuteur 5m".into(), true);
            }
            if let Some(timer) = &self.storage.data.timer {
                let (title, command) = if timer.remaining.is_some() {
                    ("Reprendre", "reprendre")
                } else {
                    ("Pause", "pause")
                };
                if ui.button(title).clicked() {
                    self.command(ctx, command.into(), true);
                }
                if ui.button("Annuler").clicked() {
                    self.command(ctx, "annuler".into(), true);
                }
            }
        });
        egui::ScrollArea::vertical()
            .stick_to_bottom(true)
            .max_height((ui.available_height() - 42.0).max(70.0))
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for (request, text) in &self.chat {
                    let fill = if *request {
                        Color32::from_rgb(24, 40, 37)
                    } else {
                        Color32::from_gray(23)
                    };
                    surface().fill(fill).show(ui, |ui| {
                        ui.label(text);
                    });
                }
            });
        ui.horizontal(|ui| {
            let input = ui.add(
                egui::TextEdit::singleline(&mut self.input)
                    .hint_text("Écrire à Halo")
                    .desired_width((ui.available_width() - 78.0).max(45.0))
                    .char_limit(1200),
            );
            let enter = input.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter));
            if ui.button("Envoyer").clicked() || enter {
                let text = std::mem::take(&mut self.input);
                self.command(ctx, text, true);
                input.request_focus();
            }
        });
    }

    fn entries(&mut self, ctx: &egui::Context, ui: &mut egui::Ui, notes: bool) {
        let field = if notes {
            &mut self.note
        } else {
            &mut self.task
        };
        let response = if notes {
            ui.add(
                egui::TextEdit::multiline(field)
                    .hint_text("Nouvelle note")
                    .desired_rows(2)
                    .desired_width(f32::INFINITY)
                    .char_limit(500),
            )
        } else {
            ui.add(
                egui::TextEdit::singleline(field)
                    .hint_text("Nouvelle tâche")
                    .desired_width(f32::INFINITY)
                    .char_limit(160),
            )
        };
        let submit = ui
            .button(if notes { "Enregistrer" } else { "Ajouter" })
            .clicked()
            || (!notes
                && response.lost_focus()
                && ui.input(|input| input.key_pressed(egui::Key::Enter)));
        if submit {
            let input = format!("{} {field}", if notes { "note" } else { "tâche" });
            if self.command(ctx, input, false) {
                if notes {
                    self.note.clear();
                } else {
                    self.task.clear();
                }
                response.request_focus();
            }
        }
        let list = if notes {
            &self.storage.data.notes
        } else {
            &self.storage.data.tasks
        };
        if list.is_empty() {
            ui.label(
                RichText::new(if notes {
                    "Aucune note enregistrée."
                } else {
                    "Aucune tâche à faire."
                })
                .color(MUTED),
            );
        }
        let mut remove = None;
        for (index, entry) in list.iter().enumerate() {
            ui.push_id(&entry.id, |ui| {
                surface().show(ui, |ui| {
                    ui.horizontal(|ui| {
                        if ui
                            .small_button(if notes { "Supprimer" } else { "Terminer" })
                            .clicked()
                        {
                            remove = Some(entry.id.clone());
                        }
                        if notes {
                            ui.label(&entry.text);
                        } else {
                            ui.label(format!("{}. {}", index + 1, entry.text));
                        }
                    });
                })
            });
        }
        if let Some(id) = remove {
            self.change(|data| {
                let list = if notes {
                    &mut data.notes
                } else {
                    &mut data.tasks
                };
                list.retain(|entry| entry.id != id);
            });
            if !notes {
                self.feedback("Tâche terminée.");
                self.react("Bien joué !", 1500);
            }
        }
    }

    fn play(&mut self, entry: &SavedFile) {
        match Playback::start(&entry.path) {
            Ok(playback) => self.playback = Some((entry.id.clone(), playback)),
            Err(error) => self.feedback(format!("Lecture impossible : {error}")),
        }
    }

    fn step_track(&mut self, direction: isize, wrap: bool) {
        let list = &self.storage.data.tracks;
        let Some((id, _)) = &self.playback else {
            return;
        };
        let Some(index) = list.iter().position(|entry| &entry.id == id) else {
            return;
        };
        let next = index as isize + direction;
        let selected = if wrap {
            Some(next.rem_euclid(list.len() as isize) as usize)
        } else {
            usize::try_from(next)
                .ok()
                .filter(|index| *index < list.len())
        };
        if let Some(entry) = selected.map(|index| list[index].clone()) {
            self.play(&entry);
        } else {
            self.playback = None;
        }
    }

    fn files(&mut self, ctx: &egui::Context, ui: &mut egui::Ui, audio: bool) {
        ui.horizontal(|ui| {
            ui.heading(if audio {
                "Musique locale"
            } else {
                "Fichiers épinglés"
            });
            if ui
                .add_enabled(
                    !self.dialog_busy,
                    egui::Button::new(if audio { "Ajouter…" } else { "Épingler…" }),
                )
                .clicked()
            {
                self.dialog_busy = true;
                self.request(ctx, move || {
                    let mut picker = rfd::FileDialog::new().set_title(if audio {
                        "Ajouter de la musique"
                    } else {
                        "Épingler des fichiers"
                    });
                    if audio {
                        picker = picker.add_filter("Audio", services::AUDIO_EXTENSIONS);
                    }
                    Background::Files(audio, picker.pick_files().unwrap_or_default())
                });
            }
        });
        if audio {
            self.player(ui);
        }
        let list = if audio {
            &self.storage.data.tracks
        } else {
            &self.storage.data.files
        };
        let mut open = None;
        let mut remove = None;
        if list.is_empty() {
            ui.label(
                RichText::new(if audio {
                    "Ajoute des morceaux depuis ton ordinateur."
                } else {
                    "Aucun fichier épinglé."
                })
                .color(MUTED),
            );
        }
        for entry in list {
            ui.push_id(&entry.id, |ui| {
                surface().show(ui, |ui| {
                    ui.horizontal(|ui| {
                        if ui
                            .small_button(if audio { "Lire" } else { "Afficher" })
                            .clicked()
                        {
                            open = Some(entry.clone());
                        }
                        if ui.small_button("Retirer").clicked() {
                            remove = Some(entry.id.clone());
                        }
                        ui.label(entry.name())
                            .on_hover_text(entry.path.to_string_lossy());
                    });
                })
            });
        }
        if let Some(entry) = open {
            if audio {
                self.play(&entry);
            } else if let Err(error) = desktop::reveal(&entry.path) {
                self.feedback(error);
            }
        }
        if let Some(id) = remove {
            let saved = self.change(|data| {
                let list = if audio {
                    &mut data.tracks
                } else {
                    &mut data.files
                };
                list.retain(|entry| entry.id != id);
            });
            if saved
                && audio
                && self
                    .playback
                    .as_ref()
                    .is_some_and(|(track, _)| *track == id)
            {
                self.playback = None;
            }
        }
    }

    fn player(&mut self, ui: &mut egui::Ui) {
        let Some((id, music)) = &self.playback else {
            return;
        };
        let Some(track) = self
            .storage
            .data
            .tracks
            .iter()
            .find(|track| &track.id == id)
        else {
            return;
        };
        let mut step = None;
        surface().show(ui, |ui| {
            ui.label(RichText::new(track.name()).strong());
            ui.horizontal_wrapped(|ui| {
                if ui.button("Précédent").clicked() {
                    step = Some(-1);
                }
                if ui
                    .button(if music.sink.is_paused() {
                        "Reprendre"
                    } else {
                        "Pause"
                    })
                    .clicked()
                {
                    if music.sink.is_paused() {
                        music.sink.play();
                    } else {
                        music.sink.pause();
                    }
                }
                if ui.button("Suivant").clicked() {
                    step = Some(1);
                }
                let mut volume = music.sink.volume();
                if ui
                    .add(egui::Slider::new(&mut volume, 0.0..=1.0).text("Volume"))
                    .changed()
                {
                    music.sink.set_volume(volume);
                }
            });
            if let Some(duration) = music.duration.filter(|duration| !duration.is_zero()) {
                let mut progress = music
                    .sink
                    .get_pos()
                    .as_secs_f32()
                    .min(duration.as_secs_f32());
                if ui
                    .add(
                        egui::Slider::new(&mut progress, 0.0..=duration.as_secs_f32()).suffix(" s"),
                    )
                    .changed()
                {
                    let _ = music.sink.try_seek(Duration::from_secs_f32(progress));
                }
            } else {
                ui.label(format!("{} s", music.sink.get_pos().as_secs()));
            }
        });
        if let Some(step) = step {
            self.step_track(step, true);
        }
    }

    fn weather(&mut self, ctx: &egui::Context, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            let input = ui.add(
                egui::TextEdit::singleline(&mut self.city)
                    .hint_text("Chercher une ville")
                    .desired_width((ui.available_width() - 86.0).max(50.0))
                    .char_limit(100),
            );
            let enter = input.lost_focus() && ui.input(|input| input.key_pressed(egui::Key::Enter));
            let search = ui
                .add_enabled(!self.weather_busy, egui::Button::new("Chercher"))
                .clicked()
                || enter;
            if search && !self.weather_busy && self.city.trim().chars().count() >= 2 {
                let query = self.city.trim().to_owned();
                self.weather_busy = true;
                self.places.clear();
                self.weather_status = "Recherche…".into();
                self.request(ctx, move || {
                    Background::Places(
                        services::places(query)
                            .map_err(|_| "Recherche indisponible. Vérifie ta connexion.".into()),
                    )
                });
            }
        });
        if !self.weather_status.is_empty() {
            ui.label(RichText::new(&self.weather_status).color(MUTED));
        }
        let mut selected = None;
        for place in &self.places {
            if ui
                .add_enabled(!self.weather_busy, egui::Button::new(&place.label))
                .clicked()
            {
                selected = Some(place.clone());
            }
        }
        if let Some((place, forecast)) = &self.weather {
            ui.horizontal_wrapped(|ui| {
                ui.heading(&place.label);
                if ui
                    .add_enabled(!self.weather_busy, egui::Button::new("Actualiser"))
                    .clicked()
                {
                    selected = Some(place.clone());
                }
            });
            ui.label(
                RichText::new(format!("{:.0} °C", forecast.current.temperature_2m)).size(34.0),
            );
            ui.label(format!(
                "{} · Ressenti {:.0} °C",
                services::conditions(forecast.current.weather_code),
                forecast.current.apparent_temperature
            ));
            let daily = &forecast.daily;
            for (((day, code), minimum), maximum) in daily
                .time
                .iter()
                .zip(&daily.weather_code)
                .zip(&daily.temperature_2m_min)
                .zip(&daily.temperature_2m_max)
            {
                surface().show(ui, |ui| {
                    ui.label(format!(
                        "{day} · {} · {minimum:.0}° / {maximum:.0}°",
                        services::conditions(*code)
                    ));
                });
            }
        }
        if let Some(place) = selected {
            self.load_weather(ctx, place);
        }
        ui.label(
            RichText::new("Données météo fournies par Open-Meteo.")
                .small()
                .color(MUTED),
        );
    }

    fn settings(&mut self, ui: &mut egui::Ui) {
        ui.heading("Apparence et comportement");
        let original = &self.storage.data.settings;
        let mut settings = original.clone();
        for (value, label) in [
            (&mut settings.clock, "Afficher l’heure en mode compact"),
            (&mut settings.motion, "Animations"),
            (&mut settings.fullscreen, "Masquer en plein écran"),
            (&mut settings.sleep, "Sommeil de Halo après 30 s"),
            (&mut settings.notifications, "Notifications du minuteur"),
        ] {
            surface().show(ui, |ui| {
                ui.checkbox(value, label);
            });
        }
        surface().show(ui, |ui| {
            ui.horizontal_wrapped(|ui| {
                ui.label("Position");
                ui.selectable_value(&mut settings.position, Position::Left, "Gauche");
                ui.selectable_value(&mut settings.position, Position::Center, "Centre");
                ui.selectable_value(&mut settings.position, Position::Right, "Droite");
            });
        });
        if settings != *original {
            if !settings.fullscreen {
                self.fullscreen = false;
            }
            if settings.sleep != original.sleep {
                self.last_motion = Instant::now();
            }
            self.change(|data| data.settings = settings);
        }
    }

    fn panel(&mut self, ctx: &egui::Context, ui: &mut egui::Ui) {
        ui.set_min_width(ui.available_width());
        surface().show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            let width =
                ((ui.available_width() - 8.0 * PAGES.len() as f32) / PAGES.len() as f32).max(58.0);
            egui::ScrollArea::horizontal()
                .id_salt("navigation")
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        for &(page, name) in PAGES {
                            if ui
                                .add_sized(
                                    [width, 24.0],
                                    egui::Button::new(name).selected(self.page == page),
                                )
                                .clicked()
                            {
                                self.select_page(ctx, page);
                            }
                        }
                    });
                });
        });
        ui.add_space(5.0);
        let available = ui.available_height();
        ui.allocate_ui(
            egui::vec2(ui.available_width(), (available - 54.0).max(10.0)),
            |ui| {
                ui.set_height((available - 54.0).max(10.0));
                if self.page == "assistant" {
                    self.assistant(ctx, ui);
                    return;
                }
                egui::ScrollArea::vertical()
                    .id_salt(self.page)
                    .show(ui, |ui| match self.page {
                        "tasks" => self.entries(ctx, ui, false),
                        "notes" => self.entries(ctx, ui, true),
                        "files" => self.files(ctx, ui, false),
                        "music" => self.files(ctx, ui, true),
                        "weather" => self.weather(ctx, ui),
                        "settings" => self.settings(ui),
                        _ => {}
                    });
            },
        );
        if let Some((message, _)) = self
            .feedback
            .as_ref()
            .filter(|(_, instant)| instant.elapsed() < Duration::from_secs(5))
        {
            ui.label(RichText::new(message).small().color(MUTED));
        }
        ui.horizontal_wrapped(|ui| {
            let shortcut = if self.shortcuts.is_some() {
                if cfg!(target_os = "macos") {
                    "⌘ + Maj + Espace"
                } else {
                    "Ctrl + Maj + Espace"
                }
            } else {
                "Raccourci indisponible"
            };
            ui.label(RichText::new(shortcut).small().color(MUTED));
            if ui
                .add_enabled(
                    self.shortcuts.is_some() || self.tray.is_some(),
                    egui::Button::new("Masquer"),
                )
                .clicked()
            {
                self.manually_hidden = true;
            }
            if ui.button("Quitter").clicked() {
                ctx.send_viewport_cmd(ViewportCommand::Close);
            }
        });
    }
}

fn surface() -> egui::Frame {
    egui::Frame::new()
        .fill(Color32::from_rgb(21, 21, 24))
        .inner_margin(egui::Margin::same(8))
        .corner_radius(egui::CornerRadius::same(9))
}

impl eframe::App for Halo {
    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        [0.0; 4]
    }

    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if !self.tray_initialized {
            self.tray_initialized = true;
            let _ = self.init_tray();
        }
        self.background();
        self.desktop(ctx);
        self.check_timer();
        if self
            .playback
            .as_ref()
            .is_some_and(|(_, track)| track.sink.empty())
        {
            self.step_track(1, false);
        }
        if ctx.input(|input| input.key_pressed(egui::Key::Escape)) {
            self.expanded = false;
        }
        let motion = self.storage.data.settings.motion && !self.reduced_motion;
        let hidden = self.manually_hidden || self.fullscreen;
        let fade = if motion {
            ctx.animate_bool_with_time(egui::Id::new("fade"), hidden, 0.2)
        } else {
            f32::from(hidden)
        };
        let progress = if motion {
            ctx.animate_bool_with_time(egui::Id::new("open"), self.expanded, 0.24)
        } else {
            f32::from(self.expanded)
        };
        let eased = progress * progress * (3.0 - 2.0 * progress);
        self.geometry(ctx, fade, eased);
        if fade < 0.995 {
            egui::CentralPanel::default()
                .frame(
                    egui::Frame::new()
                        .outer_margin(egui::Margin::same(2))
                        .corner_radius(egui::CornerRadius::same(21))
                        .fill(Color32::from_rgb(8, 8, 9).gamma_multiply(1.0 - fade))
                        .stroke(egui::Stroke::new(
                            1.0_f32,
                            Color32::from_rgb(29, 29, 32).gamma_multiply(1.0 - fade),
                        )),
                )
                .show(ctx, |ui| {
                    ui.multiply_opacity(1.0 - fade);
                    self.header(ui, progress > 0.94);
                    if progress > 0.94 && ui.available_height() > 70.0 {
                        egui::Frame::new()
                            .inner_margin(egui::Margin::symmetric(12, 5))
                            .show(ui, |ui| self.panel(ctx, ui));
                    }
                });
        }
        let interval = if motion
            && self.expanded
            && (self.sleeping()
                || self
                    .reaction
                    .is_some_and(|(_, until)| until > Instant::now()))
        {
            Duration::from_millis(33)
        } else {
            Duration::from_millis(250)
        };
        ctx.request_repaint_after(interval);
    }
}
