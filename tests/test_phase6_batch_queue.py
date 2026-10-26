import asyncio
import pytest
from httpx import AsyncClient, ASGITransport
from src.server.server import (
    app,
    TaskJobController,
    _active_jobs,
    _job_controllers,
    _save_jobs_to_disk,
)


@pytest.mark.asyncio
async def test_clear_finished_jobs_endpoint():
    j_active = "test_batch_job_active"
    j_completed = "test_batch_job_completed"
    j_failed = "test_batch_job_failed"
    j_cancelled = "test_batch_job_cancelled"

    _active_jobs[j_active] = {"session_id": j_active, "status": "active", "url": "http://example.com/1"}
    _active_jobs[j_completed] = {"session_id": j_completed, "status": "completed", "url": "http://example.com/2"}
    _active_jobs[j_failed] = {"session_id": j_failed, "status": "failed", "url": "http://example.com/3"}
    _active_jobs[j_cancelled] = {"session_id": j_cancelled, "status": "cancelled", "url": "http://example.com/4"}

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post("/api/jobs/clear-finished")
            assert res.status_code == 200
            data = res.json()
            assert data["success"] is True
            assert data["cleared_count"] >= 3

            assert j_active in _active_jobs
            assert j_completed not in _active_jobs
            assert j_failed not in _active_jobs
            assert j_cancelled not in _active_jobs
    finally:
        _active_jobs.pop(j_active, None)
        _active_jobs.pop(j_completed, None)
        _active_jobs.pop(j_failed, None)
        _active_jobs.pop(j_cancelled, None)


@pytest.mark.asyncio
async def test_pause_and_resume_all_jobs_endpoints():
    j1 = "test_batch_pause_1"
    j2 = "test_batch_pause_2"

    ctrl1 = TaskJobController()
    ctrl2 = TaskJobController()

    _job_controllers[j1] = ctrl1
    _job_controllers[j2] = ctrl2

    _active_jobs[j1] = {"session_id": j1, "status": "running", "url": "http://example.com/a", "progress": {}}
    _active_jobs[j2] = {"session_id": j2, "status": "active", "url": "http://example.com/b", "progress": {}}

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res_pause = await client.post("/api/jobs/pause-all")
            assert res_pause.status_code == 200
            data_pause = res_pause.json()
            assert data_pause["success"] is True
            assert ctrl1.is_paused is True
            assert ctrl2.is_paused is True
            assert _active_jobs[j1]["status"] == "paused"
            assert _active_jobs[j2]["status"] == "paused"

            res_resume = await client.post("/api/jobs/resume-all")
            assert res_resume.status_code == 200
            data_resume = res_resume.json()
            assert data_resume["success"] is True
            assert ctrl1.is_paused is False
            assert ctrl2.is_paused is False
            assert _active_jobs[j1]["status"] in ("active", "running")
            assert _active_jobs[j2]["status"] in ("active", "running")
    finally:
        _job_controllers.pop(j1, None)
        _job_controllers.pop(j2, None)
        _active_jobs.pop(j1, None)
        _active_jobs.pop(j2, None)


@pytest.mark.asyncio
async def test_batch_analyze_endpoint_payload_validation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res_bad = await client.post("/api/batch-analyze", json={"urls": []})
        assert res_bad.status_code == 400

        res_valid = await client.post(
            "/api/batch-analyze",
            json={
                "urls": ["https://example.com/album1", "https://example.com/album2"],
                "engine_type": "classic",
                "folder": "Viagens",
                "priority": "high",
            },
        )
        assert res_valid.status_code == 200
        data = res_valid.json()
        assert data["status"] == "started"
        assert data["total"] == 2
        assert len(data["jobs"]) == 2

        for spawned in data["jobs"]:
            s_id = spawned["session_id"]
            assert s_id in _active_jobs
            assert _active_jobs[s_id]["folder"] == "Viagens"
            assert _active_jobs[s_id]["priority"] == "high"
            _active_jobs.pop(s_id, None)
            _job_controllers.pop(s_id, None)
        from src.server.server import _save_jobs_to_disk
        _save_jobs_to_disk()
