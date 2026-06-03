import json

from flask import Blueprint, jsonify, current_app
from app.functions.exporter import build_export_json, generate_rdf, generate_rdf_merged
from app.functions.storage import load_projects

bp = Blueprint("export", __name__)


@bp.route("/project/<pid>/export/rdf", methods=["GET"])
def export_rdf(pid):
    projects = load_projects()
    if pid not in projects:
        return jsonify({"error": "Not found"}), 404
    p = projects[pid]
    # Collect spaces from all other projects so cross-project asset_bp refs resolve correctly
    extra_spaces = {}
    for other_pid, other_p in projects.items():
        if other_pid != pid:
            extra_spaces.update(other_p.get("spaces", {}))
    # Use the manually edited TTL override if the user has saved one
    rdf = p.get("ttl_override") or generate_rdf(p, extra_spaces=extra_spaces)
    return rdf, 200, {
        "Content-Type": "text/turtle",
        "Content-Disposition": f"attachment; filename=\"{p['original_name']}.ttl\"",
    }


@bp.route("/project/<pid>/export/json", methods=["GET"])
def export_json(pid):
    projects = load_projects()
    if pid not in projects:
        return jsonify({"error": "Not found"}), 404
    p = projects[pid]
    result = build_export_json(p)
    resp = current_app.response_class(
        json.dumps(result, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": f"attachment; filename=\"{p['original_name']}.json\""},
    )
    return resp


@bp.route("/export/all-json", methods=["GET"])
def export_all_json():
    projects = load_projects()
    all_results = []
    for pid, p in projects.items():
        result = build_export_json(p)
        result["_project_id"] = pid
        result["_project_name"] = p.get("original_name", pid)
        all_results.append(result)
    resp = current_app.response_class(
        json.dumps(all_results, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": 'attachment; filename="all_spaces.json"'},
    )
    return resp


@bp.route("/export/all-rdf", methods=["GET"])
def export_all_rdf():
    projects = load_projects()
    all_projects = list(projects.values())
    combined = generate_rdf_merged(all_projects) if all_projects else ""
    return combined, 200, {
        "Content-Type": "text/turtle",
        "Content-Disposition": 'attachment; filename="all_spaces.ttl"',
    }
