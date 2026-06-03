import os
from pathlib import Path

# Base paths
BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = STATIC_DIR / "uploads"
TEMPLATE_DIR = BASE_DIR / "app" / "ui" / "templates"

# Data files
DATA_DIR = BASE_DIR / "app" / "data"
PROJECTS_FILE_PATH = DATA_DIR / "projects.json"
ENVIRONMENTS_FILE = DATA_DIR / "environments.json"
RESOURCES_FILE = DATA_DIR / "resources.json"
ENTITY_CLASSES_FILE = DATA_DIR / "entity_classes.json"
ONTOLOGIES_FILE = DATA_DIR / "ontologies.json"
RESOURCES_DIR = STATIC_DIR / "resources"

# Limits
MAX_CONTENT_LENGTH = 100 * 1024 * 1024  # 100MB

# Models / endpoints
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini")
WEBOFDATA_MODEL = os.environ.get("OPENROUTER_WEBOFDATA_MODEL", "perplexity/sonar-pro")

# Local GGUF models directory
LOCAL_MODELS_DIR = RESOURCES_DIR / "local_models"

# Default / fallback GGUF model (kept for backward compat; actual selection is dynamic)
GGUF_MODEL_PATH = LOCAL_MODELS_DIR / "gpt-oss-20b-GGUF" / "gpt-oss-20b-MXFP4.gguf"
