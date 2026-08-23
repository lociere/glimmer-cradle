"""把文件型 telemetry concrete 绑定到 Cognition 可观测性 Port。"""

from glimmer_cradle.cognition.adapters.observability.logger import get_logger
from glimmer_cradle.cognition.adapters.observability.metrics import counter, gauge, histogram
from glimmer_cradle.cognition.adapters.observability.tracer import span
from glimmer_cradle.cognition.ports.observability import bind_observability


def bind_file_observability() -> None:
    bind_observability(
        logger_factory=get_logger,
        counter_sink=counter,
        gauge_sink=gauge,
        histogram_sink=histogram,
        span_factory=span,
    )
