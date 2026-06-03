from flask import Flask

from app.main.routes_ui import bp as ui_bp
from app.main.routes_projects import bp as projects_bp
from app.main.routes_env import bp as env_bp
from app.main.routes_resources import bp as resources_bp
from app.main.routes_export import bp as export_bp
from app.main.routes_sparql import bp as sparql_bp
from app.main.routes_chat import bp as chat_bp


def register_blueprints(app: Flask) -> None:
    app.register_blueprint(ui_bp)
    app.register_blueprint(projects_bp, url_prefix="/api")
    app.register_blueprint(env_bp, url_prefix="/api")
    app.register_blueprint(resources_bp, url_prefix="/api")
    app.register_blueprint(export_bp, url_prefix="/api")
    app.register_blueprint(sparql_bp, url_prefix="/api/sparql")
    app.register_blueprint(chat_bp, url_prefix="/api/project")
