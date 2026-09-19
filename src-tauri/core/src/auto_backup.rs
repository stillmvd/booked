use rusqlite::Connection;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const LAST_KEY: &str = "auto_backup_at";
pub const EVERY_SECS: i64 = 7 * 24 * 60 * 60;
pub const KEEP: usize = 5;
const PREFIX: &str = "booked-";
const SUFFIX: &str = ".db";

pub fn due(last: Option<i64>, now: i64) -> bool {
    last.map_or(true, |at| now - at >= EVERY_SECS || at > now)
}

pub fn snapshot(conn: &Connection, dest: &Path) -> io::Result<PathBuf> {
    fs::create_dir_all(dest)?;
    let day: String = conn
        .query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
        .map_err(io::Error::other)?;
    let target = dest.join(format!("{PREFIX}{day}{SUFFIX}"));
    let tmp = target.with_extension("db.tmp");
    let _ = fs::remove_file(&tmp);
    conn.execute("VACUUM INTO ?1", [tmp.to_string_lossy()])
        .map_err(io::Error::other)?;
    fs::rename(&tmp, &target)?;
    Ok(target)
}

pub fn copy_missing(from: &Path, to: &Path) -> io::Result<usize> {
    fs::create_dir_all(to)?;
    let Ok(entries) = fs::read_dir(from) else {
        return Ok(0);
    };
    let mut copied = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let target = to.join(entry.file_name());
        if !path.is_file() || target.exists() {
            continue;
        }
        fs::copy(&path, &target)?;
        copied += 1;
    }
    Ok(copied)
}

pub fn prune(dest: &Path, keep: usize) -> io::Result<()> {
    let mut names: Vec<String> = fs::read_dir(dest)?
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.starts_with(PREFIX) && name.ends_with(SUFFIX))
        .collect();
    names.sort_unstable_by(|a, b| b.cmp(a));
    for name in names.into_iter().skip(keep) {
        fs::remove_file(dest.join(name))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn due_once_a_week_and_after_clock_goes_back() {
        assert!(due(None, 1_000));
        assert!(!due(Some(1_000), 1_000 + EVERY_SECS - 1));
        assert!(due(Some(1_000), 1_000 + EVERY_SECS));
        assert!(due(Some(5_000), 1_000));
    }

    #[test]
    fn snapshot_holds_whole_base_images_are_copied_once_and_old_copies_rotate() {
        let root = std::env::temp_dir().join(format!("booked-auto-backup-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let images = root.join("images");
        let dest = root.join("Booked");
        fs::create_dir_all(&images).unwrap();
        fs::create_dir_all(&dest).unwrap();
        fs::write(images.join("a.png"), b"a").unwrap();
        for day in ["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04", "2020-01-05"] {
            fs::write(dest.join(format!("booked-{day}.db")), b"old").unwrap();
        }

        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn.execute("INSERT INTO games (base_name, title) VALUES ('pod', 'Path of Desire')", [])
            .unwrap();

        let made = snapshot(&conn, &dest).unwrap();
        assert_eq!(copy_missing(&images, &dest.join("images")).unwrap(), 1);
        assert_eq!(copy_missing(&images, &dest.join("images")).unwrap(), 0);
        prune(&dest, KEEP).unwrap();

        let copy = Connection::open(&made).unwrap();
        let title: String = copy
            .query_row("SELECT title FROM games WHERE base_name = 'pod'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "Path of Desire");
        drop(copy);
        assert!(dest.join("images").join("a.png").exists());
        assert!(!dest.join("booked-2020-01-01.db").exists());
        assert!(dest.join("booked-2020-01-02.db").exists());
        let kept = fs::read_dir(&dest)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".db"))
            .count();
        assert_eq!(kept, KEEP);
        fs::remove_dir_all(&root).ok();
    }
}
