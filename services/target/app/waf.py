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

# The whole value is inspected (up to the ingest limit), so an attack hidden after a long run of
# padding cannot slip through. Every pattern below stays linear on long input (no unbounded
# backtracking), so a crafted value cannot make Mihari slow either.
MAX_FIELD_CHARS = 64 * 1024
PAYLOAD_PREVIEW_CHARS = 2048  # what is forwarded to the AI team


@dataclass(frozen=True)
class Rule:
    rule_id: str
    attack_type: str  # sqli | xss | path_traversal | cmd_injection
    label_ja: str
    pattern: re.Pattern[str]
    # "strong": clear attack grammar, blocks on its own. "weak": looks suspicious but also appears in
    # ordinary text (a lone SQL word, document.cookie in a dev note), so it blocks only together with
    # another signal. This keeps Mihari from mistaking normal messages and code snippets for attacks.
    strength: str = "strong"


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


# OS commands an injection runs. Kept to real binaries, so ordinary words ("git", "npm") don't match.
_CMDS = (r"cat|ls|dir|id|whoami|uname|hostname|wget|curl|nc|ncat|bash|sh|zsh|ksh|powershell|pwsh|cmd"
         r"|rm|mv|cp|chmod|chown|kill|ping|nslookup|dig|python3?|perl|ruby|php|nmap|telnet|ftp|scp|ssh")
# What follows a real injected command: a flag/path/home (" -rf", " /etc", " ~"), an argument that
# contains a slash or colon (a path or URL), a pipe/redirect/terminator, or the end of the value.
# Plain prose after the word ("; cat and fish", "; id 4521") matches none of these.
_CMD_ARG = r"(?:\s+[-/~]|\s+\S*[:/]|\s*(?:$|[|;&><`]))"

RULES: tuple[Rule, ...] = (
    # --- SQL injection
    Rule("sqli-tautology", "sqli", "SQLインジェクション（常に真になる条件）",
         _r(r"['\"`]\s*(or|and|\|\||&&)\s+['\"`]?\w+['\"`]?\s*(=|<>|!=|\blike\b)\s*['\"`]?\w")),
    Rule("sqli-tautology-bare", "sqli", "SQLインジェクション（常に真になる条件）",
         _r(r"['\"`]?\s*\b(or|and)\s+(\d+)\s*=\s*\2\b")),
    Rule("sqli-union", "sqli", "SQLインジェクション（UNION SELECT）",
         _r(r"\bunion\b(\s+all)?\s+select\b")),
    Rule("sqli-stacked", "sqli", "SQLインジェクション（複文の実行）",
         _r(r";\s*(drop\s+(table|database)|truncate\s+table|delete\s+from|insert\s+into"
            r"|update\s+\w+\s+set\b|create\s+(table|database)|alter\s+table)\b")),
    Rule("sqli-comment", "sqli", "SQLインジェクション（コメントによる条件の無効化）",
         _r(r"['\"`]\s*\)?\s*(--|#)(\s|$)")),
    Rule("sqli-time", "sqli", "SQLインジェクション（時間差攻撃）",
         _r(r"['\"`)]\s*(or|and)?\s*(sleep|pg_sleep|benchmark)\s*\("
            r"|\b(or|and)\s+(sleep|pg_sleep|benchmark)\("  # "AND SLEEP(5)": no space, unlike English "or sleep (8h)"
            r"|\bwaitfor\s+delay\b")),
    Rule("sqli-time-bare", "sqli", "SQLインジェクション（時間差攻撃の疑い）",
         _r(r"\b(sleep|pg_sleep|benchmark)\s*\(\s*\d"), strength="weak"),
    Rule("sqli-schema", "sqli", "SQLインジェクション（データベース構造の探索）",
         _r(r"\binformation_schema\b|\bsqlite_master\b|\bpg_catalog\b")),
    # --- Cross-site scripting
    Rule("xss-script", "xss", "XSS（scriptタグの埋め込み）", _r(r"<\s*/?\s*script\b")),
    # <[a-z] anchors to a real tag start; [^<>] keeps each scan linear on a flood of "<".
    Rule("xss-handler", "xss", "XSS（イベントハンドラの埋め込み）",
         _r(r"<[a-z][^<>]*[\s/](on(error|load|click|mouse\w+|focus|blur|submit|change|input|key\w+"
            r"|toggle|animation\w+|pointer\w+|wheel|abort|begin|drag\w*|drop|paste|scroll))\s*=")),
    Rule("xss-js-uri", "xss", "XSS（javascript: スキーム）", _r(r"javascript\s*:\s*[\w.]+\s*\(")),
    Rule("xss-embed", "xss", "XSS（iframe / svg などの埋め込み）",
         _r(r"<\s*/?\s*(iframe|svg|object|embed|img|body|video|audio|details|marquee)\b[^<>]*(on[a-z]+\s*=|src\s*=|data\s*=)")),
    Rule("xss-cookie", "xss", "XSS（Cookie の窃取）",
         _r(r"document\s*\.\s*cookie|\beval\s*\(|\bfetch\s*\(|\.innerhtml\b"), strength="weak"),
    # --- OS command injection (checked before path traversal: "; cat /etc/hosts" is command injection)
    Rule("cmd-chain", "cmd_injection", "OSコマンドインジェクション（コマンドの連結）",
         _r(rf"(;|\|\||&&|\|)\s*({_CMDS})\b{_CMD_ARG}")),
    Rule("cmd-subst", "cmd_injection", "OSコマンドインジェクション（コマンド置換）",
         _r(rf"\$\(\s*({_CMDS})\b|`\s*({_CMDS})\b")),
    # --- Path traversal
    Rule("pt-dotdot", "path_traversal", "パストラバーサル（上位ディレクトリへの移動）",
         _r(r"(^|[/\\=])\.\.[/\\]")),
    Rule("pt-sensitive", "path_traversal", "パストラバーサル（重要ファイルの指定）",
         _r(r"/etc/(passwd|shadow|hosts)\b|\bwin\.ini\b|\bboot\.ini\b|/proc/self/environ")),
)

_WHITESPACE = re.compile(r"\s+")


def _strip_sql_comments(text: str) -> str:
    """Replace /* ... */ with a space in one linear pass.

    A regex such as /\\*.*?\\*/ rescans to the end for every unclosed "/*", which is quadratic on
    crafted input.
    """
    out, i = [], 0
    while (start := text.find("/*", i)) != -1:
        end = text.find("*/", start + 2)
        if end == -1:
            break
        out.append(text[i:start])
        out.append(" ")
        i = end + 2
    out.append(text[i:])
    return "".join(out)


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
    text = _strip_sql_comments(text)  # UN/**/ION SEL/**/ECT
    text = _WHITESPACE.sub(" ", text)
    return text


def _detection(field: str, normalized: str, rule: Rule, m: re.Match[str]) -> Detection:
    start = max(0, m.start() - 20)
    return Detection(
        rule_id=rule.rule_id,
        attack_type=rule.attack_type,
        label_ja=rule.label_ja,
        field=field,
        matched=normalized[start : m.end() + 20],
        payload=normalized[:PAYLOAD_PREVIEW_CHARS],
    )


def inspect_value(field: str, value: str) -> Detection | None:
    """A value is an attack if a strong rule matches, or if two weak rules match together.

    A single weak signal (one SQL-ish word, document.cookie in a note) is left to pass, because it
    also turns up in ordinary messages and code snippets. That is where Mihari used to false-alarm.
    """
    if not value:
        return None
    normalized = normalize(value)
    weak: list[tuple[Rule, re.Match[str]]] = []
    for rule in RULES:
        m = rule.pattern.search(normalized)
        if not m:
            continue
        if rule.strength == "strong":
            return _detection(field, normalized, rule, m)
        weak.append((rule, m))
        if len(weak) >= 2:
            # Report the first weak signal as the reason; both are evidence the AI team will see.
            return _detection(field, normalized, weak[0][0], weak[0][1])
    return None


def inspect(fields: Iterable[tuple[str, str]]) -> Detection | None:
    """Return the first detection over (field_name, value) pairs, or None."""
    for field, value in fields:
        detection = inspect_value(field, value)
        if detection:
            return detection
    return None
