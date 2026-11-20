use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedFile {
    pub id: String,
    pub path: PathBuf,
}

impl SavedFile {
    pub fn name(&self) -> String {
        self.path
            .file_name()
            .unwrap_or(self.path.as_os_str())
            .to_string_lossy()
            .into_owned()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Timer {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Position {
    Left,
    #[default]
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub clock: bool,
    pub motion: bool,
    pub fullscreen: bool,
    pub sleep: bool,
    pub notifications: bool,
    pub position: Position,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            clock: true,
            motion: true,
            fullscreen: true,
            sleep: true,
            notifications: true,
            position: Position::Center,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Place {
    pub label: String,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Data {
    pub timer: Option<Timer>,
    pub notes: Vec<Entry>,
    pub tasks: Vec<Entry>,
    pub files: Vec<SavedFile>,
    pub tracks: Vec<SavedFile>,
    pub settings: Settings,
    pub place: Option<Place>,
}

pub struct Storage {
    pub path: PathBuf,
    pub data: Data,
    pub warning: Option<String>,
}

impl Storage {
    pub fn load() -> Self {
        let root = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
        let path = root.join("Halo Desk").join("halo.json");
        let legacy = root.join("halo-desk").join("halo.json");
        let source = if path.exists() { &path } else { &legacy };
        let (data, warning) = match fs::read(source) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(data) => (data, None),
                Err(error) => (
                    Data::default(),
                    Some(format!("Données illisibles : {error}")),
                ),
            },
            Err(error) if error.kind() == io::ErrorKind::NotFound => (Data::default(), None),
            Err(error) => (
                Data::default(),
                Some(format!("Lecture impossible : {error}")),
            ),
        };
        Self {
            path,
            data,
            warning,
        }
    }

    pub fn change(&mut self, update: impl FnOnce(&mut Data)) -> io::Result<()> {
        if let Some(warning) = &self.warning {
            return Err(io::Error::new(io::ErrorKind::InvalidData, warning.clone()));
        }
        let mut next = self.data.clone();
        update(&mut next);
        save(&self.path, &next)?;
        self.data = next;
        Ok(())
    }
}

fn save(path: &Path, data: &Data) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Dossier invalide"))?;
    fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut file, data).map_err(io::Error::other)?;
    file.flush()?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_electron_data_and_preserves_values() {
        let input = r#"{"notes":[{"id":"a","text":"Écrire"}],"tasks":[],"timer":{"label":"Focus","remaining":2000},"settings":{"clock":false,"position":"right"},"tracks":[{"id":"m","path":"musique.mp3"}]}"#;
        let data: Data = serde_json::from_str(input).unwrap();
        assert_eq!(data.notes[0].text, "Écrire");
        assert_eq!(data.timer.as_ref().unwrap().remaining, Some(2000));
        assert!(!data.settings.clock);
        assert!(data.settings.motion);
        assert_eq!(data.settings.position, Position::Right);
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("halo.json");
        save(&path, &data).unwrap();
        save(&path, &data).unwrap();
        let result: Data = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(result.tracks[0].name(), "musique.mp3");
    }
}
