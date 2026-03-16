from pydantic import BaseModel
from typing import Optional, Union


class TelemetryRequest(BaseModel):
    year: int
    event: str          # event name, e.g. "Bahrain Grand Prix"
    session: str        # e.g. 'Q', 'R', 'FP1'
    drivers: list[str]  # e.g. ['VER', 'NOR']
    laps: list[Union[int, str]] # lap numbers or 'fastest'
