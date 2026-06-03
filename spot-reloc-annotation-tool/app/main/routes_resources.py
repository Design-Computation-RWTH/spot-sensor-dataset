import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request

from app.config import RESOURCES_DIR
from app.functions.storage import load_resources_db, save_resources_db

bp = Blueprint("resources", __name__)


@bp.route("/resources", methods=["GET"])
def list_resources():
    resources = load_resources_db()
    result = [{k: v for k, v in r.items() if k != "content_text"} for r in resources.values()]
    return jsonify(result)


@bp.route("/resources/upload", methods=["POST"])
def upload_resource():
    if "file" not in request.files:
        return jsonify({"error": "No file"}), 400
    f = request.files["file"]
    env_id = request.form.get("env_id") or None
    rid = str(uuid.uuid4())
    ext = Path(f.filename).suffix.lower()
    filename = rid + (ext or ".bin")
    save_path = RESOURCES_DIR / filename
    save_path.parent.mkdir(parents=True, exist_ok=True)
    f.save(str(save_path))
    try:
        content_text = save_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        content_text = "[binary content — not readable as plain text]"
    resources = load_resources_db()
    resources[rid] = {
        "id": rid,
        "name": f.filename,
        "filename": filename,
        "env_id": env_id,
        "content_text": content_text[:60000],
    }
    save_resources_db(resources)
    return jsonify({"id": rid, "name": f.filename, "env_id": env_id})


@bp.route("/resource/<rid>", methods=["DELETE"])
def delete_resource(rid):
    resources = load_resources_db()
    if rid not in resources:
        return jsonify({"error": "Not found"}), 404
    res = resources.pop(rid)
    try:
        (RESOURCES_DIR / res.get("filename", "")).unlink(missing_ok=True)
    except Exception:
        pass
    save_resources_db(resources)
    return jsonify({"ok": True})
