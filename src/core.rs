use serde_json::{json, Value};
use std::slice;
use std::str;

const SELECTION_LIMIT: usize = 12_000;
const MODEL_LIMIT: usize = 100;
const MODELS: [&str; 4] = [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
];

#[no_mangle]
pub extern "C" fn allocate(length: usize) -> *mut u8 {
    let mut buffer = vec![0; length].into_boxed_slice();
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

#[no_mangle]
pub unsafe extern "C" fn release(pointer: *mut u8, length: usize) {
    drop(Box::from_raw(slice::from_raw_parts_mut(pointer, length)));
}

unsafe fn input<'a>(pointer: *const u8, length: usize) -> Option<&'a str> {
    str::from_utf8(slice::from_raw_parts(pointer, length)).ok()
}

fn clipped(text: &str, limit: usize) -> &str {
    text.char_indices()
        .nth(limit)
        .map(|(index, _)| &text[..index])
        .unwrap_or(text)
}

fn valid_selection(text: &str) -> bool {
    !text.trim().is_empty() && text.chars().count() <= SELECTION_LIMIT
}

fn write(output: &mut [u8], value: &Value) -> usize {
    let Ok(bytes) = serde_json::to_vec(value) else {
        return 0;
    };
    if bytes.len() > output.len() {
        return 0;
    }
    output[..bytes.len()].copy_from_slice(&bytes);
    bytes.len()
}

#[no_mangle]
pub unsafe extern "C" fn selection_is_valid(pointer: *const u8, length: usize) -> u32 {
    input(pointer, length).map(valid_selection).unwrap_or(false) as u32
}

#[no_mangle]
pub extern "C" fn transition(state: u32, event: u32) -> u32 {
    match (state, event) {
        (0, 1) | (1, 1) => 1,
        (1, 2) => 2,
        (2, 3) => 3,
        (2, 4) => 4,
        (_, 5) => 0,
        (3 | 4, 1) => 1,
        (state, _) => state,
    }
}

fn request_value(
    model: &str,
    title: &str,
    context: &str,
    selection: &str,
) -> Result<Value, &'static str> {
    if model.len() > MODEL_LIMIT || !MODELS.contains(&model) {
        return Err("Choose a supported Gemini model.");
    }
    let selection = clipped(selection, SELECTION_LIMIT);
    if !valid_selection(selection) {
        return Err("Select some text first.");
    }
    let prompt = format!(
        "You help a reader understand a passage on a web page. In plain language and no more than four short sentences, say what the selected text means in its surrounding context. When it refers to someone or something specific, say who or what that is, but only if the context makes it clear. Spell out jargon, idioms, and figurative language. Stick to what the text supports; never guess at facts.\n\nPage: {}\n\nNearby text:\n{}\n\nSelected text:\n{}",
        clipped(title, 300),
        clipped(context, 5000),
        selection
    );
    Ok(json!({
        "model": model,
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": { "temperature": 0.4, "maxOutputTokens": 300 }
    }))
}

#[no_mangle]
pub unsafe extern "C" fn build_request(
    model_pointer: *const u8,
    model_length: usize,
    title_pointer: *const u8,
    title_length: usize,
    context_pointer: *const u8,
    context_length: usize,
    selection_pointer: *const u8,
    selection_length: usize,
    output_pointer: *mut u8,
    output_capacity: usize,
) -> usize {
    let output = slice::from_raw_parts_mut(output_pointer, output_capacity);
    let Some(model) = input(model_pointer, model_length) else {
        return write(output, &json!({ "error": "Invalid Gemini model." }));
    };
    let Some(title) = input(title_pointer, title_length) else {
        return write(output, &json!({ "error": "Invalid page title." }));
    };
    let Some(context) = input(context_pointer, context_length) else {
        return write(output, &json!({ "error": "Invalid nearby text." }));
    };
    let Some(selection) = input(selection_pointer, selection_length) else {
        return write(output, &json!({ "error": "Select some text first." }));
    };
    match request_value(model, title, context, selection) {
        Ok(value) => write(output, &value),
        Err(error) => write(output, &json!({ "error": error })),
    }
}

fn response_value(status: u16, body: &str) -> Value {
    let parsed: Value = match serde_json::from_str(body) {
        Ok(value) => value,
        Err(_) if (200..300).contains(&status) => {
            return json!({ "error": "Google Gemini returned an unreadable response." });
        }
        Err(_) => Value::Null,
    };
    if !(200..300).contains(&status) {
        let error = match status {
            401 | 403 => "Google rejected this key. Check that it is a Gemini API key.",
            429 => "Google rate or usage limit reached. Try again later.",
            _ => parsed["error"]["message"].as_str().unwrap_or(""),
        };
        return json!({ "error": if error.is_empty() { format!("Google Gemini returned {status}.") } else { error.to_string() } });
    }
    let answer = parsed["candidates"][0]["content"]["parts"]
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part["text"].as_str())
                .collect::<String>()
        })
        .unwrap_or_default();
    let answer = answer.trim();
    if answer.is_empty() {
        json!({ "error": "Google Gemini returned no explanation." })
    } else {
        json!({ "answer": answer })
    }
}

#[no_mangle]
pub unsafe extern "C" fn parse_response(
    status: u32,
    response_pointer: *const u8,
    response_length: usize,
    output_pointer: *mut u8,
    output_capacity: usize,
) -> usize {
    let output = slice::from_raw_parts_mut(output_pointer, output_capacity);
    let Some(body) = input(response_pointer, response_length) else {
        return write(
            output,
            &json!({ "error": "Google Gemini returned an unreadable response." }),
        );
    };
    write(
        output,
        &response_value(status.min(u16::MAX as u32) as u16, body),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_unicode_selection_limits() {
        assert!(!valid_selection(" \n"));
        assert!(valid_selection("word"));
        assert!(valid_selection(&"猫".repeat(SELECTION_LIMIT)));
        assert!(!valid_selection(&"猫".repeat(SELECTION_LIMIT + 1)));
        assert_eq!(clipped("é猫x", 2), "é猫");
    }

    #[test]
    fn transitions_explanation_state() {
        assert_eq!(transition(0, 1), 1);
        assert_eq!(transition(1, 2), 2);
        assert_eq!(transition(2, 3), 3);
        assert_eq!(transition(2, 4), 4);
        assert_eq!(transition(4, 5), 0);
        assert_eq!(transition(0, 3), 0);
    }

    #[test]
    fn constructs_request_and_clips_unicode_without_breaking_text() {
        let payload = request_value(
            "gemini-3.8-flash",
            "page",
            &"猫".repeat(5002),
            "selected \"quoted\" text",
        )
        .unwrap();
        let prompt = payload["contents"][0]["parts"][0]["text"].as_str().unwrap();
        assert_eq!(prompt.matches('猫').count(), 5000);
        assert!(prompt.contains("selected \"quoted\" text"));
        assert_eq!(payload["generationConfig"]["maxOutputTokens"], 300);
        assert!(request_value("bad-model", "", "", "word").is_err());
        assert!(request_value("gemini-3.8-flash", "", "", " ").is_err());
    }

    #[test]
    fn parses_answers_and_provider_errors() {
        assert_eq!(
            response_value(
                200,
                r#"{"candidates":[{"content":{"parts":[{"text":"  Clear "},{"text":"answer.  "}]}}]}"#
            )["answer"],
            "Clear answer."
        );
        assert!(response_value(200, "{}")["error"]
            .as_str()
            .unwrap()
            .contains("no explanation"));
        assert!(response_value(200, "not json")["error"]
            .as_str()
            .unwrap()
            .contains("unreadable"));
        assert!(response_value(403, "{}")["error"]
            .as_str()
            .unwrap()
            .contains("rejected"));
        assert!(response_value(429, "{}")["error"]
            .as_str()
            .unwrap()
            .contains("limit"));
        assert_eq!(
            response_value(500, r#"{"error":{"message":"Service unavailable"}}"#)["error"],
            "Service unavailable"
        );
    }
}
