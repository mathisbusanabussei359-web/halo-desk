use crate::data::Place;
use rodio::{Decoder, OutputStream, Sink, Source};
use serde::Deserialize;
use std::{fs::File, io::BufReader, path::Path, time::Duration};

pub const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "ogg", "opus", "flac", "m4a", "aac", "webm"];

pub struct Playback {
    pub duration: Option<Duration>,
    pub sink: Sink,
    _stream: OutputStream,
}

impl Playback {
    pub fn start(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|error| error.to_string())?;
        let decoder = Decoder::new(BufReader::new(file)).map_err(|error| error.to_string())?;
        let duration = decoder.total_duration();
        let (stream, handle) = OutputStream::try_default().map_err(|error| error.to_string())?;
        let sink = Sink::try_new(&handle).map_err(|error| error.to_string())?;
        sink.append(decoder);
        Ok(Self {
            duration,
            sink,
            _stream: stream,
        })
    }
}

#[derive(Deserialize)]
struct Geocode {
    #[serde(default)]
    results: Vec<City>,
}

#[derive(Deserialize)]
struct City {
    name: String,
    admin1: Option<String>,
    country: Option<String>,
    latitude: f64,
    longitude: f64,
}

#[derive(Deserialize)]
pub struct Forecast {
    pub current: Current,
    pub daily: Daily,
}

#[derive(Deserialize)]
pub struct Current {
    pub temperature_2m: f32,
    pub apparent_temperature: f32,
    pub weather_code: u8,
}

#[derive(Deserialize)]
pub struct Daily {
    pub time: Vec<String>,
    pub weather_code: Vec<u8>,
    pub temperature_2m_min: Vec<f32>,
    pub temperature_2m_max: Vec<f32>,
}

fn client() -> reqwest::Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

pub fn places(query: String) -> reqwest::Result<Vec<Place>> {
    let result: Geocode = client()?
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[("name", query.as_str()), ("count", "5"), ("language", "fr")])
        .send()?
        .error_for_status()?
        .json()?;
    Ok(result
        .results
        .into_iter()
        .map(|city| {
            let mut parts = vec![city.name];
            for part in [city.admin1, city.country].into_iter().flatten() {
                if !parts.contains(&part) {
                    parts.push(part);
                }
            }
            Place {
                label: parts.join(", "),
                lat: city.latitude,
                lon: city.longitude,
            }
        })
        .collect())
}

pub fn forecast(place: &Place) -> reqwest::Result<Forecast> {
    client()?
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", place.lat.to_string().as_str()),
            ("longitude", place.lon.to_string().as_str()),
            ("timezone", "auto"),
            ("forecast_days", "3"),
            (
                "current",
                "temperature_2m,apparent_temperature,weather_code",
            ),
            (
                "daily",
                "weather_code,temperature_2m_max,temperature_2m_min",
            ),
        ])
        .send()?
        .error_for_status()?
        .json()
}

pub fn conditions(code: u8) -> &'static str {
    match code {
        0 => "Ciel dégagé",
        1..=3 => "Nuageux",
        45 | 48 => "Brouillard",
        51..=57 => "Bruine",
        61..=67 => "Pluie",
        71..=77 => "Neige",
        80..=82 => "Averses",
        85..=86 => "Averses de neige",
        95..=99 => "Orages",
        _ => "Conditions indisponibles",
    }
}
