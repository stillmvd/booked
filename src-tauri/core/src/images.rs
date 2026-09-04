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

pub(crate) fn detect_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
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

#[cfg(test)]
mod tests {
    use super::*;

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
