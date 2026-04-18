from __future__ import annotations

from dataclasses import dataclass


@dataclass
class MetricsTracker:
    total_requests: int = 0
    successful_bookings: int = 0
    failed_attempts: int = 0
    cumulative_response_time: float = 0.0

    def record(self, *, success: bool, elapsed_seconds: float) -> None:
        self.total_requests += 1
        self.cumulative_response_time += elapsed_seconds
        if success:
            self.successful_bookings += 1
        else:
            self.failed_attempts += 1

    @property
    def avg_response_time(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return self.cumulative_response_time / self.total_requests
