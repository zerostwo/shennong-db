import base64
import json
from dataclasses import dataclass

from shennong_db.errors import ValidationError


@dataclass(frozen=True)
class PageCursor:
    offset: int = 0


def encode_cursor(offset: int) -> str | None:
    if offset <= 0:
        return None
    payload = json.dumps({"offset": offset}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> PageCursor:
    if not cursor:
        return PageCursor()
    try:
        padding = "=" * (-len(cursor) % 4)
        payload = base64.urlsafe_b64decode(f"{cursor}{padding}")
        data = json.loads(payload)
        offset = int(data["offset"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValidationError("Invalid pagination cursor") from exc
    if offset < 0:
        raise ValidationError("Invalid pagination cursor")
    return PageCursor(offset=offset)
