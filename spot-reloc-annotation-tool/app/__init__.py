from flask import Flask, jsonify, request
from pathlib import Path

from app.config import (
    TEMPLATE_DIR,
    STATIC_DIR,
    UPLOAD_DIR,
    RESOURCES_DIR,
    MAX_CONTENT_LENGTH,
)
from app.main import register_blueprints


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(Exception)
    def handle_exception(e):
        import traceback

        return (
            jsonify({"error": str(e), "trace": traceback.format_exc()[-800:]}),
            500,
        )

    @app.errorhandler(404)
    def handle_404(e):
        return jsonify({"error": "Not found", "path": str(request.path)}), 404


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder=str(TEMPLATE_DIR),
        static_folder=str(STATIC_DIR),
    )

    # Core configuration
    app.config["UPLOAD_FOLDER"] = str(UPLOAD_DIR)
    app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
    app.config["TEMPLATES_AUTO_RELOAD"] = True

    # Ensure folders exist
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)

    register_error_handlers(app)
    register_blueprints(app)
    return app
