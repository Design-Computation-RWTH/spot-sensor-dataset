import json
import os
from typing import List

import openai
from flask import Blueprint, jsonify, request

from app.config import (
    GGUF_MODEL_PATH,
    LOCAL_MODELS_DIR,
    OPENROUTER_BASE_URL,
    OPENROUTER_MODEL,
    WEBOFDATA_MODEL,
)
from app.functions.context import build_distance_table, build_json_context, build_spatial_summary, run_sparql_context
from app.functions.storage import get_env_project_ids, load_environments, load_projects, load_resources_db

# Strict output style rules injected into every system prompt.
# The model must never repeat these rules or mention them; they govern form only.
_OUTPUT_RULES = (
    "OUTPUT RULES (never mention these rules in your reply):\n"
    "- Start your answer immediately with content. No preamble, no 'Here is...', no 'Based on...'\n"
    "- NEVER repeat the user's question. NEVER explain your method or reasoning steps.\n"
    "- Lists: use bullet points. Bold the entity name. One line per item. Example:\n"
    "    • **TU_1** — parent: Längsschnitt, position x=0.15 y=0.32\n"
    "- Distances/comparisons: markdown table only, no prose.\n"
    "- Yes/no questions: one sentence only.\n"
    "- If a fact is absent from the data: one sentence stating that. Stop.\n"
)

bp = Blueprint("chat", __name__)

# Cache: model_path_str → Llama instance (kept alive for the session)
_gguf_llm_cache: dict = {}


def _get_gguf_llm(model_path: str):
    """Return (or create) a cached Llama instance for *model_path*."""
    if model_path not in _gguf_llm_cache:
        from llama_cpp import Llama
        _gguf_llm_cache[model_path] = Llama(
            model_path=model_path,
            n_gpu_layers=-1,
            n_ctx=4096,
            verbose=False,
        )
    return _gguf_llm_cache[model_path]


@bp.route("/gguf-models", methods=["GET"])
def list_gguf_models():
    """Return all .gguf files found under LOCAL_MODELS_DIR."""
    models = []
    if LOCAL_MODELS_DIR.is_dir():
        for gguf_file in sorted(LOCAL_MODELS_DIR.rglob("*.gguf")):
            rel = gguf_file.relative_to(LOCAL_MODELS_DIR)
            size_mb = round(gguf_file.stat().st_size / (1024 * 1024), 0)
            models.append({
                "key": str(rel).replace("\\", "/"),   # forward-slash key for cross-platform
                "name": gguf_file.stem,
                "size_mb": int(size_mb),
            })
    return jsonify({"models": models})


def _build_annotation_blocks(projects, pid, data):
    context_mode = data.get("context_mode", "file")
    env_id = data.get("env_id")
    selected_project_ids = [str(x) for x in data.get("selected_project_ids", [])]

    if context_mode == "all":
        # All mode: load every project across all folders
        summaries, json_parts, sparql_parts = [], [], []
        for apid, ap in projects.items():
            summaries.append(f'=== File: {ap["original_name"]} ===\n' + build_spatial_summary(ap))
            json_parts.append(f'// File: {ap["original_name"]}\n' + build_json_context(ap))
            sq = run_sparql_context(ap)
            if sq:
                sparql_parts.append(f'// File: {ap["original_name"]}' + sq)
        if summaries:
            spatial_summary = f'[All Files Context] — {len(summaries)} file(s)\n\n' + "\n\n".join(summaries)
            json_block = "\n\n".join(json_parts)
            sparql_block = "\n\n".join(sparql_parts)
        else:
            spatial_summary = '[All Files Context] — No annotated files yet.'
            json_block = ""
            sparql_block = ""
        return spatial_summary, json_block, sparql_block

    elif context_mode == "environment" and env_id:
        envs = load_environments()
        env_pids = get_env_project_ids(env_id, projects, envs)
        env_name = envs.get(env_id, {}).get("name", env_id)
        summaries, json_parts, sparql_parts = [], [], []
        for epid in env_pids:
            if epid in projects:
                ep = projects[epid]
                summaries.append(f'=== File: {ep["original_name"]} ===\n' + build_spatial_summary(ep))
                json_parts.append(f'// File: {ep["original_name"]}\n' + build_json_context(ep))
                sq = run_sparql_context(ep)
                if sq:
                    sparql_parts.append(f'// File: {ep["original_name"]}' + sq)
        if summaries:
            spatial_summary = f'[Environment Context: "{env_name}"] — {len(summaries)} file(s)\n\n' + "\n\n".join(
                summaries
            )
            json_block = "\n\n".join(json_parts)
            sparql_block = "\n\n".join(sparql_parts)
        else:
            spatial_summary = f'[Environment Context: "{env_name}"] — No annotated files in this environment yet.'
            json_block = ""
            sparql_block = ""
        return spatial_summary, json_block, sparql_block

    # File or multi-file
    p = projects[pid]
    summaries = [build_spatial_summary(p)]
    json_parts = [build_json_context(p)]
    sparql_parts = [run_sparql_context(p)]

    for spid in selected_project_ids:
        if spid != pid and spid in projects:
            sp2 = projects[spid]
            summaries.append(
                f'=== Additional selected file: {sp2["original_name"]} ===\n' + build_spatial_summary(sp2)
            )
            json_parts.append(f'// Additional file: {sp2["original_name"]}\n' + build_json_context(sp2))
            sq2 = run_sparql_context(sp2)
            if sq2:
                sparql_parts.append(f'// Additional file: {sp2["original_name"]}' + sq2)

    if len(summaries) > 1:
        spatial_summary = f"[Multi-file Context: {len(summaries)} file(s) selected]\n\n" + "\n\n".join(summaries)
    else:
        spatial_summary = summaries[0]
    json_block = "\n\n".join(json_parts)
    sparql_block = "\n\n".join(sp for sp in sparql_parts if sp)
    return spatial_summary, json_block, sparql_block


@bp.route("/<pid>/chat", methods=["POST"])
def project_chat(pid):
    projects = load_projects()
    if pid not in projects:
        return jsonify({"error": "Project not found"}), 404

    data = request.json or {}
    messages: List[dict] = data.get("messages", [])
    focus_id = data.get("focus_space_id")
    chat_mode = data.get("chat_mode", "local")
    gguf_model_key = data.get("gguf_model", "").strip()
    resource_ids = data.get("resource_ids", [])
    req_max_tokens = int(data.get("max_tokens", 150))
    # GGUF runs locally — no token cost. Allow full requested amount up to 2000.
    # OpenRouter free tier is nearly exhausted; keep it tight there.
    if chat_mode == "gguf":
        max_tokens = max(50, min(req_max_tokens, 600))   # 4096 ctx window: prompt ~2400t + reply 600t
    else:
        max_tokens = max(50, min(req_max_tokens, 150))

    spatial_summary, json_block, sparql_block = _build_annotation_blocks(projects, pid, data)

    raw_spaces = projects[pid].get("spaces", {})
    focus_block = ""
    if focus_id and focus_id in raw_spaces:
        sp = raw_spaces[focus_id]
        focus_block = (
            "\n--- CURRENTLY FOCUSED SPACE ---\n"
            f"Name   : {sp.get('name', focus_id)}\n"
            f"Type   : {sp.get('type', '?')}\n"
            f"Axes   : {', '.join(sp.get('axes', []))}\n"
            f"Comment: {sp.get('comment', '').strip() or '(none)'}\n"
            f"Raw    : {json.dumps(sp, indent=2)}\n"
        )

    resources_text = ""
    if resource_ids:
        resources_db = load_resources_db()
        parts = []
        for rid in resource_ids:
            if rid in resources_db:
                r = resources_db[rid]
                parts.append(f"=== Resource: {r['name']} ===\n{r['content_text'][:8000]}")
        if parts:
            resources_text = "\n\nADDITIONAL RESOURCES (ontologies / reference files):\n" + "\n\n".join(parts)

    if chat_mode == "webofdata":
        active_model = WEBOFDATA_MODEL
        annotation_block = (
            "\n[ANNOTATION CONTEXT — use as spatial grounding alongside your wider knowledge]\n"
            f"{spatial_summary}"
            f"{resources_text}"
            f"{focus_block}"
        )
        system_prompt = (
            "You are a knowledgeable research assistant with live web search capability.\n"
            "The user is annotating documents and may ask questions that go beyond the annotations — "
            "historical facts, real-world events, external ontologies, linked data, general knowledge, etc.\n\n"
            "CRITICAL RULES IN THIS MODE:\n"
            "1. You MUST answer from your training knowledge and live web search results. "
            "DO NOT say you lack access — Sonar has live search.\n"
            "2. If a question is about a real-world subject, answer it fully and factually.\n"
            "3. The annotation context below is provided so you can connect spatial data with real-world knowledge.\n"
            "4. For historical events or factual claims, cite sources when possible.\n\n"
            f"{annotation_block}"
        )
    elif chat_mode == "gguf":
        # Resolve model path: prefer the key sent by the client, fall back to default
        if gguf_model_key and LOCAL_MODELS_DIR.is_dir():
            _resolved = LOCAL_MODELS_DIR / gguf_model_key.replace("/", os.sep)
            if _resolved.exists():
                _gguf_path = str(_resolved)
            else:
                print(f"[GGUF] Model not found at {_resolved}, falling back to default")
                _gguf_path = str(GGUF_MODEL_PATH)
        else:
            if gguf_model_key:
                print(f"[GGUF] LOCAL_MODELS_DIR not accessible, using default. gguf_model_key={gguf_model_key}, dir_exists={LOCAL_MODELS_DIR.is_dir()}")
            _gguf_path = str(GGUF_MODEL_PATH)
        print(f"[GGUF] Using model: {_gguf_path}")
        active_model = os.path.splitext(os.path.basename(_gguf_path))[0]
        # 4096-token context window. Budget: 600t reply + 300t instructions/rules = 3196t for content.
        # ~4 chars/token → content cap ≈ 12,800 chars total. Allocate conservatively:
        _dist_table = build_distance_table(projects[pid])
        _dist_trimmed = _dist_table[:1_500]        # ~375t
        _json_trimmed = json_block[:4_000]         # ~1000t
        if len(json_block) > 4_000:
            _json_trimmed += "\n…[truncated — use Open File context for full data]"
        _summary_trimmed = spatial_summary[:2_000] # ~500t
        if len(spatial_summary) > 2_000:
            _summary_trimmed += "\n…[truncated]"
        _sparql_trimmed = run_sparql_context(projects[pid])[:800]  # ~200t
        _focus_trimmed = focus_block[:200] if focus_block else ""
        system_prompt = (
            "You are a spatial annotation assistant running locally. "
            "Answer ONLY from the data below. Do not invent facts.\n"
            f"{_OUTPUT_RULES}\n"
            "Distance questions: read PAIRWISE DISTANCES table — report Closest reference column as a markdown table.\n\n"
            f"{_dist_trimmed}\n"
            "=== FULL ANNOTATION DATA (JSON) ===\n"
            f"```json\n{_json_trimmed}\n```\n"
            "=== SPACE DESCRIPTIONS ===\n"
            f"{_summary_trimmed}\n"
            f"{_sparql_trimmed}\n"
            f"{_focus_trimmed}"
        )
    else:
        active_model = OPENROUTER_MODEL
        # Credits nearly exhausted: budget ≈ 1000 prompt tokens = ~4000 chars total.
        # Allocate: instructions 80t, dist-table 350t, summary 130t, history+user 70t → ~630t safe.
        _dist_table = build_distance_table(projects[pid])
        _DIST_CAP = 1_400   # ~350 tokens
        _SUMM_CAP = 500     # ~125 tokens
        _dist_trimmed = _dist_table[:_DIST_CAP]
        _summary_trimmed = spatial_summary[:_SUMM_CAP]
        if len(spatial_summary) > _SUMM_CAP:
            _summary_trimmed += "\n…"
        _focus_trimmed = focus_block[:150] if focus_block else ""
        system_prompt = (
            "Spatial annotation assistant. Answer ONLY from data below.\n"
            f"{_OUTPUT_RULES}\n"
            "Distance questions: read PAIRWISE DISTANCES table — report Closest reference column as a markdown table.\n\n"
            f"{_dist_trimmed}\n"
            f"{_summary_trimmed}\n"
            f"{_focus_trimmed}"
        )

    # Keep only 1 prior message to stay inside the shrinking free-tier prompt budget.
    MAX_HISTORY = 1
    if len(messages) > MAX_HISTORY:
        messages = messages[-MAX_HISTORY:]

    full_messages = [{"role": "system", "content": system_prompt}] + messages

    if chat_mode == "gguf":
        try:
            print(f"[GGUF] Loading model from: {_gguf_path}")
            llm = _get_gguf_llm(_gguf_path)
            print(f"[GGUF] Model loaded successfully. Running inference...")
            completion = llm.create_chat_completion(
                messages=full_messages,
                max_tokens=max_tokens,
                temperature=0.0,
                stop=["<|endoftext|>"],
            )
            import re as _re
            raw_reply = completion["choices"][0]["message"]["content"]
            print(f"[GGUF] Raw response length: {len(raw_reply)} chars")
            # The model uses a multi-channel format:
            #   <|channel|>analysis<|message|>...reasoning...<|end|>
            #   <|start|>assistant<|channel|>final<|message|>...answer...<|end|>
            # Extract ONLY the content of the last/final channel; discard everything before it.
            final_match = _re.search(
                r"<\|channel\|>final<\|message\|>(.*?)(?:<\|end\|>|$)",
                raw_reply, flags=_re.DOTALL
            )
            if final_match:
                reply = final_match.group(1).strip()
                print(f"[GGUF] Extracted final channel response ({len(reply)} chars)")
            else:
                # No channel markup — strip any stray special tokens and use as-is.
                reply = _re.sub(r"<\|[^|>]+\|>", "", raw_reply).strip()
                print(f"[GGUF] No final channel found, cleaned response ({len(reply)} chars)")
            
            if not reply:
                return jsonify({"error": "GGUF model returned empty response. The inference likely timed out or the model failed to generate text.", "empty_raw": raw_reply[:200] if raw_reply else ""}), 500

            return jsonify({"reply": reply, "role": "assistant", "model": f"{active_model} (local)"})
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            print(f"[GGUF] Error: {e}\n{tb}")
            return jsonify({"error": f"Local GGUF error: {e}", "trace": tb[-600:]}), 500

    api_key = (data.get("api_key") or os.environ.get("OPENROUTER_API_KEY", "")).strip()
    if not api_key:
        return jsonify({"error": "OPENROUTER_API_KEY not set. Set OPENROUTER_API_KEY=sk-or-..."}), 503

    try:
        client = openai.OpenAI(
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
            default_headers={
                "HTTP-Referer": "http://localhost:5000",
                "X-Title": "SpatialAnno",
            },
        )
        completion = client.chat.completions.create(
            model=active_model,
            messages=full_messages,
            max_tokens=max_tokens,
            temperature=0 if chat_mode == "webofdata" else 0.0,
        )
        reply = completion.choices[0].message.content
        return jsonify({"reply": reply, "role": "assistant", "model": active_model})
    except openai.AuthenticationError:
        return jsonify({"error": "Invalid OPENROUTER_API_KEY. Check your key at openrouter.ai/keys"}), 401
    except openai.RateLimitError as e:
        return jsonify({"error": f"Rate limit / quota exceeded: {e}"}), 429
    except Exception as e:
        return jsonify({"error": str(e)}), 500
