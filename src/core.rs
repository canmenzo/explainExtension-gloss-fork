use std::slice;
use std::str;

const LIMIT: usize = 12_000;

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

fn is_valid_selection(text: &str) -> bool {
    !text.trim().is_empty() && text.chars().count() <= LIMIT
}

#[no_mangle]
pub unsafe extern "C" fn selection_is_valid(pointer: *const u8, length: usize) -> u32 {
    input(pointer, length)
        .map(is_valid_selection)
        .unwrap_or(false) as u32
}

fn clipped(text: &str, limit: usize) -> &str {
    text.char_indices()
        .nth(limit)
        .map(|(index, _)| &text[..index])
        .unwrap_or(text)
}

#[no_mangle]
pub unsafe extern "C" fn build_prompt(
    title_pointer: *const u8,
    title_length: usize,
    context_pointer: *const u8,
    context_length: usize,
    selection_pointer: *const u8,
    selection_length: usize,
    output_pointer: *mut u8,
    output_capacity: usize,
) -> usize {
    let Some(title) = input(title_pointer, title_length) else {
        return 0;
    };
    let Some(context) = input(context_pointer, context_length) else {
        return 0;
    };
    let Some(selection) = input(selection_pointer, selection_length) else {
        return 0;
    };
    let selection = clipped(selection, LIMIT);
    if !is_valid_selection(selection) {
        return 0;
    }
    let title = clipped(title, 300);
    let context = clipped(context, 5000);
    let prompt = format!(
        "Explain what the selected text means here in 2 to 4 concise sentences. If it names a person, organization, place, or work, identify it when clear. Unpack unusual phrasing or metaphor when present. Do not invent details.\n\nPage: {title}\n\nNearby text:\n{context}\n\nSelected text:\n{selection}"
    );
    if prompt.len() > output_capacity {
        return 0;
    }
    slice::from_raw_parts_mut(output_pointer, prompt.len()).copy_from_slice(prompt.as_bytes());
    prompt.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_selection_limits() {
        assert!(!is_valid_selection(" \n"));
        assert!(is_valid_selection("word"));
        assert!(!is_valid_selection(&"x".repeat(LIMIT + 1)));
    }

    #[test]
    fn clips_by_unicode_characters() {
        assert_eq!(clipped("\u{e9}\u{732b}x", 2), "\u{e9}\u{732b}");
    }
}
