from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from threading import RLock

from mobula.service.ingest.models import _InspectionSession, _PlanRecord


class _IngestSessionStore:
    def __init__(self, root: Path) -> None:
        self._root = root
        self._root.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._sessions: dict[str, _InspectionSession] = {}
        self._plans: dict[str, _PlanRecord] = {}

    def _now(self) -> datetime:
        return datetime.now(UTC)

    def _remove_session_locked(self, inspection_id: str) -> None:
        session = self._sessions.pop(inspection_id, None)
        if session is not None:
            try:
                for child in sorted(session.temp_dir.glob("**/*"), reverse=True):
                    if child.is_file() or child.is_symlink():
                        child.unlink(missing_ok=True)
                    elif child.is_dir():
                        child.rmdir()
                session.temp_dir.rmdir()
            except OSError:
                pass
        plan_ids = [pid for pid, plan in self._plans.items() if plan.inspection_id == inspection_id]
        for pid in plan_ids:
            self._plans.pop(pid, None)

    def sweep(self) -> None:
        now = self._now()
        with self._lock:
            expired_sessions = [sid for sid, session in self._sessions.items() if session.expires_at <= now]
            expired_plans = [pid for pid, plan in self._plans.items() if plan.expires_at <= now]
            for sid in expired_sessions:
                self._remove_session_locked(sid)
            for pid in expired_plans:
                self._plans.pop(pid, None)

    def create_session_dir(self, inspection_id: str) -> Path:
        with self._lock:
            session_dir = self._root / inspection_id
            session_dir.mkdir(parents=True, exist_ok=True)
            return session_dir

    def save_session(self, session: _InspectionSession) -> None:
        with self._lock:
            self._sessions[session.inspection_id] = session

    def get_session(self, inspection_id: str) -> _InspectionSession:
        self.sweep()
        with self._lock:
            session = self._sessions.get(inspection_id)
            if session is None:
                raise LookupError(f"inspection session not found: {inspection_id}")
            return session

    def save_plan(self, plan: _PlanRecord) -> None:
        with self._lock:
            self._plans[plan.plan_id] = plan

    def get_plan(self, plan_id: str) -> _PlanRecord:
        self.sweep()
        with self._lock:
            plan = self._plans.get(plan_id)
            if plan is None:
                raise LookupError(f"ingest plan not found: {plan_id}")
            return plan

    def finalize_inspection(self, inspection_id: str) -> None:
        with self._lock:
            self._remove_session_locked(inspection_id)


__all__ = ["_IngestSessionStore"]
