use serde::Deserialize;

use crate::downloads::{Queue, QueueError, Reason};

pub const MAX_REQUEST: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Parse {
    Done(Request),
    More,
    Bad,
    TooLarge,
}

fn find_head_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

pub fn parse_request(bytes: &[u8]) -> Parse {
    let Some(head_end) = find_head_end(bytes) else {
        return if bytes.len() >= MAX_REQUEST { Parse::TooLarge } else { Parse::More };
    };
    let Ok(head) = std::str::from_utf8(&bytes[..head_end]) else {
        return Parse::Bad;
    };
    let mut lines = head.split("\r\n");
    let mut start = lines.next().unwrap_or_default().split(' ');
    let (Some(method), Some(path), Some(version), None) = (start.next(), start.next(), start.next(), start.next()) else {
        return Parse::Bad;
    };
    if method.is_empty() || !path.starts_with('/') || !version.starts_with("HTTP/1.") {
        return Parse::Bad;
    }
    let mut headers = Vec::new();
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            return Parse::Bad;
        };
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
    }
    let length = match headers.iter().find(|(name, _)| name == "content-length") {
        Some((_, value)) => match value.parse::<usize>() {
            Ok(length) => length,
            Err(_) => return Parse::Bad,
        },
        None => 0,
    };
    let body_start = head_end + 4;
    if body_start.saturating_add(length) > MAX_REQUEST {
        return Parse::TooLarge;
    }
    if bytes.len() < body_start + length {
        return Parse::More;
    }
    Parse::Done(Request {
        method: method.to_string(),
        path: path.to_string(),
        headers,
        body: bytes[body_start..body_start + length].to_vec(),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: Option<String>,
}

impl Response {
    pub fn empty(status: u16) -> Response {
        Response { status, body: None }
    }

    pub fn json(status: u16, body: String) -> Response {
        Response { status, body: Some(body) }
    }

    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Payload Too Large",
        _ => "Error",
    }
}

pub fn response_bytes(response: &Response) -> Vec<u8> {
    let body = response.body.as_deref().unwrap_or_default();
    let head = format!(
        "HTTP/1.1 {} {}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
        response.status,
        status_text(response.status),
        body.len()
    );
    let mut bytes = head.into_bytes();
    bytes.extend_from_slice(body.as_bytes());
    bytes
}

pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let mut diff = left.len() ^ right.len();
    for index in 0..left.len().max(right.len()) {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        diff |= usize::from(a ^ b);
    }
    diff == 0
}

fn bearer_matches(request: &Request, key: &str) -> bool {
    let Some(value) = request.header("authorization") else {
        return false;
    };
    let Some((scheme, token)) = value.split_once(' ') else {
        return false;
    };
    scheme.eq_ignore_ascii_case("bearer") && !key.is_empty() && constant_time_eq(token.trim().as_bytes(), key.as_bytes())
}

fn from_web_page(request: &Request) -> bool {
    request.header("origin").is_some_and(|origin| {
        let lower = origin.trim().to_ascii_lowercase();
        lower.starts_with("http://") || lower.starts_with("https://")
    })
}

#[derive(Deserialize)]
struct ResolvedBody {
    host: String,
    url: String,
    file: Option<String>,
}

#[derive(Deserialize)]
struct FailedBody {
    reason: String,
}

fn queue_status(error: QueueError) -> u16 {
    match error {
        QueueError::Unknown | QueueError::WrongState => 409,
        QueueError::BadLink => 400,
    }
}

pub fn handle(request: &Request, key: &str, queue: &mut Queue, now_ms: i64) -> Response {
    if request.method == "OPTIONS" || from_web_page(request) {
        return Response::empty(403);
    }
    if !bearer_matches(request, key) {
        return Response::empty(401);
    }
    let path = request.path.split(['?', '#']).next().unwrap_or_default();
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    match (request.method.as_str(), parts.as_slice()) {
        ("GET", ["v1", "downloads", "next"]) => {
            let job = queue.next_for_bridge(now_ms);
            Response::json(200, serde_json::json!({ "job": job }).to_string())
        }
        ("POST", ["v1", "downloads", id, "resolved"]) => {
            let Ok(id) = id.parse::<u64>() else {
                return Response::empty(404);
            };
            let Ok(body) = serde_json::from_slice::<ResolvedBody>(&request.body) else {
                let _ = queue.failed(id, Reason::Other);
                return Response::empty(400);
            };
            match queue.resolved_file(id, &body.host, &body.url, body.file.as_deref()) {
                Ok(()) => Response::empty(204),
                Err(error) => Response::empty(queue_status(error)),
            }
        }
        ("POST", ["v1", "downloads", id, "failed"]) => {
            let Ok(id) = id.parse::<u64>() else {
                return Response::empty(404);
            };
            let Ok(body) = serde_json::from_slice::<FailedBody>(&request.body) else {
                return Response::empty(400);
            };
            let Some(reason) = Reason::from_bridge(&body.reason) else {
                let _ = queue.failed(id, Reason::Other);
                return Response::empty(400);
            };
            match queue.failed(id, reason) {
                Ok(()) => Response::empty(204),
                Err(error) => Response::empty(queue_status(error)),
            }
        }
        _ => Response::empty(404),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::downloads::State;

    const KEY: &str = "ключ-облака-123";

    fn raw(method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> Vec<u8> {
        let mut text = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:47295\r\n");
        for (name, value) in headers {
            text.push_str(&format!("{name}: {value}\r\n"));
        }
        if !body.is_empty() {
            text.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        text.push_str("\r\n");
        text.push_str(body);
        text.into_bytes()
    }

    fn call(queue: &mut Queue, method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> Response {
        let Parse::Done(request) = parse_request(&raw(method, path, headers, body)) else {
            panic!("запрос не разобран");
        };
        handle(&request, KEY, queue, 1000)
    }

    fn authed(queue: &mut Queue, method: &str, path: &str, body: &str) -> Response {
        let header = format!("Bearer {KEY}");
        call(queue, method, path, &[("Authorization", header.as_str())], body)
    }

    fn queue_with_game() -> Queue {
        let mut queue = Queue::new();
        queue.add(1, 12345, "Тёмный лес", vec!["PIXELDRAIN".to_string(), "MEDIAFIRE".to_string()], 0);
        queue
    }

    #[test]
    fn parses_request_line_headers_and_body() {
        let bytes = raw("POST", "/v1/downloads/7/failed", &[("Authorization", "Bearer abc")], r#"{"reason":"other"}"#);
        let Parse::Done(request) = parse_request(&bytes) else { panic!() };
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/v1/downloads/7/failed");
        assert_eq!(request.header("authorization"), Some("Bearer abc"));
        assert_eq!(request.body, br#"{"reason":"other"}"#);
    }

    #[test]
    fn asks_for_more_bytes_until_head_and_body_are_complete() {
        let full = raw("POST", "/x", &[], r#"{"a":1}"#);
        assert_eq!(parse_request(&full[..10]), Parse::More);
        assert_eq!(parse_request(&full[..full.len() - 2]), Parse::More);
        assert!(matches!(parse_request(&full), Parse::Done(_)));
    }

    #[test]
    fn rejects_malformed_and_oversized_requests() {
        assert_eq!(parse_request(b"GARBAGE\r\n\r\n"), Parse::Bad);
        assert_eq!(parse_request(b"GET /x HTTP/1.1\r\nbroken header\r\n\r\n"), Parse::Bad);
        assert_eq!(parse_request(b"GET x HTTP/1.1\r\n\r\n"), Parse::Bad);
        assert_eq!(parse_request(b"POST /x HTTP/1.1\r\nContent-Length: abc\r\n\r\n"), Parse::Bad);
        let huge = format!("POST /x HTTP/1.1\r\nContent-Length: {}\r\n\r\n", MAX_REQUEST + 1);
        assert_eq!(parse_request(huge.as_bytes()), Parse::TooLarge);
        let endless = vec![b'a'; MAX_REQUEST];
        assert_eq!(parse_request(&endless), Parse::TooLarge);
    }

    #[test]
    fn constant_time_eq_compares_content_and_length() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"", b"a"));
    }

    #[test]
    fn missing_or_wrong_key_is_401_and_reveals_nothing() {
        let mut queue = queue_with_game();
        let none = call(&mut queue, "GET", "/v1/downloads/next", &[], "");
        assert_eq!(none, Response::empty(401));
        let wrong = call(&mut queue, "GET", "/v1/downloads/next", &[("Authorization", "Bearer чужой")], "");
        assert_eq!(wrong, Response::empty(401));
        let basic = call(&mut queue, "GET", "/v1/downloads/next", &[("Authorization", "Basic abc")], "");
        assert_eq!(basic.status, 401);
        assert_eq!(queue.snapshot(0).rows[0].state, State::Waiting);
    }

    #[test]
    fn web_page_origin_and_options_are_403() {
        let mut queue = queue_with_game();
        let header = format!("Bearer {KEY}");
        let page = call(&mut queue, "GET", "/v1/downloads/next", &[("Authorization", header.as_str()), ("Origin", "https://evil.example")], "");
        assert_eq!(page.status, 403);
        let local = call(&mut queue, "GET", "/v1/downloads/next", &[("Authorization", header.as_str()), ("Origin", "HTTP://localhost:3000")], "");
        assert_eq!(local.status, 403);
        assert_eq!(call(&mut queue, "OPTIONS", "/v1/downloads/next", &[], "").status, 403);
        let extension = call(&mut queue, "GET", "/v1/downloads/next", &[("Authorization", header.as_str()), ("Origin", "moz-extension://abc")], "");
        assert_eq!(extension.status, 200);
    }

    #[test]
    fn next_returns_job_then_null() {
        let mut queue = Queue::new();
        let empty = authed(&mut queue, "GET", "/v1/downloads/next", "");
        assert_eq!(empty, Response::json(200, r#"{"job":null}"#.to_string()));
        queue.add(1, 12345, "Тёмный лес", vec!["PIXELDRAIN".to_string()], 0);
        let first = authed(&mut queue, "GET", "/v1/downloads/next", "");
        let value: serde_json::Value = serde_json::from_str(first.body.as_deref().unwrap()).unwrap();
        assert_eq!(value["job"]["id"], 1);
        assert_eq!(value["job"]["thread"], 12345);
        assert_eq!(value["job"]["title"], "Тёмный лес");
        assert_eq!(value["job"]["hosts"][0], "PIXELDRAIN");
        assert_eq!(authed(&mut queue, "GET", "/v1/downloads/next", ""), first);
    }

    #[test]
    fn resolved_starts_the_download() {
        let mut queue = queue_with_game();
        authed(&mut queue, "GET", "/v1/downloads/next", "");
        let reply = authed(&mut queue, "POST", "/v1/downloads/1/resolved", r#"{"host":"PIXELDRAIN","url":"https://pixeldrain.com/u/abc"}"#);
        assert_eq!(reply, Response::empty(204));
        assert_eq!(queue.snapshot(0).rows[0].state, State::Downloading);
    }

    #[test]
    fn resolved_with_foreign_domain_is_400_and_wrong_state_is_409() {
        let mut queue = queue_with_game();
        let early = authed(&mut queue, "POST", "/v1/downloads/1/resolved", r#"{"host":"PIXELDRAIN","url":"https://pixeldrain.com/u/abc"}"#);
        assert_eq!(early.status, 409);
        authed(&mut queue, "GET", "/v1/downloads/next", "");
        let foreign = authed(&mut queue, "POST", "/v1/downloads/1/resolved", r#"{"host":"PIXELDRAIN","url":"https://evil.example/u/abc"}"#);
        assert_eq!(foreign.status, 400);
        let unknown = authed(&mut queue, "POST", "/v1/downloads/9/resolved", r#"{"host":"PIXELDRAIN","url":"https://pixeldrain.com/u/abc"}"#);
        assert_eq!(unknown.status, 409);
        let broken = authed(&mut queue, "POST", "/v1/downloads/1/resolved", "не json");
        assert_eq!(broken.status, 400);
    }

    #[test]
    fn broken_body_drops_the_resolving_row_instead_of_looping() {
        let mut queue = queue_with_game();
        authed(&mut queue, "GET", "/v1/downloads/next", "");
        let broken = authed(&mut queue, "POST", "/v1/downloads/1/resolved", r#"{"host":"PIXELDRAIN"}"#);
        assert_eq!(broken.status, 400);
        assert!(queue.next_for_bridge(0).is_none());
    }

    #[test]
    fn failed_marks_the_row_and_validates_the_reason() {
        let mut queue = queue_with_game();
        authed(&mut queue, "GET", "/v1/downloads/next", "");
        assert_eq!(authed(&mut queue, "POST", "/v1/downloads/1/failed", r#"{"reason":"captcha","detail":"hCaptcha"}"#), Response::empty(204));
        let row = queue.snapshot(0).rows.remove(0);
        assert_eq!(row.state, State::Failed);
        assert!(queue.is_paused());
        assert_eq!(authed(&mut queue, "POST", "/v1/downloads/1/failed", r#"{"reason":"other"}"#).status, 409);

        let mut queue = queue_with_game();
        authed(&mut queue, "GET", "/v1/downloads/next", "");
        assert_eq!(authed(&mut queue, "POST", "/v1/downloads/1/failed", r#"{"reason":"network"}"#).status, 400);
        assert_eq!(queue.snapshot(0).rows.remove(0).state, State::Failed);
        assert!(!queue.is_paused());
    }

    #[test]
    fn unknown_routes_and_methods_are_404() {
        let mut queue = queue_with_game();
        assert_eq!(authed(&mut queue, "GET", "/v1/other", "").status, 404);
        assert_eq!(authed(&mut queue, "POST", "/v1/downloads/next", "").status, 404);
        assert_eq!(authed(&mut queue, "GET", "/v1/downloads/1/resolved", "").status, 404);
        assert_eq!(authed(&mut queue, "POST", "/v1/downloads/abc/failed", "{}").status, 404);
        assert_eq!(authed(&mut queue, "GET", "/v1/downloads/next?x=1", "").status, 200);
    }

    #[test]
    fn response_has_close_and_json_headers_without_cors() {
        let bytes = response_bytes(&Response::json(200, r#"{"job":null}"#.to_string()));
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(text.contains("Connection: close\r\n"));
        assert!(text.contains("Content-Type: application/json\r\n"));
        assert!(text.contains("Content-Length: 12\r\n"));
        assert!(!text.to_ascii_lowercase().contains("access-control"));
        assert!(text.ends_with("\r\n\r\n{\"job\":null}"));
        let empty = String::from_utf8(response_bytes(&Response::empty(204))).unwrap();
        assert!(empty.starts_with("HTTP/1.1 204 No Content\r\n"));
        assert!(empty.contains("Content-Length: 0\r\n"));
    }
}
