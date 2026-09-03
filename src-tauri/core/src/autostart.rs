pub fn is_minimized_arg<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|a| a.as_ref() == "--minimized")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_minimized_flag() {
        assert!(is_minimized_arg(["magpie.exe", "--minimized"]));
    }

    #[test]
    fn absent_flag_is_false() {
        assert!(!is_minimized_arg(["magpie.exe"]));
    }

    #[test]
    fn no_args_is_false() {
        assert!(!is_minimized_arg(Vec::<&str>::new()));
    }

    #[test]
    fn other_flags_do_not_match() {
        assert!(!is_minimized_arg(["magpie.exe", "--minimize", "minimized"]));
    }
}
