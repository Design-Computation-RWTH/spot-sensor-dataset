import struct
import uuid
from pathlib import Path
from typing import Tuple

from flask import jsonify, request

from app.config import UPLOAD_DIR
from app.functions.storage import load_projects, save_projects


ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".pdf"}


def get_dimensions(path: Path, ext: str) -> Tuple[int, int]:
    """Return image dimensions; fall back to basic parsers if Pillow is missing."""
    try:
        from PIL import Image

        if ext != ".pdf":
            with Image.open(path) as img:
                return img.width, img.height
    except ImportError:
        pass

    if ext in (".jpg", ".jpeg"):
        return get_jpeg_dimensions(path)
    if ext == ".png":
        return get_png_dimensions(path)
    return 800, 600


def get_png_dimensions(path: Path) -> Tuple[int, int]:
    with open(path, "rb") as f:
        f.read(8)  # signature
        f.read(4)  # chunk length
        f.read(4)  # IHDR
        width = struct.unpack(">I", f.read(4))[0]
        height = struct.unpack(">I", f.read(4))[0]
    return width, height


def get_jpeg_dimensions(path: Path) -> Tuple[int, int]:
    with open(path, "rb") as f:
        f.read(2)
        while True:
            marker, = struct.unpack(">H", f.read(2))
            if marker in (0xFFC0, 0xFFC2):
                f.read(3)
                height = struct.unpack(">H", f.read(2))[0]
                width = struct.unpack(">H", f.read(2))[0]
                return width, height
            length, = struct.unpack(">H", f.read(2))
            f.read(length - 2)
    return 800, 600


def handle_upload():
    if "file" not in request.files:
        return jsonify({"error": "No file"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "Empty filename"}), 400

    ext = Path(f.filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        return jsonify({"error": "Unsupported file type"}), 400

    file_id = str(uuid.uuid4())
    filename = file_id + ext
    save_path = UPLOAD_DIR / filename
    save_path.parent.mkdir(parents=True, exist_ok=True)
    f.save(save_path)

    width, height = get_dimensions(save_path, ext)

    projects = load_projects()
    env_id = request.form.get("env_id") or None
    projects[file_id] = {
        "id": file_id,
        "original_name": f.filename,
        "filename": filename,
        "ext": ext,
        "width": width,
        "height": height,
        "env_id": env_id,
        "spaces": {},
    }
    save_projects(projects)

    return jsonify(
        {
            "id": file_id,
            "name": f.filename,
            "width": width,
            "height": height,
            "ext": ext,
            "env_id": env_id,
        }
    )
