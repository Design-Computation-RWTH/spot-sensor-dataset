from flask import Blueprint, jsonify, request

from app.config import BASE_DIR
from app.functions.exporter import generate_rdf, generate_rdf_merged
from app.functions.storage import get_env_project_ids, load_environments, load_projects

bp = Blueprint("sparql", __name__)


@bp.route("/queries", methods=["GET"])
def sparql_list_queries():
    query_dir = BASE_DIR / "templates" / "sparql_queries"
    files = []
    for qf in sorted(query_dir.glob("*.sparql")):
        files.append({
            "filename": qf.name,
            "name": qf.stem,          # exact stem, e.g. "01_list_all_spaces"
            "content": qf.read_text(encoding="utf-8"),
        })
    return jsonify(files)


@bp.route("/queries/save", methods=["POST"])
def sparql_save_query():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    content = (data.get("content") or "").strip()
    if not name or not content:
        return jsonify({"error": "name and content required"}), 400

    query_dir = BASE_DIR / "templates" / "sparql_queries"

    # Match by exact stem (case-insensitive)
    for qf in sorted(query_dir.glob("*.sparql")):
        if qf.stem.lower() == name.lower():
            qf.write_text(content, encoding="utf-8")
            return jsonify({"status": "updated", "filename": qf.name})

    # New file — use the supplied name as the stem directly
    import re as _re
    slug = _re.sub(r'[^\w\-]', '_', name).strip('_') or "query"
    filename = slug + ".sparql"
    # Avoid collision
    target = query_dir / filename
    if target.exists():
        import time
        filename = slug + "_" + str(int(time.time())) + ".sparql"
    (query_dir / filename).write_text(content, encoding="utf-8")
    return jsonify({"status": "created", "filename": filename})


@bp.route("/queries/delete", methods=["POST"])
def sparql_delete_query():
    import re as _re
    data = request.get_json(force=True)
    filename = (data.get("filename") or "").strip()
    if not filename:
        return jsonify({"error": "filename required"}), 400
    if _re.search(r'[/\\]', filename):
        return jsonify({"error": "invalid filename"}), 400
    query_dir = BASE_DIR / "templates" / "sparql_queries"
    target = query_dir / filename
    if not target.exists() or target.suffix != ".sparql":
        return jsonify({"error": "file not found"}), 404
    target.unlink()
    return jsonify({"status": "deleted", "filename": filename})


@bp.route("/ttl", methods=["POST"])
def sparql_get_ttl():
    data = request.get_json(force=True)
    project_ids = data.get("project_ids") or []
    env_id = data.get("env_id")
    all_projects = data.get("all_projects", False)

    projects_data = load_projects()

    if all_projects:
        target_ids = list(projects_data.keys())
    else:
        target_ids = list(project_ids)
        if env_id:
            envs = load_environments()
            for eid in get_env_project_ids(env_id, projects_data, envs):
                if eid not in target_ids:
                    target_ids.append(eid)

    if not target_ids:
        return jsonify({"error": "No projects selected"}), 400

    # Collect project dicts (respecting ttl_override for single-file overrides).
    # For merged/folder mode we always re-generate from data so that entity groups
    # are deduplicated across files; ttl_override only affects single-file exports.
    projects_to_merge = []
    errors = []
    for pid in target_ids:
        proj = projects_data.get(pid)
        if not proj:
            continue
        projects_to_merge.append(proj)

    if not projects_to_merge:
        return jsonify({"error": "No TTL generated", "errors": errors}), 400

    try:
        if len(projects_to_merge) == 1:
            # Single project: honour ttl_override if present
            p = projects_to_merge[0]
            result = p.get("ttl_override") or generate_rdf(p)
        else:
            # Folder/env mode: unified merged TTL — one section per concept, no duplicates
            result = generate_rdf_merged(projects_to_merge)
    except Exception as e:
        errors.append(f"# Error generating TTL: {e}")
        return jsonify({"error": str(e), "errors": errors}), 500

    if errors:
        result = "\n".join(errors) + "\n\n" + result
    return jsonify({"ttl": result})


@bp.route("/find_space", methods=["POST"])
def sparql_find_space():
    """Given a TTL local name, find ALL projects + spaces that map to it.
    Handles derived IRIs like AP_Name_in_Parent, AM_Name_X, BPM_Name_X_Min, Name_AxisX."""
    import re as _re

    def _safe(name: str) -> str:
        s = str(name).strip() or "Space"
        s = _re.sub(r'[\s\x00-\x1f"#<>{}|\\\^`\[\]/]', '_', s)
        return s or "Space"

    def _candidates(ln: str):
        """Yield all space safe-names that could be encoded in this local name."""
        yield ln  # exact: the space itself (IRI local-name or literal with no special chars)
        s = _safe(ln)
        if s != ln:
            yield s  # safe-ify the label so clicking a literal "My Point" matches IRI :My_Point
        # AP_{safe}_in_{parent_safe}
        if ln.startswith('AP_'):
            rest = ln[3:]
            yield rest[:rest.index('_in_')] if '_in_' in rest else rest
        # AM_{safe}_{axis_slug} or BPM_{safe}_{axis_slug}
        for pfx in ('AM_', 'BPM_'):
            if ln.startswith(pfx):
                rest = ln[len(pfx):]
                yield rest
                for suf in ('_X_Min', '_X_Max', '_Y_Min', '_Y_Max', '_Z_BP',
                            '_Asset_X', '_Asset_Y', '_Asset_Z', '_X', '_Y', '_Z'):
                    if rest.endswith(suf):
                        yield rest[:-len(suf)]
                        break
        # {safe}_Axis{slug}  or  {safe}_Asset_{slug}
        for marker in ('_Axis', '_Asset_'):
            if marker in ln:
                yield ln[:ln.index(marker)]

    data = request.get_json(force=True)
    local_name = (data.get("local_name") or "").strip()
    project_ids = data.get("project_ids") or []
    env_id = data.get("env_id")
    extra_ids = data.get("extra_project_ids") or []  # always-search fallback

    if not local_name:
        return jsonify({"error": "local_name required"}), 400

    projects_data = load_projects()
    target_ids = list(project_ids)
    if env_id:
        envs = load_environments()
        for eid in get_env_project_ids(env_id, projects_data, envs):
            if eid not in target_ids:
                target_ids.append(eid)
    for xid in extra_ids:
        if xid and xid not in target_ids:
            target_ids.append(xid)

    candidates = set(_candidates(local_name))
    matches = []
    seen = set()
    for pid in target_ids:
        proj = projects_data.get(pid)
        if not proj:
            continue
        for sid, sp in (proj.get("spaces") or {}).items():
            key = (pid, sid)
            if key in seen:
                continue
            if _safe(sp.get("name") or "") in candidates:
                seen.add(key)
                matches.append({
                    "project_id": pid,
                    "space_id": sid,
                    "space_name": sp.get("name", ""),
                    "project_name": proj.get("original_name", pid),
                })

    return jsonify({"matches": matches})


# ---------------------------------------------------------------------------
# HTML TOC parser helper for W3C respec-style ontology pages
# ---------------------------------------------------------------------------
def _parse_w3c_html_toc(html: str):
    """Parse a W3C respec HTML page to extract ontology classes and predicates.

    Extracts:
    - prefix→IRI mappings from the RDFa ``<body prefix="...">`` attribute
    - prefix:LocalName terms from ``<ol class="toc" role="directory">`` link texts

    Returns ``(classes, predicates, prefixes_dict)`` – all sorted/deduplicated.
    Terms whose LocalName starts with an uppercase letter are treated as classes;
    lowercase-starting LocalNames are treated as predicates.
    """
    import re as _re

    # 1. Extract prefix→IRI from <body prefix="pf: IRI  pf2: IRI2 ...">
    body_prefix: dict[str, str] = {}
    body_m = _re.search(r'<body[^>]+\bprefix="([^"]*)"', html, _re.IGNORECASE)
    if body_m:
        tokens = body_m.group(1).split()
        i = 0
        while i < len(tokens) - 1:
            if tokens[i].endswith(':'):
                pf = tokens[i][:-1]
                ns = tokens[i + 1]
                if ns.startswith('http'):
                    body_prefix[pf] = ns
                i += 2
            else:
                i += 1

    # 2. Find <ol class="toc" role="directory"> block
    toc_m = _re.search(r'<ol[^>]+class="toc"[^>]+role="directory"', html)
    if not toc_m:
        toc_m = _re.search(r'<ol[^>]+role="directory"[^>]+class="toc"', html)

    classes: list[str] = []
    predicates: list[str] = []

    if toc_m:
        pos = toc_m.end()
        depth = 1
        while pos < len(html) and depth > 0:
            nxt_o = html.find('<ol', pos)
            nxt_c = html.find('</ol', pos)
            if nxt_o != -1 and (nxt_c == -1 or nxt_o < nxt_c):
                depth += 1
                pos = nxt_o + 4
            elif nxt_c != -1:
                depth -= 1
                pos = nxt_c + 4
            else:
                break
        toc_html = html[toc_m.start():pos]

        all_links = _re.findall(r'<a [^>]*>(.*?)</a>', toc_html, _re.DOTALL)
        for link_html in all_links:
            text = _re.sub(r'<[^>]+>', '', link_html).strip()
            # Match optional "1.2.3 " section number, then "prefix:LocalName"
            m2 = _re.search(r'(?:[\d.]+\s+)?(\w+):([A-Za-z]\w*)$', text)
            if m2:
                prefix, local = m2.group(1), m2.group(2)
                # Only include prefixes present in body_prefix (or accept all if unknown)
                if prefix in body_prefix or not body_prefix:
                    term = f'{prefix}:{local}'
                    if local[0].isupper():
                        classes.append(term)
                    else:
                        predicates.append(term)

    return sorted(set(classes)), sorted(set(predicates)), body_prefix


@bp.route("/ontology/load", methods=["POST"])
def load_ontology_from_url():
    """Fetch an ontology from a URL with RDF content-negotiation, parse with rdflib,
    and return its name, classes, properties and prefixes as JSON."""
    import io as _io
    from collections import Counter
    import requests as _req
    from rdflib import Graph

    data = request.get_json(force=True)
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url required"}), 400

    # Content-negotiation attempts: TTL first, then RDF/XML
    ATTEMPTS = [
        ("text/turtle, application/n-triples;q=0.9, application/rdf+xml;q=0.8, */*;q=0.5", "turtle"),
        ("application/rdf+xml, text/turtle;q=0.9, */*;q=0.5", "xml"),
    ]
    content = None
    fmt = None
    fetch_errors = []
    for accept, fallback_fmt in ATTEMPTS:
        try:
            r = _req.get(url, headers={"Accept": accept}, timeout=20, allow_redirects=True)
            if r.status_code == 200:
                content = r.content
                ct = r.headers.get("Content-Type", "")
                if "turtle" in ct or "text/plain" in ct:
                    fmt = "turtle"
                elif "n-triples" in ct:
                    fmt = "nt"
                elif "rdf+xml" in ct or "xml" in ct:
                    fmt = "xml"
                elif "json" in ct:
                    fmt = "json-ld"
                else:
                    fmt = fallback_fmt
                break
            fetch_errors.append(f"HTTP {r.status_code}")
        except Exception as e:
            fetch_errors.append(str(e))

    if content is None:
        return jsonify({"error": "Could not fetch ontology", "details": fetch_errors}), 400

    # Parse RDF graph
    g = Graph()
    try:
        g.parse(_io.BytesIO(content), format=fmt)
    except Exception:
        try:
            g.parse(_io.BytesIO(content))   # let rdflib auto-detect
        except Exception as e2:
            return jsonify({"error": f"RDF parse error: {e2}"}), 400

    # Build prefix map
    prefixes = {str(p): str(ns) for p, ns in g.namespaces() if p}

    def abbrev(uri):
        uri = str(uri)
        for pf_str, ns_str in g.namespaces():
            ns_s = str(ns_str)
            if uri.startswith(ns_s) and pf_str:
                local = uri[len(ns_s):]
                if local and (local[0].isalpha() or local[0] == '_'):
                    return f"{pf_str}:{local}"
        return ""

    # ── Determine "own" namespaces ────────────────────────────────────────────
    # Only keep classes/predicates whose IRI belongs to this ontology's own
    # namespace(s), not imported external ontologies (owl, rdfs, foaf, …).
    #
    # Strategy:
    #  1. Collect the IRI of every owl:Ontology declaration in the graph.
    #  2. For each such IRI, its namespace is that IRI itself (w/ trailing / or #).
    #  3. Also include any declared prefix whose namespace IRI shares the same
    #     URL path-prefix as the fetched URL (catches ontologies that split
    #     terms across two closely related prefix URIs, e.g. ssn+sosa).
    from rdflib.namespace import OWL as _OWL, RDF as _RDF

    own_ns: set[str] = set()

    # From owl:Ontology declarations
    for onto_iri in g.subjects(_RDF.type, _OWL.Ontology):
        s = str(onto_iri).rstrip("/#")
        own_ns.add(s + "/")
        own_ns.add(s + "#")
        own_ns.add(s)          # bare form (rare but safe)

    # From declared prefix namespaces that overlap with the fetched URL
    url_stripped = url.rstrip("/#")
    for _pf, _ns in g.namespaces():
        _ns_s = str(_ns).rstrip("/#")
        if not _ns_s:
            continue
        # namespace is a prefix of the url, or url is a prefix of the namespace
        if url_stripped.startswith(_ns_s) or _ns_s.startswith(url_stripped):
            own_ns.add(str(_ns))

    # Fallback: if we found nothing (e.g. no owl:Ontology triple), accept all
    filter_active = bool(own_ns)

    def is_own(uri_node) -> bool:
        if not filter_active:
            return True
        uri_s = str(uri_node)
        return any(uri_s.startswith(ns) for ns in own_ns)

    # Extract classes
    classes_q = """
    PREFIX owl:  <http://www.w3.org/2002/07/owl#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    SELECT DISTINCT ?cls WHERE {
        { ?cls a owl:Class } UNION { ?cls a rdfs:Class }
        FILTER(isIRI(?cls))
    } ORDER BY ?cls
    """
    # Extract properties
    props_q = """
    PREFIX owl: <http://www.w3.org/2002/07/owl#>
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    SELECT DISTINCT ?prop WHERE {
        { ?prop a owl:ObjectProperty } UNION { ?prop a owl:DatatypeProperty }
        UNION { ?prop a owl:AnnotationProperty } UNION { ?prop a owl:FunctionalProperty }
        UNION { ?prop a rdf:Property }
        FILTER(isIRI(?prop))
    } ORDER BY ?prop
    """
    # Ontology IRI/label for naming
    name_q = """
    PREFIX owl:  <http://www.w3.org/2002/07/owl#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    SELECT ?onto ?label WHERE {
        ?onto a owl:Ontology .
        OPTIONAL { ?onto rdfs:label ?label }
    } LIMIT 1
    """

    classes    = sorted({abbrev(r.cls)  for r in g.query(classes_q) if abbrev(r.cls)  and is_own(r.cls)})
    predicates = sorted({abbrev(r.prop) for r in g.query(props_q)   if abbrev(r.prop) and is_own(r.prop)})

    # ── HTML TOC supplement (W3C respec pages) ───────────────────────────────
    # For pages that expose <ol class="toc" role="directory">, extract
    # class/property names from the TOC and merge with RDF results.
    # This captures terms that W3C specs list in their Table of Contents.
    try:
        html_r = _req.get(url, headers={"Accept": "text/html"}, timeout=15,
                          allow_redirects=True)
        if html_r.status_code == 200 and "html" in html_r.headers.get("Content-Type", ""):
            h_cls, h_preds, h_pfx = _parse_w3c_html_toc(html_r.text)
            if h_cls or h_preds:
                classes    = sorted(set(classes)    | set(h_cls))
                predicates = sorted(set(predicates) | set(h_preds))
                # Supplement prefixes (don't overwrite RDF-authoritative entries)
                for pf, ns in h_pfx.items():
                    if pf not in prefixes:
                        prefixes[pf] = ns
    except Exception:
        pass    # HTML supplement is always best-effort

    onto_name = url.split("/")[-1].split("?")[0] or url
    for row in g.query(name_q):
        if getattr(row, "label", None):
            onto_name = str(row.label)
        elif getattr(row, "onto", None):
            s = str(row.onto).rstrip("/")
            onto_name = s.split("/")[-1].split("#")[0] or onto_name
        break

    pf_counter = Counter()
    for term in classes + predicates:
        if ":" in term:
            pf_counter[term.split(":")[0]] += 1
    main_pf = pf_counter.most_common(1)[0][0] if pf_counter else ""

    return jsonify({
        "name": onto_name,
        "mainPrefix": main_pf,
        "classes": classes,
        "predicates": predicates,
        "prefixes": prefixes,
        "url": url,
    })


@bp.route("/run", methods=["POST"])
def sparql_run_query():
    try:
        from rdflib import Graph
        import io as _io

        data = request.get_json(force=True)
        sparql_q = (data.get("query") or "").strip()
        project_ids = data.get("project_ids") or []
        env_id = data.get("env_id")
        all_projects = data.get("all_projects", False)

        if not sparql_q:
            return jsonify({"error": "No query provided"}), 400

        projects_data = load_projects()

        if all_projects:
            target_ids = list(projects_data.keys())
        else:
            target_ids = list(project_ids)
            if env_id:
                envs = load_environments()
                for eid in get_env_project_ids(env_id, projects_data, envs):
                    if eid not in target_ids:
                        target_ids.append(eid)

        if not target_ids:
            return jsonify({"error": "No projects selected"}), 400

        g = Graph()
        for pid in target_ids:
            proj = projects_data.get(pid)
            if not proj:
                continue
            try:
                ttl = generate_rdf(proj)
                g.parse(_io.StringIO(ttl), format="turtle")
            except Exception:
                pass

        results = g.query(sparql_q)
        vars_ = [str(v) for v in results.vars]
        rows = []
        for row in results:
            cells = []
            for v in results.vars:
                val = row[v]
                cells.append(str(val) if val is not None else "")
            rows.append(cells)

        return jsonify({"vars": vars_, "rows": rows})

    except Exception as e:
        import traceback

        return jsonify({"error": str(e), "trace": traceback.format_exc()[-600:]}), 500
