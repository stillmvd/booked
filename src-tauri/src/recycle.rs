use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recycle {
    Done,
    Refused,
    Busy,
    Failed,
}

pub fn to_recycle_bin(path: &Path) -> Recycle {
    let owned = path.to_path_buf();
    std::thread::spawn(move || shell::recycle(&owned))
        .join()
        .unwrap_or(Recycle::Failed)
}

pub fn folder_is_busy(path: &Path) -> bool {
    let Some(name) = path.file_name() else {
        return true;
    };
    let mut probe: PathBuf = path.to_path_buf();
    probe.set_file_name(format!("{}.booked-busy-check", name.to_string_lossy()));
    if probe.exists() || std::fs::rename(path, &probe).is_err() {
        return true;
    }
    for _ in 0..40 {
        if std::fs::rename(&probe, path).is_ok() {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    true
}

#[cfg(windows)]
mod shell {
    use std::cell::Cell;
    use std::path::Path;
    use std::rc::Rc;

    use windows::core::{implement, Ref, Result, HRESULT, HSTRING, PCWSTR};
    use windows::Win32::Foundation::E_ABORT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOperation, IFileOperation, IFileOperationProgressSink, IFileOperationProgressSink_Impl, IShellItem,
        SHCreateItemFromParsingName, FOFX_EARLYFAILURE, FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO, FOF_NO_UI,
        TSF_DELETE_RECYCLE_IF_POSSIBLE,
    };

    use super::Recycle;

    const SHARING_VIOLATION: i32 = 0x8027_0028_u32 as i32;
    const DEST_SHARING_VIOLATION: i32 = 0x8027_0029_u32 as i32;

    #[derive(Default)]
    struct Marks {
        refused: Cell<bool>,
        recycled: Cell<bool>,
        busy: Cell<bool>,
    }

    #[implement(IFileOperationProgressSink)]
    struct Sink(Rc<Marks>);

    impl IFileOperationProgressSink_Impl for Sink_Impl {
        fn StartOperations(&self) -> Result<()> {
            Ok(())
        }
        fn FinishOperations(&self, _: HRESULT) -> Result<()> {
            Ok(())
        }
        fn PreRenameItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR) -> Result<()> {
            Ok(())
        }
        fn PostRenameItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR, _: HRESULT, _: Ref<IShellItem>) -> Result<()> {
            Ok(())
        }
        fn PreMoveItem(&self, _: u32, _: Ref<IShellItem>, _: Ref<IShellItem>, _: &PCWSTR) -> Result<()> {
            Ok(())
        }
        fn PostMoveItem(
            &self,
            _: u32,
            _: Ref<IShellItem>,
            _: Ref<IShellItem>,
            _: &PCWSTR,
            _: HRESULT,
            _: Ref<IShellItem>,
        ) -> Result<()> {
            Ok(())
        }
        fn PreCopyItem(&self, _: u32, _: Ref<IShellItem>, _: Ref<IShellItem>, _: &PCWSTR) -> Result<()> {
            Ok(())
        }
        fn PostCopyItem(
            &self,
            _: u32,
            _: Ref<IShellItem>,
            _: Ref<IShellItem>,
            _: &PCWSTR,
            _: HRESULT,
            _: Ref<IShellItem>,
        ) -> Result<()> {
            Ok(())
        }
        fn PreDeleteItem(&self, flags: u32, _: Ref<IShellItem>) -> Result<()> {
            if flags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 == 0 {
                self.0.refused.set(true);
                return Err(E_ABORT.into());
            }
            Ok(())
        }
        fn PostDeleteItem(&self, _: u32, _: Ref<IShellItem>, result: HRESULT, created: Ref<IShellItem>) -> Result<()> {
            if result.is_ok() && created.is_some() {
                self.0.recycled.set(true);
            }
            if result.0 == SHARING_VIOLATION || result.0 == DEST_SHARING_VIOLATION {
                self.0.busy.set(true);
            }
            Ok(())
        }
        fn PreNewItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR) -> Result<()> {
            Ok(())
        }
        fn PostNewItem(
            &self,
            _: u32,
            _: Ref<IShellItem>,
            _: &PCWSTR,
            _: &PCWSTR,
            _: u32,
            _: HRESULT,
            _: Ref<IShellItem>,
        ) -> Result<()> {
            Ok(())
        }
        fn UpdateProgress(&self, _: u32, _: u32) -> Result<()> {
            Ok(())
        }
        fn ResetTimer(&self) -> Result<()> {
            Ok(())
        }
        fn PauseTimer(&self) -> Result<()> {
            Ok(())
        }
        fn ResumeTimer(&self) -> Result<()> {
            Ok(())
        }
    }

    fn perform(path: &Path, marks: &Rc<Marks>) -> Result<()> {
        unsafe {
            let operation: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)?;
            operation.SetOperationFlags(FOF_ALLOWUNDO | FOF_NO_UI | FOFX_EARLYFAILURE | FOFX_RECYCLEONDELETE)?;
            let item: IShellItem =
                SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None)?;
            let sink: IFileOperationProgressSink = Sink(marks.clone()).into();
            operation.DeleteItem(&item, &sink)?;
            operation.PerformOperations()
        }
    }

    pub fn recycle(path: &Path) -> Recycle {
        if !path.is_dir() {
            return Recycle::Failed;
        }
        let marks = Rc::new(Marks::default());
        let outcome = unsafe {
            if CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_err() {
                return Recycle::Failed;
            }
            let outcome = perform(path, &marks);
            CoUninitialize();
            outcome
        };
        let gone = !path.exists();
        match (outcome.is_ok(), gone) {
            (true, true) if marks.recycled.get() && !marks.refused.get() => Recycle::Done,
            (_, false) if marks.refused.get() => Recycle::Refused,
            (_, false) if marks.busy.get() => Recycle::Busy,
            _ => Recycle::Failed,
        }
    }
}

#[cfg(not(windows))]
mod shell {
    use std::path::Path;

    use super::Recycle;

    pub fn recycle(_: &Path) -> Recycle {
        Recycle::Refused
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live_dir(var: &str) -> PathBuf {
        PathBuf::from(std::env::var(var).unwrap_or_else(|_| panic!("нужна переменная {var}")))
    }

    #[test]
    fn busy_probe_leaves_free_folder_in_place() {
        let dir = std::env::temp_dir().join(format!("booked-busy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("game")).unwrap();
        std::fs::write(dir.join("game").join("a.txt"), b"x").unwrap();
        assert!(!folder_is_busy(&dir));
        assert!(dir.join("game").join("a.txt").is_file());
        assert!(folder_is_busy(&dir.join("нет-такой")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore]
    fn recycle_live_done() {
        let dir = live_dir("BOOKED_RECYCLE_DIR");
        assert_eq!(to_recycle_bin(&dir), Recycle::Done);
        assert!(!dir.exists());
    }

    #[test]
    #[ignore]
    fn recycle_live_refused() {
        let dir = live_dir("BOOKED_RECYCLE_DIR");
        assert_eq!(to_recycle_bin(&dir), Recycle::Refused);
        assert!(dir.is_dir());
    }

    #[test]
    #[ignore]
    fn recycle_live_busy() {
        let dir = live_dir("BOOKED_RECYCLE_DIR");
        assert!(folder_is_busy(&dir));
        assert_eq!(to_recycle_bin(&dir), Recycle::Busy);
        assert!(dir.is_dir());
    }
}
