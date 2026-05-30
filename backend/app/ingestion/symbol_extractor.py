"""Regex-based symbol extraction from code content for MVP."""

import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Patterns for common symbol types
PYTHON_PATTERNS = [
    (r"(?:async\s+)?def\s+(\w+)\s*\(", "function"),
    (r"class\s+(\w+)\s*[\(:]", "class"),
    (r"(?:async\s+)?(\w+)\s*=\s*(?:lambda|function)", "function"),
]

JS_TS_PATTERNS = [
    (r"(?:export\s+)?(?:async\s+)?function\s+(\w+)", "function"),
    (r"(?:export\s+)?class\s+(\w+)", "class"),
    (r"(?:export\s+)?const\s+(\w+)\s*=\s*(?:\(|async\s*\()", "function"),
    (r"(?:export\s+)?(?:const|let|var)\s+(\w+)", "variable"),
    (r"(?:export\s+)?interface\s+(\w+)", "interface"),
    (r"(?:export\s+)?type\s+(\w+)", "type"),
    (r"(?:export\s+)?enum\s+(\w+)", "enum"),
]

GO_PATTERNS = [
    (r"func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(", "function"),
    (r"type\s+(\w+)\s+struct", "class"),
    (r"type\s+(\w+)\s+interface", "interface"),
]

RUST_PATTERNS = [
    (r"(?:pub\s+)?(?:async\s+)?fn\s+(\w+)", "function"),
    (r"(?:pub\s+)?struct\s+(\w+)", "class"),
    (r"(?:pub\s+)?trait\s+(\w+)", "interface"),
    (r"(?:pub\s+)?enum\s+(\w+)", "enum"),
]

LANG_PATTERNS = {
    "python": PYTHON_PATTERNS,
    "javascript": JS_TS_PATTERNS,
    "typescript": JS_TS_PATTERNS,
    "jsx": JS_TS_PATTERNS,
    "tsx": JS_TS_PATTERNS,
    "go": GO_PATTERNS,
    "rust": RUST_PATTERNS,
}

EXTENSION_MAP = {
    ".py": "python", ".js": "javascript", ".ts": "typescript",
    ".jsx": "jsx", ".tsx": "tsx", ".go": "go", ".rs": "rust",
    ".java": "javascript",  # Similar patterns
    ".rb": "python",  # Similar patterns
}


def detect_language(file_path: str) -> str:
    for ext, lang in EXTENSION_MAP.items():
        if file_path.endswith(ext):
            return lang
    return "unknown"


def extract_symbols(content: str, file_path: str, artifact_id: Optional[str] = None) -> list[dict]:
    """Extract code symbols from file content using regex."""
    if not content:
        return []

    lang = detect_language(file_path)
    patterns = LANG_PATTERNS.get(lang, [])
    if not patterns:
        return []

    symbols = []
    lines = content.split("\n")

    for line_num, line in enumerate(lines, 1):
        for pattern, kind in patterns:
            match = re.search(pattern, line)
            if match:
                name = match.group(1)
                # Extract signature (the full line trimmed)
                signature = line.strip()
                # Try to extract doc comment from previous line
                doc_comment = None
                if line_num > 1:
                    prev = lines[line_num - 2].strip()
                    if prev.startswith("#") or prev.startswith("//") or prev.startswith("*"):
                        doc_comment = prev.lstrip("#/ *").strip()

                symbols.append({
                    "name": name,
                    "kind": kind,
                    "file_path": file_path,
                    "line_start": line_num,
                    "line_end": line_num,
                    "signature": signature[:500] if signature else None,
                    "doc_comment": doc_comment[:500] if doc_comment else None,
                    "artifact_id": artifact_id,
                })

    return symbols
