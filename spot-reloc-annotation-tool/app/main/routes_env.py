from flask import Blueprint, jsonify, request

from app.functions.storage import (
    get_env_project_ids,
    load_environments,
    load_projects,
    save_environments,
    save_projects,
)

bp = Blueprint("env", __name__)


@bp.route("/environments", methods=["GET"])
def list_environments():
    return jsonify(load_environments())


@bp.route("/environments", methods=["POST"])
def create_environment():
    data = request.json or {}
    envs = load_environments()
    import uuid

    eid = str(uuid.uuid4())
    envs[eid] = {
        "id": eid,
        "name": (data.get("name") or "New Environment").strip(),
        "parent_id": data.get("parent_id") or None,
    }
    save_environments(envs)
    return jsonify(envs[eid])


@bp.route("/environment/<eid>/rename", methods=["POST"])
def rename_environment(eid):
    data = request.json or {}
    envs = load_environments()
    if eid not in envs:
        return jsonify({"error": "Not found"}), 404
    envs[eid]["name"] = (data.get("name") or envs[eid]["name"]).strip()
    save_environments(envs)
    return jsonify(envs[eid])


@bp.route("/environment/<eid>/move", methods=["POST"])
def move_environment(eid):
    data = request.json or {}
    envs = load_environments()
    if eid not in envs:
        return jsonify({"error": "Not found"}), 404
    new_parent = data.get("parent_id") or None
    if new_parent:
        cur = new_parent
        while cur:
            if cur == eid:
                return jsonify({"error": "Cannot move a folder into its own descendant"}), 400
            cur = envs.get(cur, {}).get("parent_id")
    envs[eid]["parent_id"] = new_parent
    save_environments(envs)
    return jsonify(envs[eid])


@bp.route("/environment/<eid>", methods=["DELETE"])
def delete_environment(eid):
    envs = load_environments()
    if eid not in envs:
        return jsonify({"error": "Not found"}), 404
    parent_id = envs[eid].get("parent_id")
    for e in envs.values():
        if e.get("parent_id") == eid:
            e["parent_id"] = parent_id
    del envs[eid]
    save_environments(envs)

    projects = load_projects()
    for p in projects.values():
        if p.get("env_id") == eid:
            p["env_id"] = parent_id
    save_projects(projects)
    return jsonify({"ok": True})
