"""Language-agnostic filters for overview / structure / data graph views."""

from __future__ import annotations

from typing import Any

GraphNode = dict[str, Any]
GraphEdge = dict[str, Any]


def focus_options(nodes: Any) -> list[dict[str, Any]]:
    return [
        {
            "id": node["id"],
            "label": node["label"],
            "kind": node.get("card", {}).get("kind"),
            "line": node.get("metadata", {}).get("line"),
        }
        for node in nodes
        if node.get("card", {}).get("kind") in {"class", "function"}
    ]


def default_focus(nodes: list[GraphNode], view: str, fallback_id: str | None) -> str | None:
    if view == "overview":
        return None
    users = [node for node in nodes if not node["id"].startswith("static:context:")]
    classes = [node for node in users if node.get("card", {}).get("kind") == "class"]
    if classes:
        classes.sort(key=lambda node: (node.get("metadata", {}).get("line") or 0, node["id"]))
        return classes[-1]["id"]
    functions = [
        node for node in users
        if node.get("card", {}).get("kind") == "function" and node.get("label") != "__main__"
    ]
    if functions:
        functions.sort(key=lambda node: (node.get("metadata", {}).get("line") or 0, node["id"]))
        return functions[-1]["id"]
    all_classes = [node for node in nodes if node.get("card", {}).get("kind") == "class"]
    if all_classes:
        all_classes.sort(key=lambda node: (node.get("metadata", {}).get("line") or 0, node["id"]))
        return all_classes[-1]["id"]
    return fallback_id if fallback_id and any(node["id"] == fallback_id for node in nodes) else None


def select_graph_view(
    nodes: list[GraphNode],
    edges: list[GraphEdge],
    view: str,
    focus: str | None,
    fallback_id: str | None = None,
) -> tuple[list[GraphNode], list[GraphEdge], str | None]:
    view = view if view in {"overview", "structure", "data"} else "overview"
    node_map = {node["id"]: node for node in nodes}
    selected = focus if focus in node_map else default_focus(nodes, view, fallback_id)
    if view == "overview":
        return _overview(nodes, edges)
    if view == "data":
        return _data(nodes, edges, selected)
    return _structure(nodes, edges, selected)


def _overview(nodes: list[GraphNode], edges: list[GraphEdge]) -> tuple[list[GraphNode], list[GraphEdge], str | None]:
    primary = {"module", "class", "function", "import"}
    candidates = [node for node in nodes if node.get("card", {}).get("kind") in primary]
    if len(candidates) > 18:
        degree: dict[str, int] = {node["id"]: 0 for node in candidates}
        candidate_ids = set(degree)
        for edge in edges:
            if edge["from"] in candidate_ids and edge["to"] in candidate_ids:
                degree[edge["from"]] += 1
                degree[edge["to"]] += 1
        kind_rank = {"module": 0, "class": 1, "function": 2, "import": 3}
        candidates.sort(
            key=lambda node: (
                kind_rank.get(node.get("card", {}).get("kind"), 9),
                -degree[node["id"]],
                -(node.get("metadata", {}).get("line") or 0),
            )
        )
        included = {node["id"] for node in candidates[:18]}
    else:
        included = {node["id"] for node in candidates}
    method_to_class: dict[str, str] = {}
    for edge in edges:
        if edge["kind"] == "method":
            method_to_class[edge["to"]] = edge["from"]
    included -= set(method_to_class)
    kept = [
        edge for edge in edges
        if edge["from"] in included and edge["to"] in included
        and edge["kind"] in {"defines", "nested", "inherits", "imports", "uses", "calls"}
    ]
    for edge in edges:
        if edge["kind"] != "calls" or edge["from"] not in method_to_class:
            continue
        owner_class = method_to_class[edge["from"]]
        if owner_class in included and edge["to"] in included:
            kept.append({
                "id": f"overview-lift:{edge['from']}:{edge['to']}",
                "from": owner_class,
                "to": edge["to"],
                "kind": "calls",
                "label": edge.get("label"),
            })
    external = [node_id for node_id in included if any(node["id"] == node_id and node.get("card", {}).get("kind") == "external" for node in nodes)]
    if len(external) > 24:
        included -= set(external[24:])
        kept = [edge for edge in kept if edge["from"] in included and edge["to"] in included]
    view_nodes, view_edges = _collect(nodes, kept, included)
    return view_nodes, view_edges, None


def _structure(nodes: list[GraphNode], edges: list[GraphEdge], focus: str | None) -> tuple[list[GraphNode], list[GraphEdge], str | None]:
    if not focus:
        return _overview(nodes, edges)
    focus_node = next((node for node in nodes if node["id"] == focus), None)
    if focus_node is not None and focus_node.get("card", {}).get("kind") == "class":
        # Class level stays one hop deep: fields, methods and bases. Focus a
        # method to inspect its parameters, variables and calls.
        allowed = {"field", "method", "inherits", "nested"}
        targets = [edge["to"] for edge in edges if edge["from"] == focus and edge["kind"] in allowed]
        included: set[str] = {focus} | set(_limited_members(nodes, targets, fields=6, methods=6))
        kept = [
            edge for edge in edges
            if edge["from"] in included and edge["to"] in included
            and edge["kind"] in allowed | {"contains"}
        ]
        view_nodes, view_edges = _collect(nodes, kept, included)
        view_nodes, view_edges = _without_calls(view_nodes, view_edges)
        return view_nodes, view_edges, focus
    included: set[str] = {focus}
    queue = [focus]
    boundary = {"calls", "targets", "inherits", "imports", "uses"}
    internal = {"parameter", "defines", "contains", "writes", "reads", "produces", "flows", "returns", "iterates", "nested"}
    outgoing: dict[str, list[GraphEdge]] = {}
    for edge in edges:
        outgoing.setdefault(edge["from"], []).append(edge)
    while queue and len(included) < 36:
        current = queue.pop(0)
        for edge in outgoing.get(current, []):
            target = edge["to"]
            if target in included:
                continue
            if edge["kind"] in internal:
                included.add(target)
                queue.append(target)
            elif edge["kind"] in boundary:
                included.add(target)
    kept = [
        edge for edge in edges
        if edge["from"] in included and edge["to"] in included
        and edge["kind"] in internal | boundary
    ]
    view_nodes, view_edges = _collect(nodes, kept, included)
    view_nodes, view_edges = _without_calls(view_nodes, view_edges)
    return view_nodes, view_edges, focus


def _data(nodes: list[GraphNode], edges: list[GraphEdge], focus: str | None) -> tuple[list[GraphNode], list[GraphEdge], str | None]:
    if not focus:
        return _overview(nodes, edges)
    focus_node = next((node for node in nodes if node["id"] == focus), None)
    if focus_node is not None and focus_node.get("card", {}).get("kind") == "class":
        # Class data stays at field/parameter level; focus a method to see its
        # local variables and containers.
        data_edges = {"field", "parameter", "defines"}
        targets = [edge["to"] for edge in edges if edge["from"] == focus and edge["kind"] in data_edges]
        included: set[str] = {focus} | set(_limited_members(nodes, targets, fields=12, methods=0))
        kept = [
            edge for edge in edges
            if edge["from"] in included and edge["to"] in included
            and edge["kind"] in data_edges
        ]
        view_nodes, view_edges = _collect(nodes, kept, included)
        return view_nodes, view_edges, focus
    included: set[str] = {focus}
    queue = [focus]
    data_kinds = {"variable", "parameter", "struct", "list", "dict", "set", "array", "matrix", "tensor", "pointer", "class", "function"}
    internal = {"parameter", "defines", "field", "flows", "produces", "contains", "writes", "reads", "returns", "iterates"}
    outgoing: dict[str, list[GraphEdge]] = {}
    for edge in edges:
        outgoing.setdefault(edge["from"], []).append(edge)
    while queue and len(included) < 36:
        current = queue.pop(0)
        for edge in outgoing.get(current, []):
            target = edge["to"]
            if target in included or edge["kind"] not in internal:
                continue
            node = next((item for item in nodes if item["id"] == target), None)
            if node and node.get("card", {}).get("kind") in data_kinds:
                included.add(target)
                queue.append(target)
    kept = [
        edge for edge in edges
        if edge["from"] in included and edge["to"] in included
        and edge["kind"] in internal | {"targets", "calls"}
    ]
    view_nodes, view_edges = _collect(nodes, kept, included)
    return view_nodes, view_edges, focus


def _collect(nodes: list[GraphNode], edges: list[GraphEdge], included: set[str]) -> tuple[list[GraphNode], list[GraphEdge]]:
    return (
        [node for node in nodes if node["id"] in included],
        [edge for edge in edges if edge["from"] in included and edge["to"] in included],
    )


def _limited_members(
    nodes: list[GraphNode], target_ids: list[str], *, fields: int, methods: int
) -> list[str]:
    node_map = {node["id"]: node for node in nodes}
    buckets: dict[int, list[GraphNode]] = {0: [], 1: [], 2: [], 3: []}
    for target in target_ids:
        node = node_map.get(target)
        if node is None:
            continue
        kind = node.get("card", {}).get("kind")
        rank = 0 if kind == "class" else 1 if kind in {"variable", "parameter"} else 2 if kind == "function" else 3
        buckets[rank].append(node)
    for bucket in buckets.values():
        bucket.sort(key=lambda node: node.get("metadata", {}).get("line") or 0)
    return [
        node["id"]
        for node in [*buckets[0][:4], *buckets[1][:fields], *buckets[2][:methods], *buckets[3][:4]]
    ]


def _without_calls(
    nodes: list[GraphNode], edges: list[GraphEdge]
) -> tuple[list[GraphNode], list[GraphEdge]]:
    # Calls are already represented by caller -> target edges; call cards make
    # a function view unreadable without adding durable structure.
    visible = {node["id"] for node in nodes if node.get("card", {}).get("kind") != "call"}
    return (
        [node for node in nodes if node["id"] in visible],
        [edge for edge in edges if edge["from"] in visible and edge["to"] in visible],
    )
