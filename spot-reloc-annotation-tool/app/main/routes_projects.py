from pathlib import Path

from flask import Blueprint, jsonify, request

from app.config import UPLOAD_DIR
from app.functions.files import handle_upload
from app.functions.storage import load_projects, save_projects, load_entity_classes, save_entity_classes, load_ontologies, save_ontologies

bp = Blueprint("projects", __name__)


@bp.route("/projects", methods=["GET"])
def list_projects():
    projects = load_projects()
    result = []
    for pid, p in projects.items():
        result.append({
            "id": pid,
            "name": p["original_name"],
            "ext": p.get("ext", ""),
            "env_id": p.get("env_id"),
        })
    return jsonify(result)


@bp.route("/project/<pid>", methods=["GET"])
def get_project(pid):
    projects = load_projects()
    if pid not in projects:
        return jsonify({"error": "Not found"}), 404
    return jsonify(projects[pid])


@bp.route("/project/<pid>/spaces", methods=["POST"])
def save_spaces(pid):
    projects = load_projects()
    if pid not in projects:
        return jsonify({"error": "Not found"}), 404
    data = request.json or {}
    projects[pid]["spaces"] = data.get("spaces", {})
    if "meta" in data:
        projects[pid]["meta"] = data["meta"]
    if "ontologies" in data:
        projects[pid]["ontologies"] = data["ontologies"]
    save_projects(projects)
    return jsonify({"ok": True})


@bp.route("/project/<pid>/delete", methods=["POST"])
def delete_project(pid):
    projects = load_projects()
    if pid not in projects:
        return jsonify({"error": "Not found"}), 404
    p = projects[pid]
    file_path = UPLOAD_DIR / p.get("filename", "")
    try:
        if file_path.exists():
            file_path.unlink()
    except Exception:
        pass
    del projects[pid]
    save_projects(projects)
    return jsonify({"ok": True})


@bp.route("/project/<pid>/set-env", methods=["POST"])
def set_project_env(pid):
    data = request.json or {}
    projects = load_projects()
    if pid not in projects:
        return jsonify({"error": "Not found"}), 404
    projects[pid]["env_id"] = data.get("env_id") or None
    save_projects(projects)
    return jsonify({"ok": True})


@bp.route("/project/<pid>/rename", methods=["POST"])
def rename_project(pid):
    data = request.json or {}
    new_name = (data.get("new_name") or "").strip()
    if not new_name:
        return jsonify({"error": "new_name required"}), 400

    projects = load_projects()
    if pid not in projects:
        return jsonify({"error": "Not found"}), 404

    proj = projects[pid]
    env_id = proj.get("env_id")

    # Collect existing original_names in the same env (exclude current project)
    existing_names = {
        p.get("original_name", "")
        for ppid, p in projects.items()
        if ppid != pid and p.get("env_id") == env_id
    }

    # Resolve duplicate: append _copy01, _copy02, … until unique
    actual_name = new_name
    if actual_name in existing_names:
        counter = 1
        while actual_name in existing_names:
            actual_name = f"{new_name}_copy{counter:02d}"
            counter += 1

    projects[pid]["original_name"] = actual_name
    # Clear display_name override so the field now reflects the real filename
    projects[pid].setdefault("meta", {}).pop("display_name", None)

    save_projects(projects)
    return jsonify({"ok": True, "name": actual_name, "renamed": actual_name != new_name})


@bp.route("/entities", methods=["GET"])
def list_entities():
    """Return all unique entity names across every project."""
    projects = load_projects()
    names = set()
    for p in projects.values():
        for sp in (p.get("spaces") or {}).values():
            e = (sp.get("entity") or "").strip()
            if e:
                names.add(e)
    return jsonify(sorted(names, key=str.lower))


@bp.route("/entity_classes", methods=["GET"])
def get_entity_classes():
    """Return the global entity class associations (cross-file)."""
    return jsonify(load_entity_classes())


@bp.route("/entity_classes", methods=["POST"])
def set_entity_classes():
    """Replace the global entity class associations with the posted data."""
    data = request.json
    if not isinstance(data, dict):
        return jsonify({"error": "Expected a JSON object"}), 400
    save_entity_classes(data)
    return jsonify({"ok": True})


@bp.route("/ontologies", methods=["GET"])
def get_ontologies():
    """Return the global ontology list (cross-file)."""
    return jsonify(load_ontologies())


@bp.route("/ontologies", methods=["POST"])
def set_ontologies():
    """Replace the global ontology list with the posted data."""
    data = request.json
    if not isinstance(data, list):
        return jsonify({"error": "Expected a JSON array"}), 400
    save_ontologies(data)
    return jsonify({"ok": True})


@bp.route("/upload", methods=["POST"])
def upload_file():
    return handle_upload()


# ── TTL editor: load & save per-project TTL override ──────────────────────────

@bp.route("/project/<pid>/ttl", methods=["GET"])
def get_project_ttl(pid):
    """Return the custom TTL override for the project, or generate from annotations."""
    from app.functions.exporter import generate_rdf
    projects = load_projects()
    if pid not in projects:
        return jsonify({"error": "Not found"}), 404
    p = projects[pid]
    override = p.get("ttl_override")
    if override is not None:
        return override, 200, {"Content-Type": "text/plain; charset=utf-8"}
    ttl = generate_rdf(p)
    return ttl, 200, {"Content-Type": "text/plain; charset=utf-8"}


@bp.route("/project/<pid>/ttl", methods=["POST"])
def save_project_ttl(pid):
    """
    Save a custom TTL text for this project.
    - Validates TTL syntax (returns 400 on error).
    - Parses changed labels, comments, and coordinates back into the spaces dict.
    - Clears the override when reset=true.
    """
    from app.functions.ttl_parser import validate_and_parse_ttl
    projects = load_projects()
    if pid not in projects:
        return jsonify({"error": "Not found"}), 404
    data = request.json or {}

    if data.get("reset"):
        projects[pid].pop("ttl_override", None)
        save_projects(projects)
        return jsonify({"ok": True, "reset": True})

    content = data.get("content", "")

    # Validate syntax and parse space changes
    error, updated_spaces = validate_and_parse_ttl(content, projects[pid].get("spaces", {}))
    if error:
        return jsonify({"error": error}), 400

    # Apply changes
    projects[pid]["ttl_override"] = content
    projects[pid]["spaces"] = updated_spaces
    save_projects(projects)
    return jsonify({"ok": True, "spaces_updated": len(updated_spaces)})
