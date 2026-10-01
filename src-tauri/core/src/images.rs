use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

#[derive(Debug)]
pub enum ImageError {
    UnsupportedType,
    Io(std::io::Error),
}

impl From<std::io::Error> for ImageError {
    fn from(e: std::io::Error) -> Self {
        ImageError::Io(e)
    }
}

impl std::fmt::Display for ImageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImageError::UnsupportedType => write!(f, "неподдерживаемый тип файла"),
            ImageError::Io(e) => write!(f, "{e}"),
        }
    }
}

fn is_avif_brand(bytes: &[u8]) -> bool {
    let end = bytes.len().min(32);
    bytes[8..end].windows(4).any(|w| w == b"avif" || w == b"avis")
}

pub(crate) fn detect_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" && is_avif_brand(bytes) {
        Some("avif")
    } else {
        None
    }
}

pub fn is_valid_image_filename(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && Path::new(name).file_name().map(|f| f == name).unwrap_or(false)
}

pub fn import(images_dir: &Path, source: &Path) -> Result<String, ImageError> {
    let bytes = fs::read(source)?;
    import_bytes(images_dir, &bytes)
}

pub fn import_bytes(images_dir: &Path, bytes: &[u8]) -> Result<String, ImageError> {
    let ext = detect_extension(bytes).ok_or(ImageError::UnsupportedType)?;

    let hash = Sha256::digest(bytes);
    let hex: String = hash.iter().take(16).map(|b| format!("{b:02x}")).collect();
    let filename = format!("{hex}.{ext}");

    fs::create_dir_all(images_dir)?;
    let dest = images_dir.join(&filename);
    if !dest.exists() {
        fs::write(&dest, bytes)?;
    }

    Ok(filename)
}

fn is_thumbable(name: &str) -> bool {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "avif")
}

pub fn thumb_rel(rel: &str) -> Option<String> {
    let parts: Vec<&str> = rel.split('/').collect();
    let name = match parts.as_slice() {
        ["images", name] => *name,
        ["previews", fan, name] if name.len() >= 2 && name.get(..2) == Some(*fan) => *name,
        _ => return None,
    };
    (is_valid_image_filename(name) && is_thumbable(name)).then(|| format!("thumbs/{rel}.webp"))
}

fn media_files(data_dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let names = |dir: &Path| -> Vec<String> {
        fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default()
    };
    for name in names(&data_dir.join("images")) {
        out.push(format!("images/{name}"));
    }
    for fan in names(&data_dir.join("previews")) {
        for name in names(&data_dir.join("previews").join(&fan)) {
            out.push(format!("previews/{fan}/{name}"));
        }
    }
    out
}

pub struct ThumbsState {
    pub ready: Vec<String>,
    pub missing: Vec<String>,
}

pub fn thumbs_state(data_dir: &Path) -> ThumbsState {
    let mut state = ThumbsState { ready: Vec::new(), missing: Vec::new() };
    for rel in media_files(data_dir) {
        let Some(thumb) = thumb_rel(&rel) else { continue };
        if data_dir.join(&thumb).is_file() {
            state.ready.push(rel);
        } else {
            state.missing.push(rel);
        }
    }
    state
}

pub fn store_thumb(data_dir: &Path, rel: &str, bytes: &[u8]) -> Result<(), ImageError> {
    let thumb = thumb_rel(rel).ok_or(ImageError::UnsupportedType)?;
    if detect_extension(bytes) != Some("webp") {
        return Err(ImageError::UnsupportedType);
    }
    let dest = data_dir.join(thumb);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = dest.with_extension("part");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, &dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn webp_bytes() -> Vec<u8> {
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes.extend_from_slice(b"WEBPVP8 ");
        bytes
    }

    #[test]
    fn thumb_rel_accepts_images_and_fanned_previews() {
        assert_eq!(thumb_rel("images/ab12.avif").as_deref(), Some("thumbs/images/ab12.avif.webp"));
        assert_eq!(thumb_rel("previews/ab/ab12.jpg").as_deref(), Some("thumbs/previews/ab/ab12.jpg.webp"));
    }

    #[test]
    fn thumb_rel_rejects_escapes_wrong_fan_and_animated_or_icon_files() {
        assert_eq!(thumb_rel("images/../booked.db"), None);
        assert_eq!(thumb_rel("images/a/b.png"), None);
        assert_eq!(thumb_rel("previews/cd/ab12.jpg"), None);
        assert_eq!(thumb_rel("icons/ab12.png"), None);
        assert_eq!(thumb_rel("images/ab12.gif"), None);
        assert_eq!(thumb_rel("images/ab12.ico"), None);
        assert_eq!(thumb_rel("images/обложка.png").as_deref(), Some("thumbs/images/обложка.png.webp"));
    }

    #[test]
    fn thumbs_state_splits_ready_and_missing_and_store_fills_the_gap() {
        let dir = scratch_dir("thumbs-state");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("images")).unwrap();
        fs::create_dir_all(dir.join("previews").join("cd")).unwrap();
        fs::write(dir.join("images").join("aa.png"), b"x").unwrap();
        fs::write(dir.join("images").join("bb.gif"), b"x").unwrap();
        fs::write(dir.join("previews").join("cd").join("cdef.jpg"), b"x").unwrap();

        let state = thumbs_state(&dir);
        assert!(state.ready.is_empty());
        let mut missing = state.missing.clone();
        missing.sort();
        assert_eq!(missing, vec!["images/aa.png".to_string(), "previews/cd/cdef.jpg".to_string()]);

        store_thumb(&dir, "images/aa.png", &webp_bytes()).unwrap();
        let state = thumbs_state(&dir);
        assert_eq!(state.ready, vec!["images/aa.png".to_string()]);
        assert_eq!(state.missing, vec!["previews/cd/cdef.jpg".to_string()]);
        assert!(dir.join("thumbs/images/aa.png.webp").is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn store_thumb_refuses_non_webp_bytes_and_bad_paths() {
        let dir = scratch_dir("thumbs-refuse");
        assert!(store_thumb(&dir, "images/aa.png", &[0x89, b'P', b'N', b'G']).is_err());
        assert!(store_thumb(&dir, "images/../aa.png", &webp_bytes()).is_err());
        assert!(!dir.join("thumbs").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("booked-images-test-{}-{name}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_source(dir: &Path, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    fn avif_header(brand: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0, 0, 0, 0x20];
        bytes.extend_from_slice(b"ftyp");
        bytes.extend_from_slice(brand);
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes.extend_from_slice(b"mif1avif");
        bytes
    }

    #[test]
    fn detect_extension_recognizes_avif_dragged_from_a_browser() {
        assert_eq!(detect_extension(&avif_header(b"avif")), Some("avif"));
        assert_eq!(detect_extension(&avif_header(b"avis")), Some("avif"));
    }

    #[test]
    fn detect_extension_ignores_other_mp4_like_containers() {
        let mut bytes = vec![0, 0, 0, 0x20];
        bytes.extend_from_slice(b"ftyp");
        bytes.extend_from_slice(b"isom");
        bytes.extend_from_slice(&[0, 0, 2, 0]);
        bytes.extend_from_slice(b"isomiso2");
        assert_eq!(detect_extension(&bytes), None);
    }

    #[test]
    fn valid_image_filename_accepts_bare_hash_name() {
        assert!(is_valid_image_filename("abc123.png"));
    }

    #[test]
    fn valid_image_filename_rejects_path_traversal() {
        assert!(!is_valid_image_filename("../../secrets"));
        assert!(!is_valid_image_filename("../secrets.png"));
        assert!(!is_valid_image_filename("a/b.png"));
        assert!(!is_valid_image_filename("a\\b.png"));
        assert!(!is_valid_image_filename(""));
    }

    #[test]
    fn import_rejects_svg() {
        let dir = scratch_dir("svg");
        let source = write_source(&dir, "icon.svg", b"<svg xmlns='http://www.w3.org/2000/svg'></svg>");
        let images_dir = dir.join("images");
        let err = import(&images_dir, &source).unwrap_err();
        assert!(matches!(err, ImageError::UnsupportedType));
    }

    #[test]
    fn import_rejects_text_named_png() {
        let dir = scratch_dir("fake-png");
        let source = write_source(&dir, "fake.png", b"this is not a real png");
        let images_dir = dir.join("images");
        let err = import(&images_dir, &source).unwrap_err();
        assert!(matches!(err, ImageError::UnsupportedType));
    }

    #[test]
    fn import_returns_bare_filename() {
        let dir = scratch_dir("bare-name");
        let mut bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(b"payload");
        let source = write_source(&dir, "../../evil.png", &bytes);
        let images_dir = dir.join("images");
        let filename = import(&images_dir, &source).unwrap();
        assert!(!filename.contains('/'));
        assert!(!filename.contains('\\'));
        assert!(!filename.contains(".."));
    }

    #[test]
    fn import_bytes_rejects_non_image() {
        let dir = scratch_dir("bytes-non-image");
        let images_dir = dir.join("images");
        let err = import_bytes(&images_dir, b"not an image").unwrap_err();
        assert!(matches!(err, ImageError::UnsupportedType));
    }

    #[test]
    fn import_bytes_returns_same_name_as_import_of_same_content() {
        let dir = scratch_dir("bytes-same-name");
        let mut bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(b"payload");
        let source = write_source(&dir, "a.png", &bytes);
        let images_dir = dir.join("images");

        let from_file = import(&images_dir, &source).unwrap();
        let from_bytes = import_bytes(&images_dir, &bytes).unwrap();
        assert_eq!(from_file, from_bytes);
    }

    #[test]
    fn import_is_idempotent() {
        let dir = scratch_dir("idempotent");
        let mut bytes = vec![0xFF, 0xD8, 0xFF];
        bytes.extend_from_slice(b"same-content");
        let source = write_source(&dir, "a.jpg", &bytes);
        let images_dir = dir.join("images");

        let first = import(&images_dir, &source).unwrap();
        let second = import(&images_dir, &source).unwrap();
        assert_eq!(first, second);

        let entries: Vec<_> = fs::read_dir(&images_dir).unwrap().collect();
        assert_eq!(entries.len(), 1);
    }
}
