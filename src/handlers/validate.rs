use axum::extract::Multipart;
use axum::Json;
use libxml::parser::Parser;
use libxml::schemas::{SchemaParserContext, SchemaValidationContext};
use serde::Serialize;
use std::io::Write;
use tempfile::NamedTempFile;

use crate::error::AppError;

const DP_PAKET_EIS_01_00: &str = "DP_PAKET_EIS_01_00.xsd";

#[derive(Serialize)]
pub struct ValidationResponse {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
}

#[derive(Serialize)]
pub struct ValidationError {
    pub message: Option<String>,
    pub level: String,
    pub line: Option<i32>,
    pub column: Option<i32>,
    pub filename: Option<String>,
}

pub async fn validate_handler(
    mut multipart: Multipart,
) -> Result<Json<ValidationResponse>, AppError> {
    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("failed to read multipart field: {e}")))?
        .ok_or_else(|| AppError::BadRequest("no file field in request".to_string()))?;

    let bytes = field
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(format!("failed to read field bytes: {e}")))?;

    let mut tmp = NamedTempFile::new().map_err(AppError::Internal)?;
    tmp.write_all(&bytes).map_err(AppError::Internal)?;
    tmp.flush().map_err(AppError::Internal)?;

    let xml_path = tmp
        .path()
        .to_str()
        .ok_or_else(|| AppError::Internal(std::io::Error::other("temp file path is not UTF-8")))?
        .to_string();

    let schema_path = schema_file_path();
    let response = run_validation(&xml_path, &schema_path);

    Ok(Json(response))
}

fn schema_file_path() -> String {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    format!("{}/schemas/{}", manifest_dir, DP_PAKET_EIS_01_00)
}

pub fn run_validation(xml_path: &str, schema_path: &str) -> ValidationResponse {
    // Parse the XML first to catch well-formedness errors early.
    // SchemaValidationContext::validate_file panics on unparseable input.
    let xml_parser = Parser::default();
    let doc = match xml_parser.parse_file(xml_path) {
        Ok(d) => d,
        Err(e) => {
            return ValidationResponse {
                valid: false,
                errors: vec![ValidationError {
                    message: Some(format!("XML parse error: {e}")),
                    level: "Error".to_string(),
                    line: None,
                    column: None,
                    filename: Some(xml_path.to_string()),
                }],
            };
        }
    };

    let mut schema_parser = SchemaParserContext::from_file(schema_path);
    let schema_parse_errors = schema_parser.drain_errors();
    if !schema_parse_errors.is_empty() {
        return ValidationResponse {
            valid: false,
            errors: schema_parse_errors
                .into_iter()
                .map(structured_error_to_validation_error)
                .collect(),
        };
    }

    let mut validator = match SchemaValidationContext::from_parser(&mut schema_parser) {
        Ok(v) => v,
        Err(errors) => {
            return ValidationResponse {
                valid: false,
                errors: errors
                    .into_iter()
                    .map(structured_error_to_validation_error)
                    .collect(),
            };
        }
    };

    match validator.validate_document(&doc) {
        Ok(()) => ValidationResponse {
            valid: true,
            errors: vec![],
        },
        Err(errors) => ValidationResponse {
            valid: false,
            errors: errors
                .into_iter()
                .map(structured_error_to_validation_error)
                .collect(),
        },
    }
}

fn structured_error_to_validation_error(e: libxml::error::StructuredError) -> ValidationError {
    ValidationError {
        message: e.message,
        level: format!("{:?}", e.level),
        line: e.line,
        column: e.col,
        filename: e.filename,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn schema_path() -> String {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        format!("{}/schemas/{}", manifest_dir, DP_PAKET_EIS_01_00)
    }

    fn validate_xml(xml: &[u8]) -> ValidationResponse {
        let mut tmp = NamedTempFile::new().expect("failed to create temp file");
        tmp.write_all(xml).expect("failed to write xml");
        tmp.flush().expect("failed to flush");
        let path = tmp
            .path()
            .to_str()
            .expect("temp path not UTF-8")
            .to_string();
        run_validation(&path, &schema_path())
    }

    /// Builds the minimal valid XML with all required attributes satisfied.
    fn valid_xml() -> String {
        // Required attributes on ФайлПакет:
        //   ИдТрПакет (ГУИД36Тип — exactly 36 chars)
        //   ИдФайл    (ИдФайлТип — 1-255 chars)
        //   ДатаВрФормир (xs:dateTime)
        //   ТипПрилож (enum — one of the listed values)
        //   ВерсФорм  (ВерсФормТип enum, e.g. "1.00")
        //   ИдОтпр    (ИдУчТип — 4-46 chars)
        //   ИдПол     (ИдУчТип — 4-46 chars)
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
         <ФайлПакет \
           ИдТрПакет=\"00000000-0000-0000-0000-000000000000\" \
           ИдФайл=\"test-file-id\" \
           ДатаВрФормир=\"2024-01-01T00:00:00\" \
           ТипПрилож=\"УПДПрод\" \
           ВерсФорм=\"1.00\" \
           ИдОтпр=\"0001\" \
           ИдПол=\"0002\"/>"
            .to_string()
    }

    #[test]
    fn test_valid_xml() {
        let result = validate_xml(valid_xml().as_bytes());
        assert!(
            result.valid,
            "expected valid XML, got errors: {:?}",
            result
                .errors
                .iter()
                .filter_map(|e| e.message.as_deref())
                .collect::<Vec<_>>()
        );
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_invalid_xml_wrong_root() {
        // Wrong root element name — schema expects ФайлПакет.
        let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<WrongRoot/>";
        let result = validate_xml(xml.as_bytes());
        assert!(!result.valid, "expected invalid XML");
        assert!(!result.errors.is_empty(), "expected at least one error");
        assert!(
            result.errors.iter().any(|e| e.message.is_some()),
            "expected error message"
        );
    }

    #[test]
    fn test_invalid_xml_missing_required_attributes() {
        // Root element present but all required attributes absent.
        let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ФайлПакет/>";
        let result = validate_xml(xml.as_bytes());
        assert!(
            !result.valid,
            "expected invalid XML due to missing required attributes"
        );
        assert!(!result.errors.is_empty());
    }

    #[test]
    fn test_invalid_xml_attribute_wrong_length() {
        // ИдТрПакет must be exactly 36 chars; "too-short" violates the xs:length restriction.
        let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
                   <ФайлПакет \
                     ИдТрПакет=\"too-short\" \
                     ИдФайл=\"test-file-id\" \
                     ДатаВрФормир=\"2024-01-01T00:00:00\" \
                     ТипПрилож=\"УПДПрод\" \
                     ВерсФорм=\"1.00\" \
                     ИдОтпр=\"0001\" \
                     ИдПол=\"0002\"/>";
        let result = validate_xml(xml.as_bytes());
        assert!(
            !result.valid,
            "expected invalid XML due to attribute length violation"
        );
        assert!(!result.errors.is_empty());
    }

    #[test]
    fn test_malformed_xml() {
        // Syntactically broken XML (unclosed tag) — libxml2 will report a parse error.
        let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ФайлПакет";
        let result = validate_xml(xml.as_bytes());
        assert!(!result.valid, "expected invalid due to malformed XML");
        assert!(!result.errors.is_empty());
    }

    #[test]
    fn test_empty_xml() {
        let result = validate_xml(b"");
        assert!(!result.valid, "expected invalid for empty input");
        assert!(!result.errors.is_empty());
    }
}
