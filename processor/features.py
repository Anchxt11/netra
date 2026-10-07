from typing import Any

def build_features(event: dict[str, Any]) -> dict[str, Any]:
    path=str(event.get('path') or '').lower()
    process=str(event.get('process') or '').lower()
    ua=str(event.get('user_agent') or '').lower()
    resp_ms=int(event.get('response_ms') or 0)
    status=int(event.get('http_status') or 0)
    return {
        'is_failure': event.get('status') == 'failure',
        'is_http': event.get('event_type') == 'http_request',
        'is_login': event.get('event_type') == 'login',
        'is_process_start': event.get('event_type') == 'process_start',
        'is_data_transfer': event.get('event_type') == 'data_transfer',
        'is_server_error': status >= 500,
        'is_timeout': status in (408, 499, 504),
        'response_ms': resp_ms,
        'response_ms_extreme': resp_ms > 10_000,
        'bytes_out': int(event.get('bytes_out') or 0),
        'method': event.get('method') or '',
        'path': event.get('path') or '',
        'source': event.get('source') or '',
        'event_type': event.get('event_type') or '',
        'path_has_admin': '/admin' in path,
        'process_has_sudo': 'sudo' in process,
        'process_has_useradd': 'useradd' in process,
        'process_has_net_user': 'net user' in process,
        'path_has_sqli': any(s in path for s in ["'", 'union', 'select', 'drop ', 'sleep(', 'or ']),
        'path_has_ssrf': any(s in path for s in ['169.254.169.254', 'metadata.google', '127.0.0.1', 'localhost', '169.254.', 'metadata/v1']),
        'path_has_traversal': '..' in path,
        'ua_is_scanner': any(s in ua for s in ['sqlmap', 'nmap', 'nikto', 'slowloris']),
        'ua_is_tool': any(s in ua for s in ['python-requests', 'curl/', 'go-http-client']),
        'process_has_netcat': 'nc ' in process or 'ncat ' in process,
        'process_has_shadow': '/etc/shadow' in process,
        'process_has_curl_pipe': 'curl' in process and 'sh' in process,
        'bytes_out_large': int(event.get('bytes_out') or 0) > 50_000_000,
    }

