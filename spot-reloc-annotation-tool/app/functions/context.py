import json
import math
from pathlib import Path
from typing import Dict, Optional, Tuple

from app.config import BASE_DIR
from app.functions.exporter import generate_rdf


# Part	                Chars	~Tokens
# System instructions	120	    30
# Distance table	    1,400	350
# Summary	            500	    125
# Focus	                150	    38
# History (1 msg)	    200	    50
# User message	        100	    25
# Total	               ~2,470  ~618


_AXIS_DIR_LABEL = {
    "x": "Right",
    "inv_x": "Left",
    "y": "Bottom",
    "inv_y": "Top",
    "z": "Out",
    "inv_z": "In",
}

_ASSET_DIR_LABEL = {
    "x": "Rear",
    "inv_x": "Front",
    "y": "Left",
    "inv_y": "Right",
    "z": "Rear",
    "inv_z": "Front",
}


def _pct(v):
    try:
        return f"{round(float(v) * 100, 1)}%"
    except (TypeError, ValueError):
        return str(v)


def _resolve_abs_coords(spaces: dict) -> dict:
    """
    Return a dict mapping space_id → (abs_cx, abs_cy, abs_left, abs_top, abs_right, abs_bottom)
    where abs_* are normalised coordinates in the root document frame (0..1).
    DocumentSpace bbox and PointSpace/LineSpace points are given relative to their parent;
    this function resolves them recursively to absolute document coordinates.
    """
    cache: dict = {}

    def _resolve(sid):
        if sid in cache:
            return cache[sid]
        sp = spaces.get(sid)
        if sp is None:
            return None

        pid = sp.get("parent_id")
        stype = sp.get("type", "")

        if stype == "DocumentSpace":
            b = sp.get("bbox", {})
            L0, T0, R0, B0 = b.get("left", 0), b.get("top", 0), b.get("right", 1), b.get("bottom", 1)
            if pid and pid in spaces and spaces[pid].get("type") == "DocumentSpace":
                pr = _resolve(pid)
                if pr:
                    pw = pr[4] - pr[2]  # parent width
                    ph = pr[5] - pr[3]  # parent height
                    L = pr[2] + L0 * pw
                    T = pr[3] + T0 * ph
                    R = pr[2] + R0 * pw
                    B = pr[3] + B0 * ph
                else:
                    L, T, R, B = L0, T0, R0, B0
            else:
                L, T, R, B = L0, T0, R0, B0
            cx, cy = (L + R) / 2, (T + B) / 2
            result = (cx, cy, L, T, R, B)

        elif stype == "PointSpace":
            pt = sp.get("point", {})
            px, py = pt.get("x", 0.5), pt.get("y", 0.5)
            if pid and pid in spaces and spaces[pid].get("type") == "DocumentSpace":
                pr = _resolve(pid)
                if pr:
                    pw = pr[4] - pr[2]
                    ph = pr[5] - pr[3]
                    ax = pr[2] + px * pw
                    ay = pr[3] + py * ph
                else:
                    ax, ay = px, py
            else:
                ax, ay = px, py
            result = (ax, ay, ax, ay, ax, ay)

        elif stype in ("LineSpace", "VectorSpace"):
            s = sp.get("start", {})
            e = sp.get("end", {})
            mx = (s.get("x", 0) + e.get("x", 1)) / 2
            my = (s.get("y", 0) + e.get("y", 0)) / 2
            if pid and pid in spaces and spaces[pid].get("type") == "DocumentSpace":
                pr = _resolve(pid)
                if pr:
                    pw = pr[4] - pr[2]
                    ph = pr[5] - pr[3]
                    ax = pr[2] + mx * pw
                    ay = pr[3] + my * ph
                else:
                    ax, ay = mx, my
            else:
                ax, ay = mx, my
            result = (ax, ay, ax, ay, ax, ay)

        else:
            result = (0.5, 0.5, 0.0, 0.0, 1.0, 1.0)

        cache[sid] = result
        return result

    for sid in spaces:
        _resolve(sid)
    return cache


def build_distance_table(project: Dict) -> str:
    """
    Build a compact pre-computed coordinate + pairwise distance table.
    Injecting this lets the LLM answer distance/proximity questions without calculating.
    """
    spaces = project.get("spaces", {})
    if not spaces:
        return ""

    coords = _resolve_abs_coords(spaces)
    name_of = {sid: sp.get("name", sid) for sid, sp in spaces.items()}

    # Separate PointSpaces from potential reference spaces (DocumentSpace + LineSpace + PointSpace)
    point_ids = [sid for sid, sp in spaces.items() if sp.get("type") == "PointSpace"]
    ref_ids = [sid for sid, sp in spaces.items() if sp.get("type") != "PointSpace"]

    # Absolute coordinate table (all spaces)
    lines = ["=== PRE-COMPUTED ABSOLUTE COORDINATES (root-doc frame, 0\u20131) ===",
             f"{'Space':<24} | {'Type':<14} | {'abs_x':>6} | {'abs_y':>6}",
             f"{'-'*24}-+-{'-'*14}-+-{'------':>6}-+-{'------':>6}"]
    for sid, sp in spaces.items():
        c = coords.get(sid)
        if c:
            lines.append(f"{name_of[sid]:<24} | {sp.get('type','?'):<14} | {c[0]:>6.4f} | {c[1]:>6.4f}")

    if not point_ids or not ref_ids:
        return "\n".join(lines) + "\n"

    # Pairwise distance table: rows = PointSpaces, cols = reference spaces
    ref_names = [name_of[r] for r in ref_ids]
    col_w = max(len(n) for n in ref_names + ["Space"]) + 2

    lines.append("")
    lines.append("=== PRE-COMPUTED PAIRWISE DISTANCES (2D Euclidean, root-doc frame) ===")
    header = f"{'Space':<24} | " + " | ".join(f"{n:>{col_w}}" for n in ref_names) + " | Closest reference"
    lines.append(header)
    lines.append("-" * len(header))

    for pid in point_ids:
        pc = coords.get(pid)
        if not pc:
            continue
        dists = {}
        for rid in ref_ids:
            rc = coords.get(rid)
            if rc:
                dists[rid] = round(math.sqrt((pc[0] - rc[0]) ** 2 + (pc[1] - rc[1]) ** 2), 4)
        closest = min(dists, key=dists.get) if dists else None
        dist_cols = " | ".join(f"{dists.get(r, '?'):>{col_w}.4f}" if r in dists else f"{'?':>{col_w}}" for r in ref_ids)
        closest_name = name_of[closest] if closest else "?"
        lines.append(f"{name_of[pid]:<24} | {dist_cols} | {closest_name}")

    lines.append("")
    return "\n".join(lines) + "\n"


def build_json_context(project: Dict) -> str:
    spaces = project.get("spaces", {})
    id_to_name = {sid: sp.get("name", sid) for sid, sp in spaces.items()}

    def clean_space(sid):
        sp = spaces[sid]
        r = {"name": sp.get("name", sid), "type": sp.get("type", "?")}
        pid = sp.get("parent_id")
        if pid:
            r["parent"] = id_to_name.get(pid, pid)
        if sp.get("comment", "").strip():
            r["comment"] = sp["comment"].strip()
        t = sp.get("type")
        if t == "DocumentSpace":
            b = sp.get("bbox", {})
            r["bbox"] = {
                "left": round(b.get("left", 0), 5),
                "top": round(b.get("top", 0), 5),
                "right": round(b.get("right", 1), 5),
                "bottom": round(b.get("bottom", 1), 5),
            }
            r["x_axis"] = sp.get("x_axis", "x")
            r["y_axis"] = sp.get("y_axis", "y")
            if sp.get("target_asset"):
                r["target_asset"] = True
            if sp.get("dashed"):
                r["dashed"] = True
        elif t == "PointSpace":
            pt = sp.get("point", {})
            r["point"] = {
                "x": round(pt.get("x", 0), 5),
                "y": round(pt.get("y", 0), 5),
                "z": round(pt.get("z", 0.5), 5),
            }
            if sp.get("target_asset"):
                r["x_axis"] = sp.get("x_axis", "x")
                r["y_axis"] = sp.get("y_axis", "y")
        elif t in ("LineSpace", "VectorSpace"):  # VectorSpace is legacy name
            s = sp.get("start", {})
            e = sp.get("end", {})
            r["start"] = {
                "x": round(s.get("x", 0), 5),
                "y": round(s.get("y", 0), 5),
                "z": round(s.get("z", 0.5), 5),
            }
            r["end"] = {
                "x": round(e.get("x", 1), 5),
                "y": round(e.get("y", 0), 5),
                "z": round(e.get("z", 0.5), 5),
            }
            if sp.get("dashed"):
                r["dashed"] = True
        return r

    children_map = {sid: [] for sid in spaces}
    roots = []
    for sid, sp in spaces.items():
        pid = sp.get("parent_id")
        if pid and pid in children_map:
            children_map[pid].append(sid)
        else:
            roots.append(sid)

    def build_node(sid):
        node = clean_space(sid)
        kids = children_map.get(sid, [])
        if kids:
            node["children"] = [build_node(k) for k in kids]
        return node

    meta = {k: v for k, v in project.get("meta", {}).items() if v}
    payload = {
        "file": project.get("original_name"),
        "width_px": project.get("width"),
        "height_px": project.get("height"),
    }
    if meta:
        payload["meta"] = meta
    payload["spaces"] = [build_node(r) for r in roots]
    return json.dumps(payload, indent=2, ensure_ascii=False)


def run_sparql_context(project: Dict) -> str:
    try:
        from rdflib import Graph
        import io as _io

        ttl = generate_rdf(project)
        g = Graph()
        g.parse(_io.StringIO(ttl), format="turtle")

        query_dir = BASE_DIR / "templates" / "sparql_queries"
        if not query_dir.exists():
            return ""

        sections = []
        for qfile in sorted(query_dir.glob("*.sparql")):
            qtext = qfile.read_text(encoding="utf-8")
            try:
                results = g.query(qtext)
                rows = list(results)
                if not rows:
                    continue
                vars_ = [str(v) for v in results.vars]
                header = " | ".join(vars_)
                sep = "-|-".join(["-" * max(len(v), 4) for v in vars_])
                lines = [header, sep]
                for row in rows:
                    cells = []
                    for v in results.vars:
                        val = row[v]
                        cells.append(str(val).replace("\n", " ") if val is not None else "")
                    lines.append(" | ".join(cells))
                heading = qfile.stem.lstrip("0123456789_").replace("_", " ").title()
                sections.append(f"[{heading}]\n" + "\n".join(lines))
            except Exception as qe:
                sections.append(f"[{qfile.stem}] ERROR: {qe}")

        if not sections:
            return ""
        return (
            "\n\n=== SPARQL QUERY RESULTS (derived from the RDF export of the annotation) ===\n"
            + "\n\n".join(sections)
            + "\n=== END SPARQL RESULTS ===\n"
        )
    except Exception as e:
        return f"\n[SPARQL context unavailable: {e}]\n"


def build_spatial_summary(project: Dict) -> str:
    spaces = project.get("spaces", {})
    fname = project.get("original_name", "unknown")
    w = project.get("width", "?")
    h = project.get("height", "?")

    lines = [
        f'=== SPATIAL ANNOTATION: "{fname}" ({w}×{h} px) ===',
        f"Total annotated spaces: {len(spaces)}",
        "",
    ]

    children = {sid: [] for sid in spaces}
    roots = []
    for sp in spaces.values():
        pid = sp.get("parent_id")
        if pid and pid in children:
            children[pid].append(sp)
        else:
            roots.append(sp)

    def fmt_space(sp, indent=0):
        pad = "  " * indent
        stype = sp.get("type", "Space")
        name = sp.get("name", sp["id"])
        cmt = sp.get("comment", "").strip()
        ta = sp.get("target_asset", False)
        dashed = sp.get("dashed", False)
        x_ax = sp.get("x_axis", "x")
        y_ax = sp.get("y_axis", "y")

        lines.append(f"{pad}[{stype}] \"{name}\"")

        if stype == "DocumentSpace":
            b = sp.get("bbox", {})
            L = b.get("left", 0)
            T = b.get("top", 0)
            R = b.get("right", 1)
            B = b.get("bottom", 1)
            origin = sp.get("origin", "top_left")
            lines.append(f"{pad}  bbox    : L={round(L,5)}  T={round(T,5)}  R={round(R,5)}  B={round(B,5)}")
            lines.append(f"{pad}  size    : {_pct(R-L)} wide × {_pct(B-T)} tall of parent")
            lines.append(f"{pad}  centre  : x={round((L+R)/2,4)}  y={round((T+B)/2,4)}")
            x_dir = _ASSET_DIR_LABEL.get(x_ax, "Rear") if ta else _AXIS_DIR_LABEL.get(x_ax, "Right")
            y_dir = _ASSET_DIR_LABEL.get(y_ax, "Left") if ta else _AXIS_DIR_LABEL.get(y_ax, "Bottom")
            lines.append(
                f"{pad}  axes    : docX={x_ax}→{x_dir}  docY={y_ax}→{y_dir}" + ("  [TargetAsset]" if ta else "")
            )
            lines.append(f"{pad}  origin  : {origin}")
            if dashed:
                lines.append(f"{pad}  style   : dashed border")

        elif stype == "PointSpace":
            pt = sp.get("point", {})
            x = pt.get("x", 0)
            y = pt.get("y", 0)
            z = pt.get("z", 0.5)
            lines.append(f"{pad}  position: x={round(x,5)}  y={round(y,5)}  z={round(z,5)}")
            lines.append(f"{pad}           ({_pct(x)} right, {_pct(y)} down, {_pct(z)} depth in parent)")
            if ta:
                x_dir = _ASSET_DIR_LABEL.get(x_ax, "Rear")
                y_dir = _ASSET_DIR_LABEL.get(y_ax, "Left")
                lines.append(f"{pad}  axes→asset: docX={x_ax}→{x_dir}  docY={y_ax}→{y_dir}  [TargetAsset]")

        elif stype in ("LineSpace", "VectorSpace"):  # VectorSpace is legacy name
            s = sp.get("start", {})
            e = sp.get("end", {})
            lines.append(
                f"{pad}  start   : x={round(s.get('x',0),5)}  y={round(s.get('y',0),5)}  z={round(s.get('z',0.5),5)}"
            )
            lines.append(
                f"{pad}  end     : x={round(e.get('x',1),5)}  y={round(e.get('y',0),5)}  z={round(e.get('z',0.5),5)}"
            )
            try:
                import math

                dx = e.get("x", 1) - s.get("x", 0)
                dy = e.get("y", 0) - s.get("y", 0)
                angle = round(math.degrees(math.atan2(dy, dx)), 1)
                length_pct = round(math.sqrt(dx * dx + dy * dy) * 100, 1)
                lines.append(f"{pad}  direction: {angle}°  length≈{length_pct}% of document")
            except Exception:
                pass
            if dashed:
                lines.append(f"{pad}  style   : dashed")

        if cmt:
            lines.append(f'{pad}  comment : "{cmt}"')

        kids = children.get(sp["id"], [])
        if kids:
            lines.append(f"{pad}  children ({len(kids)}):")
            for kid in kids:
                fmt_space(kid, indent + 2)
        lines.append("")

    for sp in roots:
        fmt_space(sp)

    return "\n".join(lines)
