//! Local text extraction from documents a client hands over (spec: v0.2, T1).
//!
//! This is the audited surface: a hostile PDF, DOCX or XLSX must not be able to do anything but
//! produce text or a refusal. Nothing here is ever written to disk — zip entries are read as
//! in-memory streams, never extracted — and nothing here reaches the network. The extracted text
//! is returned to the caller and never cached or logged.
//!
//! Every failure path collapses to one token, `UNREADABLE`, with no detail: consistent with the
//! rest of the app's error style (see `commands.rs`), and it keeps a malformed file's internals
//! out of any log.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// A file larger than this is refused before it is read. Chosen so a user cannot point the app
/// at something that is not one of the five documented kinds and have it hang reading gigabytes.
pub const MAX_INPUT_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// The zip-bomb guard. For DOCX this bounds the decompressed bytes actually pulled out of
/// `word/document.xml` while streaming it. For XLSX (parsed by `calamine`, which manages its own
/// zip decompression with no hook to bound it mid-stream) this module runs its own streaming
/// decompression pass over every entry first — via `true_uncompressed_total_exceeds_cap`, using
/// this same cap — and only hands the bytes to `calamine` if that real inflated total stays
/// within it (v0.2 security audit, Finding 2: the archive's central directory *declares* an
/// uncompressed size that the `zip` crate does not enforce during inflation, so trusting it
/// without decompressing was bypassable). For PDF it is passed straight through to `lopdf`'s own
/// per-page decompression-limit API.
pub const MAX_DECOMPRESSED_BYTES: usize = 100 * 1024 * 1024;

/// The text returned to the renderer is capped independently of how it was produced, so one
/// enormous document cannot balloon the suggestion panel or the eventual project file.
pub const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;

/// However many paths a picker hands back, only the first this many are processed. The rest are
/// silently dropped rather than the whole call being refused: a user who multi-selects too much
/// still gets useful results for what fits.
pub const MAX_FILES_PER_CALL: usize = 50;

/// The one token every failure path in this module reports. No detail: see module docs.
pub const UNREADABLE: &str = "UNREADABLE";

const KIND_PDF: &str = "pdf";
const KIND_DOCX: &str = "docx";
const KIND_XLSX: &str = "xlsx";
const KIND_CSV: &str = "csv";
const KIND_TXT: &str = "txt";
const KIND_UNKNOWN: &str = "unknown";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedFile {
    pub name: String,
    pub kind: String,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedError {
    pub name: String,
    pub kind: String,
    pub error: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum ExtractResult {
    Ok(ExtractedFile),
    Err(ExtractedError),
}

/// Extracts plain text from every path given, up to `MAX_FILES_PER_CALL`. One file's failure —
/// malformed bytes, a panic inside a parser, an unreadable path — never fails the batch; it
/// becomes that file's `ExtractResult::Err` entry instead.
pub fn extract_text(paths: &[PathBuf]) -> Vec<ExtractResult> {
    paths
        .iter()
        .take(MAX_FILES_PER_CALL)
        .map(|p| extract_one(p))
        .collect()
}

fn file_name_only(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn detect_kind(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => Some(KIND_PDF),
        "docx" => Some(KIND_DOCX),
        "xlsx" => Some(KIND_XLSX),
        "csv" => Some(KIND_CSV),
        "txt" | "log" => Some(KIND_TXT),
        _ => None,
    }
}

fn unreadable(name: String, kind: &str) -> ExtractResult {
    ExtractResult::Err(ExtractedError {
        name,
        kind: kind.to_string(),
        error: UNREADABLE.to_string(),
    })
}

fn extract_one(path: &Path) -> ExtractResult {
    let name = file_name_only(path);

    // An extension that is not one of the five kinds is refused without ever touching the
    // filesystem — no stat, no open — so a path that does not even exist behaves identically to
    // one that does.
    let Some(kind) = detect_kind(path) else {
        return unreadable(name, KIND_UNKNOWN);
    };

    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return unreadable(name, kind),
    };
    if !meta.is_file() || meta.len() > MAX_INPUT_FILE_BYTES {
        return unreadable(name, kind);
    }

    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return unreadable(name, kind),
    };

    // A malformed file must never poison the batch, including via a panic inside a parser
    // dependency. `catch_unwind` is a safe function; nothing here is `unsafe`.
    let parsed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse_bytes(kind, &bytes)));

    match parsed {
        Ok(Ok((text, truncated_while_parsing))) => {
            let (text, truncated_by_text_cap) = cap_text(text);
            ExtractResult::Ok(ExtractedFile {
                name,
                kind: kind.to_string(),
                text,
                truncated: truncated_while_parsing || truncated_by_text_cap,
            })
        }
        Ok(Err(())) | Err(_) => unreadable(name, kind),
    }
}

/// `Ok((text, truncated))` on success; `Err(())` collapses every parser-specific failure into the
/// one `UNREADABLE` token the caller reports. CSV/TXT/log cannot be malformed — any bytes are a
/// valid (possibly lossy) text file — so those two never fail here.
fn parse_bytes(kind: &str, bytes: &[u8]) -> Result<(String, bool), ()> {
    match kind {
        KIND_PDF => parse_pdf(bytes),
        KIND_DOCX => parse_docx(bytes),
        KIND_XLSX => parse_xlsx(bytes),
        KIND_CSV | KIND_TXT => Ok((String::from_utf8_lossy(bytes).into_owned(), false)),
        _ => Err(()),
    }
}

fn cap_text(mut text: String) -> (String, bool) {
    if text.len() <= MAX_TEXT_BYTES {
        return (text, false);
    }
    let mut end = MAX_TEXT_BYTES;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    (text, true)
}

// ---------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------

/// Best-effort text extraction. An image-only/scanned PDF loads fine and yields empty text —
/// that is an honest answer, not a failure, so the caller can show it as "no text found" rather
/// than an error. Decompression is bounded per page via `lopdf`'s own bomb-safe API; a page that
/// exceeds the bound is dropped (contributes nothing) and the file is marked truncated, rather
/// than failing extraction for every other page.
fn parse_pdf(bytes: &[u8]) -> Result<(String, bool), ()> {
    let doc = lopdf::Document::load_mem(bytes).map_err(|_| ())?;
    let page_numbers: Vec<u32> = doc.get_pages().keys().copied().collect();

    // v0.2 security audit, Finding 4 (MINOR). Passing every page number to
    // `extract_text_chunks_with_limit` at once means it accumulates every page's text into its
    // own `Vec<Result<String>>` before returning, so peak memory was the sum of all pages'
    // extracted text rather than `MAX_TEXT_BYTES` — `cap_text` only trims the final `String`
    // after all of that was already held at once. Calling it one page at a time instead, and
    // stopping once the running total reaches the cap, bounds peak memory to roughly one page's
    // text plus the cap: later pages are never decompressed at all rather than being extracted
    // and then discarded by `cap_text`.
    let mut text = String::new();
    let mut truncated = false;
    for page_number in page_numbers {
        if text.len() >= MAX_TEXT_BYTES {
            truncated = true;
            break;
        }
        let chunks = doc.extract_text_chunks_with_limit(&[page_number], MAX_DECOMPRESSED_BYTES);
        for chunk in chunks {
            match chunk {
                Ok(s) => text.push_str(&s),
                Err(_) => truncated = true,
            }
        }
    }
    Ok((text, truncated))
}

// ---------------------------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------------------------

/// Reads only `word/document.xml`, as a stream — the archive is never extracted to disk. `w:t`
/// text runs are concatenated; a `w:p` paragraph end becomes a newline. Everything else in the
/// package (styles, media, headers/footers, `[Content_Types].xml`...) is ignored.
fn parse_docx(bytes: &[u8]) -> Result<(String, bool), ()> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|_| ())?;
    let mut entry = archive.by_name("word/document.xml").map_err(|_| ())?;
    let (xml, truncated) = read_capped(&mut entry, MAX_DECOMPRESSED_BYTES);
    let text = xml_to_paragraph_text(&xml, b"t", b"p").map_err(|_| ())?;
    Ok((text, truncated))
}

/// Reads up to `cap` bytes from `r`, streaming — this is what stops a small compressed entry from
/// inflating without limit. Returns `(bytes_read, more_data_existed_beyond_cap)`.
fn read_capped<R: Read>(r: &mut R, cap: usize) -> (Vec<u8>, bool) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
        if buf.len() >= cap {
            return match r.read(&mut chunk) {
                Ok(0) | Err(_) => (buf, false),
                Ok(_) => (buf, true),
            };
        }
        match r.read(&mut chunk) {
            Ok(0) => return (buf, false),
            Ok(n) => {
                let remaining = cap - buf.len();
                if n <= remaining {
                    buf.extend_from_slice(&chunk[..n]);
                } else {
                    buf.extend_from_slice(&chunk[..remaining]);
                    return (buf, true);
                }
            }
            Err(_) => return (buf, false),
        }
    }
}

/// Minimal streaming XML-to-text walk shared by the DOCX path: text inside `text_tag` (matched by
/// local name, so a namespace prefix like `w:` is irrelevant) is kept, and each closing
/// `paragraph_tag` becomes a newline.
fn xml_to_paragraph_text(
    xml: &[u8],
    text_tag: &[u8],
    paragraph_tag: &[u8],
) -> Result<String, quick_xml::Error> {
    let mut reader = quick_xml::Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut in_text = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Start(e)) => {
                if e.local_name().as_ref() == text_tag {
                    in_text = true;
                }
            }
            Ok(quick_xml::events::Event::Text(e)) if in_text => {
                if let Ok(decoded) = e.decode() {
                    if let Ok(unescaped) = quick_xml::escape::unescape(&decoded) {
                        out.push_str(&unescaped);
                    }
                }
            }
            Ok(quick_xml::events::Event::End(e)) => {
                let local = e.local_name();
                if local.as_ref() == text_tag {
                    in_text = false;
                } else if local.as_ref() == paragraph_tag {
                    out.push('\n');
                }
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(e) => return Err(e),
            _ => {}
        }
        buf.clear();
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------------------------

/// All sheets, cells joined per row with tabs, rows with newlines. See the module-level and
/// `MAX_DECOMPRESSED_BYTES` docs for how this guards against a zip bomb before handing the
/// archive to `calamine`, which does its own zip decompression with no bound this module can set
/// mid-stream.
fn parse_xlsx(bytes: &[u8]) -> Result<(String, bool), ()> {
    // v0.2 security audit, Finding 2 (IMPORTANT). This used to trust the archive's central
    // directory to *declare* its uncompressed size honestly, then only decompress if that
    // declared number passed the cap. The `zip` crate does not enforce the declared size during
    // inflation, so a forged small declared size wrapping a highly compressible deflate stream
    // sailed through this check and inflated to gigabytes inside `calamine`, whose CRC check only
    // fires after the fact. The fix decompresses every entry itself, streaming, through the same
    // `read_capped` ceiling DOCX already uses, and sums the *actual* inflated bytes — the number
    // the old check assumed but never verified. That means an honest XLSX now gets decompressed
    // twice (once here to prove the bound, once by `calamine` to read cells): an acceptable cost
    // for a bound that is actually true, versus one that only looked true.
    if true_uncompressed_total_exceeds_cap(bytes, MAX_DECOMPRESSED_BYTES).ok_or(())? {
        // Same convention as before: an honest zip bomb is reported as an empty, truncated
        // result rather than UNREADABLE, since the file was readable — it just could not be
        // safely decompressed in full.
        return Ok((String::new(), true));
    }

    let cursor = std::io::Cursor::new(bytes);
    let mut workbook: calamine::Xlsx<_> = calamine::Reader::new(cursor).map_err(|_| ())?;

    let mut out = String::new();
    for (_name, range) in calamine::Reader::worksheets(&mut workbook) {
        for row in range.rows() {
            let line = row
                .iter()
                .map(|cell| cell.to_string())
                .collect::<Vec<_>>()
                .join("\t");
            out.push_str(&line);
            out.push('\n');
        }
    }
    Ok((out, false))
}

/// Streams every entry in the archive through `read_capped`, decompressing for real, and reports
/// whether the true cumulative inflated size exceeds `cap`. `None` if the bytes are not readable
/// as a zip at all — `parse_xlsx` treats that the same as any other malformed archive.
///
/// This stops reading (and returns `Some(true)`) as soon as the running total would cross `cap`,
/// so a genuine bomb is never decompressed past the bound even though it spans many entries —
/// each entry's own read is capped to whatever room is left, not to `cap` itself.
fn true_uncompressed_total_exceeds_cap(bytes: &[u8], cap: usize) -> Option<bool> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).ok()?;
    let mut total: usize = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).ok()?;
        let remaining = cap.saturating_sub(total);
        let (data, more_beyond_cap) = read_capped(&mut entry, remaining);
        total += data.len();
        if more_beyond_cap || total > cap {
            return Some(true);
        }
    }
    Some(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            for (name, contents) in entries {
                writer.start_file(*name, options).unwrap();
                writer.write_all(contents).unwrap();
            }
            writer.finish().unwrap();
        }
        buf
    }

    /// Forges the "uncompressed size" field the zip central directory declares for the first
    /// entry whose local/central file headers this finds, leaving the actual compressed data
    /// (and therefore what it really inflates to) untouched. This is v0.2 security audit Finding
    /// 2's exact attack shape: a small declared size wrapping a stream that decompresses to
    /// something much larger. Field offsets are from the ZIP spec (§4.3.7 local file header,
    /// §4.3.12 central directory file header); this only works for archives without Zip64
    /// extensions, which `write_zip`'s small fixtures never trigger.
    fn forge_declared_uncompressed_size(zip_bytes: &mut [u8], forged_size: u32) {
        const LOCAL_HEADER_SIG: [u8; 4] = [0x50, 0x4b, 0x03, 0x04];
        const CENTRAL_HEADER_SIG: [u8; 4] = [0x50, 0x4b, 0x01, 0x02];
        let local_pos = zip_bytes
            .windows(4)
            .position(|w| w == LOCAL_HEADER_SIG)
            .expect("no local file header found");
        zip_bytes[local_pos + 22..local_pos + 26].copy_from_slice(&forged_size.to_le_bytes());
        let central_pos = zip_bytes
            .windows(4)
            .position(|w| w == CENTRAL_HEADER_SIG)
            .expect("no central directory header found");
        zip_bytes[central_pos + 24..central_pos + 28].copy_from_slice(&forged_size.to_le_bytes());
    }

    fn minimal_document_xml(paragraphs: &[&str]) -> String {
        let mut body = String::new();
        for p in paragraphs {
            body.push_str(&format!(
                "<w:p><w:r><w:t>{p}</w:t></w:r></w:p>",
                p = p
            ));
        }
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">\
             <w:body>{body}</w:body></w:document>"
        )
    }

    fn minimal_docx(paragraphs: &[&str]) -> Vec<u8> {
        let xml = minimal_document_xml(paragraphs);
        write_zip(&[("word/document.xml", xml.as_bytes())])
    }

    /// `lopdf::dictionary!` needs a `use` of the macro item to resolve under this crate's
    /// edition, which is more ceremony than it is worth for one test helper — a couple of
    /// `.set()` calls read just as plainly.
    fn dict(pairs: &[(&str, lopdf::Object)]) -> lopdf::Dictionary {
        let mut d = lopdf::Dictionary::new();
        for (k, v) in pairs {
            d.set(*k, v.clone());
        }
        d
    }

    fn minimal_pdf_with_text(text: &str) -> Vec<u8> {
        let mut doc = lopdf::Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(lopdf::Object::Dictionary(dict(&[
            ("Type", "Font".into()),
            ("Subtype", "Type1".into()),
            ("BaseFont", "Helvetica".into()),
        ])));
        let mut fonts = lopdf::Dictionary::new();
        fonts.set("F1", font_id);
        let resources_id =
            doc.add_object(lopdf::Object::Dictionary(dict(&[("Font", fonts.into())])));
        let content = format!("BT /F1 24 Tf 100 700 Td ({text}) Tj ET");
        let content_id = doc.add_object(lopdf::Stream::new(
            lopdf::Dictionary::new(),
            content.into_bytes(),
        ));
        let page_id = doc.add_object(lopdf::Object::Dictionary(dict(&[
            ("Type", "Page".into()),
            ("Parent", pages_id.into()),
            ("Contents", content_id.into()),
        ])));
        doc.objects.insert(
            pages_id,
            lopdf::Object::Dictionary(dict(&[
                ("Type", "Pages".into()),
                ("Kids", vec![page_id.into()].into()),
                ("Count", 1.into()),
                ("Resources", resources_id.into()),
            ])),
        );
        let catalog_id = doc.add_object(lopdf::Object::Dictionary(dict(&[
            ("Type", "Catalog".into()),
            ("Pages", pages_id.into()),
        ])));
        doc.trailer.set("Root", catalog_id);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    /// Same shape as `minimal_pdf_with_text`, generalised to one text per page — for exercising
    /// Finding 4's stop-accumulating-at-the-cap behaviour across multiple pages.
    fn minimal_pdf_with_page_texts(texts: &[&str]) -> Vec<u8> {
        let mut doc = lopdf::Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(lopdf::Object::Dictionary(dict(&[
            ("Type", "Font".into()),
            ("Subtype", "Type1".into()),
            ("BaseFont", "Helvetica".into()),
        ])));
        let mut fonts = lopdf::Dictionary::new();
        fonts.set("F1", font_id);
        let resources_id =
            doc.add_object(lopdf::Object::Dictionary(dict(&[("Font", fonts.into())])));
        let mut page_ids = Vec::new();
        for text in texts {
            let content = format!("BT /F1 24 Tf 100 700 Td ({text}) Tj ET");
            let content_id = doc.add_object(lopdf::Stream::new(
                lopdf::Dictionary::new(),
                content.into_bytes(),
            ));
            let page_id = doc.add_object(lopdf::Object::Dictionary(dict(&[
                ("Type", "Page".into()),
                ("Parent", pages_id.into()),
                ("Contents", content_id.into()),
            ])));
            page_ids.push(page_id);
        }
        doc.objects.insert(
            pages_id,
            lopdf::Object::Dictionary(dict(&[
                ("Type", "Pages".into()),
                (
                    "Kids",
                    page_ids.into_iter().map(Into::into).collect::<Vec<_>>().into(),
                ),
                ("Count", (texts.len() as i64).into()),
                ("Resources", resources_id.into()),
            ])),
        );
        let catalog_id = doc.add_object(lopdf::Object::Dictionary(dict(&[
            ("Type", "Catalog".into()),
            ("Pages", pages_id.into()),
        ])));
        doc.trailer.set("Root", catalog_id);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    fn minimal_xlsx(rows: &[&[&str]]) -> Vec<u8> {
        let mut sheet_rows = String::new();
        for (r_idx, row) in rows.iter().enumerate() {
            let mut cells = String::new();
            for (c_idx, value) in row.iter().enumerate() {
                let cell_ref = format!("{}{}", (b'A' + c_idx as u8) as char, r_idx + 1);
                cells.push_str(&format!(
                    "<c r=\"{cell_ref}\" t=\"inlineStr\"><is><t>{value}</t></is></c>"
                ));
            }
            sheet_rows.push_str(&format!("<row r=\"{}\">{cells}</row>", r_idx + 1));
        }
        let sheet_xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
             <sheetData>{sheet_rows}</sheetData></worksheet>"
        );
        let workbook_xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" \
             xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
             <sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>";
        let workbook_rels = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
             <Relationship Id=\"rId1\" \
             Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" \
             Target=\"worksheets/sheet1.xml\"/></Relationships>";
        let content_types = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
             <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
             <Override PartName=\"/xl/workbook.xml\" \
             ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\
             <Override PartName=\"/xl/worksheets/sheet1.xml\" \
             ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>\
             </Types>";
        let root_rels = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
             <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
             <Relationship Id=\"rId1\" \
             Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" \
             Target=\"xl/workbook.xml\"/></Relationships>";
        write_zip(&[
            ("[Content_Types].xml", content_types.as_bytes()),
            ("_rels/.rels", root_rels.as_bytes()),
            ("xl/workbook.xml", workbook_xml.as_bytes()),
            ("xl/_rels/workbook.xml.rels", workbook_rels.as_bytes()),
            ("xl/worksheets/sheet1.xml", sheet_xml.as_bytes()),
        ])
    }

    fn ok_of(r: &ExtractResult) -> &ExtractedFile {
        match r {
            ExtractResult::Ok(f) => f,
            ExtractResult::Err(e) => panic!("expected Ok, got error variant: {e:?}"),
        }
    }

    fn err_of(r: &ExtractResult) -> &ExtractedError {
        match r {
            ExtractResult::Err(e) => e,
            ExtractResult::Ok(f) => panic!("expected Err, got ok variant: {f:?}"),
        }
    }

    // ---- happy paths ----

    #[test]
    fn extracts_csv_directly() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.csv");
        std::fs::write(&path, "a,b,c\n1,2,3\n").unwrap();
        let result = extract_text(&[path]);
        let f = ok_of(&result[0]);
        assert_eq!(f.kind, "csv");
        assert_eq!(f.text, "a,b,c\n1,2,3\n");
        assert!(!f.truncated);
    }

    #[test]
    fn extracts_txt_directly_including_lossy_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.txt");
        let mut bytes = b"hello ".to_vec();
        bytes.extend_from_slice(&[0xff, 0xfe]); // not valid UTF-8
        bytes.extend_from_slice(b" world");
        std::fs::write(&path, &bytes).unwrap();
        let result = extract_text(&[path]);
        let f = ok_of(&result[0]);
        assert_eq!(f.kind, "txt");
        assert!(f.text.contains("hello"));
        assert!(f.text.contains("world"));
    }

    #[test]
    fn a_log_extension_is_read_as_txt() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.log");
        std::fs::write(&path, "line one\nline two\n").unwrap();
        let result = extract_text(&[path]);
        let f = ok_of(&result[0]);
        assert_eq!(f.kind, "txt");
        assert_eq!(f.text, "line one\nline two\n");
    }

    #[test]
    fn extracts_docx_text_with_paragraph_breaks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("letter.docx");
        std::fs::write(&path, minimal_docx(&["Hello", "World"])).unwrap();
        let result = extract_text(&[path]);
        let f = ok_of(&result[0]);
        assert_eq!(f.kind, "docx");
        assert_eq!(f.text, "Hello\nWorld\n");
        assert!(!f.truncated);
    }

    #[test]
    fn extracts_xlsx_cells_tab_and_newline_joined() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sheet.xlsx");
        std::fs::write(&path, minimal_xlsx(&[&["a", "b"], &["1", "2"]])).unwrap();
        let result = extract_text(&[path]);
        let f = ok_of(&result[0]);
        assert_eq!(f.kind, "xlsx");
        assert_eq!(f.text, "a\tb\n1\t2\n");
        assert!(!f.truncated);
    }

    #[test]
    fn extracts_text_from_a_minimal_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.pdf");
        std::fs::write(&path, minimal_pdf_with_text("Hello PDF")).unwrap();
        let result = extract_text(&[path]);
        let f = ok_of(&result[0]);
        assert_eq!(f.kind, "pdf");
        assert!(
            f.text.contains("Hello PDF"),
            "expected extracted text to contain the string drawn on the page, got {:?}",
            f.text
        );
        assert!(!f.truncated);
    }

    #[test]
    fn a_pdf_stops_reading_pages_once_the_text_cap_is_already_reached() {
        // v0.2 security audit, Finding 4 (MINOR). Page one alone already exceeds MAX_TEXT_BYTES;
        // page two carries a marker string that must never appear in the result if extraction
        // truly stops accumulating (and stops calling into lopdf for further pages) once the cap
        // is reached, rather than extracting every page and only trimming the sum afterwards.
        let page_one = "A".repeat(MAX_TEXT_BYTES + 1000);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("multi.pdf");
        std::fs::write(
            &path,
            minimal_pdf_with_page_texts(&[&page_one, "PAGE_TWO_MARKER"]),
        )
        .unwrap();
        let result = extract_text(&[path]);
        let f = ok_of(&result[0]);
        assert_eq!(f.kind, "pdf");
        assert!(f.truncated);
        assert_eq!(f.text.len(), MAX_TEXT_BYTES);
        assert!(
            !f.text.contains("PAGE_TWO_MARKER"),
            "page two must never be read once the cap was already reached by page one"
        );
    }

    #[test]
    fn a_scanned_pdf_with_no_text_operators_yields_empty_text_not_an_error() {
        let mut doc = lopdf::Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let content_id = doc.add_object(lopdf::Stream::new(lopdf::Dictionary::new(), Vec::new()));
        let page_id = doc.add_object(lopdf::Object::Dictionary(dict(&[
            ("Type", "Page".into()),
            ("Parent", pages_id.into()),
            ("Contents", content_id.into()),
        ])));
        doc.objects.insert(
            pages_id,
            lopdf::Object::Dictionary(dict(&[
                ("Type", "Pages".into()),
                ("Kids", vec![page_id.into()].into()),
                ("Count", 1.into()),
            ])),
        );
        let catalog_id = doc.add_object(lopdf::Object::Dictionary(dict(&[
            ("Type", "Catalog".into()),
            ("Pages", pages_id.into()),
        ])));
        doc.trailer.set("Root", catalog_id);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("scanned.pdf");
        std::fs::write(&path, bytes).unwrap();
        let result = extract_text(&[path]);
        let f = ok_of(&result[0]);
        assert_eq!(f.text, "", "an image-only PDF has no text to find");
        assert!(!f.truncated);
    }

    // ---- caps ----

    #[test]
    fn refuses_a_file_over_the_size_cap() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("huge.txt");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_INPUT_FILE_BYTES + 1).unwrap();
        let result = extract_text(&[path]);
        let e = err_of(&result[0]);
        assert_eq!(e.error, UNREADABLE);
        assert_eq!(e.kind, "txt");
    }

    #[test]
    fn a_docx_entry_that_would_decompress_past_the_cap_is_truncated_not_failed() {
        // A small compressed stream that decompresses to well past a much smaller cap, to keep
        // the test itself fast while still exercising the streaming-stop path.
        const TEST_CAP: usize = 1024;
        let huge_paragraph = "x".repeat(TEST_CAP * 4);
        let xml = minimal_document_xml(&[&huge_paragraph]);
        let zip_bytes = write_zip(&[("word/document.xml", xml.as_bytes())]);

        let cursor = std::io::Cursor::new(&zip_bytes);
        let mut archive = zip::ZipArchive::new(cursor).unwrap();
        let mut entry = archive.by_name("word/document.xml").unwrap();
        let (data, truncated) = read_capped(&mut entry, TEST_CAP);
        assert!(truncated);
        assert_eq!(data.len(), TEST_CAP);
    }

    #[test]
    fn no_file_appears_on_disk_after_parsing_a_hostile_archive_with_path_traversal_entries() {
        let dir = tempfile::tempdir().unwrap();
        let before: Vec<_> = std::fs::read_dir(std::env::current_dir().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name())
            .collect();

        let xml = minimal_document_xml(&["hi"]);
        let zip_bytes = write_zip(&[
            ("../../../evil.txt", b"pwned"),
            ("word/document.xml", xml.as_bytes()),
        ]);
        let path = dir.path().join("hostile.docx");
        std::fs::write(&path, &zip_bytes).unwrap();

        let result = extract_text(&[path]);
        // Whatever the result — the entry order or `by_name` resolution is not the point here —
        // nothing was ever extracted to disk.
        let _ = result;

        let after: Vec<_> = std::fs::read_dir(std::env::current_dir().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name())
            .collect();
        assert_eq!(before, after, "parsing a hostile archive must never write to disk");
        assert!(!Path::new("../../../evil.txt").exists());
    }

    #[test]
    fn an_xlsx_entry_with_a_large_real_uncompressed_size_is_refused() {
        // Builds a zip whose entry honestly decompresses past the cap — the classic zip-bomb
        // shape — and checks the real streaming check (Finding 2's fix) catches it.
        let mut buf = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            writer.start_file("xl/worksheets/sheet1.xml", options).unwrap();
            // Highly compressible: a run of the same byte, well past the cap once inflated.
            writer
                .write_all(&vec![b'a'; MAX_DECOMPRESSED_BYTES + 1])
                .unwrap();
            writer.finish().unwrap();
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bomb.xlsx");
        std::fs::write(&path, &buf).unwrap();
        let result = extract_text(&[path]);
        let f = ok_of(&result[0]);
        assert_eq!(f.text, "");
        assert!(f.truncated);
    }

    #[test]
    fn an_xlsx_with_a_forged_small_declared_size_is_still_refused() {
        // v0.2 security audit, Finding 2 (IMPORTANT). The archive's central directory declares a
        // small uncompressed size for this entry — well under the cap — but the actual deflate
        // stream it wraps inflates to well past it. Against the old code (which trusted that
        // declared field instead of decompressing to check it) this file's declared size would
        // have passed the cap unexamined, the call would have reached `calamine` (which, given
        // only a bare `xl/worksheets/sheet1.xml` with no other package parts, fails to open the
        // workbook) and the result would have come back `ExtractResult::Err` — so `ok_of` below
        // panics on the old code, which is what "fails against the old code" means here. Against
        // the fix, the real streaming decompression pass catches the true size regardless of what
        // the archive claims, and the archive is refused before `calamine` ever sees it.
        let mut buf = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            writer.start_file("xl/worksheets/sheet1.xml", options).unwrap();
            writer
                .write_all(&vec![b'a'; MAX_DECOMPRESSED_BYTES + 1])
                .unwrap();
            writer.finish().unwrap();
        }
        forge_declared_uncompressed_size(&mut buf, 10);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("forged.xlsx");
        std::fs::write(&path, &buf).unwrap();
        let result = extract_text(&[path]);
        let f = ok_of(&result[0]);
        assert_eq!(f.text, "");
        assert!(f.truncated);
    }

    #[test]
    fn text_over_the_cap_is_truncated_and_marked() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.txt");
        std::fs::write(&path, "x".repeat(MAX_TEXT_BYTES + 100)).unwrap();
        let result = extract_text(&[path]);
        let f = ok_of(&result[0]);
        assert_eq!(f.text.len(), MAX_TEXT_BYTES);
        assert!(f.truncated);
    }

    #[test]
    fn only_the_first_max_files_are_processed() {
        let dir = tempfile::tempdir().unwrap();
        let mut paths = Vec::new();
        for i in 0..(MAX_FILES_PER_CALL + 1) {
            let path = dir.path().join(format!("f{i}.txt"));
            std::fs::write(&path, "x").unwrap();
            paths.push(path);
        }
        let result = extract_text(&paths);
        assert_eq!(result.len(), MAX_FILES_PER_CALL);
    }

    // ---- malformed / unreadable ----

    #[test]
    fn malformed_bytes_with_a_pdf_extension_are_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fake.pdf");
        std::fs::write(&path, "not a pdf at all").unwrap();
        let result = extract_text(&[path]);
        let e = err_of(&result[0]);
        assert_eq!(e.error, UNREADABLE);
        assert_eq!(e.kind, "pdf");
    }

    #[test]
    fn malformed_bytes_with_a_docx_extension_are_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fake.docx");
        std::fs::write(&path, "not a zip at all").unwrap();
        let result = extract_text(&[path]);
        let e = err_of(&result[0]);
        assert_eq!(e.error, UNREADABLE);
        assert_eq!(e.kind, "docx");
    }

    #[test]
    fn a_docx_missing_document_xml_is_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.docx");
        std::fs::write(&path, write_zip(&[("readme.txt", b"nothing here")])).unwrap();
        let result = extract_text(&[path]);
        let e = err_of(&result[0]);
        assert_eq!(e.error, UNREADABLE);
    }

    #[test]
    fn malformed_bytes_with_an_xlsx_extension_are_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fake.xlsx");
        std::fs::write(&path, "not a zip at all").unwrap();
        let result = extract_text(&[path]);
        let e = err_of(&result[0]);
        assert_eq!(e.error, UNREADABLE);
        assert_eq!(e.kind, "xlsx");
    }

    #[test]
    fn an_unknown_extension_is_unreadable_without_ever_opening_the_path() {
        // The path does not exist. If the code tried to `stat` or `read` it before checking the
        // extension, this would come back as a filesystem error path instead — same conclusion,
        // wrong reason. The kind must be "unknown", not one of the five real kinds, proving the
        // extension check ran and nothing after it did.
        let path = PathBuf::from("/definitely/does/not/exist/anywhere.exe");
        let result = extract_text(&[path]);
        let e = err_of(&result[0]);
        assert_eq!(e.error, UNREADABLE);
        assert_eq!(e.kind, "unknown");
    }

    #[test]
    fn a_panic_inside_a_parser_is_caught_and_reported_as_unreadable_not_propagated() {
        // Exercised indirectly: malformed input is the practical way to hit an internal panic in
        // a dependency without adding a test-only hook. What this test actually pins is that the
        // batch keeps going afterwards — the real point of catch_unwind here.
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("bad.pdf");
        std::fs::write(&bad, "garbage").unwrap();
        let good = dir.path().join("good.txt");
        std::fs::write(&good, "still here").unwrap();

        let result = extract_text(&[bad, good]);
        assert_eq!(result.len(), 2);
        assert_eq!(err_of(&result[0]).error, UNREADABLE);
        assert_eq!(ok_of(&result[1]).text, "still here");
    }

    #[test]
    fn serializes_ok_and_err_variants_to_the_documented_camel_case_shapes() {
        let ok = ExtractResult::Ok(ExtractedFile {
            name: "a.txt".into(),
            kind: "txt".into(),
            text: "hi".into(),
            truncated: false,
        });
        let json = serde_json::to_value(&ok).unwrap();
        assert_eq!(json["name"], "a.txt");
        assert_eq!(json["kind"], "txt");
        assert_eq!(json["text"], "hi");
        assert_eq!(json["truncated"], false);
        assert!(json.get("error").is_none());

        let err = ExtractResult::Err(ExtractedError {
            name: "b.exe".into(),
            kind: "unknown".into(),
            error: UNREADABLE.into(),
        });
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["name"], "b.exe");
        assert_eq!(json["error"], "UNREADABLE");
        assert!(json.get("text").is_none());
    }
}
