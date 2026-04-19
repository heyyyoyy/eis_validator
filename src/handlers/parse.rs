use axum::extract::Multipart;
use axum::Json;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use encoding_rs::WINDOWS_1251;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use quick_xml::writer::Writer;
use serde::Serialize;
use std::io::Cursor;

use crate::error::AppError;

#[derive(Debug, Serialize)]
pub struct ParseResponse {
    pub document: String,
    pub attachment: String,
}

pub async fn parse_handler(mut multipart: Multipart) -> Result<Json<ParseResponse>, AppError> {
    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("failed to read multipart field: {e}")))?
        .ok_or_else(|| AppError::BadRequest("no file field in request".to_string()))?;

    let bytes = field
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(format!("failed to read field bytes: {e}")))?;

    extract_and_pretty_print(&bytes).map(Json)
}

pub fn extract_and_pretty_print(bytes: &[u8]) -> Result<ParseResponse, AppError> {
    // Transcode to UTF-8 only if the bytes are declared as windows-1251.
    // If they are already valid UTF-8 (e.g. in tests) pass through as-is.
    let utf8_bytes: std::borrow::Cow<[u8]> = if is_windows1251_declared(bytes) {
        let (decoded, _, _) = WINDOWS_1251.decode(bytes);
        std::borrow::Cow::Owned(decoded.into_owned().into_bytes())
    } else {
        std::borrow::Cow::Borrowed(bytes)
    };

    let (doc_b64, att_b64) = extract_base64_payloads(&utf8_bytes)?;

    let document = decode_and_pretty_print(&doc_b64, "Документ/Контент")?;
    let attachment = decode_and_pretty_print(&att_b64, "Прилож/Контент")?;

    Ok(ParseResponse {
        document,
        attachment,
    })
}

/// Returns true if the XML declaration contains `encoding="windows-1251"` (case-insensitive).
/// Scans only the first 200 bytes to avoid reading the whole document.
fn is_windows1251_declared(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(200)];
    let head_lossy = String::from_utf8_lossy(head).to_lowercase();
    head_lossy.contains("windows-1251")
}

/// Walk the XML element tree and return the Base64 text content of
/// `Документ/Контент` and `Прилож/Контент`.
///
/// Uses an element name stack so that the grandparent of `<Контент>` is
/// correctly identified regardless of nesting depth.
fn extract_base64_payloads(xml: &[u8]) -> Result<(String, String), AppError> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<String> = Vec::new();
    // When inside a targeted <Контент>, remembers which top-level container we're in.
    let mut collecting: Option<String> = None;

    let mut doc_b64: Option<String> = None;
    let mut att_b64: Option<String> = None;

    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                // Check before pushing: is this a <Контент> whose immediate parent
                // is one of the two containers we care about?
                if local == "Контент" {
                    if let Some(parent) = stack.last() {
                        if parent == "Документ" || parent == "Прилож" {
                            collecting = Some(parent.clone());
                        }
                    }
                }
                stack.push(local);
            }
            Ok(Event::End(_)) => {
                stack.pop();
                if stack
                    .last()
                    .is_none_or(|p| p != "Документ" && p != "Прилож")
                {
                    collecting = None;
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Some(ref container) = collecting {
                    let text = e.decode().unwrap_or_default().into_owned();
                    match container.as_str() {
                        "Документ" => doc_b64 = Some(text),
                        "Прилож" => att_b64 = Some(text),
                        _ => {}
                    }
                }
            }
            Ok(Event::CData(ref e)) => {
                if let Some(ref container) = collecting {
                    let text = e.decode().unwrap_or_default().into_owned();
                    match container.as_str() {
                        "Документ" => doc_b64 = Some(text),
                        "Прилож" => att_b64 = Some(text),
                        _ => {}
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(AppError::BadRequest(format!("XML parse error: {e}")));
            }
            _ => {}
        }
        buf.clear();
    }

    let doc = doc_b64
        .ok_or_else(|| AppError::BadRequest("Документ/Контент element not found".to_string()))?;
    let att = att_b64
        .ok_or_else(|| AppError::BadRequest("Прилож/Контент element not found".to_string()))?;

    Ok((doc, att))
}

/// Base64-decode a payload, transcode Windows-1251 → UTF-8, then pretty-print the XML.
fn decode_and_pretty_print(b64: &str, label: &str) -> Result<String, AppError> {
    let raw = BASE64
        .decode(b64.trim())
        .map_err(|e| AppError::BadRequest(format!("{label}: invalid Base64: {e}")))?;

    let (utf8_str, _, _) = WINDOWS_1251.decode(&raw);

    // Strip the XML declaration (if any) before re-serialising so we can
    // prepend a clean UTF-8 one after pretty-printing.
    let xml_body = strip_xml_declaration(utf8_str.as_ref());

    let pretty = pretty_print_xml(xml_body.as_bytes())
        .map_err(|e| AppError::BadRequest(format!("{label}: pretty-print error: {e}")))?;

    Ok(format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{pretty}"
    ))
}

/// Remove a leading `<?xml ... ?>` processing instruction so we can replace it
/// with a normalised UTF-8 declaration.
fn strip_xml_declaration(xml: &str) -> std::borrow::Cow<'_, str> {
    let trimmed = xml.trim_start();
    if trimmed.starts_with("<?xml") {
        if let Some(end) = trimmed.find("?>") {
            return std::borrow::Cow::Owned(trimmed[end + 2..].trim_start().to_string());
        }
    }
    std::borrow::Cow::Borrowed(xml)
}

/// Re-serialise XML bytes with two-space indentation using quick-xml.
fn pretty_print_xml(xml: &[u8]) -> Result<String, String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);

    let mut writer = Writer::new_with_indent(Cursor::new(Vec::new()), b' ', 2);
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) => break,
            Ok(event) => writer.write_event(event).map_err(|e| e.to_string())?,
            Err(e) => return Err(e.to_string()),
        }
        buf.clear();
    }

    let bytes = writer.into_inner().into_inner();
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;

    const INNER_XML: &str =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><root><child>value</child></root>";

    /// Build a minimal SOAP envelope (UTF-8) with optional Документ/Контент
    /// and Прилож/Контент elements whose text is the Base64 of `INNER_XML`.
    fn make_package(include_doc: bool, include_att: bool) -> Vec<u8> {
        let b64 = BASE64.encode(INNER_XML.as_bytes());

        let doc_block = if include_doc {
            format!("<Документ><Контент>{b64}</Контент></Документ>")
        } else {
            String::new()
        };
        let att_block = if include_att {
            format!("<Прилож><Контент>{b64}</Контент></Прилож>")
        } else {
            String::new()
        };

        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><Envelope>{doc_block}{att_block}</Envelope>"#
        )
        .into_bytes()
    }

    /// Same as `make_package` but the Контент text is an arbitrary string
    /// (not valid Base64).
    fn make_package_bad_b64() -> Vec<u8> {
        let doc = "<Документ><Контент>!!!not-base64!!!</Контент></Документ>";
        let att = "<Прилож><Контент>!!!not-base64!!!</Контент></Прилож>";
        format!(r#"<?xml version="1.0" encoding="UTF-8"?><Envelope>{doc}{att}</Envelope>"#)
            .into_bytes()
    }

    #[test]
    fn test_extract_valid_package() {
        let pkg = make_package(true, true);
        let result = extract_and_pretty_print(&pkg).expect("should succeed");
        assert!(
            !result.document.is_empty(),
            "document field should be non-empty"
        );
        assert!(
            !result.attachment.is_empty(),
            "attachment field should be non-empty"
        );
        assert!(
            result.document.starts_with("<?xml"),
            "document should start with XML declaration"
        );
        assert!(
            result.attachment.starts_with("<?xml"),
            "attachment should start with XML declaration"
        );
    }

    #[test]
    fn test_missing_document_content() {
        let pkg = make_package(false, true);
        let err = extract_and_pretty_print(&pkg).expect_err("should fail");
        match err {
            AppError::BadRequest(msg) => {
                assert!(
                    msg.contains("Документ/Контент"),
                    "error should mention missing element, got: {msg}"
                );
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn test_missing_attachment_content() {
        let pkg = make_package(true, false);
        let err = extract_and_pretty_print(&pkg).expect_err("should fail");
        match err {
            AppError::BadRequest(msg) => {
                assert!(
                    msg.contains("Прилож/Контент"),
                    "error should mention missing element, got: {msg}"
                );
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn test_invalid_base64() {
        let pkg = make_package_bad_b64();
        let err = extract_and_pretty_print(&pkg).expect_err("should fail on bad Base64");
        match err {
            AppError::BadRequest(msg) => {
                assert!(
                    msg.contains("Base64") || msg.contains("base64"),
                    "error should mention Base64, got: {msg}"
                );
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn test_pretty_print_indents_output() {
        let pkg = make_package(true, true);
        let result = extract_and_pretty_print(&pkg).expect("should succeed");
        assert!(
            result.document.contains('\n'),
            "document should contain newlines (pretty-printed), got:\n{}",
            result.document
        );
    }
}
