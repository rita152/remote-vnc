use enigo::{Enigo, KeyboardControllable, Key, MouseButton, MouseControllable};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(tag = "k")]
enum InputEvent {
    #[serde(rename = "mouse_move")]
    MouseMove { x: f64, y: f64 },
    #[serde(rename = "mouse_button")]
    MouseButton { button: u8, down: bool },
    #[serde(rename = "mouse_wheel")]
    MouseWheel { dx: f64, dy: f64 },
    #[serde(rename = "key")]
    Key { code: String, down: bool },
}

#[tauri::command]
fn inject_input_batch(events: Vec<InputEvent>, capture_width: u32, capture_height: u32) -> Result<(), String> {
    if capture_width == 0 || capture_height == 0 {
        return Ok(());
    }

    let mut enigo = Enigo::new();
    for ev in events {
        match ev {
            InputEvent::MouseMove { x, y } => {
                let max_x = capture_width.saturating_sub(1) as f64;
                let max_y = capture_height.saturating_sub(1) as f64;
                let px = (x.clamp(0.0, 1.0) * max_x).round() as i32;
                let py = (y.clamp(0.0, 1.0) * max_y).round() as i32;
                enigo.mouse_move_to(px, py);
            }
            InputEvent::MouseButton { button, down } => {
                let mb = match button {
                    0 => MouseButton::Left,
                    1 => MouseButton::Middle,
                    2 => MouseButton::Right,
                    _ => MouseButton::Left,
                };
                if down {
                    enigo.mouse_down(mb);
                } else {
                    enigo.mouse_up(mb);
                }
            }
            InputEvent::MouseWheel { dx, dy } => {
                // Browser wheel deltas are usually pixels; Enigo expects "lines". Scale gently.
                let sx = (dx / 30.0).round() as i32;
                let sy = (dy / 30.0).round() as i32;
                if sx != 0 {
                    enigo.mouse_scroll_x(sx);
                }
                if sy != 0 {
                    enigo.mouse_scroll_y(sy);
                }
            }
            InputEvent::Key { code, down } => {
                if let Some(key) = key_from_code(&code) {
                    if down {
                        enigo.key_down(key);
                    } else {
                        enigo.key_up(key);
                    }
                }
            }
        }
    }

    Ok(())
}

fn key_from_code(code: &str) -> Option<Key> {
    Some(match code {
        "Enter" => Key::Return,
        "Escape" => Key::Escape,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Space" => Key::Space,

        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,

        "Delete" => Key::Delete,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,

        "ControlLeft" | "ControlRight" => Key::Control,
        "ShiftLeft" | "ShiftRight" => Key::Shift,
        "AltLeft" | "AltRight" => Key::Alt,
        "MetaLeft" | "MetaRight" => Key::Meta,

        "KeyA" => Key::Layout('a'),
        "KeyB" => Key::Layout('b'),
        "KeyC" => Key::Layout('c'),
        "KeyD" => Key::Layout('d'),
        "KeyE" => Key::Layout('e'),
        "KeyF" => Key::Layout('f'),
        "KeyG" => Key::Layout('g'),
        "KeyH" => Key::Layout('h'),
        "KeyI" => Key::Layout('i'),
        "KeyJ" => Key::Layout('j'),
        "KeyK" => Key::Layout('k'),
        "KeyL" => Key::Layout('l'),
        "KeyM" => Key::Layout('m'),
        "KeyN" => Key::Layout('n'),
        "KeyO" => Key::Layout('o'),
        "KeyP" => Key::Layout('p'),
        "KeyQ" => Key::Layout('q'),
        "KeyR" => Key::Layout('r'),
        "KeyS" => Key::Layout('s'),
        "KeyT" => Key::Layout('t'),
        "KeyU" => Key::Layout('u'),
        "KeyV" => Key::Layout('v'),
        "KeyW" => Key::Layout('w'),
        "KeyX" => Key::Layout('x'),
        "KeyY" => Key::Layout('y'),
        "KeyZ" => Key::Layout('z'),

        "Digit0" => Key::Layout('0'),
        "Digit1" => Key::Layout('1'),
        "Digit2" => Key::Layout('2'),
        "Digit3" => Key::Layout('3'),
        "Digit4" => Key::Layout('4'),
        "Digit5" => Key::Layout('5'),
        "Digit6" => Key::Layout('6'),
        "Digit7" => Key::Layout('7'),
        "Digit8" => Key::Layout('8'),
        "Digit9" => Key::Layout('9'),

        _ => return None,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![inject_input_batch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
