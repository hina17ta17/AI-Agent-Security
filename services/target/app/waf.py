"""Mihari: a small, fast rule-based WAF.

It is deliberately simple (regular expressions over normalized input). Its job is the
first response: stop an obviously malicious request within milliseconds, then hand the
event to the AI team for deeper analysis.
"""

from __future__ import annotations

import html
import re
import urllib.parse
from dataclasses import dataclass
from typing import Iterable

MAX_FIELD_CHARS = 4096  # longer values are truncated before matching
PAYLOAD_PREVIEW_CHARS = 2048  # what is forwarded to the AI team


@dataclass(frozen=True)
class Rule:
    rule_id: str
    attack_type: str  # sqli | xss | path_traversal | cmd_injection
    label_ja: str
    pattern: re.Pattern[str]


@dataclass(frozen=True)
class Detection:
    rule_id: str
    attack_type: str
    label_ja: str
    field: str  # e.g. "query:q", "form:message", "path"
    matched: str  # the matched fragment (normalized)
    payload: str  # the raw field value (decoded, truncated)


def _r(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


RULES: tuple[Rule, ...] = (
    # --- SQL injection
    Rule("sqli-tautology", "sqli", "SQLインジェクション（常に真になる条件）",
         _r(r"['\"`]\s*(or|and|\|\||&&)\s*['\"`]?\s*\w+\s*['\"`]?\s*(=|like)\s*['\"`]?\s*\w+")),
    Rule("sqli-tautology-bare", "sqli", "SQLインジェクション（常に真になる条件）",
         _r(r"\b(or|and)\s+(\d+)\s*=\s*\2\b")),
    Rule("sqli-union", "sqli", "SQLインジェクション（UNION SELECT）",
         _r(r"\bunion\b(\s+all)?\s+select\b")),
    Rule("sqli-stacked", "sqli", "SQLインジェクション（複文の実行）",
         _r(r";\s*(drop|delete|insert|update|alter|truncate|create)\s+\w+")),
    Rule("sqli-comment", "sqli", "SQLインジェクション（コメントによる条件の無効化）",
         _r(r"['\"`]\s*\)?\s*(--|#)")),
    Rule("sqli-time", "sqli", "SQLインジェクション（時間差攻撃）",
         _r(r"\b(sleep|pg_sleep|benchmark)\s*\(|\bwaitfor\s+delay\b")),
    Rule("sqli-schema", "sqli", "SQLインジェクション（データベース構造の探索）",
         _r(r"\binformation_schema\b|\bsqlite_master\b|\bpg_catalog\b")),
    # --- Cross-site scripting
    Rule("xss-script", "xss", "XSS（scriptタグの埋め込み）", _r(r"<\s*script\b")),
    Rule("xss-handler", "xss", "XSS（イベントハンドラの埋め込み）", _r(r"<[^>]*\bon[a-z]+\s*=")),
    Rule("xss-js-uri", "xss", "XSS（javascript: スキーム）", _r(r"javascript\s*:")),
    Rule("xss-embed", "xss", "XSS（iframe / svg などの埋め込み）", _r(r"<\s*(iframe|svg|object|embed)\b")),
    Rule("xss-cookie", "xss", "XSS（Cookie の窃取）", _r(r"document\s*\.\s*cookie")),
    # --- OS command injection (checked before path traversal: "; cat /etc/hosts" is command injection)
    Rule("cmd-chain", "cmd_injection", "OSコマンドインジェクション（コマンドの連結）",
         _r(r"(;|\|\||&&|\|)\s*(cat|ls|id|whoami|uname|wget|curl|nc|bash|sh|powershell|rm)\b")),
    Rule("cmd-subst", "cmd_injection", "OSコマンドインジェクション（コマンド置換）",
         _r(r"\$\([^)]{1,200}\)|`[^`]{1,200}`")),
    # --- Path traversal
    Rule("pt-dotdot", "path_traversal", "パストラバーサル（上位ディレクトリへの移動）",
         _r(r"(^|[/\\=])\.\.[/\\]")),
    Rule("pt-sensitive", "path_traversal", "パストラバーサル（重要ファイルの指定）",
         _r(r"/etc/(passwd|shadow|hosts)\b|\bwin\.ini\b|\bboot\.ini\b|/proc/self/environ")),
)

_SQL_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_WHITESPACE = re.compile(r"\s+")


def normalize(value: str) -> str:
    """Undo common evasion tricks so the rules see what the server would see."""
    text = value[:MAX_FIELD_CHARS]
    for _ in range(2):  # double URL-encoding is a classic bypass
        decoded = urllib.parse.unquote_plus(text)
        if decoded == text:
            break
        text = decoded
    text = html.unescape(text)
    text = text.replace("\x00", "")
    text = _SQL_COMMENT.sub(" ", text)  # UN/**/ION SEL/**/ECT
    text = _WHITESPACE.sub(" ", text)
    return text


def inspect_value(field: str, value: str) -> Detection | None:
    if not value:
        return None
    normalized = normalize(value)
    for rule in RULES:
        m = rule.pattern.search(normalized)
        if m:
            start = max(0, m.start() - 20)
            return Detection(
                rule_id=rule.rule_id,
                attack_type=rule.attack_type,
                label_ja=rule.label_ja,
                field=field,
                matched=normalized[start : m.end() + 20],
                payload=normalized[:PAYLOAD_PREVIEW_CHARS],
            )
    return None


def inspect(fields: Iterable[tuple[str, str]]) -> Detection | None:
    """Return the first detection over (field_name, value) pairs, or None."""
    for field, value in fields:
        detection = inspect_value(field, value)
        if detection:
            return detection
    return None
