import json
from typing import Dict, List

from app.config import PROJECTS_FILE_PATH, ENVIRONMENTS_FILE, RESOURCES_FILE, ENTITY_CLASSES_FILE, ONTOLOGIES_FILE


def _load_json(path) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {}


def _save_json(path, data) -> None:
    path.write_text(json.dumps(data, indent=2))


def load_projects() -> Dict:
    return _load_json(PROJECTS_FILE_PATH)


def save_projects(data: Dict) -> None:
    _save_json(PROJECTS_FILE_PATH, data)


def load_environments() -> Dict:
    return _load_json(ENVIRONMENTS_FILE)


def save_environments(data: Dict) -> None:
    _save_json(ENVIRONMENTS_FILE, data)


def load_resources_db() -> Dict:
    return _load_json(RESOURCES_FILE)


def save_resources_db(data: Dict) -> None:
    _save_json(RESOURCES_FILE, data)


def load_entity_classes() -> Dict:
    """Load global entity class associations (cross-file, keyed by entity safe-name)."""
    return _load_json(ENTITY_CLASSES_FILE)


def save_entity_classes(data: Dict) -> None:
    """Persist global entity class associations."""
    _save_json(ENTITY_CLASSES_FILE, data)


def load_ontologies() -> list:
    """Load global ontologies (cross-file)."""
    data = _load_json(ONTOLOGIES_FILE)
    # File is stored as a list; return empty list if missing/wrong type
    return data if isinstance(data, list) else []


def save_ontologies(data: list) -> None:
    """Persist global ontologies."""
    ONTOLOGIES_FILE.write_text(__import__('json').dumps(data, indent=2))


def get_env_project_ids(env_id: str, projects: Dict, envs: Dict) -> List[str]:
    """Recursively collect all project IDs belonging to an environment tree."""
    ids = [pid for pid, p in projects.items() if p.get("env_id") == env_id]
    child_envs = [eid for eid, e in envs.items() if e.get("parent_id") == env_id]
    for child_eid in child_envs:
        ids.extend(get_env_project_ids(child_eid, projects, envs))
    return ids
