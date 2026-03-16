import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from models.schemas import TelemetryRequest
from services import fastf1_service, processing, cache

router = APIRouter()


def _fmt_lap(lap_obj) -> str:
    lt = lap_obj.get("LapTime")
    if lt is not None and pd.notna(lt):
        s = lt.total_seconds()
        return f"{int(s // 60)}:{s % 60:06.3f}"
    return "N/A"


def _resolve_lap(lap_selection) -> int | None:
    """Convert 'fastest' or int to int (or None for fastest)."""
    if lap_selection == "fastest" or lap_selection is None:
        return None
    try:
        return int(lap_selection)
    except (ValueError, TypeError):
        return None


@router.post("/telemetry")
def get_telemetry(req: TelemetryRequest):
    if len(req.drivers) != len(req.laps):
        raise HTTPException(status_code=400, detail="Mismatched drivers and laps lengths")
    if not req.drivers:
        raise HTTPException(status_code=400, detail="No drivers provided")
    
    lap_nums = [_resolve_lap(l) for l in req.laps]

    # create cache key that encapsulates all drivers
    # sort drivers maybe? No, order matters for frontend colors
    driver_laps_str = "_".join(f"{d}-{l}" for d, l in zip(req.drivers, lap_nums))
    cache_key = cache.make_key(
        "telemetry",
        req.year, req.event, req.session,
        driver_laps_str
    )
    cached = cache.get(cache_key)
    if cached:
        return cached

    try:
        session = fastf1_service.load_session(req.year, req.event, req.session, telemetry=True, laps=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load session: {e}")

    # Get telemetry for all drivers
    tels = []
    laps_objs = []
    for driver, lap_num in zip(req.drivers, lap_nums):
        try:
            lap_obj, tel = fastf1_service.get_lap_telemetry(session, driver, lap_num)
            laps_objs.append(lap_obj)
            tels.append(tel)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load telemetry for {driver}: {e}")

    # Get driver metadata
    d_infos = [fastf1_service.get_driver_info(session, d) for d in req.drivers]

    # Normalize telemetry to common distance grid
    norm = processing.normalize_telemetry(tels)
    common_dist = np.array(norm["distance"])

    # Compute accelerations and add them to channels
    for i, tel in enumerate(tels):
        acc = processing.compute_accelerations(tel, common_dist)
        norm["drivers"][i]["channels"].update(acc)

    # Compute faster segments
    speeds = [norm["drivers"][i]["channels"]["speed"] for i in range(len(tels))]
    faster_segments_list = processing.compute_faster_segments(speeds)
    for i in range(len(tels)):
        norm["drivers"][i]["channels"]["faster_segments"] = faster_segments_list[i]

    # Track coordinates (use first driver's telemetry for track shape)
    track_x, track_y = processing.get_track_coords(tels[0], common_dist)

    # Circuit corners
    corners = processing.get_circuit_corners(session)

    def driver_payload(info: dict, lap_obj, channels: dict) -> dict:
        return {
            "abbreviation": info["abbreviation"],
            "full_name": info["full_name"],
            "number": str(info.get("number", "")),
            "team": info["team"],
            "team_color": info.get("color", ""),
            "lap_number": int(lap_obj["LapNumber"]),
            "lap_time": _fmt_lap(lap_obj),
            "channels": channels,
        }

    response = {
        "track": {"x": track_x, "y": track_y},
        "distance": norm["distance"],
        "drivers": [driver_payload(d_infos[i], laps_objs[i], norm["drivers"][i]["channels"]) for i in range(len(tels))],
        "circuit_info": {"corners": corners},
    }

    cache.set(cache_key, response)
    return response
