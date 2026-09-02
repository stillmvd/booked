pub fn launched_minimized() -> bool {
    trove_core::autostart::is_minimized_arg(std::env::args())
}
