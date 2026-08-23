"""Cognition 内部指标种类；跨边界投影由 Adapter 映射。"""

from enum import StrEnum


class MetricKind(StrEnum):
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"
