from typing import Any


class ShennongError(Exception):
    """Base application error with an API-safe code and details payload."""

    status_code = 500
    code = "internal_error"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(ShennongError):
    status_code = 404
    code = "not_found"


class ValidationError(ShennongError):
    status_code = 422
    code = "validation_error"


class BackendUnavailableError(ShennongError):
    status_code = 503
    code = "backend_unavailable"


class BackendCapabilityError(ShennongError):
    status_code = 400
    code = "backend_capability_error"
