from __future__ import annotations

from datetime import UTC, datetime
from itertools import count

from shennong_db.errors import NotFoundError
from shennong_db.schemas.semantic import JobCreate, JobRecord


class InMemoryJobStore:
    """Process-local ingest status registry."""

    def __init__(self) -> None:
        self._counter = count(1)
        self._jobs: dict[str, JobRecord] = {}

    def create(self, payload: JobCreate, *, message: str | None = None) -> JobRecord:
        now = datetime.now(UTC)
        job_id = f"job_{now:%Y%m%d_%H%M%S}_{next(self._counter):04d}"
        record = JobRecord(
            job_id=job_id,
            type=payload.type,
            state="queued",
            spec=payload.spec,
            progress=0.0,
            message=message or "Queued; durable worker execution is not configured.",
            created_at=now,
            updated_at=now,
        )
        self._jobs[job_id] = record
        return record

    def complete(
        self,
        job_id: str,
        *,
        result: dict | None = None,
        message: str | None = None,
    ) -> JobRecord:
        record = self.get(job_id)
        updated = record.model_copy(
            update={
                "state": "completed",
                "result": result,
                "progress": 1.0,
                "message": message or "Completed.",
                "updated_at": datetime.now(UTC),
            }
        )
        self._jobs[job_id] = updated
        return updated

    def fail(self, job_id: str, *, error: str, message: str | None = None) -> JobRecord:
        record = self.get(job_id)
        updated = record.model_copy(
            update={
                "state": "failed",
                "error": error,
                "message": message or error,
                "updated_at": datetime.now(UTC),
            }
        )
        self._jobs[job_id] = updated
        return updated

    def get(self, job_id: str) -> JobRecord:
        record = self._jobs.get(job_id)
        if record is None:
            raise NotFoundError(f"Job '{job_id}' was not found")
        return record
