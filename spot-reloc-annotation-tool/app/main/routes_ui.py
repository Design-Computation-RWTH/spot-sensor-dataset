from flask import Blueprint, render_template, send_file

from app.config import BASE_DIR

bp = Blueprint("ui", __name__)


@bp.route("/")
def index():
    return render_template("index.html")


@bp.route("/download/export-template")
def download_export_template():
    path = BASE_DIR / "templates" / "export_template.json"
    return send_file(
        str(path),
        mimetype="application/json",
        as_attachment=True,
        download_name="export_template.json",
    )
