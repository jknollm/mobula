from fastapi import FastAPI
from fastapi.testclient import TestClient

from mobula.data.scene import cube_scene_descriptor
from mobula.data.scene_snapshot import write_scene_snapshot
from mobula.main import create_app


def test_mounted_app_keeps_assets_api_and_launch_url_under_its_base_path(base_dataset, tmp_path) -> None:
    manifest, _ = write_scene_snapshot(
        tmp_path / "mounted-scene.json",
        cube_scene_descriptor(base_dataset),
        {("native", "combined"): base_dataset},
    )
    base_path = "/mobula/opaque-job-id"
    owner = FastAPI()
    owner.mount(base_path, create_app())

    with TestClient(owner) as client:
        index = client.get(f"{base_path}/")
        stylesheet = client.get(f"{base_path}/static/styles.css")
        health = client.get(f"{base_path}/api/health")
        registered = client.post(
            f"{base_path}/api/scenes/register-snapshot",
            json={"path": str(manifest)},
            headers={"X-Forwarded-Prefix": base_path},
        )

    assert index.status_code == 200
    assert '<base href="./"' in index.text
    assert stylesheet.status_code == 200
    assert health.json() == {"status": "ok"}
    assert registered.status_code == 200
    assert registered.json()["launch_url"] == f"{base_path}/?scene_id=cube%3Atest-cube"
