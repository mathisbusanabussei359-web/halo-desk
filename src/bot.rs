use crate::data::{Data, Entry, Timer};
use rand::Rng;
use regex::Regex;
use std::sync::LazyLock;

const HELP: &str = "Temps · lance un minuteur de 5 minutes, focus 25m, pause, reprendre, annuler, date\nOrganisation · note Acheter du café, notes, tâche Envoyer le dossier, tâches, fait 1\nOutils · calc (12 + 3) * 4, copier mon texte, dé 20, pile ou face, ouvrir agenda";
static TIMER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:(?:lance[rz]?|démarre[rz]?|demarre[rz]?|mets?|mettre|programme[rz]?|règle[rz]?)(?:-moi)?\s+(?:(?:un|le)\s+)?)?(minuteur|chrono|focus|pomodoro)(?:\s+(?:(?:de|pour|sur)\s+)?(.+))?$").unwrap()
});
static DURATION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(\d+(?:[.,]\d+)?)\s*(s(?:ec(?:ondes?)?)?|m(?:in(?:utes?)?)?|h(?:eures?)?)?$")
        .unwrap()
});
static NATURAL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)^(ajoute (?:une )?t[âa]che|note que|prends une note|termine (?:la )?t[âa]che|calcule|ouvre|copie)(?:\s*:\s*|\s+)(.+)$").unwrap()
});

#[derive(Default)]
pub struct Reply {
    pub message: String,
    pub view: Option<&'static str>,
    pub copy: Option<String>,
    pub url: Option<&'static str>,
    pub changed: bool,
    pub cheer: bool,
}

impl Reply {
    fn say(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            ..Self::default()
        }
    }
}

fn interpret(input: &str) -> (String, &str) {
    let text = input.trim();
    let lower = text.to_lowercase();
    let text = ["peux-tu ", "tu peux ", "s’il te plaît, ", "s'il te plaît, "]
        .iter()
        .find_map(|prefix| lower.starts_with(prefix).then(|| &text[prefix.len()..]))
        .unwrap_or(text);
    let sentence = text.trim_end_matches(['.', '!', '?']).trim();
    let sentence = sentence
        .strip_suffix(" s’il te plaît")
        .or_else(|| sentence.strip_suffix(" s'il te plaît"))
        .unwrap_or(sentence);
    let lower = sentence.to_lowercase();

    let core = match lower.as_str() {
        "mets le minuteur en pause" | "mets en pause" | "met en pause" | "suspends le minuteur" => {
            "pause"
        }
        "reprends le minuteur" | "reprend le minuteur" | "relance le minuteur" => "reprendre",
        "annule le minuteur"
        | "arrête le minuteur"
        | "arrete le minuteur"
        | "stoppe le chrono"
        | "arrête mon chrono"
        | "annule mon focus" => "annuler",
        "affiche mes notes" | "montre-moi mes notes" | "montre mes notes" | "affiche les notes" => {
            "notes"
        }
        "affiche mes tâches"
        | "montre-moi mes tâches"
        | "montre mes tâches"
        | "affiche les tâches" => "tâches",
        "quelle heure est-il" | "quelle est la date" | "on est quel jour" => "date",
        _ => "",
    };
    if !core.is_empty() {
        return (core.into(), "");
    }
    if let Some(parts) = TIMER.captures(sentence) {
        let key = parts[1].to_lowercase();
        let key = if matches!(key.as_str(), "focus" | "pomodoro") {
            "focus"
        } else {
            "minuteur"
        };
        return (key.into(), parts.get(2).map_or("", |part| part.as_str()));
    }
    if let Some(parts) = NATURAL.captures(text) {
        let verb = parts[1]
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_lowercase();
        let key = match verb.as_str() {
            "ajoute" => "tâche",
            "note" | "prends" => "note",
            "termine" => "fait",
            "calcule" => "calc",
            "ouvre" => "ouvrir",
            _ => "copier",
        };
        return (key.into(), parts.get(2).unwrap().as_str());
    }
    let (command, argument) = text.split_once(char::is_whitespace).unwrap_or((text, ""));
    (command.to_lowercase(), argument.trim_start())
}

fn duration(argument: &str) -> Option<u64> {
    let parts = DURATION.captures(argument)?;
    let amount: f64 = parts[1].replace(',', ".").parse().ok()?;
    let multiplier = match parts
        .get(2)
        .and_then(|unit| unit.as_str().chars().next())
        .map(|unit| unit.to_ascii_lowercase())
    {
        Some('s') => 1.0,
        Some('h') => 3600.0,
        _ => 60.0,
    };
    let seconds = amount * multiplier;
    (1.0..=86400.0)
        .contains(&seconds)
        .then(|| (seconds * 1000.0).round() as u64)
}

fn calculate(text: &str) -> Option<f64> {
    fn expression(input: &mut &str, level: u8) -> Option<f64> {
        let mut value = if level < 2 {
            expression(input, level + 1)?
        } else {
            *input = input.trim_start();
            if let Some(rest) = input.strip_prefix('-') {
                *input = rest;
                return Some(-expression(input, 2)?);
            }
            if let Some(rest) = input.strip_prefix('+') {
                *input = rest;
                return expression(input, 2);
            }
            if let Some(rest) = input.strip_prefix('(') {
                *input = rest;
                let value = expression(input, 0)?;
                *input = input.trim_start().strip_prefix(')')?;
                return Some(value);
            }
            let length = input
                .bytes()
                .take_while(|byte| byte.is_ascii_digit() || matches!(byte, b'.' | b','))
                .count();
            let value = input[..length].replace(',', ".").parse::<f64>().ok()?;
            *input = &input[length..];
            return Some(value);
        };
        loop {
            *input = input.trim_start();
            let operator = match (level, input.as_bytes().first()) {
                (0, Some(b'+' | b'-')) | (1, Some(b'*' | b'/')) => input.as_bytes()[0],
                _ => return Some(value),
            };
            *input = &input[1..];
            let right = expression(input, level + 1)?;
            value = match operator {
                b'+' => value + right,
                b'-' => value - right,
                b'*' => value * right,
                b'/' if right != 0.0 => value / right,
                _ => return None,
            };
            if !value.is_finite() {
                return None;
            }
        }
    }
    if text.len() > 150 {
        return None;
    }
    let mut input = text;
    let result = expression(&mut input, 0)?;
    (input.trim().is_empty() && result.is_finite()).then_some(result)
}

pub fn run(input: &str, data: &mut Data, now: u64) -> Reply {
    let (key, argument) = interpret(input);
    let argument = argument.trim();
    match key.as_str() {
        "aide" => Reply::say(HELP),
        "minuteur" | "focus" => {
            let label = if key == "focus" { "Focus" } else { "Minuteur" };
            let argument = if label == "Focus" && argument.is_empty() {
                "25m"
            } else {
                argument
            };
            let Some(length) = duration(argument) else {
                return Reply::say(
                    "Indique une durée de 1 seconde à 24 heures. Exemple : minuteur 90s.",
                );
            };
            let message = if data.timer.is_some() {
                "Minuteur remplacé.".into()
            } else {
                format!("{label} lancé.")
            };
            data.timer = Some(Timer {
                label: label.into(),
                end: Some(now + length),
                remaining: None,
            });
            Reply {
                changed: true,
                ..Reply::say(message)
            }
        }
        "annuler" => {
            if data.timer.take().is_none() {
                return Reply::say("Aucun minuteur actif.");
            }
            Reply {
                changed: true,
                ..Reply::say("Minuteur annulé.")
            }
        }
        "pause" => {
            let Some(timer) = &mut data.timer else {
                return Reply::say("Aucun minuteur en cours.");
            };
            let Some(end) = timer.end.filter(|end| *end > now) else {
                return Reply::say("Aucun minuteur en cours.");
            };
            timer.end = None;
            timer.remaining = Some(end - now);
            Reply {
                changed: true,
                ..Reply::say("Minuteur en pause.")
            }
        }
        "reprendre" => {
            let Some(timer) = &mut data.timer else {
                return Reply::say("Aucun minuteur en pause.");
            };
            let Some(remaining) = timer.remaining.take() else {
                return Reply::say("Aucun minuteur en pause.");
            };
            timer.end = Some(now.saturating_add(remaining));
            Reply {
                changed: true,
                ..Reply::say("Minuteur repris.")
            }
        }
        "note" | "tâche" | "tache" => {
            let is_note = key == "note";
            let limit = if is_note { 500 } else { 160 };
            if argument.is_empty() || argument.chars().count() > limit {
                return Reply::say(format!("Écris un texte de 1 à {limit} caractères."));
            }
            let list = if is_note {
                &mut data.notes
            } else {
                &mut data.tasks
            };
            if list.len() >= 100 {
                return Reply::say("Limite de 100 éléments atteinte.");
            }
            let entry = Entry {
                id: uuid::Uuid::new_v4().to_string(),
                text: argument.into(),
            };
            if is_note {
                list.insert(0, entry);
            } else {
                list.push(entry);
            }
            Reply {
                changed: true,
                view: (!is_note).then_some("tasks"),
                ..Reply::say(if is_note {
                    "Note enregistrée."
                } else {
                    "Tâche ajoutée."
                })
            }
        }
        "notes" => Reply {
            view: Some("notes"),
            ..Reply::say("Voici tes notes.")
        },
        "tâches" | "taches" => Reply {
            view: Some("tasks"),
            ..Reply::say("Voici tes tâches.")
        },
        "fait" => {
            let index = argument
                .parse::<usize>()
                .ok()
                .and_then(|i| i.checked_sub(1));
            let Some(index) = index.filter(|i| *i < data.tasks.len()) else {
                return Reply::say("Indique le numéro d’une tâche. Exemple : fait 1.");
            };
            let task = data.tasks.remove(index);
            Reply {
                changed: true,
                cheer: true,
                view: Some("tasks"),
                ..Reply::say(format!("Tâche terminée : {}", task.text))
            }
        }
        "date" => {
            let date = chrono::Local::now();
            Reply::say(date.format("%d/%m/%Y à %H:%M").to_string())
        }
        "dé" | "de" => {
            let faces = if argument.is_empty() {
                6
            } else {
                argument.parse::<u32>().unwrap_or_default()
            };
            if !(2..=1000).contains(&faces) {
                return Reply::say("Choisis de 2 à 1 000 faces.");
            }
            Reply {
                cheer: true,
                ..Reply::say(format!(
                    "Dé à {faces} faces : {}.",
                    rand::rng().random_range(1..=faces)
                ))
            }
        }
        "pile" => Reply {
            cheer: true,
            ..Reply::say(if rand::random() { "Pile !" } else { "Face !" })
        },
        "calc" => match calculate(argument) {
            Some(value) => Reply::say(format!(
                "Résultat : {}",
                value.to_string().replace('.', ",")
            )),
            _ => Reply::say("Calcul impossible. Vérifie l’expression et les divisions par zéro."),
        },
        "copier" if !argument.is_empty() => Reply {
            copy: Some(argument.into()),
            ..Reply::say("Texte copié.")
        },
        "copier" => Reply::say("Indique le texte à copier."),
        "ouvrir" => {
            let destination = argument
                .trim_end_matches(['.', '!', '?'])
                .trim()
                .to_lowercase();
            let url = match destination.as_str() {
                "agenda" => "https://calendar.google.com/",
                "github" => "https://github.com/",
                "traduction" => "https://www.deepl.com/translator",
                _ => return Reply::say("Raccourcis disponibles : agenda, github et traduction."),
            };
            Reply {
                url: Some(url),
                ..Reply::say(format!("Ouverture de {destination}…"))
            }
        }
        _ => Reply::say(format!("Commande inconnue. {HELP}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equivalent_minuteurs_and_pause() {
        for input in [
            "minuteur 5m",
            "minuteur 5 minutes",
            "Lance un minuteur de 5 minutes !",
            "Peux-tu démarrer un chrono pour 5 min ?",
        ] {
            let mut data = Data::default();
            assert!(run(input, &mut data, 10).changed, "{input}");
            assert_eq!(data.timer.as_ref().unwrap().end, Some(300010));
            assert!(run("mets le minuteur en pause", &mut data, 10010).changed);
            assert_eq!(data.timer.as_ref().unwrap().remaining, Some(290000));
            assert!(run("reprends le minuteur", &mut data, 30010).changed);
            assert_eq!(data.timer.as_ref().unwrap().end, Some(320010));
        }
    }

    #[test]
    fn preserves_notes_and_limits_actions() {
        let mut data = Data::default();
        run("Prends une note : Écrire à Léa !", &mut data, 0);
        assert_eq!(data.notes[0].text, "Écrire à Léa !");
        run("Ajoute une tâche : Tester", &mut data, 0);
        assert!(run("fait 1", &mut data, 0).cheer);
        assert!(data.tasks.is_empty());
        assert_eq!(
            run("calcule (2 + 3) * 4", &mut data, 0).message,
            "Résultat : 20"
        );
        assert!(run("ouvre file:///tmp/test", &mut data, 0).url.is_none());
    }
}
