import json
from typing import Dict, Tuple

from app.functions.storage import load_entity_classes

_DCT_PREFIX = "http://purl.org/dc/dcmitype/"

_AXIS_DIR_MAP = {
    "x": "Right",
    "inv_x": "Left",
    "y": "Bottom",
    "inv_y": "Top",
}

_AXIS_CODE_MAP = {
    "x": ("X", False),
    "inv_x": ("X", True),
    "y": ("Y", False),
    "inv_y": ("Y", True),
    "z": ("Z", False),
    "inv_z": ("Z", True),
}

_ASSET_DIR_LABEL = {
    "x": "Rear",
    "inv_x": "Front",
    "y": "Left",
    "inv_y": "Right",
    "z": "Top",
    "inv_z": "Bottom",
}


# ── Appearance Predicate Helper ──────────────────────────────────────────────────

def _ap_pred(container_type: str) -> str:
    """Return spot:hasAppearance — unified predicate; appearance type is encoded in rdf:type of the AP node."""
    return 'spot:hasAppearance'


# ── Topological Natural Language Label Helpers ─────────────────────────────────

def _topo_file_x(v: float) -> str:
    """Screen/File x-axis: grows towards right."""
    if v < 0.33: return "left"
    if v < 0.66: return "transversalCenter"
    return "right"

def _topo_file_y(v: float) -> str:
    """Screen/File y-axis: grows towards bottom."""
    if v < 0.33: return "top"
    if v < 0.66: return "verticalCenter"
    return "bottom"

def _topo_asset_x(v: float) -> str:
    """Asset x-axis: grows towards rear."""
    if v < 0.33: return "front"
    if v < 0.66: return "longitudinalCenter"
    return "rear"

def _topo_asset_y(v: float) -> str:
    """Asset y-axis: grows towards left."""
    if v < 0.33: return "right"
    if v < 0.66: return "transversalCenter"
    return "left"

def _topo_asset_z(v: float) -> str:
    """Asset z-axis: grows towards top."""
    if v < 0.33: return "bottom"
    if v < 0.66: return "verticalCenter"
    return "top"

def _reloc(label: str) -> str:
    """Convert topo label to reloc relation string (containedIn + CapitalizedLabel)."""
    return f"containedIn{label[0].upper() + label[1:]}"


def _format_rdf_object(obj: str, is_instance: bool = False) -> str:
    """Format an RDF object reference.
    
    For instance links (is_instance=True), ensures local references are prefixed with `:` to make them IRIs.
    If object already contains a colon (namespace prefix or local reference), returns as-is.
    Otherwise, prepends `:` for local instance references.
    """
    if not obj:
        return obj
    # If it already has a colon (like "sosa:Sensor" or ":LVU_Top"), return as-is
    if ':' in obj:
        return obj
    # For instance links without a prefix, make them local IRIs
    if is_instance:
        return f":{obj}"
    return obj


# ── Helper transforms ───────────────────────────────────────────

def _axis_directions(sp: Dict) -> Dict:
    return {
        "X": _AXIS_DIR_MAP.get(sp.get("x_axis", "x"), "Right"),
        "Y": _AXIS_DIR_MAP.get(sp.get("y_axis", "y"), "Bottom"),
    }


def _axis_mappings_from_sp(sp: Dict, target_obj: str, use_asset: bool = False) -> list:
    """Build axis mappings using sp.axes + sp.src_axes (or asset_axes + asset_src_axes)."""
    if use_asset:
        axes = sp.get("asset_axes") or ["x", "y", "z"]
        src_names = sp.get("asset_src_axes") or [(["X", "Y", "Z"][i] if i < 3 else "X") for i in range(len(axes))]
    else:
        axes = sp.get("axes") or [sp.get("x_axis", "x"), sp.get("y_axis", "y")]
        src_names = sp.get("src_axes") or [(["X", "Y", "Z"][i] if i < 3 else "X") for i in range(len(axes))]
    mappings = []
    for src_name, tgt_val in zip(src_names, axes):
        tgt_axis, inverse = _AXIS_CODE_MAP.get(tgt_val, (tgt_val.lstrip("inv_").upper(), tgt_val.startswith("inv_")))
        mappings.append({
            "source": {"axis": src_name},
            "target": {"object": target_obj, "axis": tgt_axis, "inverse": inverse},
            "accuracy": "Exact",
        })
    return mappings



def to_parent_relative_bbox(bbox: Dict, parent_sp: Dict) -> Dict:
    if parent_sp is None:
        return bbox
    pb = parent_sp.get("bbox", {"left": 0, "top": 0, "right": 1, "bottom": 1})
    pw = pb["right"] - pb["left"]
    ph = pb["bottom"] - pb["top"]

    def nx(v):
        return round((v - pb["left"]) / pw, 5) if pw else 0.0

    def ny(v):
        return round((v - pb["top"]) / ph, 5) if ph else 0.0

    return {
        "left": nx(bbox["left"]),
        "right": nx(bbox["right"]),
        "top": ny(bbox["top"]),
        "bottom": ny(bbox["bottom"]),
    }


def to_parent_relative_point(point: Dict, parent_sp: Dict) -> Dict:
    if parent_sp is None:
        return point
    pb = parent_sp.get("bbox", {"left": 0, "top": 0, "right": 1, "bottom": 1})
    pw = pb["right"] - pb["left"]
    ph = pb["bottom"] - pb["top"]

    def nx(v):
        return round((v - pb["left"]) / pw, 5) if pw else 0.0

    def ny(v):
        return round((v - pb["top"]) / ph, 5) if ph else 0.0

    return {"x": nx(point["x"]), "y": ny(point["y"])}


def _boundary_mappings_doc(rel_bbox: Dict, parent_name: str):
    return [
        {
            "source": {"axis": "X", "boundary": "Min"},
            "reloc_relation": _reloc(_topo_file_x(rel_bbox["left"])),
            "reloc_relation_target": parent_name,
            "normalized_coordinate": rel_bbox["left"],
            "topo_label": _topo_file_x(rel_bbox["left"]),
            "accuracy": "Approximate",
        },
        {
            "source": {"axis": "X", "boundary": "Max"},
            "reloc_relation": _reloc(_topo_file_x(rel_bbox["right"])),
            "reloc_relation_target": parent_name,
            "normalized_coordinate": rel_bbox["right"],
            "topo_label": _topo_file_x(rel_bbox["right"]),
            "accuracy": "Approximate",
        },
        {
            "source": {"axis": "Y", "boundary": "Min"},
            "reloc_relation": _reloc(_topo_file_y(rel_bbox["top"])),
            "reloc_relation_target": parent_name,
            "normalized_coordinate": rel_bbox["top"],
            "topo_label": _topo_file_y(rel_bbox["top"]),
            "accuracy": "Approximate",
        },
        {
            "source": {"axis": "Y", "boundary": "Max"},
            "reloc_relation": _reloc(_topo_file_y(rel_bbox["bottom"])),
            "reloc_relation_target": parent_name,
            "normalized_coordinate": rel_bbox["bottom"],
            "topo_label": _topo_file_y(rel_bbox["bottom"]),
            "accuracy": "Approximate",
        },
    ]


def _boundary_mappings_point(parent_name: str):
    return [
        {
            "source": {"axis": "X", "boundary": "Min"},
            "reloc_relation_target": parent_name,
            "reloc_relation": "meetFront",
            "accuracy": "Exact",
        },
        {
            "source": {"axis": "X", "boundary": "Max"},
            "reloc_relation_target": parent_name,
            "reloc_relation": "meetRear",
            "accuracy": "Exact",
        },
        {
            "source": {"axis": "Y", "boundary": "Min"},
            "reloc_relation_target": parent_name,
            "reloc_relation": "meetRight",
            "accuracy": "Exact",
        },
        {
            "source": {"axis": "Y", "boundary": "Max"},
            "reloc_relation_target": parent_name,
            "reloc_relation": "meetLeft",
            "accuracy": "Exact",
        },
        {
            "source": {"axis": "Z", "boundary": "Min"},
            "reloc_relation_target": parent_name,
            "reloc_relation": "meetBottom",
            "accuracy": "Exact",
        },
        {
            "source": {"axis": "Z", "boundary": "Max"},
            "reloc_relation_target": parent_name,
            "reloc_relation": "containedInTop",
            "accuracy": "Exact",
        },
    ]


def _dct_uri(raw_type: str) -> str:
    if not raw_type:
        return ""
    if raw_type.startswith("http"):
        return raw_type
    return _DCT_PREFIX + raw_type


# ── Export JSON ─────────────────────────────────────────────────

def build_export_json(project: Dict) -> Dict:
    spaces = project.get("spaces", {})
    meta = project.get("meta", {})
    fname = project["original_name"]
    ext = project.get("ext", "").lstrip(".")

    display_name = meta.get("display_name") or fname
    doc_space_name = f"document_space_{display_name}"

    asset_entry = {
        "class": "AssetSpace",
        "name": "AssetSpace",   # single shared IRI across all files
        "axes_directions": {"X": "Rear", "Y": "Left", "Z": "Rear"},
        "metadata": {
            "rel_access_url": meta.get("url", ""),
            "filetype": meta.get("filetype", ext),
            "dct_type": _dct_uri(meta.get("dct_type", "Image")),
            "comment": meta.get("comment", ""),
        },
    }

    asset_name = asset_entry["name"]
    root_doc_entry = {
        "class": "DocumentSpace",
        "name": doc_space_name,
        "axes_directions": {"X": "Right", "Y": "Bottom"},
        "metadata": {
            "rel_access_url": meta.get("url", ""),
            "filetype": meta.get("filetype", ext),
            "dct_type": _dct_uri(meta.get("dct_type", "Image")),
            "comment": meta.get("comment", ""),
        },
        "asset_appearances": [
            {
                "axis_mappings": [
                    {
                        "source": {"axis": "X"},
                        "target": {"object": asset_name, "axis": "X", "inverse": False},
                        "accuracy": "Exact",
                    },
                    {
                        "source": {"axis": "Y"},
                        "target": {"object": asset_name, "axis": "Y", "inverse": False},
                        "accuracy": "Exact",
                    },
                ],
                "boundary_point_mappings": [
                    {
                        "source": {"axis": "X", "boundary": "Min"},
                        "reloc_relation_target": asset_name,
                        "reloc_relation": "meetFront",
                        "accuracy": "Exact",
                    },
                    {
                        "source": {"axis": "X", "boundary": "Max"},
                        "reloc_relation_target": asset_name,
                        "reloc_relation": "meetRear",
                        "accuracy": "Exact",
                    },
                    {
                        "source": {"axis": "Y", "boundary": "Min"},
                        "reloc_relation_target": asset_name,
                        "reloc_relation": "meetRight",
                        "accuracy": "Exact",
                    },
                    {
                        "source": {"axis": "Y", "boundary": "Max"},
                        "reloc_relation_target": asset_name,
                        "reloc_relation": "meetLeft",
                        "accuracy": "Exact",
                    },
                ],
            }
        ],
    }

    document_spaces = [root_doc_entry]
    entity_spaces = []

    for sp in spaces.values():
        parent_id = sp.get("parent_id")
        parent_sp = spaces.get(parent_id) if parent_id else None
        parent_name = parent_sp["name"] if parent_sp else doc_space_name
        sname = sp.get("name", sp["id"])

        if sp["type"] == "DocumentSpace":
            bbox = sp.get("bbox", {"left": 0, "top": 0, "right": 1, "bottom": 1})
            rel_bbox = to_parent_relative_bbox(bbox, parent_sp)

            asset_apps = []
            if sp.get("target_asset"):
                asset_apps = [{"asset": asset_name, "axis_mappings": _axis_mappings_from_sp(sp, asset_name, use_asset=True)}]

            entry = {
                "class": "AreaSpace",
                "name": sname,
                "metadata": {
                    "rel_access_url": "",
                    "filetype": ext,
                    "dct_type": _dct_uri(meta.get("dct_type", "Image")),
                    "comment": sp.get("comment", ""),
                },
                "asset_appearances": asset_apps,
                "document_appearances": [
                    {
                        "ref_document": parent_name,
                        "axis_mappings": _axis_mappings_from_sp(sp, parent_name),
                        "boundary_point_mappings": _boundary_mappings_doc(rel_bbox, parent_name),
                    }
                ],
                "entity_appearances": [],
            }
            entity_spaces.append(entry)

        elif sp["type"] == "PointSpace":
            pt = sp.get("point", {"x": 0.5, "y": 0.5})
            rel_pt = to_parent_relative_point(pt, parent_sp)

            asset_apps = []
            if sp.get("target_asset"):
                asset_apps = [{"asset": asset_name, "axis_mappings": _axis_mappings_from_sp(sp, asset_name, use_asset=True)}]

            entry = {
                "class": "PointSpace",
                "name": sname,
                "metadata": {"comment": sp.get("comment", "")},
                "asset_appearances": asset_apps,
                "document_appearances": [
                    {
                        "ref_document": parent_name,
                        "axis_mappings": _axis_mappings_from_sp(sp, parent_name),
                        "boundary_point_mappings": _boundary_mappings_point(parent_name),
                        "point": {
                            "normalized_x": round(rel_pt.get("x", 0.5), 5),
                            "normalized_y": round(rel_pt.get("y", 0.5), 5),
                            "topo_x": _topo_file_x(rel_pt.get("x", 0.5)),
                            "topo_y": _topo_file_y(rel_pt.get("y", 0.5)),
                        },
                    }
                ],
            }
            entity_spaces.append(entry)

        elif sp["type"] in ("LineSpace", "VectorSpace"):  # VectorSpace is the legacy name
            s_pt = sp.get("start", {"x": 0.0, "y": 0.5, "z": 0.5})
            e_pt = sp.get("end",   {"x": 1.0, "y": 0.5, "z": 0.5})
            rel_s = to_parent_relative_point(s_pt, parent_sp)
            rel_e = to_parent_relative_point(e_pt, parent_sp)
            entry = {
                "class": "LineSpace",
                "name": sname,
                "metadata": {"comment": sp.get("comment", "")},
                "dashed": sp.get("dashed", False),
                "document_appearances": [
                    {
                        "ref_document": parent_name,
                        "start_point": {
                            "normalized_x": round(rel_s.get("x", 0.0), 5),
                            "normalized_y": round(rel_s.get("y", 0.5), 5),
                            "normalized_z": round(s_pt.get("z", 0.5), 5),
                            "topo_x": _topo_file_x(rel_s.get("x", 0.0)),
                            "topo_y": _topo_file_y(rel_s.get("y", 0.5)),
                            "topo_z": _topo_asset_z(s_pt.get("z", 0.5)),
                        },
                        "end_point": {
                            "normalized_x": round(rel_e.get("x", 1.0), 5),
                            "normalized_y": round(rel_e.get("y", 0.5), 5),
                            "normalized_z": round(e_pt.get("z", 0.5), 5),
                            "topo_x": _topo_file_x(rel_e.get("x", 1.0)),
                            "topo_y": _topo_file_y(rel_e.get("y", 0.5)),
                            "topo_z": _topo_asset_z(e_pt.get("z", 0.5)),
                        },
                    }
                ],
            }
            entity_spaces.append(entry)

    return {"asset": asset_entry, "document_spaces": document_spaces, "entity_spaces": entity_spaces}


def _export_space_to_entity(sp, entity_spaces, spaces, doc_space_name, meta, ext):
    """Helper to export a single space (used for PointSpace children)."""
    parent_id = sp.get("parent_id")
    parent_sp = spaces.get(parent_id) if parent_id else None
    parent_name = parent_sp["name"] if parent_sp else doc_space_name
    sname = sp.get("name", sp["id"])
    if sp["type"] == "DocumentSpace":
        bbox = sp.get("bbox", {"left": 0, "top": 0, "right": 1, "bottom": 1})
        rel_bbox = to_parent_relative_bbox(bbox, parent_sp)
        entry = {
            "class": "AreaSpace",
            "name": sname,
            "metadata": {"comment": sp.get("comment", "")},
            "document_appearances": [
                {
                    "ref_document": parent_name,
                    "axis_mappings": _axis_mappings_from_sp(sp, parent_name),
                    "boundary_point_mappings": _boundary_mappings_doc(rel_bbox, parent_name),
                }
            ],
        }
        entity_spaces.append(entry)


# ── RDF Export ──────────────────────────────────────────────────

# Module-level cache for ontology prefix map (refreshed on demand)
_ONTOLOGY_PREFIX_CACHE: dict | None = None

def _ontology_prefix_map() -> dict:
    """Load prefix→IRI mapping from ontologies.json (module-level cached)."""
    global _ONTOLOGY_PREFIX_CACHE
    if _ONTOLOGY_PREFIX_CACHE is not None:
        return _ONTOLOGY_PREFIX_CACHE
    import json as _json
    from app.config import BASE_DIR
    ont_file = BASE_DIR / "ontologies.json"
    result: dict = {}
    if ont_file.exists():
        try:
            data = _json.loads(ont_file.read_text(encoding="utf-8"))
            for ont in (data if isinstance(data, list) else []):
                pfx = (ont.get("mainPrefix") or "").strip()
                ns  = (ont.get("name") or "").strip()
                if pfx and ns.startswith("http"):
                    if not ns.endswith(("#", "/")):
                        ns += "#"
                    result[pfx] = ns
                for k, v in (ont.get("prefixes") or {}).items():
                    k = k.strip(); v = (v or "").strip()
                    if k and v.startswith("http") and k not in result:
                        result[k] = v
        except Exception:
            pass
    _ONTOLOGY_PREFIX_CACHE = result
    return result


def _inject_missing_prefixes(out: list) -> list:
    """Scan TTL lines for used-but-undeclared prefixes and inject @prefix declarations."""
    import re as _re2
    _SKIP = {"http", "https", "ftp", "urn", "mailto"}

    # Collect already-declared prefixes
    declared: set = set()
    for ln in out:
        m = _re2.match(r"@prefix\s+([\w-]*):", ln)
        if m:
            declared.add(m.group(1))

    # Collect all prefix tokens used in non-@prefix lines
    used: set = set()
    for ln in out:
        if ln.startswith("@prefix"):
            continue
        for pfx in _re2.findall(r"\b([a-zA-Z][\w-]*):", ln):
            if pfx not in _SKIP and pfx not in declared:
                used.add(pfx)

    if not used:
        return out

    known = _ontology_prefix_map()
    new_decls = []
    for pfx in sorted(used):
        iri = known.get(pfx)
        if iri:
            # Ensure IRI ends with '>' and line ends with ' .'
            iri_str = str(iri)
            if not iri_str.endswith('>'):
                if not iri_str.endswith(('>', '#', '/')):
                    iri_str += '#'
                iri_str = f"<{iri_str}>"
            width = max(8, len(pfx) + 2)
            new_decls.append(f"@prefix {(pfx + ': ').ljust(width)}{iri_str} .")

    if not new_decls:
        return out

    # Insert new @prefix lines after the last existing @prefix line
    last_prefix_idx = -1
    for i, ln in enumerate(out):
        if ln.startswith("@prefix"):
            last_prefix_idx = i

    result = list(out)
    for i, decl in enumerate(new_decls):
        result.insert(last_prefix_idx + 1 + i, decl)
    return result


def generate_rdf(project: Dict, extra_spaces: Dict = None) -> str:
    import re as _re

    def _safe(name: str) -> str:
        # Keep Unicode letters/digits/underscores/hyphens/dots — valid in Turtle 1.1 local names.
        # Only replace whitespace and chars truly invalid in Turtle local names with _.
        s = str(name).strip() or "Space"
        s = _re.sub(r'[\s\x00-\x1f"#<>{}|\\\^`\[\]/]', '_', s)
        return s or "Space"

    def _esc(s: str) -> str:
        return (str(s)
                .replace("\\", "\\\\")
                .replace('"', '\\"')
                .replace("\n", "\\n")
                .replace("\r", "\\r"))

    def _hdr(label: str) -> str:
        return f"# ----------------------- {label} ----------------------- #"

    def _lbl(s: str) -> str:
        """Human-readable label: replace underscores with spaces, then escape for TTL."""
        return _esc(str(s).replace('_', ' '))
    project_for_export = dict(project)
    project_for_export["spaces"] = {**project.get("spaces", {}), **(extra_spaces or {})}
    return generate_rdf_merged([project_for_export])

    spaces = project.get("spaces", {})
    _spaces_lookup = {**spaces, **(extra_spaces or {})}
    meta = project.get("meta", {})
    fname = project.get("original_name", "unknown")
    disp = meta.get("display_name") or fname
    asset_n = "AssetSpace"   # single shared instance across all files
    doc_n = _safe(disp)

    id_to_safe = {sid: _safe(sp.get("name", sid)) for sid, sp in spaces.items()}
    children_map = {sid: [] for sid in spaces}
    for sid, sp in spaces.items():
        pid = sp.get("parent_id")
        if pid and pid in children_map:
            children_map[pid].append(sid)

    out = []
    ap_out = []  # Collects all appearance/mapping triples for the # Appearances # section

    out += [
        "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
        "@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .",
        "@prefix owl:    <http://www.w3.org/2002/07/owl#> .",
        "@prefix xs:     <http://www.w3.org/2001/XMLSchema#> .",
        "@prefix spot:   <https://w3id.org/spot#> .",
        "@prefix spot-am: <https://w3id.org/spot/am#> .",
        "@prefix reloc:  <https://w3id.org/reloc#> .",
        "@prefix :       <http://example.org/> .",
        "",
        f"# \u2500\u2500 Exported from: {fname} ({project.get('width','?')}\u00d7{project.get('height','?')} px) \u2500\u2500",
        "",
    ]

    out += [
        _hdr("Space Classes"),
        "spot:DocumentSpace a owl:Class ;",
        "    rdfs:label \"DocumentSpace\" .",
        "",
        "spot:EntitySpace a owl:Class ;",
        "    rdfs:label \"EntitySpace\" .",
        "",
        "spot:PointSpace a owl:Class ;",
        "    rdfs:label \"PointSpace\" .",
        "",
        "spot:LineSpace a owl:Class ;",
        "    rdfs:label \"LineSpace\" .",
        "",
        "spot:VolumeSpace a owl:Class ;",
        "    rdfs:label \"VolumeSpace\" .",
        "",
        "spot:AssetSpace a owl:Class ;",
        "    rdfs:label \"AssetSpace\" .",
        "",
    ]

    out += [
        _hdr("Asset Space"),
        f":AssetSpace a spot:AssetSpace ;",
        f"    rdfs:label \"Asset Space\" ;",
        f"    spot:hasXAxis :AssetSpace_AxisX ;",
        f"    spot:hasYAxis :AssetSpace_AxisY ;",
        f"    spot:hasZAxis :AssetSpace_AxisZ .",
        "",
        f":AssetSpace_AxisX a spot:Axis ; rdfs:label \"Asset Space X Axis\" ; spot:hasDirection spot:Rear ; spot-am:axisOf :AssetSpace .",
        f":AssetSpace_AxisX_Inv a spot:Axis ; spot-am:axisOf :AssetSpace ; spot-am:inverseOf :AssetSpace_AxisX .",
        f":AssetSpace_AxisY a spot:Axis ; rdfs:label \"Asset Space Y Axis\" ; spot:hasDirection spot:Left ; spot-am:axisOf :AssetSpace .",
        f":AssetSpace_AxisY_Inv a spot:Axis ; spot-am:axisOf :AssetSpace ; spot-am:inverseOf :AssetSpace_AxisY .",
        f":AssetSpace_AxisZ a spot:Axis ; rdfs:label \"Asset Space Z Axis\" ; spot:hasDirection spot:Rear ; spot-am:axisOf :AssetSpace .",
        f":AssetSpace_AxisZ_Inv a spot:Axis ; spot-am:axisOf :AssetSpace ; spot-am:inverseOf :AssetSpace_AxisZ .",
        "",
    ]

    def _ml_refs(pred, items, term):
        """Format a TTL object-list as one IRI per line, aligned after the predicate.
        Returns a list of line strings ready to extend a body/out list."""
        if not items:
            return []
        prefix = f"    {pred} "
        pad    = " " * len(prefix)
        return [
            (prefix if i == 0 else pad) + iri + (" ," if i < len(items) - 1 else f" {term}")
            for i, iri in enumerate(items)
        ]
    def _axis_target_pred(tgt_v: str) -> str:
        return "spot-am:hasInverseTargetAxis" if tgt_v.startswith("inv_") else "spot-am:hasTargetAxis"

    def emit_area(sid, sp, safe, parent_safe, parent_sp, no_entity_block=False, space_cls='spot:DocumentSpace', entity_safe=None):
        sname = sp.get("name", sid)
        cmt = sp.get("comment", "").strip()
        bbox = sp.get("bbox", {"left": 0, "top": 0, "right": 1, "bottom": 1})
        rel = bbox

        # Collect per-axis info
        axes_tgt  = sp.get("axes") or [sp.get("x_axis","x"), sp.get("y_axis","y")]
        axes_src  = sp.get("src_axes") or [("X" if i==0 else "Y" if i==1 else "Z") for i in range(len(axes_tgt))]
        # Build safe IRI fragment for each source axis name
        def src_slug(s): return s.upper().replace(" ","_") or "A"
        ax_iris  = [f"{safe}_Axis{src_slug(n)}" for n in axes_src]
        ax_am    = [f"AM_{safe}_{src_slug(n)}" for n in axes_src]

        # Appearance refs (kept as lists for multi-line formatting)
        app_refs = [f":{a}" for a in ax_am]
        _bpm_parts = [f":BPM_{safe}_X_Min", f":BPM_{safe}_X_Max", f":BPM_{safe}_Y_Min", f":BPM_{safe}_Y_Max"]
        if len(ax_iris) >= 3:
            _bpm_parts += [f":BPM_{safe}_Z_Min", f":BPM_{safe}_Z_Max"]
        bpm_refs = _bpm_parts

        # Space + entity block declarations
        has_asset = sp.get("target_asset")
        if not no_entity_block:
            body = [f":{safe} a {space_cls} ;", f"    rdfs:label \"{_lbl(sname)}\" ;"]
            if cmt:
                body.append(f"    rdfs:comment \"{_esc(cmt)}\" ;")
            for iri, n in zip(ax_iris, axes_src):
                body.append(f"    spot:has{src_slug(n)}Axis :{iri} ;")
            # Direct link to parent space (unless this is root document space)
            if safe != doc_n:
                body.append(f"    spot:appearsIn :{parent_safe} ;")
            # Asset appearance link
            parent_type = parent_sp.get("type", "DocumentSpace") if parent_sp else "DocumentSpace"
            parent_pred = _ap_pred(parent_type)
            if has_asset:
                body.append(f"    {parent_pred} :AP_{safe}_in_{parent_safe} ;")
                body.append(f"    spot:hasAppearance :AP_{safe}_in_{_safe('AssetSpace')} .")
            else:
                body.append(f"    {parent_pred} :AP_{safe}_in_{parent_safe} .")
            out.extend(body + [""])

        # Axis declarations — new format: each axis gets a regular + _Inv variant
        # When this space belongs to an entity, the axis IRI is owned by the entity.
        if not entity_safe:
            bp_suffixes = [("_AxisX_Min", "_AxisX_Max"), ("_AxisY_Min", "_AxisY_Max"), ("_AxisZ_Min", "_AxisZ_Max")]
            for idx, (iri, src_n) in enumerate(zip(ax_iris, axes_src)):
                slug = src_slug(src_n)
                bp_min = f":{safe}_Axis{slug}_Min"
                bp_max = f":{safe}_Axis{slug}_Max"
                out.extend([
                    f":{iri} a spot:Axis ;",
                    f"    rdfs:label \"{_lbl(sname)} {src_n} Axis\" ;",
                    f"    spot-am:axisOf :{safe} ;",
                ] + _ml_refs("spot-am:hasBoundaryPoint", [bp_min, bp_max], "."))
                out.extend([
                    f":{iri}_Inv a spot:Axis ;",
                    f"    spot-am:axisOf :{safe} ;",
                    f"    spot-am:inverseOf :{iri} .",
                    "",
                ])

        # Standalone BP nodes — emitted with space body (before Appearances section)
        if len(ax_iris) >= 1:
            slug0 = src_slug(axes_src[0])
            out.extend([f":{safe}_Axis{slug0}_Min a spot-am:MinBoundaryPoint .",
                        f":{safe}_Axis{slug0}_Max a spot-am:MaxBoundaryPoint .", ""])
        if len(ax_iris) >= 2:
            slug1 = src_slug(axes_src[1])
            out.extend([f":{safe}_Axis{slug1}_Min a spot-am:MinBoundaryPoint .",
                        f":{safe}_Axis{slug1}_Max a spot-am:MaxBoundaryPoint .", ""])
        if len(ax_iris) >= 3:
            slug2 = src_slug(axes_src[2])
            out.extend([f":{safe}_Axis{slug2}_Min a spot-am:MinBoundaryPoint .",
                        f":{safe}_Axis{slug2}_Max a spot-am:MaxBoundaryPoint .", ""])

        # Document appearance → ap_out (Appearances section)
        _ap_sname_lbl = str(sname).replace('_', ' ')
        _ap_psafe_lbl = parent_safe.replace('_', ' ')
        ap_out.append(_hdr(f"{_ap_sname_lbl} in {_ap_psafe_lbl}"))
        ap_body = [
            f":AP_{safe}_in_{parent_safe} a spot:DocumentAppearance ;",
            f"    rdfs:label \"Appearance of {_lbl(sname)} in {_ap_psafe_lbl}\" ;",
            f"    spot:appearsIn :{parent_safe} ;",
        ]
        ap_body.extend(_ml_refs("spot-am:hasBoundaryPointMapping", bpm_refs, "."))
        ap_out.extend(ap_body + [""])

        # Axis mappings — new format: direct :mapsToAxis triples (no AM node)
        _doc_offset_on = sp.get("axis_offset_on") or []
        _doc_offsets   = sp.get("axis_offsets")   or []
        for i, (src_n, tgt_v) in enumerate(zip(axes_src, axes_tgt)):
            tgt_base = tgt_v.replace("inv_","").upper()
            is_inverse = tgt_v.startswith("inv_")
            src_axis_iri = f":{entity_safe}_Axis{src_slug(src_n)}" if entity_safe else f":{ax_iris[i]}"
            # Source → target (forward mapping)
            if is_inverse:
                # source maps to target's _Inv; source_Inv maps to target
                ap_out.extend([
                    f"{src_axis_iri} :mapsToAxis :{parent_safe}_Axis{tgt_base}_Inv .",
                    f"{src_axis_iri}_Inv :mapsToAxis :{parent_safe}_Axis{tgt_base} .",
                    "",
                ])
            else:
                ap_out.extend([
                    f"{src_axis_iri} :mapsToAxis :{parent_safe}_Axis{tgt_base} .",
                    f"{src_axis_iri}_Inv :mapsToAxis :{parent_safe}_Axis{tgt_base}_Inv .",
                    "",
                ])

        # Boundary point mappings → ap_out
        def topo_x(v): return _reloc(_topo_file_x(v))
        def topo_y(v): return _reloc(_topo_file_y(v))
        ap_out.extend([
            f":BPM_{safe}_X_Min a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} X Min\" ;",
            f"    spot-am:hasSourcePoint :{safe}_AxisX_Min ;",
            f"    reloc:{topo_x(rel['left'])} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{round(rel['left'], 5)}\"^^xs:decimal .",
            "",
            f":BPM_{safe}_X_Max a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} X Max\" ;",
            f"    spot-am:hasSourcePoint :{safe}_AxisX_Max ;",
            f"    reloc:{topo_x(rel['right'])} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{round(rel['right'], 5)}\"^^xs:decimal .",
            "",
            f":BPM_{safe}_Y_Min a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} Y Min\" ;",
            f"    spot-am:hasSourcePoint :{safe}_AxisY_Min ;",
            f"    reloc:{topo_y(rel['top'])} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{round(rel['top'], 5)}\"^^xs:decimal .",
            "",
            f":BPM_{safe}_Y_Max a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} Y Max\" ;",
            f"    spot-am:hasSourcePoint :{safe}_AxisY_Max ;",
            f"    reloc:{topo_y(rel['bottom'])} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{round(rel['bottom'], 5)}\"^^xs:decimal .",
            "",
        ])

        if len(ax_iris) >= 3:
            z_val = round(sp.get("z", 0.5), 5)
            ap_out.extend([
                f":BPM_{safe}_Z_Min a spot-am:BoundaryPointMapping ;",
                f"    rdfs:label \"BPM {_lbl(sname)} Z Min\" ;",
                f"    spot-am:hasSourcePoint :{safe}_AxisZ_Min ;",
                f"    reloc:{_reloc(_topo_asset_z(z_val))} :{parent_safe} ;",
                f"    spot-am:hasNormalizedCoordinateValue \"{z_val}\"^^xs:decimal .",
                "",
                f":BPM_{safe}_Z_Max a spot-am:BoundaryPointMapping ;",
                f"    rdfs:label \"BPM {_lbl(sname)} Z Max\" ;",
                f"    spot-am:hasSourcePoint :{safe}_AxisZ_Max ;",
                f"    reloc:{_reloc(_topo_asset_z(z_val))} :{parent_safe} ;",
                f"    spot-am:hasNormalizedCoordinateValue \"{z_val}\"^^xs:decimal .",
                "",
            ])

        # Asset appearance → ap_out
        if has_asset:
            a_axes_tgt = sp.get("asset_axes") or ["x","y","z"]
            a_axes_src = sp.get("asset_src_axes") or [("X" if i==0 else "Y" if i==1 else "Z") for i in range(len(a_axes_tgt))]
            a_ax_am      = [f"AM_{safe}_Asset_{src_slug(n)}" for n in a_axes_src]
            a_ax_am_iris = [f":{a}" for a in a_ax_am]
            asset_bp = sp.get("asset_bp")
            a_bpm_iris = ([f":BPM_{safe}_Asset_X_Min", f":BPM_{safe}_Asset_X_Max",
                           f":BPM_{safe}_Asset_Y_Min", f":BPM_{safe}_Asset_Y_Max"]
                          if asset_bp else [])
            ap_out.append(_hdr(f"{str(sname).replace('_', ' ')} in AssetSpace"))
            ap_out.extend([
                f":AP_{safe}_in_{_safe('AssetSpace')} a spot:AssetAppearance ;",
                f"    rdfs:label \"Appearance of {_lbl(sname)} in AssetSpace\" ;",
                f"    spot:appearsIn :AssetSpace ;",
            ])
            if a_bpm_iris:
                ap_out[-1] = ap_out[-1][:-1] + " ;"
                ap_out.extend(_ml_refs("spot-am:hasBoundaryPointMapping", a_bpm_iris, "."))
            ap_out.append("")
            _asset_offset_on = sp.get("asset_axis_offset_on") or []
            _asset_offsets   = sp.get("asset_axis_offsets")   or []
            for _i, (src_n, tgt_v) in enumerate(zip(a_axes_src, a_axes_tgt)):
                tgt_base = tgt_v.replace("inv_","").upper()
                src_iri  = [a for a in ax_iris if a.endswith(src_slug(src_n))]
                src_iri  = src_iri[0] if src_iri else f"{safe}_Axis{src_slug(src_n)}"
                is_inverse = tgt_v.startswith("inv_")
                if is_inverse:
                    ap_out.extend([
                        f":{src_iri} :mapsToAxis :AssetSpace_Axis{tgt_base}_Inv .",
                        f":{src_iri}_Inv :mapsToAxis :AssetSpace_Axis{tgt_base} .",
                        "",
                    ])
                else:
                    ap_out.extend([
                        f":{src_iri} :mapsToAxis :AssetSpace_Axis{tgt_base} .",
                        f":{src_iri}_Inv :mapsToAxis :AssetSpace_Axis{tgt_base}_Inv .",
                        "",
                    ])
            if asset_bp:
                _bp_l = round(float(asset_bp.get("left",   0)), 5)
                _bp_r = round(float(asset_bp.get("right",  1)), 5)
                _bp_t = round(float(asset_bp.get("top",    0)), 5)
                _bp_b = round(float(asset_bp.get("bottom", 1)), 5)
                ap_out.extend([
                    f":BPM_{safe}_Asset_X_Min a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} X Min\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisX_Min ;",
                    f"    reloc:{_reloc(_topo_file_x(_bp_l))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_l}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_X_Max a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} X Max\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisX_Max ;",
                    f"    reloc:{_reloc(_topo_file_x(_bp_r))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_r}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_Y_Min a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} Y Min\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisY_Min ;",
                    f"    reloc:{_reloc(_topo_file_y(_bp_t))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_t}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_Y_Max a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} Y Max\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisY_Max ;",
                    f"    reloc:{_reloc(_topo_file_y(_bp_b))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_b}\"^^xs:decimal .",
                    "",
                ])

    def emit_point(sid, sp, safe, parent_safe, parent_sp, no_entity_block=False, entity_safe=None):
        sname = sp.get("name", sid)
        cmt = sp.get("comment", "").strip()
        pt = sp.get("point", {"x": 0.5, "y": 0.5, "z": 0.5})
        rx = round(pt.get("x", 0.5), 5)
        ry = round(pt.get("y", 0.5), 5)
        rz = round(pt.get("z", 0.5), 5)

        axes_tgt = sp.get("axes") or ["z"]   # per-space axis selection
        axes_src = sp.get("src_axes") or [("X" if i==0 else "Y" if i==1 else "Z") for i in range(len(axes_tgt))]
        def src_slug(s): return s.upper().replace(" ","_") or "A"
        ax_iris = [f"{safe}_Axis{src_slug(n)}" for n in axes_src]
        ax_am   = [f"AM_{safe}_{src_slug(n)}" for n in axes_src]
        ax_bpm  = [f"BPM_{safe}_{src_slug(n)}" for n in axes_src]

        am_refs  = [f":{a}" for a in ax_am]
        bpm_refs = [f":{a}" for a in ax_bpm]

        has_asset = sp.get("target_asset")
        if not no_entity_block:
            body = [f":{safe} a spot:PointSpace ;", f"    rdfs:label \"{_lbl(sname)}\" ;"]
            if cmt:
                body.append(f"    rdfs:comment \"{_esc(cmt)}\" ;")
            for iri, n in zip(ax_iris, axes_src):
                body.append(f"    spot:has{src_slug(n)}Axis :{iri} ;")
            # Direct link to parent space (unless this is root document space)
            if safe != doc_n:
                body.append(f"    spot:appearsIn :{parent_safe} ;")
            parent_type = parent_sp.get("type", "DocumentSpace") if parent_sp else "DocumentSpace"
            parent_pred = _ap_pred(parent_type)
            if has_asset:
                body.append(f"    {parent_pred} :AP_{safe}_in_{parent_safe} ;")
                body.append(f"    spot:hasAppearance :AP_{safe}_in_{_safe('AssetSpace')} .")
            else:
                body.append(f"    {parent_pred} :AP_{safe}_in_{parent_safe} .")
            out.extend(body + [""])

        for iri, src_n in zip(ax_iris, axes_src):
            if not entity_safe:
                out.extend([
                    f":{iri} a spot:Axis ;",
                    f"    rdfs:label \"{_lbl(sname)} {src_n} Axis\" ;",
                    f"    spot-am:axisOf :{safe} ;",
                    f"    spot-am:hasBoundaryPoint :{iri}_BP .",
                    f":{iri}_Inv a spot:Axis ;",
                    f"    spot-am:axisOf :{safe} ;",
                    f"    spot-am:inverseOf :{iri} .",
                ])
                out.extend([
                    f":{iri}_BP a spot-am:BoundaryPoint .",
                    "",
                ])

        ap_out.append(_hdr(f"{str(sname).replace('_', ' ')} in {parent_safe.replace('_', ' ')}"))
        ap_body = [
            f":AP_{safe}_in_{parent_safe} a spot:DocumentAppearance ;",
            f"    rdfs:label \"Appearance of {_lbl(sname)} in {parent_safe.replace("_", " ")}\" ;",
            f"    spot:appearsIn :{parent_safe} ;",
        ]
        if bpm_refs:
            ap_body.extend(_ml_refs("spot-am:hasBoundaryPointMapping", bpm_refs, "."))
        else:
            ap_body[-1] = ap_body[-1].rstrip(" ;") + " ."
        ap_out.extend(ap_body + [""])

        coord_map = {"X": rx, "Y": ry, "Z": rz}
        topo_map  = {"X": _topo_file_x(rx), "Y": _topo_file_y(ry), "Z": _topo_asset_z(rz)}
        reloc_map = {"X": _reloc(_topo_file_x(rx)), "Y": _reloc(_topo_file_y(ry)), "Z": _reloc(_topo_asset_z(rz))}

        _pt_offset_on = sp.get("axis_offset_on") or []
        _pt_offsets   = sp.get("axis_offsets")   or []
        for _i, (src_n, tgt_v, iri, am_iri, bpm_iri) in enumerate(zip(axes_src, axes_tgt, ax_iris, ax_am, ax_bpm)):
            tgt_base = tgt_v.replace("inv_","").upper()
            is_inverse = tgt_v.startswith("inv_")
            src_axis_iri = f":{entity_safe}_Axis{src_slug(src_n)}" if entity_safe else f":{iri}"
            if is_inverse:
                ap_out.extend([
                    f"{src_axis_iri} :mapsToAxis :{parent_safe}_Axis{tgt_base}_Inv .",
                    f"{src_axis_iri}_Inv :mapsToAxis :{parent_safe}_Axis{tgt_base} .",
                    "",
                ])
            else:
                ap_out.extend([
                    f"{src_axis_iri} :mapsToAxis :{parent_safe}_Axis{tgt_base} .",
                    f"{src_axis_iri}_Inv :mapsToAxis :{parent_safe}_Axis{tgt_base}_Inv .",
                    "",
                ])

            coord_val = coord_map.get(src_n.upper(), 0.5)
            reloc_val = reloc_map.get(src_n.upper(), "containedIn")
            if entity_safe:
                ap_out.extend([f":{iri}_BP a spot-am:BoundaryPoint .", ""])
            ap_out.extend([
                f":{bpm_iri} a spot-am:BoundaryPointMapping ;",
                f"    spot-am:hasSourcePoint :{iri}_BP ;",
                f"    reloc:{reloc_val} :{parent_safe} ;",
                f"    spot-am:hasNormalizedCoordinateValue \"{coord_val}\"^^xs:decimal .",
                "",
            ])

        # Asset appearance → ap_out
        if has_asset:
            a_axes_tgt = sp.get("asset_axes") or ["x","y","z"]
            a_axes_src = sp.get("asset_src_axes") or [("X" if i==0 else "Y" if i==1 else "Z") for i in range(len(a_axes_tgt))]
            asset_bp = sp.get("asset_bp")
            a_bpm_iris = ([f":BPM_{safe}_Asset_X_Min", f":BPM_{safe}_Asset_X_Max",
                           f":BPM_{safe}_Asset_Y_Min", f":BPM_{safe}_Asset_Y_Max"]
                          if asset_bp else [])
            ap_out.append(_hdr(f"{str(sname).replace('_', ' ')} in AssetSpace"))
            ap_out.extend([
                f":AP_{safe}_in_{_safe('AssetSpace')} a spot:AssetAppearance ;",
                f"    rdfs:label \"Appearance of {_lbl(sname)} in AssetSpace\" ;",
                f"    spot:appearsIn :AssetSpace ;",
            ])
            if a_bpm_iris:
                ap_out[-1] = ap_out[-1][:-1] + " ;"
                ap_out.extend(_ml_refs("spot-am:hasBoundaryPointMapping", a_bpm_iris, "."))
            ap_out.append("")
            _asset_offset_on = sp.get("asset_axis_offset_on") or []
            _asset_offsets   = sp.get("asset_axis_offsets")   or []
            for _i, (src_n, tgt_v) in enumerate(zip(a_axes_src, a_axes_tgt)):
                tgt_base = tgt_v.replace("inv_","").upper()
                src_iri  = [a for a in ax_iris if a.endswith(src_slug(src_n))]
                src_iri  = src_iri[0] if src_iri else f"{safe}_Axis{src_slug(src_n)}"
                is_inverse = tgt_v.startswith("inv_")
                if is_inverse:
                    ap_out.extend([
                        f":{src_iri} :mapsToAxis :AssetSpace_Axis{tgt_base}_Inv .",
                        f":{src_iri}_Inv :mapsToAxis :AssetSpace_Axis{tgt_base} .",
                        "",
                    ])
                else:
                    ap_out.extend([
                        f":{src_iri} :mapsToAxis :AssetSpace_Axis{tgt_base} .",
                        f":{src_iri}_Inv :mapsToAxis :AssetSpace_Axis{tgt_base}_Inv .",
                        "",
                    ])
            if asset_bp:
                _bp_l = round(float(asset_bp.get("left",   0)), 5)
                _bp_r = round(float(asset_bp.get("right",  1)), 5)
                _bp_t = round(float(asset_bp.get("top",    0)), 5)
                _bp_b = round(float(asset_bp.get("bottom", 1)), 5)
                ap_out.extend([
                    f":BPM_{safe}_Asset_X_Min a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} X Min\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisX_Min ;",
                    f"    reloc:{_reloc(_topo_file_x(_bp_l))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_l}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_X_Max a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} X Max\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisX_Max ;",
                    f"    reloc:{_reloc(_topo_file_x(_bp_r))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_r}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_Y_Min a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} Y Min\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisY_Min ;",
                    f"    reloc:{_reloc(_topo_file_y(_bp_t))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_t}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_Y_Max a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} Y Max\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisY_Max ;",
                    f"    reloc:{_reloc(_topo_file_y(_bp_b))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_b}\"^^xs:decimal .",
                    "",
                ])

    def emit_line(sid, sp, safe, parent_safe, parent_sp, no_entity_block=False):
        sname = sp.get("name", sid)
        cmt = sp.get("comment", "").strip()
        s_pt = sp.get("start", {"x": 0.3, "y": 0.5, "z": 0.5})
        e_pt = sp.get("end",   {"x": 0.7, "y": 0.5, "z": 0.5})
        sx = round(s_pt.get("x", 0.3), 5)
        sy = round(s_pt.get("y", 0.5), 5)
        sz = round(s_pt.get("z", 0.5), 5)
        ex = round(e_pt.get("x", 0.7), 5)
        ey = round(e_pt.get("y", 0.5), 5)
        ez = round(e_pt.get("z", 0.5), 5)

        axes_tgt = sp.get("axes") or ["x"]
        axes_src = sp.get("src_axes") or ["X"]
        def src_slug(s): return s.upper().replace(" ", "_") or "A"

        # First (main) axis always gets 2 BPs (Min + Max); secondary axes get 1 BP
        main_tgt      = axes_tgt[0] if axes_tgt else "x"
        main_tgt_base = main_tgt.replace("inv_", "")
        main_src      = src_slug(axes_src[0] if axes_src else "X")

        # Derive min/max coords for the main axis from start/end points
        if main_tgt_base == "x":
            min_coord = round(min(sx, ex), 5);  max_coord = round(max(sx, ex), 5)
            topo_min  = _reloc(_topo_file_x(min_coord))
            topo_max  = _reloc(_topo_file_x(max_coord))
        elif main_tgt_base == "y":
            min_coord = round(min(sy, ey), 5);  max_coord = round(max(sy, ey), 5)
            topo_min  = _reloc(_topo_file_y(min_coord))
            topo_max  = _reloc(_topo_file_y(max_coord))
        elif main_tgt_base == "z":
            min_coord = round(min(sz, ez), 5);  max_coord = round(max(sz, ez), 5)
            topo_min  = _reloc(_topo_asset_z(min_coord))
            topo_max  = _reloc(_topo_asset_z(max_coord))
        else:
            min_coord = round(min(sx, ex), 5);  max_coord = round(max(sx, ex), 5)
            topo_min  = _reloc(_topo_file_x(min_coord))
            topo_max  = _reloc(_topo_file_x(max_coord))

        if not no_entity_block:
            body = [f":{safe} a spot:LineSpace ;", f"    rdfs:label \"{_lbl(sname)}\" ;"]
            if cmt:
                body.append(f"    rdfs:comment \"{_esc(cmt)}\" ;")
            for i, src_n in enumerate(axes_src):
                slug = src_slug(src_n)
                body.append(f"    spot:has{slug}Axis :{safe}_Axis{slug} ;")
            # Direct link to parent space (unless this is root document space)
            if safe != doc_n:
                body.append(f"    spot:appearsIn :{parent_safe} ;")
            lp_type = parent_sp.get("type", "DocumentSpace") if parent_sp else "DocumentSpace"
            lp_pred = _ap_pred(lp_type)
            body.append(f"    {lp_pred} :AP_{safe}_in_{parent_safe} .")
            out.extend(body + [""])

            # Main axis — 2 BPs
            out.extend([
                f":{safe}_Axis{main_src} a spot:Axis ;",
                f"    rdfs:label \"{_lbl(sname)} {axes_src[0] if axes_src else 'X'} Axis\" ;",
                f"    spot-am:axisOf :{safe} ;",
                f"    spot-am:hasBoundaryPoint :{safe}_Axis{main_src}_Min , :{safe}_Axis{main_src}_Max .",
                f":{safe}_Axis{main_src}_Inv a spot:Axis ;",
                f"    spot-am:axisOf :{safe} ;",
                f"    spot-am:inverseOf :{safe}_Axis{main_src} .",
                "",
                f":{safe}_Axis{main_src}_Min a spot-am:MinBoundaryPoint .",
                f":{safe}_Axis{main_src}_Max a spot-am:MaxBoundaryPoint .",
                "",
            ])
            # Secondary axes — 1 BP each
            for src_n in axes_src[1:]:
                slug = src_slug(src_n)
                out.extend([
                    f":{safe}_Axis{slug} a spot:Axis ;",
                    f"    rdfs:label \"{_lbl(sname)} {src_n} Axis\" ;",
                    f"    spot-am:axisOf :{safe} ;",
                    f"    spot-am:hasBoundaryPoint :{safe}_Axis{slug}_BP .",
                    f":{safe}_Axis{slug}_Inv a spot:Axis ;",
                    f"    spot-am:axisOf :{safe} ;",
                    f"    spot-am:inverseOf :{safe}_Axis{slug} .",
                    "",
                    f":{safe}_Axis{slug}_BP a spot-am:BoundaryPoint .",
                    "",
                ])

        # Appearance
        bpm_iris = [f":BPM_{safe}_{main_src}_Min", f":BPM_{safe}_{main_src}_Max"]
        for src_n in axes_src[1:]:
            bpm_iris.append(f":BPM_{safe}_{src_slug(src_n)}_BP")

        ap_out.append(_hdr(f"{str(sname).replace('_', ' ')} in {parent_safe.replace('_', ' ')}"))
        ap_body = [
            f":AP_{safe}_in_{parent_safe} a spot:DocumentAppearance ;",
            f"    rdfs:label \"Appearance of {_lbl(sname)} in {parent_safe.replace("_", " ")}\" ;",
            f"    spot:appearsIn :{parent_safe} ;",
        ]
        ap_body.extend(_ml_refs("spot-am:hasBoundaryPointMapping", bpm_iris, "."))
        ap_out.extend(ap_body + [""])

        # Axis mappings — new format: direct :mapsToAxis triples
        for i, (src_n, tgt_v) in enumerate(zip(axes_src, axes_tgt)):
            tgt_base  = tgt_v.replace("inv_", "").upper()
            is_inverse = tgt_v.startswith("inv_")
            ax_iri    = f"{safe}_Axis{src_slug(src_n)}"
            if is_inverse:
                ap_out.extend([
                    f":{ax_iri} :mapsToAxis :{parent_safe}_Axis{tgt_base}_Inv .",
                    f":{ax_iri}_Inv :mapsToAxis :{parent_safe}_Axis{tgt_base} .",
                    "",
                ])
            else:
                ap_out.extend([
                    f":{ax_iri} :mapsToAxis :{parent_safe}_Axis{tgt_base} .",
                    f":{ax_iri}_Inv :mapsToAxis :{parent_safe}_Axis{tgt_base}_Inv .",
                    "",
                ])

        # BPMs for main axis (Min + Max)
        ap_out.extend([
            f":BPM_{safe}_{main_src}_Min a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} {axes_src[0] if axes_src else 'X'} Min\" ;",
            f"    spot-am:hasSourcePoint :{safe}_Axis{main_src}_Min ;",
            f"    reloc:{topo_min} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{min_coord}\"^^xs:decimal .",
            "",
            f":BPM_{safe}_{main_src}_Max a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} {axes_src[0] if axes_src else 'X'} Max\" ;",
            f"    spot-am:hasSourcePoint :{safe}_Axis{main_src}_Max ;",
            f"    reloc:{topo_max} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{max_coord}\"^^xs:decimal .",
            "",
        ])
        # BPMs for secondary axes (1 BP each — midpoint of perpendicular)
        for i, src_n in enumerate(axes_src[1:], start=1):
            slug    = src_slug(src_n)
            sec_tgt = axes_tgt[i] if i < len(axes_tgt) else "y"
            sec_base = sec_tgt.replace("inv_", "")
            if sec_base == "x":
                perp_coord = round((sx + ex) / 2, 5)
                topo_perp  = _reloc(_topo_file_x(perp_coord))
            elif sec_base == "y":
                perp_coord = round((sy + ey) / 2, 5)
                topo_perp  = _reloc(_topo_file_y(perp_coord))
            elif sec_base == "z":
                perp_coord = round((sz + ez) / 2, 5)
                topo_perp  = _reloc(_topo_asset_z(perp_coord))
            else:
                perp_coord = round((sy + ey) / 2, 5)
                topo_perp  = _reloc(_topo_file_y(perp_coord))
            ap_out.extend([
                f":BPM_{safe}_{slug}_BP a spot-am:BoundaryPointMapping ;",
                f"    rdfs:label \"BPM {_lbl(sname)} {src_n} BP\" ;",
                f"    spot-am:hasSourcePoint :{safe}_Axis{slug}_BP ;",
                f"    reloc:{topo_perp} :{parent_safe} ;",
                f"    spot-am:hasNormalizedCoordinateValue \"{perp_coord}\"^^xs:decimal .",
                "",
            ])

    # ── Deduplication: merge spaces sharing the same entity name ──
    def _src_axis_slugs_for(sid, sp):
        """Return list of canonical axis slugs (e.g. ['X','Y','Z']) used by this space."""
        axes_src = sp.get("src_axes") or [
            ("X" if i == 0 else "Y" if i == 1 else "Z")
            for i in range(len(sp.get("axes") or ["x", "y"]))
        ]
        def _sl(s): return s.upper().replace(" ", "_") or "A"
        return [_sl(n) for n in axes_src]

    entity_groups: dict = {}
    _ea_ap_pending: list = []  # EA AP blocks flushed into ap_out before Appearances header
    for sid, sp in spaces.items():
        ent = (sp.get("entity") or "").strip()
        if not ent:
            continue
        ent_safe = _safe(ent)
        if ent_safe not in entity_groups:
            entity_groups[ent_safe] = {
                "name": ent,
                "type": sp.get("type", "DocumentSpace"),
                "canonical_axes": set(),
                "ap_entries": [],
                "appearances": [],
            }
        for slug in _src_axis_slugs_for(sid, sp):
            entity_groups[ent_safe]["canonical_axes"].add(slug)
        space_safe = id_to_safe[sid]
        space_name = sp.get("name", sid)
        ea_ap_iri  = f"AP_{ent_safe}_in_{space_safe}"
        entity_groups[ent_safe]["appearances"].append({
            "ap_iri": ea_ap_iri, "space_safe": space_safe, "space_name": space_name
        })
        entity_groups[ent_safe]["ap_entries"].append((ea_ap_iri, "spot:hasAppearance"))

    _cls_map = {
        "DocumentSpace": "spot:DocumentSpace",
        "PointSpace": "spot:PointSpace",
        "LineSpace": "spot:LineSpace",
        "VectorSpace": "spot:LineSpace",
        "VolumeSpace": "spot:VolumeSpace",
    }
    if entity_groups:
        out.append(_hdr("EntitySpaces"))
    def _emit_ap_entries(body, ap_entries):
        pred_groups: dict = {}
        for iri, pred in ap_entries:
            pred_groups.setdefault(pred, []).append(iri)
        pg_items = list(pred_groups.items())
        for i, (pred, iris) in enumerate(pg_items):
            is_last = (i == len(pg_items) - 1)
            if len(iris) == 1:
                body.append(f"    {pred} :{iris[0]} {'.' if is_last else ';'}")
            else:
                body.append(f"    {pred} :{iris[0]} ,")
                for ap in iris[1:-1]:
                    body.append(f"                       :{ap} ,")
                body.append(f"                       :{iris[-1]} {'.' if is_last else ';'}")

    for ent_safe, eg in entity_groups.items():
        ap_entries = eg["ap_entries"]
        
        # Build direct appearance links as entries (for inclusion in entity block)
        direct_app_entries = [
            (app["space_safe"], "spot:appearsIn")
            for app in eg.get("appearances", [])
        ]
        # Combine all entries: axes, direct appearances, then hasAppearance
        combined_entries = (
            [(f"{ent_safe}_Axis{slug}", f"spot:has{slug}Axis") for slug in sorted(eg["canonical_axes"])]
            + direct_app_entries
            + ap_entries
        )
        
        # If the entity name resolves to the root AssetSpace IRI, don't create a
        # new entity — just patch additional typed appearance triples onto it.
        if ent_safe == asset_n:
            if combined_entries:
                body = [f":{asset_n}"]
                _emit_ap_entries(body, combined_entries)
                out.extend(body + [""])
            continue
        out.append(_hdr(eg["name"]))
        cls = "spot:EntitySpace"
        canonical = sorted(eg["canonical_axes"])  # e.g. ['X', 'Y', 'Z']
        body = [f":{ent_safe} a {cls} ;", f"    rdfs:label \"{_esc(eg['name'])}\" ;"]
        _emit_ap_entries(body, combined_entries)
        out.extend(body + [""])
        # Entity-level class/predicate associations: merge global store with per-file meta
        _global_ec = load_entity_classes()
        _meta_ec   = meta.get("entity_classes", {}).get(ent_safe, [])
        _global_ec_list = _global_ec.get(ent_safe, [])
        # Deduplicate: global takes precedence, then add per-file ones not already present
        seen = {(a.get("pred"), a.get("cls"), (a.get("kind") or "class").lower()) for a in _global_ec_list}
        entity_class_assocs = list(_global_ec_list) + [
            a for a in _meta_ec if (a.get("pred"), a.get("cls"), (a.get("kind") or "class").lower()) not in seen
        ]
        if entity_class_assocs:
            for assoc in entity_class_assocs:
                ec_pred = (assoc.get("pred") or "").strip()
                ec_cls  = (assoc.get("cls")  or "").strip()
                is_instance = (assoc.get("kind") or "").lower() == "instance"
                if ec_pred and ec_cls:
                    # Format object: for instance links, ensure local references are prefixed with ':'
                    formatted_obj = _format_rdf_object(ec_cls, is_instance)
                    out.append(f":{ent_safe} {'a' if ec_pred == 'rdf:type' else ec_pred} {formatted_obj} .")
            out.append("")
        # Canonical axis declarations (one per direction, shared across all appearances)
        for slug in canonical:
            out.extend([
                f":{ent_safe}_Axis{slug} a spot:Axis ;",
                f"    rdfs:label \"{_esc(eg['name'])} {slug} Axis\" ;",
                f"    spot-am:axisOf :{ent_safe} .",
                f":{ent_safe}_Axis{slug}_Inv a spot:Axis ;",
                f"    spot-am:axisOf :{ent_safe} ;",
                f"    spot-am:inverseOf :{ent_safe}_Axis{slug} .",
                "",
            ])
        # Minimal EntityAppearance APs collected here; emitted into ap_out after spaces
        for app in eg.get("appearances", []):
            _ea_ap_pending.append((eg["name"], app))

    def _emit_space_block(sid, sp):
        out.append(_hdr(sp.get("name", sid)))
        safe = id_to_safe[sid]
        pid = sp.get("parent_id")
        parent_sp = spaces.get(pid) if pid else None
        parent_safe = id_to_safe.get(pid, doc_n) if pid else doc_n
        stype = sp.get("type", "DocumentSpace")

        # Appearance spaces always emit their full body and own axes.
        # The entity block links to the space IRI; the space links to its DocumentAppearance.
        if stype == "DocumentSpace":
            emit_area(sid, sp, safe, parent_safe, parent_sp)
        elif stype == "VolumeSpace":
            emit_area(sid, sp, safe, parent_safe, parent_sp, space_cls='spot:VolumeSpace')
        elif stype == "PointSpace":
            emit_point(sid, sp, safe, parent_safe, parent_sp)
        elif stype == "VectorSpace" or stype == "LineSpace":
            emit_line(sid, sp, safe, parent_safe, parent_sp)

        # Class / predicate associations added via the Spaces & Ontology panel
        classes = sp.get("classes") or []
        if classes:
            for assoc in classes:
                pred = (assoc.get("pred") or "").strip()
                cls  = (assoc.get("cls")  or "").strip()
                if pred and cls:
                    out.append(f":{safe} {'a' if pred == 'rdf:type' else pred} {cls} .")
            out.append("")

    doc_spaces = [(sid, sp) for sid, sp in spaces.items() if sp.get("type", "DocumentSpace") == "DocumentSpace"]
    ap_spaces  = [(sid, sp) for sid, sp in spaces.items() if sp.get("type", "DocumentSpace") != "DocumentSpace"]

    # DocumentSpaces: root doc space + all child DocumentSpace-typed spaces
    out.append(_hdr("DocumentSpaces"))
    out += [
        _hdr(disp),
        f":{doc_n} a spot:DocumentSpace ;",
        f"    rdfs:label \"{_esc(disp)}\" ;",
        f"    spot:hasXAxis :{doc_n}_AxisX ;",
        f"    spot:hasYAxis :{doc_n}_AxisY ;",
        f"    spot:hasZAxis :{doc_n}_AxisZ .",
        "",
        f":{doc_n}_AxisX a spot:Axis ; rdfs:label \"{_esc(disp)} X Axis\" ; spot:hasDirection spot:Right .",
        f":{doc_n}_AxisY a spot:Axis ; rdfs:label \"{_esc(disp)} Y Axis\" ; spot:hasDirection spot:Bottom .",
        f":{doc_n}_AxisZ a spot:Axis ; rdfs:label \"{_esc(disp)} Z Axis\" ; spot:hasDirection spot:Rear .",
        "",
    ]
    for sid, sp in doc_spaces:
        _emit_space_block(sid, sp)

    # Spaces: all property-panel appearance spaces
    if ap_spaces:
        out.append(_hdr("Spaces"))
    for sid, sp in ap_spaces:
        _emit_space_block(sid, sp)

    # Appearances: all AP instances, AxisMappings, BPMs
    # Flush minimal EntityAppearance APs (entity → space) into ap_out first
    for _ea_name, _ea_app in _ea_ap_pending:
        ap_out.extend([
            _hdr(f"{str(_ea_name).replace('_', ' ')} in {str(_ea_app['space_name']).replace('_', ' ')}"),  # appearance
            f":{_ea_app['ap_iri']} a spot:EntityAppearance ;",
            f"    rdfs:label \"Appearance of {_esc(_ea_name)} in {_esc(_ea_app['space_name'])}\" ;",
            f"    spot:appearsIn :{_ea_app['space_safe']} .",
            "",
        ])
    if ap_out:
        out.append(_hdr("Appearances"))
    out.extend(ap_out)

    # Inject @prefix declarations for any extra ontology prefixes used in class associations
    out = _inject_missing_prefixes(out)

    # ── Post-process: expand inline semicolons for readability ──────────────
    formatted = []
    for line in out:
        stripped = line.strip()
        if ' ; ' in line and not stripped.startswith('#') and stripped:
            # Determine leading indent from first character
            lead_indent = len(line) - len(line.lstrip())
            lead = ' ' * lead_indent
            cont = lead + '    '  # continuation indent
            parts = line.split(' ; ')
            formatted.append(lead + parts[0].strip() + ' ;')
            for part in parts[1:-1]:
                formatted.append(cont + part.strip() + ' ;')
            last = parts[-1].strip()
            formatted.append(cont + last)
        else:
            formatted.append(line)

    return "\n".join(formatted)


def generate_rdf_merged(projects_list: list) -> str:
    """Generate a single unified TTL from multiple projects (folder/env mode).

    All entities that share the same name are merged into one block with all
    appearances from every file.  Document-space headers, Space-Classes and
    Asset-Space preambles appear only once.
    """
    import re as _re

    # ── shared helpers (identical to generate_rdf) ──────────────────────────
    def _safe(name: str) -> str:
        s = str(name).strip() or "Space"
        s = _re.sub(r'[\s\x00-\x1f"#<>{}|\\\^`\[\]/]', '_', s)
        return s or "Space"

    def _esc(s: str) -> str:
        return (str(s)
                .replace("\\", "\\\\")
                .replace('"', '\\"')
                .replace("\n", "\\n")
                .replace("\r", "\\r"))

    def _hdr(label: str) -> str:
        return f"# ----------------------- {label} ----------------------- #"

    def _lbl(s: str) -> str:
        """Human-readable label: replace underscores with spaces, then escape for TTL."""
        return _esc(str(s).replace('_', ' '))

    def _ml_refs(pred, items, term):
        if not items:
            return []
        prefix = f"    {pred} "
        pad    = " " * len(prefix)
        return [
            (prefix if i == 0 else pad) + iri + (" ," if i < len(items) - 1 else f" {term}")
            for i, iri in enumerate(items)
        ]

    def _axis_target_pred(tgt_v: str) -> str:
        return "spot-am:hasInverseTargetAxis" if tgt_v.startswith("inv_") else "spot-am:hasTargetAxis"

    def _fmt_dec(v) -> str:
        num = float(v)
        text = f"{num:.5f}"
        return "0.00000" if text == "-0.00000" else text

    asset_n = "AssetSpace"

    # ── collect merged data from all projects ────────────────────────────────
    all_spaces: dict  = {}   # sid → sp  (globally unique since IDs are UUIDs)
    sid_to_doc_n: dict = {}  # sid → that project's root doc-space IRI
    project_infos: list = [] # per-project metadata for the header + doc-space blocks

    for proj in projects_list:
        spaces_p = proj.get("spaces", {})
        meta_p   = proj.get("meta", {})
        fname_p  = proj.get("original_name", "unknown")
        disp_p   = meta_p.get("display_name") or fname_p
        doc_n_p  = _safe(disp_p)
        project_infos.append({
            "doc_n":  doc_n_p,
            "disp":   disp_p,
            "fname":  fname_p,
            "width":  proj.get("width", "?"),
            "height": proj.get("height", "?"),
            "spaces": spaces_p,
            "meta":   meta_p,
        })
        for sid, sp in spaces_p.items():
            all_spaces[sid] = sp
            sid_to_doc_n[sid] = doc_n_p

    id_to_safe = {sid: _safe(sp.get("name", sid)) for sid, sp in all_spaces.items()}

    # ── output buffer ────────────────────────────────────────────────────────
    out: list = []
    ap_out: list = []  # Collects all appearance/mapping triples for the # Appearances # section

    # Prefixes (once)
    fnames_str = ", ".join(pi["fname"] for pi in project_infos)
    out += [
        "@prefix rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
        "@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .",
        "@prefix owl:    <http://www.w3.org/2002/07/owl#> .",
        "@prefix xs:     <http://www.w3.org/2001/XMLSchema#> .",
        "@prefix spot:   <https://w3id.org/spot#> .",
        "@prefix spot-am: <https://w3id.org/spot/am#> .",
        "@prefix reloc:  <https://w3id.org/reloc#> .",
        "@prefix :       <http://example.org/> .",
        "",
        f"# \u2500\u2500 Merged export: {len(project_infos)} file(s): {fnames_str} \u2500\u2500",
        "",
    ]

    # Space Classes (once)
    out += [
        _hdr("Space Classes"),
        "spot:DocumentSpace a owl:Class ;",
        "    rdfs:label \"DocumentSpace\" .",
        "",
        "spot:EntitySpace a owl:Class ;",
        "    rdfs:label \"EntitySpace\" .",
        "",
        "spot:PointSpace a owl:Class ;",
        "    rdfs:label \"PointSpace\" .",
        "",
        "spot:LineSpace a owl:Class ;",
        "    rdfs:label \"LineSpace\" .",
        "",
        "spot:VolumeSpace a owl:Class ;",
        "    rdfs:label \"VolumeSpace\" .",
        "",
        "spot:AssetSpace a owl:Class ;",
        "    rdfs:label \"AssetSpace\" .",
        "",
    ]

    # Shared Asset Space (once)
    out += [
        _hdr("Asset Space"),
        f":{asset_n} a spot:AssetSpace ;",
        f"    rdfs:label \"Asset Space\" ;",
        f"    spot:hasXAxis :{asset_n}_AxisX ;",
        f"    spot:hasYAxis :{asset_n}_AxisY ;",
        f"    spot:hasZAxis :{asset_n}_AxisZ .",
        "",
        f":{asset_n}_AxisX a spot:Axis ; rdfs:label \"Asset Space X Axis\" ; spot:hasDirection spot:Rear .",
        f":{asset_n}_AxisY a spot:Axis ; rdfs:label \"Asset Space Y Axis\" ; spot:hasDirection spot:Left .",
        f":{asset_n}_AxisZ a spot:Axis ; rdfs:label \"Asset Space Z Axis\" ; spot:hasDirection spot:Top .",
        "",
    ]

    # ── emit helpers (closures over out, id_to_safe, sid_to_doc_n) ──────────
    def _parent_context(sid, sp):
        """Return (parent_sp | None, parent_safe_iri) for any space in any project."""
        pid = sp.get("parent_id")
        if pid and pid in all_spaces:
            return all_spaces[pid], id_to_safe[pid]
        return None, sid_to_doc_n[sid]

    def emit_area(sid, sp, safe, parent_safe, parent_sp,
                  no_entity_block=False, space_cls='spot:DocumentSpace', entity_safe=None):
        sname = sp.get("name", sid)
        cmt = sp.get("comment", "").strip()
        bbox = sp.get("bbox", {"left": 0, "top": 0, "right": 1, "bottom": 1})
        rel  = bbox
        axes_tgt = sp.get("axes") or [sp.get("x_axis", "x"), sp.get("y_axis", "y")]
        axes_src = sp.get("src_axes") or [
            ("X" if i == 0 else "Y" if i == 1 else "Z") for i in range(len(axes_tgt))
        ]
        def src_slug(s): return s.upper().replace(" ", "_") or "A"
        ax_iris  = [f"{safe}_Axis{src_slug(n)}" for n in axes_src]
        ax_am    = [f"AM_{safe}_{src_slug(n)}" for n in axes_src]
        app_refs = [f":{a}" for a in ax_am]
        _bpm_parts = [f":BPM_{safe}_X_Min", f":BPM_{safe}_X_Max",
                      f":BPM_{safe}_Y_Min", f":BPM_{safe}_Y_Max"]
        if len(ax_iris) >= 3:
            _bpm_parts += [f":BPM_{safe}_Z_Min", f":BPM_{safe}_Z_Max"]
        bpm_refs = _bpm_parts
        has_asset = sp.get("target_asset")

        if not no_entity_block:
            body = [f":{safe} a {space_cls} ;", f"    rdfs:label \"{_lbl(sname)}\" ;"]
            if cmt:
                body.append(f"    rdfs:comment \"{_esc(cmt)}\" ;")
            for iri, n in zip(ax_iris, axes_src):
                body.append(f"    spot:has{src_slug(n)}Axis :{iri} ;")
            # Direct link to parent space (unless this is root document space)
            if safe != sid_to_doc_n[sid]:
                body.append(f"    spot:appearsIn :{parent_safe} ;")
            parent_type = parent_sp.get("type", "DocumentSpace") if parent_sp else "DocumentSpace"
            parent_pred = _ap_pred(parent_type)
            if has_asset:
                body.append(f"    {parent_pred} :AP_{safe}_in_{parent_safe} ;")
                body.append(f"    spot:hasAppearance :AP_{safe}_in_{_safe('AssetSpace')} .")
            else:
                body.append(f"    {parent_pred} :AP_{safe}_in_{parent_safe} .")
            out.extend(body + [""])

        if not entity_safe:
            if len(ax_iris) >= 1:
                out.extend([
                    f":{ax_iris[0]} a spot:Axis ;",
                    f"    rdfs:label \"{_lbl(sname)} {axes_src[0]} Axis\" ;",
                ] + _ml_refs("spot-am:hasBoundaryPoint",
                             [f":{safe}_AxisX_Min", f":{safe}_AxisX_Max"], "."))
                out.append("")
            if len(ax_iris) >= 2:
                out.extend([
                    f":{ax_iris[1]} a spot:Axis ;",
                    f"    rdfs:label \"{_lbl(sname)} {axes_src[1]} Axis\" ;",
                ] + _ml_refs("spot-am:hasBoundaryPoint",
                             [f":{safe}_AxisY_Min", f":{safe}_AxisY_Max"], "."))
                out.append("")
            if len(ax_iris) >= 3:
                out.extend([
                    f":{ax_iris[2]} a spot:Axis ;",
                    f"    rdfs:label \"{_lbl(sname)} {axes_src[2]} Axis\" ;",
                    f"    spot-am:hasBoundaryPoint :{safe}_AxisZ_Min ,",
                    f"                             :{safe}_AxisZ_Max .", "",
                ])

        # BP nodes — emitted with space body (before Appearances section)
        if len(ax_iris) >= 1:
            out.extend([f":{safe}_AxisX_Min a spot-am:MinBoundaryPoint .",
                        f":{safe}_AxisX_Max a spot-am:MaxBoundaryPoint .", ""])
        if len(ax_iris) >= 2:
            out.extend([f":{safe}_AxisY_Min a spot-am:MinBoundaryPoint .",
                        f":{safe}_AxisY_Max a spot-am:MaxBoundaryPoint .", ""])
        if len(ax_iris) >= 3:
            out.extend([f":{safe}_AxisZ_Min a spot-am:MinBoundaryPoint .",
                        f":{safe}_AxisZ_Max a spot-am:MaxBoundaryPoint .", ""])

        ap_out.append(_hdr(f"{str(sname).replace('_', ' ')} in {parent_safe.replace('_', ' ')}"))
        ap_body = [
            f":AP_{safe}_in_{parent_safe} a spot:DocumentAppearance ;",
            f"    rdfs:label \"Appearance of {_lbl(sname)} in {parent_safe.replace("_", " ")}\" ;",
            f"    spot:appearsIn :{parent_safe} ;",
        ]
        if app_refs:
            ap_body.extend(_ml_refs("spot-am:hasAxisMapping", app_refs, ";"))
        ap_body.extend(_ml_refs("spot-am:hasBoundaryPointMapping", bpm_refs, "."))
        ap_out.extend(ap_body + [""])

        def topo_x(v): return _reloc(_topo_file_x(v))
        def topo_y(v): return _reloc(_topo_file_y(v))

        _doc_offset_on_m = sp.get("axis_offset_on") or []
        _doc_offsets_m   = sp.get("axis_offsets")   or []
        for i, (src_n, tgt_v) in enumerate(zip(axes_src, axes_tgt)):
            tgt_base = tgt_v.replace("inv_", "").upper()
            src_axis_iri = f":{entity_safe}_Axis{src_slug(src_n)}" if entity_safe else f":{ax_iris[i]}"
            lines = [
                f":{ax_am[i]} a spot-am:AxisMapping ;",
                f"    rdfs:label \"Mapping of {_lbl(sname)} {src_n} Axis\" ;",
                f"    spot-am:hasSourceAxis {src_axis_iri} ;",
                f"    {_axis_target_pred(tgt_v)} :{parent_safe}_Axis{tgt_base} ;",
            ]
            if len(_doc_offset_on_m) > i and _doc_offset_on_m[i] and len(_doc_offsets_m) > i and _doc_offsets_m[i] is not None:
                _ang = float(_doc_offsets_m[i])
                lines.append(f"    spot-am:hasSourceToTargetAngle \"{_fmt_dec(round(_ang, 2))}\"^^xs:decimal ;")
                _accuracy = "Approximate" if abs(_ang) <= 45 else "Broad"
            else:
                _accuracy = "Exact"
            lines.append(f"    spot-am:hasAccuracy spot-am:{_accuracy} .")
            ap_out.extend(lines + [""])

        ap_out.extend([
            f":BPM_{safe}_X_Min a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} X Min\" ;",
            f"    spot-am:hasSourcePoint :{safe}_AxisX_Min ;",
            f"    reloc:{topo_x(rel['left'])} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{_fmt_dec(rel['left'])}\"^^xs:decimal .", "",
            f":BPM_{safe}_X_Max a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} X Max\" ;",
            f"    spot-am:hasSourcePoint :{safe}_AxisX_Max ;",
            f"    reloc:{topo_x(rel['right'])} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{_fmt_dec(rel['right'])}\"^^xs:decimal .", "",
            f":BPM_{safe}_Y_Min a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} Y Min\" ;",
            f"    spot-am:hasSourcePoint :{safe}_AxisY_Min ;",
            f"    reloc:{topo_y(rel['top'])} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{_fmt_dec(rel['top'])}\"^^xs:decimal .", "",
            f":BPM_{safe}_Y_Max a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} Y Max\" ;",
            f"    spot-am:hasSourcePoint :{safe}_AxisY_Max ;",
            f"    reloc:{topo_y(rel['bottom'])} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{_fmt_dec(rel['bottom'])}\"^^xs:decimal .", "",
        ])
        if len(ax_iris) >= 3:
            z_val = round(sp.get("z", 0.5), 5)
            ap_out.extend([
                f":BPM_{safe}_Z_Min a spot-am:BoundaryPointMapping ;",
                f"    rdfs:label \"BPM {_lbl(sname)} Z Min\" ;",
                f"    spot-am:hasSourcePoint :{safe}_AxisZ_Min ;",
                f"    reloc:{_reloc(_topo_asset_z(z_val))} :{parent_safe} ;",
                f"    spot-am:hasNormalizedCoordinateValue \"{_fmt_dec(z_val)}\"^^xs:decimal .",
                "",
                f":BPM_{safe}_Z_Max a spot-am:BoundaryPointMapping ;",
                f"    rdfs:label \"BPM {_lbl(sname)} Z Max\" ;",
                f"    spot-am:hasSourcePoint :{safe}_AxisZ_Max ;",
                f"    reloc:{_reloc(_topo_asset_z(z_val))} :{parent_safe} ;",
                f"    spot-am:hasNormalizedCoordinateValue \"{_fmt_dec(z_val)}\"^^xs:decimal .", "",
            ])
        # Asset appearance → ap_out (merged)
        if has_asset:
            a_axes_tgt = sp.get("asset_axes") or ["x","y","z"]
            a_axes_src = sp.get("asset_src_axes") or [("X" if i==0 else "Y" if i==1 else "Z") for i in range(len(a_axes_tgt))]
            a_ax_am      = [f"AM_{safe}_Asset_{src_slug(n)}" for n in a_axes_src]
            a_ax_am_iris = [f":{a}" for a in a_ax_am]
            asset_bp = sp.get("asset_bp")
            a_bpm_iris = ([f":BPM_{safe}_Asset_X_Min", f":BPM_{safe}_Asset_X_Max",
                           f":BPM_{safe}_Asset_Y_Min", f":BPM_{safe}_Asset_Y_Max"]
                          if asset_bp else [])
            ap_out.append(_hdr(f"{str(sname).replace('_', ' ')} in AssetSpace"))
            ap_out.extend([
                f":AP_{safe}_in_{_safe('AssetSpace')} a spot:AssetAppearance ;",
                f"    rdfs:label \"Appearance of {_lbl(sname)} in AssetSpace\" ;",
                f"    spot:appearsIn :AssetSpace ;",
            ])
            if a_ax_am_iris or a_bpm_iris:
                ap_out[-1] = ap_out[-1][:-1] + " ;"
                if a_ax_am_iris:
                    ap_out.extend(_ml_refs("spot-am:hasAxisMapping", a_ax_am_iris, ";" if a_bpm_iris else "."))
                if a_bpm_iris:
                    ap_out.extend(_ml_refs("spot-am:hasBoundaryPointMapping", a_bpm_iris, "."))
            ap_out.append("")
            _asset_offset_on = sp.get("asset_axis_offset_on") or []
            _asset_offsets   = sp.get("asset_axis_offsets")   or []
            for _i, (src_n, tgt_v) in enumerate(zip(a_axes_src, a_axes_tgt)):
                tgt_base = tgt_v.replace("inv_","").upper()
                src_iri  = [a for a in ax_iris if a.endswith(src_slug(src_n))]
                src_iri  = src_iri[0] if src_iri else f"{safe}_Axis{src_slug(src_n)}"
                lines = [
                    f":{f'AM_{safe}_Asset_{src_slug(src_n)}'} a spot-am:AxisMapping ;",
                    f"    rdfs:label \"Asset Mapping of {_lbl(sname)} {src_n} Axis\" ;",
                    f"    spot-am:hasSourceAxis :{src_iri} ;",
                    f"    {_axis_target_pred(tgt_v)} :AssetSpace_Axis{tgt_base} ;",
                ]
                if len(_asset_offset_on) > _i and _asset_offset_on[_i] and len(_asset_offsets) > _i and _asset_offsets[_i] is not None:
                    _ang = float(_asset_offsets[_i])
                    lines.append(f"    spot-am:hasSourceToTargetAngle \"{_fmt_dec(round(_ang, 2))}\"^^xs:decimal ;")
                    _accuracy = "Approximate" if abs(_ang) <= 45 else "Broad"
                else:
                    _accuracy = "Exact"
                lines.append(f"    spot-am:hasAccuracy spot-am:{_accuracy} .")
                ap_out.extend(lines + [""])
            if asset_bp:
                _bp_l = round(float(asset_bp.get("left",   0)), 5)
                _bp_r = round(float(asset_bp.get("right",  1)), 5)
                _bp_t = round(float(asset_bp.get("top",    0)), 5)
                _bp_b = round(float(asset_bp.get("bottom", 1)), 5)
                ap_out.extend([
                    f":BPM_{safe}_Asset_X_Min a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} X Min\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisX_Min ;",
                    f"    reloc:{_reloc(_topo_file_x(_bp_l))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_fmt_dec(_bp_l)}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_X_Max a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} X Max\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisX_Max ;",
                    f"    reloc:{_reloc(_topo_file_x(_bp_r))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_fmt_dec(_bp_r)}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_Y_Min a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} Y Min\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisY_Min ;",
                    f"    reloc:{_reloc(_topo_file_y(_bp_t))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_fmt_dec(_bp_t)}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_Y_Max a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} Y Max\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisY_Max ;",
                    f"    reloc:{_reloc(_topo_file_y(_bp_b))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_fmt_dec(_bp_b)}\"^^xs:decimal .",
                    "",
                ])

    def emit_point(sid, sp, safe, parent_safe, parent_sp,
                   no_entity_block=False, entity_safe=None):
        sname = sp.get("name", sid)
        cmt = sp.get("comment", "").strip()
        pt = sp.get("point", {"x": 0.5, "y": 0.5, "z": 0.5})
        rx = round(pt.get("x", 0.5), 5)
        ry = round(pt.get("y", 0.5), 5)
        rz = round(pt.get("z", 0.5), 5)
        axes_tgt = sp.get("axes") or ["z"]
        axes_src = sp.get("src_axes") or [
            ("X" if i == 0 else "Y" if i == 1 else "Z") for i in range(len(axes_tgt))
        ]
        def src_slug(s): return s.upper().replace(" ", "_") or "A"
        ax_iris = [f"{safe}_Axis{src_slug(n)}" for n in axes_src]
        ax_am   = [f"AM_{safe}_{src_slug(n)}" for n in axes_src]
        ax_bpm  = [f"BPM_{safe}_{src_slug(n)}" for n in axes_src]
        am_refs  = [f":{a}" for a in ax_am]
        bpm_refs = [f":{a}" for a in ax_bpm]
        has_asset = sp.get("target_asset")

        if not no_entity_block:
            body = [f":{safe} a spot:PointSpace ;", f"    rdfs:label \"{_lbl(sname)}\" ;"]
            if cmt:
                body.append(f"    rdfs:comment \"{_esc(cmt)}\" ;")
            for iri, n in zip(ax_iris, axes_src):
                body.append(f"    spot:has{src_slug(n)}Axis :{iri} ;")
            # Direct link to parent space (unless this is root document space)
            if safe != sid_to_doc_n[sid]:
                body.append(f"    spot:appearsIn :{parent_safe} ;")
            parent_type = parent_sp.get("type", "DocumentSpace") if parent_sp else "DocumentSpace"
            parent_pred = _ap_pred(parent_type)
            if has_asset:
                body.append(f"    {parent_pred} :AP_{safe}_in_{parent_safe} ;")
                body.append(f"    spot:hasAppearance :AP_{safe}_in_{_safe('AssetSpace')} .")
            else:
                body.append(f"    {parent_pred} :AP_{safe}_in_{parent_safe} .")
            out.extend(body + [""])

        for iri, src_n in zip(ax_iris, axes_src):
            if not entity_safe:
                out.extend([
                    f":{iri} a spot:Axis ;",
                    f"    rdfs:label \"{_lbl(sname)} {src_n} Axis\" ;",
                    f"    spot-am:hasBoundaryPoint :{iri}_BP .",
                ])
                out.extend([f":{iri}_BP a spot-am:BoundaryPoint .", ""])

        ap_out.append(_hdr(f"{str(sname).replace('_', ' ')} in {parent_safe.replace('_', ' ')}"))
        ap_body = [
            f":AP_{safe}_in_{parent_safe} a spot:DocumentAppearance ;",
            f"    rdfs:label \"Appearance of {_lbl(sname)} in {parent_safe.replace("_", " ")}\" ;",
            f"    spot:appearsIn :{parent_safe} ;",
        ]
        if am_refs:
            ap_body.extend(_ml_refs("spot-am:hasAxisMapping", am_refs, ";"))
        if bpm_refs:
            ap_body.extend(_ml_refs("spot-am:hasBoundaryPointMapping", bpm_refs, "."))
        else:
            ap_body[-1] = ap_body[-1].rstrip(" ;") + " ."
        ap_out.extend(ap_body + [""])

        coord_map = {"X": rx, "Y": ry, "Z": rz}
        reloc_map = {
            "X": _reloc(_topo_file_x(rx)),
            "Y": _reloc(_topo_file_y(ry)),
            "Z": _reloc(_topo_asset_z(rz)),
        }

        _pt_offset_on_m = sp.get("axis_offset_on") or []
        _pt_offsets_m   = sp.get("axis_offsets")   or []
        for _i, (src_n, tgt_v, iri, am_iri, bpm_iri) in enumerate(zip(axes_src, axes_tgt, ax_iris, ax_am, ax_bpm)):
            tgt_base = tgt_v.replace("inv_", "").upper()
            src_axis_iri = f":{entity_safe}_Axis{src_slug(src_n)}" if entity_safe else f":{iri}"
            lines = [
                f":{am_iri} a spot-am:AxisMapping ;",
                f"    spot-am:hasSourceAxis {src_axis_iri} ;",
                f"    {_axis_target_pred(tgt_v)} :{parent_safe}_Axis{tgt_base} ;",
            ]
            if len(_pt_offset_on_m) > _i and _pt_offset_on_m[_i] and len(_pt_offsets_m) > _i and _pt_offsets_m[_i] is not None:
                _ang = float(_pt_offsets_m[_i])
                lines.append(f"    spot-am:hasSourceToTargetAngle \"{_fmt_dec(round(_ang, 2))}\"^^xs:decimal ;")
                _accuracy = "Approximate" if abs(_ang) <= 45 else "Broad"
            else:
                _accuracy = "Exact"
            lines.append(f"    spot-am:hasAccuracy spot-am:{_accuracy} .")
            ap_out.extend(lines + [""])

            coord_val = coord_map.get(src_n.upper(), 0.5)
            reloc_val = reloc_map.get(src_n.upper(), "containedIn")
            if entity_safe:
                ap_out.extend([f":{iri}_BP a spot-am:BoundaryPoint .", ""])
            ap_out.extend([
                f":{bpm_iri} a spot-am:BoundaryPointMapping ;",
                f"    spot-am:hasSourcePoint :{iri}_BP ;",
                f"    reloc:{reloc_val} :{parent_safe} ;",
                f"    spot-am:hasNormalizedCoordinateValue \"{_fmt_dec(coord_val)}\"^^xs:decimal .", "",
            ])
        # Asset appearance → ap_out (merged)
        if has_asset:
            a_axes_tgt = sp.get("asset_axes") or ["x","y","z"]
            a_axes_src = sp.get("asset_src_axes") or [("X" if i==0 else "Y" if i==1 else "Z") for i in range(len(a_axes_tgt))]
            a_ax_am     = [f"AM_{safe}_Asset_{src_slug(n)}" for n in a_axes_src]
            a_ax_am_iris = [f":{a}" for a in a_ax_am]
            asset_bp = sp.get("asset_bp")
            a_bpm_iris = ([f":BPM_{safe}_Asset_X_Min", f":BPM_{safe}_Asset_X_Max",
                           f":BPM_{safe}_Asset_Y_Min", f":BPM_{safe}_Asset_Y_Max"]
                          if asset_bp else [])
            ap_out.append(_hdr(f"{str(sname).replace('_', ' ')} in AssetSpace"))
            ap_out.extend([
                f":AP_{safe}_in_{_safe('AssetSpace')} a spot:AssetAppearance ;",
                f"    rdfs:label \"Appearance of {_lbl(sname)} in AssetSpace\" ;",
                f"    spot:appearsIn :AssetSpace ;",
            ])
            if a_ax_am_iris or a_bpm_iris:
                ap_out[-1] = ap_out[-1][:-1] + " ;"
                if a_ax_am_iris:
                    ap_out.extend(_ml_refs("spot-am:hasAxisMapping", a_ax_am_iris, ";" if a_bpm_iris else "."))
                if a_bpm_iris:
                    ap_out.extend(_ml_refs("spot-am:hasBoundaryPointMapping", a_bpm_iris, "."))
            ap_out.append("")
            _asset_offset_on = sp.get("asset_axis_offset_on") or []
            _asset_offsets   = sp.get("asset_axis_offsets")   or []
            for _i, (src_n, tgt_v) in enumerate(zip(a_axes_src, a_axes_tgt)):
                tgt_base = tgt_v.replace("inv_","").upper()
                src_iri  = [a for a in ax_iris if a.endswith(src_slug(src_n))]
                src_iri  = src_iri[0] if src_iri else f"{safe}_Axis{src_slug(src_n)}"
                lines = [
                    f":{f'AM_{safe}_Asset_{src_slug(src_n)}'} a spot-am:AxisMapping ;",
                    f"    rdfs:label \"Asset Mapping of {_lbl(sname)} {src_n} Axis\" ;",
                    f"    spot-am:hasSourceAxis :{src_iri} ;",
                    f"    {_axis_target_pred(tgt_v)} :AssetSpace_Axis{tgt_base} ;",
                ]
                if len(_asset_offset_on) > _i and _asset_offset_on[_i] and len(_asset_offsets) > _i and _asset_offsets[_i] is not None:
                    _ang = float(_asset_offsets[_i])
                    lines.append(f"    spot-am:hasSourceToTargetAngle \"{_fmt_dec(round(_ang, 2))}\"^^xs:decimal ;")
                    _accuracy = "Approximate" if abs(_ang) <= 45 else "Broad"
                else:
                    _accuracy = "Exact"
                lines.append(f"    spot-am:hasAccuracy spot-am:{_accuracy} .")
                ap_out.extend(lines + [""])
            if asset_bp:
                _bp_l = round(float(asset_bp.get("left",   0)), 5)
                _bp_r = round(float(asset_bp.get("right",  1)), 5)
                _bp_t = round(float(asset_bp.get("top",    0)), 5)
                _bp_b = round(float(asset_bp.get("bottom", 1)), 5)
                ap_out.extend([
                    f":BPM_{safe}_Asset_X_Min a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} X Min\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisX_Min ;",
                    f"    reloc:{_reloc(_topo_file_x(_bp_l))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_l}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_X_Max a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} X Max\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisX_Max ;",
                    f"    reloc:{_reloc(_topo_file_x(_bp_r))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_r}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_Y_Min a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} Y Min\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisY_Min ;",
                    f"    reloc:{_reloc(_topo_file_y(_bp_t))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_t}\"^^xs:decimal .",
                    "",
                    f":BPM_{safe}_Asset_Y_Max a spot-am:BoundaryPointMapping ;",
                    f"    rdfs:label \"Asset BPM {_lbl(sname)} Y Max\" ;",
                    f"    spot-am:hasSourcePoint :{safe}_AxisY_Max ;",
                    f"    reloc:{_reloc(_topo_file_y(_bp_b))} :{asset_n} ;",
                    f"    spot-am:hasNormalizedCoordinateValue \"{_bp_b}\"^^xs:decimal .",
                    "",
                ])

    def emit_line(sid, sp, safe, parent_safe, parent_sp, no_entity_block=False):
        sname = sp.get("name", sid)
        cmt = sp.get("comment", "").strip()
        s_pt = sp.get("start", {"x": 0.3, "y": 0.5, "z": 0.5})
        e_pt = sp.get("end",   {"x": 0.7, "y": 0.5, "z": 0.5})
        sx = round(s_pt.get("x", 0.3), 5);  sy = round(s_pt.get("y", 0.5), 5)
        sz = round(s_pt.get("z", 0.5), 5)
        ex = round(e_pt.get("x", 0.7), 5);  ey = round(e_pt.get("y", 0.5), 5)
        ez = round(e_pt.get("z", 0.5), 5)

        axes_tgt = sp.get("axes") or ["x"]
        axes_src = sp.get("src_axes") or ["X"]
        def src_slug(s): return s.upper().replace(" ", "_") or "A"

        main_tgt      = axes_tgt[0] if axes_tgt else "x"
        main_tgt_base = main_tgt.replace("inv_", "")
        main_src      = src_slug(axes_src[0] if axes_src else "X")

        if main_tgt_base == "x":
            min_coord = round(min(sx, ex), 5);  max_coord = round(max(sx, ex), 5)
            topo_min  = _reloc(_topo_file_x(min_coord))
            topo_max  = _reloc(_topo_file_x(max_coord))
        elif main_tgt_base == "y":
            min_coord = round(min(sy, ey), 5);  max_coord = round(max(sy, ey), 5)
            topo_min  = _reloc(_topo_file_y(min_coord))
            topo_max  = _reloc(_topo_file_y(max_coord))
        elif main_tgt_base == "z":
            min_coord = round(min(sz, ez), 5);  max_coord = round(max(sz, ez), 5)
            topo_min  = _reloc(_topo_asset_z(min_coord))
            topo_max  = _reloc(_topo_asset_z(max_coord))
        else:
            min_coord = round(min(sx, ex), 5);  max_coord = round(max(sx, ex), 5)
            topo_min  = _reloc(_topo_file_x(min_coord))
            topo_max  = _reloc(_topo_file_x(max_coord))

        if not no_entity_block:
            body = [f":{safe} a spot:LineSpace ;", f"    rdfs:label \"{_lbl(sname)}\" ;"]
            if cmt:
                body.append(f"    rdfs:comment \"{_esc(cmt)}\" ;")
            for i, src_n in enumerate(axes_src):
                slug = src_slug(src_n)
                body.append(f"    spot:has{slug}Axis :{safe}_Axis{slug} ;")
            # Direct link to parent space (unless this is root document space)
            if safe != sid_to_doc_n[sid]:
                body.append(f"    spot:appearsIn :{parent_safe} ;")
            lp_type = parent_sp.get("type", "DocumentSpace") if parent_sp else "DocumentSpace"
            lp_pred = _ap_pred(lp_type)
            body.append(f"    {lp_pred} :AP_{safe}_in_{parent_safe} .")
            out.extend(body + [""])

            out.extend([
                f":{safe}_Axis{main_src} a spot:Axis ;",
                f"    rdfs:label \"{_lbl(sname)} {axes_src[0] if axes_src else 'X'} Axis\" ;",
                f"    spot-am:hasBoundaryPoint :{safe}_Axis{main_src}_Min , :{safe}_Axis{main_src}_Max .",
                "",
                f":{safe}_Axis{main_src}_Min a spot-am:MinBoundaryPoint .",
                f":{safe}_Axis{main_src}_Max a spot-am:MaxBoundaryPoint .",
                "",
            ])
            for src_n in axes_src[1:]:
                slug = src_slug(src_n)
                out.extend([
                    f":{safe}_Axis{slug} a spot:Axis ;",
                    f"    rdfs:label \"{_lbl(sname)} {src_n} Axis\" ;",
                    f"    spot-am:hasBoundaryPoint :{safe}_Axis{slug}_BP .",
                    "",
                    f":{safe}_Axis{slug}_BP a spot-am:BoundaryPoint .",
                    "",
                ])

        am_iris  = [f":AM_{safe}_{src_slug(n)}" for n in axes_src]
        bpm_iris = [f":BPM_{safe}_{main_src}_Min", f":BPM_{safe}_{main_src}_Max"]
        for src_n in axes_src[1:]:
            bpm_iris.append(f":BPM_{safe}_{src_slug(src_n)}_BP")

        ap_out.append(_hdr(f"{str(sname).replace('_', ' ')} in {parent_safe.replace('_', ' ')}"))
        ap_body = [
            f":AP_{safe}_in_{parent_safe} a spot:DocumentAppearance ;",
            f"    rdfs:label \"Appearance of {_lbl(sname)} in {parent_safe.replace("_", " ")}\" ;",
            f"    spot:appearsIn :{parent_safe} ;",
        ]
        if am_iris:
            ap_body.extend(_ml_refs("spot-am:hasAxisMapping", am_iris, ";"))
        ap_body.extend(_ml_refs("spot-am:hasBoundaryPointMapping", bpm_iris, "."))
        ap_out.extend(ap_body + [""])

        for i, (src_n, tgt_v) in enumerate(zip(axes_src, axes_tgt)):
            tgt_base     = tgt_v.replace("inv_", "").upper()
            am_iri = f"AM_{safe}_{src_slug(src_n)}"
            ax_iri = f"{safe}_Axis{src_slug(src_n)}"
            lines = [
                f":{am_iri} a spot-am:AxisMapping ;",
                f"    rdfs:label \"Mapping of {_lbl(sname)} {src_n} Axis\" ;",
                f"    spot-am:hasSourceAxis :{ax_iri} ;",
                f"    {_axis_target_pred(tgt_v)} :{parent_safe}_Axis{tgt_base} ;",
            ]
            # spot-am:hasSourceToTargetAngle — not applicable for LineSpace (axis-aligned only)
            lines.append(f"    spot-am:hasAccuracy spot-am:Exact .")
            ap_out.extend(lines + [""])

        ap_out.extend([
            f":BPM_{safe}_{main_src}_Min a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} {axes_src[0] if axes_src else 'X'} Min\" ;",
            f"    spot-am:hasSourcePoint :{safe}_Axis{main_src}_Min ;",
            f"    reloc:{topo_min} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{min_coord}\"^^xs:decimal .",
            "",
            f":BPM_{safe}_{main_src}_Max a spot-am:BoundaryPointMapping ;",
            f"    rdfs:label \"BPM {_lbl(sname)} {axes_src[0] if axes_src else 'X'} Max\" ;",
            f"    spot-am:hasSourcePoint :{safe}_Axis{main_src}_Max ;",
            f"    reloc:{topo_max} :{parent_safe} ;",
            f"    spot-am:hasNormalizedCoordinateValue \"{max_coord}\"^^xs:decimal .",
            "",
        ])
        for i, src_n in enumerate(axes_src[1:], start=1):
            slug     = src_slug(src_n)
            sec_tgt  = axes_tgt[i] if i < len(axes_tgt) else "y"
            sec_base = sec_tgt.replace("inv_", "")
            if sec_base == "x":
                perp_coord = round((sx + ex) / 2, 5)
                topo_perp  = _reloc(_topo_file_x(perp_coord))
            elif sec_base == "y":
                perp_coord = round((sy + ey) / 2, 5)
                topo_perp  = _reloc(_topo_file_y(perp_coord))
            elif sec_base == "z":
                perp_coord = round((sz + ez) / 2, 5)
                topo_perp  = _reloc(_topo_asset_z(perp_coord))
            else:
                perp_coord = round((sy + ey) / 2, 5)
                topo_perp  = _reloc(_topo_file_y(perp_coord))
            ap_out.extend([
                f":BPM_{safe}_{slug}_BP a spot-am:BoundaryPointMapping ;",
                f"    rdfs:label \"BPM {_lbl(sname)} {src_n} BP\" ;",
                f"    spot-am:hasSourcePoint :{safe}_Axis{slug}_BP ;",
                f"    reloc:{topo_perp} :{parent_safe} ;",
                f"    spot-am:hasNormalizedCoordinateValue \"{perp_coord}\"^^xs:decimal .",
                "",
            ])

    # ── entity (dedup) group accumulation across ALL projects ────────────────
    def _src_axis_slugs_for(sid, sp):
        axes_src = sp.get("src_axes") or [
            ("X" if i == 0 else "Y" if i == 1 else "Z")
            for i in range(len(sp.get("axes") or ["x", "y"]))
        ]
        def _sl(s): return s.upper().replace(" ", "_") or "A"
        return [_sl(n) for n in axes_src]

    entity_groups: dict = {}
    _ea_ap_pending: list = []  # EA AP blocks flushed into ap_out before Appearances header
    _ea_ap_pending: list = []  # EA AP blocks flushed into ap_out before Appearances header
    entity_meta_ec: dict = {}  # ent_safe → merged list of class assocs from per-file meta

    for sid, sp in all_spaces.items():
        ent = (sp.get("entity") or "").strip()
        if not ent:
            continue
        ent_safe = _safe(ent)
        if ent_safe not in entity_groups:
            entity_groups[ent_safe] = {
                "name": ent,
                "type": sp.get("type", "DocumentSpace"),
                "canonical_axes": set(),
                "ap_entries": [],
                "appearances": [],
            }
            entity_meta_ec[ent_safe] = []
        for slug in _src_axis_slugs_for(sid, sp):
            entity_groups[ent_safe]["canonical_axes"].add(slug)
        space_safe = id_to_safe[sid]
        space_name = sp.get("name", sid)
        space_type = sp.get("type", "DocumentSpace")
        axis_refs = [f":AM_{space_safe}_{slug}" for slug in _src_axis_slugs_for(sid, sp)]
        if space_type in ("DocumentSpace", "VolumeSpace"):
            bpm_refs = [f":BPM_{space_safe}_X_Min", f":BPM_{space_safe}_X_Max", f":BPM_{space_safe}_Y_Min", f":BPM_{space_safe}_Y_Max"]
            if len(axis_refs) >= 3:
                bpm_refs += [f":BPM_{space_safe}_Z_Min", f":BPM_{space_safe}_Z_Max"]
        elif space_type in ("PointSpace",):
            bpm_refs = [f":BPM_{space_safe}_{slug}_BP" for slug in _src_axis_slugs_for(sid, sp)]
        else:
            bpm_refs = [f":BPM_{space_safe}_X_Min", f":BPM_{space_safe}_X_Max"]
            if len(axis_refs) >= 2:
                bpm_refs += [f":BPM_{space_safe}_Y_Min", f":BPM_{space_safe}_Y_Max"]
            if len(axis_refs) >= 3:
                bpm_refs += [f":BPM_{space_safe}_Z_Min", f":BPM_{space_safe}_Z_Max"]
        ea_ap_iri  = f"AP_{ent_safe}_in_{space_safe}"
        entity_groups[ent_safe]["appearances"].append({
            "ap_iri": ea_ap_iri,
            "space_safe": space_safe,
            "space_name": space_name,
            "axis_refs": axis_refs,
            "bpm_refs": bpm_refs,
        })
        entity_groups[ent_safe]["ap_entries"].append((ea_ap_iri, "spot:hasAppearance"))

    # Merge per-file meta entity_classes
    for pi in project_infos:
        meta_ec = pi["meta"].get("entity_classes", {})
        for ent_safe, assocs in meta_ec.items():
            if ent_safe not in entity_meta_ec:
                entity_meta_ec[ent_safe] = []
            seen = {(a.get("pred"), a.get("cls")) for a in entity_meta_ec[ent_safe]}
            for a in assocs:
                k = (a.get("pred"), a.get("cls"))
                if k not in seen:
                    entity_meta_ec[ent_safe].append(a)
                    seen.add(k)

    _cls_map = {
        "DocumentSpace": "spot:DocumentSpace",
        "PointSpace":    "spot:PointSpace",
        "LineSpace":     "spot:LineSpace",
        "VectorSpace":   "spot:LineSpace",
        "VolumeSpace":   "spot:VolumeSpace",
    }

    def _emit_ap_entries(body, ap_entries):
        pred_groups: dict = {}
        for iri, pred in ap_entries:
            pred_groups.setdefault(pred, []).append(iri)
        pg_items = list(pred_groups.items())
        for i, (pred, iris) in enumerate(pg_items):
            is_last = (i == len(pg_items) - 1)
            if len(iris) == 1:
                body.append(f"    {pred} :{iris[0]} {'.' if is_last else ';'}")
            else:
                body.append(f"    {pred} :{iris[0]} ,")
                for ap in iris[1:-1]:
                    body.append(f"                       :{ap} ,")
                body.append(f"                       :{iris[-1]} {'.' if is_last else ';'}")

    if entity_groups:
        out.append(_hdr("EntitySpaces"))
    _global_ec = load_entity_classes()

    for ent_safe, eg in entity_groups.items():
        ap_entries = eg["ap_entries"]
        
        # Build direct appearance links as entries (for inclusion in entity block)
        direct_app_entries = [
            (app["space_safe"], "spot:appearsIn")
            for app in eg.get("appearances", [])
        ]
        # Combine all entries: axes, direct appearances, then hasAppearance
        combined_entries = (
            [(f"{ent_safe}_Axis{slug}", f"spot:has{slug}Axis") for slug in sorted(eg["canonical_axes"])]
            + direct_app_entries
            + ap_entries
        )
        
        if ent_safe == asset_n:
            if combined_entries:
                body = [f":{asset_n}"]
                _emit_ap_entries(body, combined_entries)
                out.extend(body + [""])
            continue
        out.append(_hdr(eg["name"]))
        canonical = sorted(eg["canonical_axes"])
        body = [f":{ent_safe} a spot:EntitySpace ;",
                f"    rdfs:label \"{_esc(eg['name'])}\" ;"]
        _emit_ap_entries(body, combined_entries)
        out.extend(body + [""])

        # Class associations: merge global + all per-file metas
        _global_ec_list = _global_ec.get(ent_safe, [])
        seen_ec = {(a.get("pred"), a.get("cls"), (a.get("kind") or "class").lower()) for a in _global_ec_list}
        entity_class_assocs = list(_global_ec_list) + [
            a for a in entity_meta_ec.get(ent_safe, [])
            if (a.get("pred"), a.get("cls"), (a.get("kind") or "class").lower()) not in seen_ec
        ]
        if entity_class_assocs:
            for assoc in entity_class_assocs:
                ec_pred = (assoc.get("pred") or "").strip()
                ec_cls  = (assoc.get("cls")  or "").strip()
                is_instance = (assoc.get("kind") or "").lower() == "instance"
                if ec_pred and ec_cls:
                    # Format object: for instance links, ensure local references are prefixed with ':'
                    formatted_obj = _format_rdf_object(ec_cls, is_instance)
                    out.append(f":{ent_safe} {'a' if ec_pred == 'rdf:type' else ec_pred} {formatted_obj} .")
            out.append("")
        for slug in canonical:
            out.extend([
                f":{ent_safe}_Axis{slug} a spot:Axis ;",
                f"    rdfs:label \"{_esc(eg['name'])} {slug} Axis\" ;",
                f"    spot-am:axisOf :{ent_safe} .",
                f":{ent_safe}_Axis{slug}_Inv a spot:Axis ;",
                f"    spot-am:axisOf :{ent_safe} ;",
                f"    spot-am:inverseOf :{ent_safe}_Axis{slug} .",
                "",
            ])
        # Minimal EntityAppearance APs collected here; emitted into ap_out after spaces
        for app in eg.get("appearances", []):
            _ea_ap_pending.append((eg["name"], app))

    # ── all appearance spaces (merged, one header per space) ─────────────────
    def _emit_space_block(sid, sp):
        out.append(_hdr(sp.get("name", sid)))
        safe = id_to_safe[sid]
        parent_sp, parent_safe = _parent_context(sid, sp)
        stype = sp.get("type", "DocumentSpace")

        # Appearance spaces always emit their full body and own axes.
        # The entity block links to the space IRI; the space links to its DocumentAppearance.
        if stype == "DocumentSpace":
            emit_area(sid, sp, safe, parent_safe, parent_sp)
        elif stype == "VolumeSpace":
            emit_area(sid, sp, safe, parent_safe, parent_sp, space_cls='spot:VolumeSpace')
        elif stype == "PointSpace":
            emit_point(sid, sp, safe, parent_safe, parent_sp)
        elif stype in ("VectorSpace", "LineSpace"):
            emit_line(sid, sp, safe, parent_safe, parent_sp)

        classes = sp.get("classes") or []
        if classes:
            for assoc in classes:
                pred = (assoc.get("pred") or "").strip()
                cls  = (assoc.get("cls")  or "").strip()
                if pred and cls:
                    out.append(f":{safe} {'a' if pred == 'rdf:type' else pred} {cls} .")
            out.append("")

    doc_spaces = [(sid, sp) for sid, sp in all_spaces.items()
                  if sp.get("type", "DocumentSpace") == "DocumentSpace"]
    ap_spaces  = [(sid, sp) for sid, sp in all_spaces.items()
                  if sp.get("type", "DocumentSpace") != "DocumentSpace"]

    # DocumentSpaces: root doc space(s) per project + child DocumentSpace-typed spaces
    out.append(_hdr("DocumentSpaces"))
    for pi in project_infos:
        doc_n_p = pi["doc_n"]
        disp_p  = pi["disp"]
        out += [
            _hdr(pi["fname"]),
            f":{doc_n_p} a spot:DocumentSpace ;",
            f"    rdfs:label \"{_esc(disp_p)}\" ;",
            f"    spot:hasXAxis :{doc_n_p}_AxisX ;",
            f"    spot:hasYAxis :{doc_n_p}_AxisY ;",
            f"    spot:hasZAxis :{doc_n_p}_AxisZ .",
            "",
            f":{doc_n_p}_AxisX a spot:Axis ; rdfs:label \"{_esc(disp_p)} X Axis\" ; spot:hasDirection spot:Right ; spot-am:axisOf :{doc_n_p} .",
            f":{doc_n_p}_AxisX_Inv a spot:Axis ; spot-am:axisOf :{doc_n_p} ; spot-am:inverseOf :{doc_n_p}_AxisX .",
            f":{doc_n_p}_AxisY a spot:Axis ; rdfs:label \"{_esc(disp_p)} Y Axis\" ; spot:hasDirection spot:Bottom ; spot-am:axisOf :{doc_n_p} .",
            f":{doc_n_p}_AxisY_Inv a spot:Axis ; spot-am:axisOf :{doc_n_p} ; spot-am:inverseOf :{doc_n_p}_AxisY .",
            f":{doc_n_p}_AxisZ a spot:Axis ; rdfs:label \"{_esc(disp_p)} Z Axis\" ; spot:hasDirection spot:Rear ; spot-am:axisOf :{doc_n_p} .",
            f":{doc_n_p}_AxisZ_Inv a spot:Axis ; spot-am:axisOf :{doc_n_p} ; spot-am:inverseOf :{doc_n_p}_AxisZ .",
            "",
        ]
    for sid, sp in doc_spaces:
        _emit_space_block(sid, sp)

    # Spaces: all property-panel appearance spaces
    if ap_spaces:
        out.append(_hdr("Spaces"))
    for sid, sp in ap_spaces:
        _emit_space_block(sid, sp)

    # Appearances: all AP instances, AxisMappings, BPMs
    # Flush minimal EntityAppearance APs (entity → space) into ap_out first
    for _ea_name, _ea_app in _ea_ap_pending:
        ap_out.extend([
            _hdr(f"{str(_ea_name).replace('_', ' ')} in {str(_ea_app['space_name']).replace('_', ' ')}"),  # appearance
            f":{_ea_app['ap_iri']} a spot:EntityAppearance ;",
            f"    rdfs:label \"Appearance of {_esc(_ea_name)} in {_esc(_ea_app['space_name'])}\" ;",
            f"    spot:appearsIn :{_ea_app['space_safe']} ;",
        ])
        if _ea_app.get("axis_refs"):
            ap_out.extend(_ml_refs("spot-am:hasAxisMapping", _ea_app["axis_refs"], ";" if _ea_app.get("bpm_refs") else "."))
        if _ea_app.get("bpm_refs"):
            ap_out.extend(_ml_refs("spot-am:hasBoundaryPointMapping", _ea_app["bpm_refs"], "."))
        if not _ea_app.get("axis_refs") and not _ea_app.get("bpm_refs"):
            ap_out[-1] = ap_out[-1].rstrip(" ;") + " ."
        ap_out.append("")
    if ap_out:
        out.append(_hdr("Appearances"))
    out.extend(ap_out)

    # Inject @prefix declarations for any extra ontology prefixes used in class associations
    out = _inject_missing_prefixes(out)

    # ── post-process: expand inline semicolons for readability ───────────────
    formatted = []
    for line in out:
        stripped = line.strip()
        if ' ; ' in line and not stripped.startswith('#') and stripped:
            lead_indent = len(line) - len(line.lstrip())
            lead = ' ' * lead_indent
            cont = lead + '    '
            parts = line.split(' ; ')
            formatted.append(lead + parts[0].strip() + ' ;')
            for part in parts[1:-1]:
                formatted.append(cont + part.strip() + ' ;')
            formatted.append(cont + parts[-1].strip())
        else:
            formatted.append(line)

    return "\n".join(formatted)