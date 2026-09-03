use tauri::State;
use booked_core::search::{self, SearchRequest, SearchResults};

use crate::db::{with_conn, Db};

#[tauri::command]
pub fn search_query(db: State<Db>, request: SearchRequest) -> Result<SearchResults, String> {
    with_conn(&db, |conn| search::search_bookmarks(conn, &request))
}
