"""Python static structure analysis for the isolated workbench.

This is deliberately a structural/mind-map pass, not a type checker and not a
replacement for runtime data. Unknown values remain unknown; no object identity
is inferred from source text.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .graph_views import default_focus, focus_options, select_graph_view

MAX_NODES = 320
MAX_EDGES = 520
MAX_VARS_PER_SCOPE = 80
MAX_CALLS_PER_SCOPE = 80

CONTEXT_END_MARKER = "# ==== end context ===="
CONTEXT_START_MARKER = "# ==== Thinking Canvas context"


@dataclass
class SourceIndex:
    imports: dict[str, tuple[str, int]] = field(default_factory=dict)
    definitions: dict[str, ast.AST] = field(default_factory=dict)
    annotations: dict[str, str] = field(default_factory=dict)


class StaticAnalyzer:
    def __init__(
        self,
        *,
        workbench_path: Path,
        workbench_source: str,
        source_path: Path | None,
        source_source: str | None,
    ) -> None:
        self.workbench_path = workbench_path
        self.workbench_rel = workbench_path.name
        self.source_path = source_path
        self.source_rel = source_path.name if source_path else None
        self.workbench_source = workbench_source
        self.source_source = source_source
        self.nodes: dict[str, dict[str, Any]] = {}
        self.edges: dict[str, dict[str, Any]] = {}
        self.edge_keys: set[tuple[str, str, str, str]] = set()
        self.workbench_symbols: dict[str, str] = {}
        self.workbench_imports: dict[str, str] = {}
        self.context_module_id: str | None = None
        self.inherited_ids: dict[str, str] = {}
        self.truncated = False
        self.missing: set[str] = set()
        self.source = SourceIndex()
        self._function_values = 0
        self._function_calls = 0
        self._context_end_line = _context_end_line(workbench_source)

    def analyze(self, view: str = "overview", focus: str | None = None) -> dict[str, Any]:
        try:
            tree = ast.parse(self.workbench_source, filename=str(self.workbench_path))
        except SyntaxError as exc:
            return {
                "error": f"SyntaxError: {exc.msg} (line {exc.lineno})",
                "scene": {"nodes": [], "edges": []},
                "coverage": {"state": "unknown", "reason": "The file has a syntax error.", "knownMissing": ["static structure"]},
                "stats": {"nodes": 0, "edges": 0, "functions": 0, "classes": 0},
            }
        if self.source_source is not None:
            try:
                self.source = _index_source(ast.parse(self.source_source, filename=str(self.source_path)))
            except SyntaxError:
                self.source = SourceIndex()
                self.missing.add("source file has a syntax error")
        module_id = self._node(
            f"static:module:{self.workbench_rel}",
            self.workbench_rel,
            {"kind": "module", "path": self.workbench_rel, "source": self.source_rel},
            line=None,
        )
        if module_id is None:
            raise RuntimeError("could not create module node")
        top_level = [
            stmt for stmt in tree.body
            if getattr(stmt, "lineno", 0) > self._context_end_line
        ]
        for stmt in top_level:
            self._module_statement(stmt, module_id)
        coverage_state = "partial" if self.truncated or self.missing else "complete"
        all_nodes = list(self.nodes.values())
        all_edges = list(self.edges.values())
        options = focus_options(all_nodes)
        view = view if view in {"overview", "structure", "data"} else "overview"
        module_id = f"static:module:{self.workbench_rel}"
        selected_focus = focus if focus in self.nodes else default_focus(all_nodes, view, module_id)
        view_nodes, view_edges, selected_focus = select_graph_view(all_nodes, all_edges, view, selected_focus, module_id)
        hidden = len(self.nodes) - len(view_nodes)
        return {
            "scene": {"nodes": view_nodes, "edges": view_edges},
            "coverage": {
                "state": coverage_state,
                "reason": "Static analysis budget reached." if self.truncated else None,
                "knownMissing": sorted(self.missing),
            },
            "stats": {
                "nodes": len(view_nodes),
                "edges": len(view_edges),
                "functions": sum(1 for node in view_nodes if node.get("card", {}).get("kind") == "function"),
                "classes": sum(1 for node in view_nodes if node.get("card", {}).get("kind") == "class"),
            },
            "sourceFile": self.source_rel,
            "traceLines": executable_lines(self.workbench_source),
            "origin": "static",
            "view": view,
            "focus": selected_focus,
            "focusOptions": options,
            "hiddenNodeCount": hidden,
        }

    def _module_statement(self, stmt: ast.stmt, module_id: str) -> None:
        if isinstance(stmt, (ast.Import, ast.ImportFrom)):
            self._import(stmt, module_id)
            return
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            self._function(stmt, module_id, qualname=stmt.name)
            return
        if isinstance(stmt, ast.ClassDef):
            self._class(stmt, module_id, qualname=stmt.name)
            return
        if isinstance(stmt, ast.If) and _is_main_guard(stmt.test):
            test_id = self._node(
                "static:test:main",
                "__main__ · 测试入口",
                {"kind": "function", "signature": "__main__()", "input": "测试输入", "output": "调试入口", "line": stmt.lineno},
                line=stmt.lineno,
            )
            if test_id:
                self._edge(module_id, test_id, "defines", "__main__")
                scope: dict[str, str] = {}
                self._body(stmt.body, test_id, scope, None, None, in_loop=False)
            return
        if isinstance(stmt, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            self._assignment(stmt, module_id, {}, None, None, in_loop=False)
            return
        self._body([stmt], module_id, {}, None, None, in_loop=False)

    def _import(self, stmt: ast.Import | ast.ImportFrom, owner: str) -> None:
        if isinstance(stmt, ast.Import):
            for alias in stmt.names:
                local = alias.asname or alias.name.split(".")[0]
                target = alias.name
                node_id = self._import_node(target, [local])
                if node_id:
                    self.workbench_imports[local] = node_id
                    self._edge(owner, node_id, "imports", target)
            return
        module = stmt.module or ""
        names = [alias.name for alias in stmt.names]
        target = module or ", ".join(names)
        if target.startswith("tc_context_"):
            return
        node_id = self._import_node(target, names)
        if node_id:
            for alias in stmt.names:
                local = alias.asname or alias.name
                self.workbench_imports[local] = node_id
            self._edge(owner, node_id, "imports", target)

    def _import_node(self, target: str, names: list[str]) -> str | None:
        return self._node(
            f"static:import:{target}",
            target,
            {"kind": "import", "module": target, "names": names},
        )

    def _function(
        self,
        stmt: ast.FunctionDef | ast.AsyncFunctionDef,
        parent: str,
        *,
        qualname: str,
        class_id: str | None = None,
        class_fields: list[str] | None = None,
    ) -> str | None:
        if self._function_values >= MAX_VARS_PER_SCOPE:
            self.truncated = True
            return None
        self._function_values += 1
        function_id = f"static:function:{qualname}:{stmt.lineno}"
        signature, params, returns = _signature(stmt)
        if class_id:
            params = [item for item in params if item.split(":", 1)[0].strip() not in {"self", "cls"}]
            signature = f"{stmt.name}({', '.join(params)})"
            if returns:
                signature += f" -> {returns}"
        function_id = self._unique(function_id)
        card = {
            "kind": "function",
            "signature": signature,
            "input": ", ".join(params),
            "output": returns or "?",
            "params": params,
            "returns": returns,
            "line": stmt.lineno,
        }
        label = qualname if class_id else stmt.name
        if self._node(function_id, label, card, line=stmt.lineno) is None:
            return None
        self._edge(parent, function_id, "method" if class_id else "defines", stmt.name)
        scope: dict[str, str] = {}
        args = _iter_args(stmt.args)
        for arg, annotation, default in args:
            if class_id and arg in {"self", "cls"}:
                continue
            param_id = self._unique(f"static:param:{function_id}:{arg}")
            if self._node(param_id, arg, {
                "kind": "parameter",
                "name": arg,
                "type": annotation,
                "defaultValue": default,
            }) is None:
                continue
            scope[arg] = param_id
            self._edge(function_id, param_id, "parameter", annotation or "input")
            if class_id:
                self._edge(class_id, param_id, "parameter", "构造输入")
        self._body(stmt.body, function_id, scope, class_id, function_id, in_loop=False, class_fields=class_fields)
        self._function_values = 0
        return function_id

    def _class(self, stmt: ast.ClassDef, parent: str, *, qualname: str) -> str | None:
        class_id = self._unique(f"static:class:{qualname}:{stmt.lineno}")
        bases = [_expr_name(base) or "?" for base in stmt.bases]
        card_fields: list[str] = []
        card_methods: list[str] = []
        if self._node(class_id, stmt.name, {
            "kind": "class",
            "name": stmt.name,
            "bases": bases,
            "fields": card_fields,
            "methods": card_methods,
            "line": stmt.lineno,
        }, line=stmt.lineno) is None:
            return None
        self.workbench_symbols[stmt.name] = class_id
        self._edge(parent, class_id, "defines", stmt.name)
        for base in stmt.bases:
            base_name = _expr_name(base)
            if not base_name:
                continue
            base_id = self._resolve(base_name.split(".")[0], {})
            if base_id:
                self._edge(class_id, base_id, "inherits", base_name)
            else:
                external = self._node(
                    f"static:external:base:{base_name}",
                    base_name,
                    {"kind": "external", "target": base_name, "category": "base class"},
                )
                if external:
                    self._edge(class_id, external, "inherits", base_name)
        for item in stmt.body:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                card_methods.append(item.name)
                method_id = self._function(item, class_id, qualname=f"{stmt.name}.{item.name}", class_id=class_id, class_fields=card_fields)
                if method_id:
                    self._edge(class_id, method_id, "method", item.name)
            elif isinstance(item, (ast.Assign, ast.AnnAssign)):
                for name, annotation, value in _assigned_fields(item):
                    field_id = self._field(class_id, stmt.name, name, annotation, value)
                    if field_id and name not in card_fields:
                        card_fields.append(name)
            elif isinstance(item, ast.ClassDef):
                self._class(item, class_id, qualname=f"{stmt.name}.{item.name}")
        return class_id

    def _field(self, class_id: str, class_name: str, name: str, annotation: str | None, value: ast.expr | None) -> str | None:
        field_id = self._unique(f"static:field:{class_id}:{name}")
        card = _value_card(value, annotation)
        if self._node(field_id, name, card) is None:
            return None
        self._edge(class_id, field_id, "field", annotation or "field")
        return field_id

    def _body(
        self,
        statements: list[ast.stmt],
        owner: str,
        scope: dict[str, str],
        class_id: str | None,
        function_id: str | None,
        *,
        in_loop: bool,
        class_fields: list[str] | None = None,
    ) -> None:
        for stmt in statements:
            if isinstance(stmt, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                self._assignment(stmt, owner, scope, class_id, function_id, in_loop=in_loop, class_fields=class_fields)
            elif isinstance(stmt, ast.Return):
                self._return(stmt, owner, scope, function_id)
            elif isinstance(stmt, ast.For):
                self._loop(stmt, owner, scope, class_id, function_id, "for", stmt.target, stmt.iter, stmt.body)
            elif isinstance(stmt, ast.While):
                self._loop(stmt, owner, scope, class_id, function_id, "while", None, stmt.test, stmt.body)
            elif isinstance(stmt, ast.If):
                self._expr(stmt.test, owner, scope, class_id, function_id)
                self._body(stmt.body, owner, scope, class_id, function_id, in_loop=in_loop, class_fields=class_fields)
                self._body(stmt.orelse, owner, scope, class_id, function_id, in_loop=in_loop, class_fields=class_fields)
            elif isinstance(stmt, (ast.With, ast.AsyncWith)):
                for item in stmt.items:
                    self._expr(item.context_expr, owner, scope, class_id, function_id)
                self._body(stmt.body, owner, scope, class_id, function_id, in_loop=in_loop, class_fields=class_fields)
            elif isinstance(stmt, ast.Try):
                self._body(stmt.body, owner, scope, class_id, function_id, in_loop=in_loop, class_fields=class_fields)
                for handler in stmt.handlers:
                    self._body(handler.body, owner, scope, class_id, function_id, in_loop=in_loop, class_fields=class_fields)
                self._body(stmt.orelse, owner, scope, class_id, function_id, in_loop=in_loop, class_fields=class_fields)
                self._body(stmt.finalbody, owner, scope, class_id, function_id, in_loop=in_loop, class_fields=class_fields)
            elif isinstance(stmt, ast.Expr):
                self._expr(stmt.value, owner, scope, class_id, function_id)
            elif isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self._function(stmt, owner, qualname=stmt.name)
            elif isinstance(stmt, ast.ClassDef):
                self._class(stmt, owner, qualname=stmt.name)
            elif isinstance(stmt, ast.Assert):
                self._expr(stmt.test, owner, scope, class_id, function_id)

    def _assignment(
        self,
        stmt: ast.Assign | ast.AnnAssign | ast.AugAssign,
        owner: str,
        scope: dict[str, str],
        class_id: str | None,
        function_id: str | None,
        *,
        in_loop: bool,
        class_fields: list[str] | None = None,
    ) -> None:
        annotation = _annotation(stmt.annotation) if isinstance(stmt, ast.AnnAssign) else None
        value = getattr(stmt, "value", None)
        value_node = self._expr(value, owner, scope, class_id, function_id) if value is not None else None
        targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
        for target in targets:
            if isinstance(target, ast.Name):
                self._variable(target.id, annotation, value, scope, owner, class_id, function_id, value_node, in_loop)
            elif isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id == "self" and class_id:
                field_id = self._field(class_id, "", target.attr, annotation, value)
                if field_id:
                    self._edge(owner, field_id, "writes", target.attr)
                    if value_node:
                        self._edge(value_node, field_id, "flows", target.attr)
                    if function_id and class_fields is not None and target.attr not in class_fields:
                        class_fields.append(target.attr)
            elif isinstance(target, (ast.Tuple, ast.List)):
                for item in target.elts:
                    if isinstance(item, ast.Name):
                        self._variable(item.id, annotation, None, scope, owner, class_id, function_id, None, in_loop)

    def _variable(
        self,
        name: str,
        annotation: str | None,
        value: ast.expr | None,
        scope: dict[str, str],
        owner: str,
        class_id: str | None,
        function_id: str | None,
        value_node: str | None,
        in_loop: bool,
    ) -> None:
        if not name or name.startswith("_"):
            return
        scope_key = function_id or owner
        var_id = self._unique(f"static:var:{scope_key}:{name}")
        existing = var_id in self.nodes
        card = _value_card(value, annotation)
        if self._node(var_id, name, card) is None:
            return
        if not existing:
            self._edge(owner, var_id, "defines", name)
        if in_loop and owner != var_id:
            self._edge(owner, var_id, "writes", name)
        scope[name] = var_id
        if value_node and value_node != var_id:
            self._edge(value_node, var_id, "produces" if _is_call(value) else "flows", name)

    def _loop(
        self,
        stmt: ast.For | ast.While,
        owner: str,
        scope: dict[str, str],
        class_id: str | None,
        function_id: str | None,
        kind: str,
        target: ast.expr | None,
        iterable: ast.expr,
        body: list[ast.stmt],
    ) -> None:
        if kind == "for" and target is not None:
            header = f"for {_short_unparse(target)} in {_short_unparse(iterable)}"
        elif kind == "while":
            header = f"while {_short_unparse(iterable)}"
        else:
            header = f"{kind} {_short_unparse(iterable)}"
        loop_id = self._unique(f"static:loop:{owner}:{stmt.lineno}")
        if self._node(loop_id, header, {"kind": "loop", "header": header, "line": stmt.lineno}, line=stmt.lineno) is None:
            return
        self._edge(owner, loop_id, "contains", header)
        self._expr(iterable, owner, scope, class_id, function_id)
        for name in _names(iterable):
            node = self._resolve(name, scope)
            if node:
                self._edge(node, loop_id, "iterates", name)
        if isinstance(target, ast.Name):
            var_id = self._unique(f"static:var:{function_id or owner}:{target.id}")
            if self._node(var_id, target.id, {"kind": "variable", "value": "loop item"}) is not None:
                scope[target.id] = var_id
                self._edge(loop_id, var_id, "writes", target.id)
        self._body(body, loop_id, scope, class_id, function_id, in_loop=True)

    def _return(self, stmt: ast.Return, owner: str, scope: dict[str, str], function_id: str | None) -> None:
        if stmt.value is None or function_id is None:
            return
        call_id = self._expr(stmt.value, owner, scope, None, function_id)
        for name in _names(stmt.value):
            node = self._resolve(name, scope)
            if node:
                self._edge(node, function_id, "returns", name)
        if call_id:
            self._edge(call_id, function_id, "returns", _expr_name(stmt.value) or "value")

    def _expr(
        self,
        expr: ast.expr | None,
        owner: str,
        scope: dict[str, str],
        class_id: str | None,
        function_id: str | None,
    ) -> str | None:
        if expr is None:
            return None
        if isinstance(expr, ast.Call):
            return self._call(expr, owner, scope, class_id, function_id)
        if isinstance(expr, ast.Name):
            return self._resolve(expr.id, scope)
        if isinstance(expr, ast.Attribute):
            if isinstance(expr.value, ast.Name) and expr.value.id == "self" and class_id:
                field_id = self._field(class_id, "", expr.attr, None, None)
                if field_id and function_id:
                    self._edge(field_id, function_id, "reads", expr.attr)
                return field_id
            self._expr(expr.value, owner, scope, class_id, function_id)
            return None
        if isinstance(expr, ast.Subscript):
            self._expr(expr.value, owner, scope, class_id, function_id)
            self._expr(expr.slice, owner, scope, class_id, function_id)
            return None
        for child in ast.iter_child_nodes(expr):
            if isinstance(child, ast.expr):
                self._expr(child, owner, scope, class_id, function_id)
        return None

    def _call(
        self,
        expr: ast.Call,
        owner: str,
        scope: dict[str, str],
        class_id: str | None,
        function_id: str | None,
    ) -> str | None:
        if self._function_calls >= MAX_CALLS_PER_SCOPE:
            self.truncated = True
            return None
        self._function_calls += 1
        target = _expr_name(expr.func) or "?"
        args = [_short_unparse(arg) for arg in expr.args]
        args += [f"{kw.arg}={_short_unparse(kw.value)}" for kw in expr.keywords if kw.arg]
        call_id = self._unique(f"static:call:{owner}:{expr.lineno}:{target}")
        if self._node(call_id, target, {
            "kind": "call",
            "target": target,
            "args": args,
            "line": expr.lineno,
        }, line=expr.lineno) is None:
            return None
        self._edge(owner, call_id, "calls", target)
        for arg in [*expr.args, *(kw.value for kw in expr.keywords)]:
            self._expr(arg, owner, scope, class_id, function_id)
            for name in _names(arg):
                node = self._resolve(name, scope)
                if node:
                    self._edge(node, call_id, "flows", name)
        base = target.split(".")[0]
        if base == "self" and class_id and "." in target:
            attr = target.split(".", 1)[1].split(".")[0]
            field_id = self._unique(f"static:field:{class_id}:{attr}")
            if field_id in self.nodes:
                self._edge(call_id, field_id, "targets", target)
                return call_id
        caller = function_id or owner
        resolved = self._resolve(base, scope)
        if resolved:
            self._edge(call_id, resolved, "targets", target)
            self._edge(caller, resolved, "calls", target)
        elif "." not in target and target not in {"print", "len", "range", "enumerate", "abs", "min", "max", "sum", "int", "str", "float", "bool", "list", "dict", "set", "tuple", "type", "isinstance", "super"}:
            external = self._node(
                f"static:external:call:{target}",
                target,
                {"kind": "external", "target": target, "category": "callable"},
            )
            if external:
                self._edge(call_id, external, "targets", target)
                self._edge(caller, external, "calls", target)
        elif "." in target:
            external = self._node(
                f"static:external:call:{target}",
                target,
                {"kind": "external", "target": target, "category": "external call"},
            )
            if external:
                self._edge(call_id, external, "targets", target)
                self._edge(caller, external, "calls", target)
        self._function_calls = 0
        return call_id

    def _resolve(self, name: str, scope: dict[str, str]) -> str | None:
        if name in scope:
            return scope[name]
        if name in self.workbench_symbols:
            return self.workbench_symbols[name]
        if name in self.workbench_imports:
            return self.workbench_imports[name]
        if name in self.source.imports:
            target, _line = self.source.imports[name]
            return self._inherited_import(name, target)
        if name in self.source.definitions:
            return self._inherited_definition(name, self.source.definitions[name])
        return None

    def _inherited_import(self, alias: str, target: str) -> str | None:
        key = f"import:{alias}:{target}"
        if key in self.inherited_ids:
            return self.inherited_ids[key]
        context = self._context_module()
        node_id = self._node(
            f"static:context:import:{alias}:{target}",
            target,
            {"kind": "import", "module": target, "names": [alias]},
        )
        if node_id is None:
            return None
        if context:
            self._edge(context, node_id, "imports", target)
        self.inherited_ids[key] = node_id
        return node_id

    def _inherited_definition(self, name: str, stmt: ast.AST) -> str | None:
        key = f"definition:{name}"
        if key in self.inherited_ids:
            return self.inherited_ids[key]
        context = self._context_module()
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            signature, params, returns = _signature(stmt)
            node_id = self._node(
                f"static:context:function:{name}",
                name,
                {"kind": "function", "signature": signature, "input": ", ".join(params), "output": returns or "?", "params": params, "returns": returns, "line": stmt.lineno},
                line=stmt.lineno,
            )
        elif isinstance(stmt, ast.ClassDef):
            node_id = self._node(
                f"static:context:class:{name}",
                name,
                {"kind": "class", "name": name, "bases": [_expr_name(base) or "?" for base in stmt.bases], "line": stmt.lineno},
                line=stmt.lineno,
            )
        else:
            node_id = self._node(
                f"static:context:var:{name}",
                name,
                {"kind": "variable", "value": _short_unparse(stmt.value) if isinstance(stmt, (ast.Assign, ast.AnnAssign)) and stmt.value is not None else "source global"},
            )
        if node_id and context:
            self._edge(context, node_id, "defines", name)
            self.inherited_ids[key] = node_id
        return node_id

    def _context_module(self) -> str | None:
        if self.context_module_id:
            return self.context_module_id
        if not self.source_rel:
            return None
        self.context_module_id = self._node(
            f"static:context:{self.source_rel}",
            f"继承 · {self.source_rel}",
            {"kind": "module", "path": self.source_rel, "source": "imported context"},
        )
        module = f"static:module:{self.workbench_rel}"
        if self.context_module_id and module in self.nodes:
            self._edge(module, self.context_module_id, "inherits", "import 上下文")
        return self.context_module_id

    def _node(self, node_id: str, label: str, card: dict[str, Any], *, line: int | None = None) -> str | None:
        node_id = self._unique(node_id)
        if node_id in self.nodes:
            return node_id
        if len(self.nodes) >= MAX_NODES:
            self.truncated = True
            self.missing.add("Static node budget reached.")
            return None
        node: dict[str, Any] = {
            "id": node_id,
            "valueId": node_id,
            "label": label,
            "kind": "static",
            "card": card,
            "origin": "static",
        }
        if line is not None:
            node["metadata"] = {"line": line}
        self.nodes[node_id] = node
        if card.get("kind") == "function":
            self.workbench_symbols.setdefault(label, node_id)
        return node_id

    def _unique(self, base: str) -> str:
        if base not in self.nodes:
            return base
        return base

    def _edge(self, source: str | None, target: str | None, kind: str, label: str | None = None) -> None:
        if not source or not target or source == target or source not in self.nodes or target not in self.nodes:
            return
        key = (source, target, kind, label or "")
        if key in self.edge_keys:
            return
        if len(self.edges) >= MAX_EDGES:
            self.truncated = True
            self.missing.add("Static edge budget reached.")
            return
        self.edge_keys.add(key)
        edge_id = f"static-edge:{len(self.edges)}"
        self.edges[edge_id] = {
            "id": edge_id,
            "from": source,
            "to": target,
            "kind": kind,
            "label": label,
        }


def executable_lines(source: str) -> list[int]:
    """Executable statement starts for auto-recording; excludes headers/imports/docstrings."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    context_end = _context_end_line(source)
    lines: set[int] = set()
    skipped = (
        ast.FunctionDef,
        ast.AsyncFunctionDef,
        ast.ClassDef,
        ast.Import,
        ast.ImportFrom,
        ast.Pass,
        ast.Global,
        ast.Nonlocal,
    )
    for node in ast.walk(tree):
        if isinstance(node, skipped):
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            continue
        line = getattr(node, "lineno", None)
        if isinstance(line, int) and line > context_end:
            lines.add(line)
    return sorted(lines)


def _index_source(tree: ast.Module) -> SourceIndex:
    index = SourceIndex()
    for stmt in tree.body:
        if isinstance(stmt, ast.Import):
            for alias in stmt.names:
                local = alias.asname or alias.name.split(".")[0]
                index.imports[local] = (alias.name, stmt.lineno)
        elif isinstance(stmt, ast.ImportFrom):
            module = stmt.module or ""
            for alias in stmt.names:
                local = alias.asname or alias.name
                index.imports[local] = (f"{module}.{alias.name}".strip("."), stmt.lineno)
        elif isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            index.definitions[stmt.name] = stmt
        elif isinstance(stmt, (ast.Assign, ast.AnnAssign)):
            for target in (stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]):
                if isinstance(target, ast.Name):
                    index.definitions.setdefault(target.id, stmt)
                    if isinstance(stmt, ast.AnnAssign):
                        index.annotations[target.id] = _annotation(stmt.annotation)
    return index


def _context_end_line(source: str) -> int:
    lines = source.splitlines()
    end = 0
    in_context = False
    for number, line in enumerate(lines, start=1):
        if line.strip().startswith(CONTEXT_START_MARKER):
            in_context = True
        if in_context and line.strip() == CONTEXT_END_MARKER:
            end = number
            in_context = False
    return end


def _signature(node: ast.FunctionDef | ast.AsyncFunctionDef) -> tuple[str, list[str], str | None]:
    parts: list[str] = []
    for arg, annotation, default in _iter_args(node.args):
        text = arg
        if annotation:
            text += f": {annotation}"
        if default:
            text += f" = {default}"
        parts.append(text)
    returns = _annotation(node.returns) if node.returns else None
    signature = f"{node.name}({', '.join(parts)})"
    if returns:
        signature += f" -> {returns}"
    return signature, parts, returns


def _iter_args(args: ast.arguments) -> list[tuple[str, str | None, str | None]]:
    result: list[tuple[str, str | None, str | None]] = []
    positional = [*args.posonlyargs, *args.args]
    defaults = [None] * (len(positional) - len(args.defaults)) + list(args.defaults)
    for arg, default in zip(positional, defaults):
        result.append((arg.arg, _annotation(arg.annotation), _short_unparse(default) if default else None))
    if args.vararg:
        result.append((f"*{args.vararg.arg}", _annotation(args.vararg.annotation), None))
    for arg, default in zip(args.kwonlyargs, args.kw_defaults):
        result.append((arg.arg, _annotation(arg.annotation), _short_unparse(default) if default else None))
    if args.kwarg:
        result.append((f"**{args.kwarg.arg}", _annotation(args.kwarg.annotation), None))
    return result


def _assigned_fields(stmt: ast.Assign | ast.AnnAssign) -> list[tuple[str, str | None, ast.expr | None]]:
    targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
    value = getattr(stmt, "value", None)
    annotation = _annotation(stmt.annotation) if isinstance(stmt, ast.AnnAssign) else None
    return [(target.id, annotation, value) for target in targets if isinstance(target, ast.Name)]


def _value_card(value: ast.expr | None, annotation: str | None) -> dict[str, Any]:
    if value is None:
        return {"kind": "variable", "value": annotation or "unknown"}
    if isinstance(value, (ast.List, ast.Tuple)):
        return {"kind": "list", "items": [{"value": _short_unparse(item)} for item in value.elts]}
    if isinstance(value, ast.Set):
        return {"kind": "set", "items": [{"value": _short_unparse(item)} for item in value.elts]}
    if isinstance(value, ast.Dict):
        return {
            "kind": "dict",
            "entries": [
                {"key": _short_unparse(key), "value": _short_unparse(item)}
                for key, item in zip(value.keys, value.values) if key is not None
            ],
        }
    if isinstance(value, (ast.ListComp, ast.SetComp, ast.DictComp)):
        return {"kind": "list" if not isinstance(value, ast.DictComp) else "dict", "items" if not isinstance(value, ast.DictComp) else "entries": []}
    if isinstance(value, ast.Call):
        target = _expr_name(value.func) or "call"
        if "torch" in target.lower() or "tensor" in (annotation or "").lower():
            return {"kind": "tensor", "shape": [], "preview": _short_unparse(value)}
        return {"kind": "variable", "value": _short_unparse(value)}
    if isinstance(value, ast.Constant):
        return {"kind": "variable", "value": repr(value.value)[:200]}
    return {"kind": "variable", "value": _short_unparse(value)}


def _is_call(value: ast.expr | None) -> bool:
    return isinstance(value, ast.Call)


def _is_main_guard(test: ast.expr) -> bool:
    return isinstance(test, ast.Compare) and any(
        isinstance(item, ast.Name) and item.id == "__name__" for item in [test.left, *test.comparators]
    )


def _expr_name(node: ast.expr | None) -> str | None:
    if node is None:
        return None
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _expr_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    if isinstance(node, ast.Call):
        base = _expr_name(node.func)
        return f"{base}()" if base else None
    return None


def _names(node: ast.expr | None) -> list[str]:
    if node is None:
        return []
    result: list[str] = []
    for child in ast.walk(node):
        if isinstance(child, ast.Name) and child.id not in result:
            result.append(child.id)
    return result


def _annotation(node: ast.expr | None) -> str | None:
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:
        return None


def _unparse(node: ast.expr | None) -> str:
    if node is None:
        return ""
    try:
        return ast.unparse(node)
    except Exception:
        return "?"


def _short_unparse(node: ast.expr | None) -> str:
    text = _unparse(node)
    return text if len(text) <= 90 else text[:87] + "..."


def analyze_python(
    workbench_path: Path,
    workbench_source: str,
    source_path: Path | None,
    source_source: str | None,
    *,
    view: str = "overview",
    focus: str | None = None,
) -> dict[str, Any]:
    return StaticAnalyzer(
        workbench_path=workbench_path,
        workbench_source=workbench_source,
        source_path=source_path,
        source_source=source_source,
    ).analyze(view, focus)