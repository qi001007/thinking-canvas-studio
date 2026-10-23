"""Scripted data for the local demo session. No user program is executed."""

from __future__ import annotations

from typing import Any

DEMO_STEPS: list[dict[str, Any]] = [
    {"label": "初始状态", "line": 2, "nums": [5, 1, 4, 2], "seen": {}, "i": 0, "j": 0, "swapped": False},
    {"label": "比较 5 与 1", "line": 6, "nums": [5, 1, 4, 2], "seen": {"5": 0}, "i": 0, "j": 0, "swapped": False},
    {"label": "交换 5 与 1", "line": 7, "nums": [1, 5, 4, 2], "seen": {"5": 0, "1": 1}, "i": 0, "j": 0, "swapped": True},
    {"label": "比较 5 与 4", "line": 6, "nums": [1, 5, 4, 2], "seen": {"5": 0, "1": 1, "4": 2}, "i": 0, "j": 1, "swapped": True},
    {"label": "交换 5 与 4", "line": 7, "nums": [1, 4, 5, 2], "seen": {"5": 0, "1": 1, "4": 2}, "i": 0, "j": 1, "swapped": True},
    {"label": "比较 5 与 2", "line": 6, "nums": [1, 4, 5, 2], "seen": {"5": 0, "1": 1, "4": 2, "2": 3}, "i": 0, "j": 2, "swapped": True},
    {"label": "交换 5 与 2", "line": 7, "nums": [1, 4, 2, 5], "seen": {"5": 0, "1": 1, "4": 2, "2": 3}, "i": 0, "j": 2, "swapped": True},
    {"label": "第一轮结束", "line": 9, "nums": [1, 4, 2, 5], "seen": {"5": 0, "1": 1, "4": 2, "2": 3}, "i": 0, "j": 2, "swapped": True},
]

DEMO_BOARD: dict[str, Any] = {
    "id": "board-demo",
    "title": "冒泡排序 · 手绘",
    "scene": {
        "nodes": [
            {
                "id": "layout:manual:function",
                "valueId": "manual:function",
                "label": "bubbleSort",
                "kind": "manual",
                "card": {
                    "kind": "function",
                    "signature": "bubbleSort(nums) → nums",
                    "input": "[5, 1, 4, 2]",
                    "output": "[1, 2, 4, 5]",
                    "complexity": "O(n²) / O(1)",
                },
            },
            {
                "id": "layout:manual:invariant",
                "valueId": "manual:invariant",
                "label": "不变量",
                "kind": "manual",
                "card": {
                    "kind": "sticky",
                    "tone": "invariant",
                    "text": "每一轮把当前最大的元素推到右端。j 扫过的位置已经有序。",
                },
            },
            {
                "id": "layout:manual:array",
                "valueId": "manual:array",
                "label": "nums",
                "kind": "manual",
                "card": {"kind": "array", "rows": [[{"value": "5"}, {"value": "1"}, {"value": "4"}, {"value": "2"}]]},
            },
            {
                "id": "layout:manual:swapped",
                "valueId": "manual:swapped",
                "label": "swapped",
                "kind": "manual",
                "card": {"kind": "variable", "value": "true"},
            },
        ],
        "edges": [
            {"id": "edge-function-array", "from": "layout:manual:function", "to": "layout:manual:array", "kind": "contains", "label": "输入"},
            {"id": "edge-function-swapped", "from": "layout:manual:function", "to": "layout:manual:swapped", "kind": "contains", "label": "状态"},
        ],
    },
    "annotations": [],
    "layout": {
        "zoom": 1,
        "positions": {
            "layout:manual:function": {"x": 20, "y": 20},
            "layout:manual:invariant": {"x": 330, "y": 20},
            "layout:manual:array": {"x": 20, "y": 210},
            "layout:manual:swapped": {"x": 20, "y": 380},
        },
    },
    "steps": [],
}