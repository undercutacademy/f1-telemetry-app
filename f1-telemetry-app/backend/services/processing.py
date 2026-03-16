"""
Telemetry processing: distance normalization, delta time, acceleration computation.
"""
import numpy as np
import pandas as pd
from typing import Optional


NUM_POINTS = 500


def normalize_telemetry(tels: list[pd.DataFrame]) -> dict:
    """
    Resample a list of telemetry DataFrames to a common distance grid.
    Returns processed channels for all drivers plus delta time.
    """
    dist_arrays = [tel["Distance"].values for tel in tels]

    # Use the shortest lap distance so all are fully represented
    max_dist = min([dist.max() for dist in dist_arrays])
    common_dist = np.linspace(0, max_dist, num=NUM_POINTS)

    result = {"distance": common_dist.tolist(), "drivers": []}

    for idx, tel in enumerate(tels):
        dist = tel["Distance"].values
        channels = {}

        # Continuous channels — linear interpolation
        for ch, out_name in [("Speed", "speed"), ("RPM", "rpm"), ("Throttle", "throttle")]:
            if ch in tel.columns:
                vals = tel[ch].values.astype(float)
                channels[out_name] = np.interp(common_dist, dist, vals).tolist()
            else:
                channels[out_name] = [0.0] * NUM_POINTS

        # Discrete channels — nearest neighbor (forward fill)
        for ch, out_name in [("nGear", "gear"), ("Brake", "brake")]:
            if ch in tel.columns:
                indices = np.searchsorted(dist, common_dist, side="right") - 1
                indices = np.clip(indices, 0, len(dist) - 1)
                raw = tel[ch].values[indices]
                if ch == "Brake":
                    # Convert bool to 0/1
                    raw = raw.astype(float)
                channels[out_name] = raw.tolist()
            else:
                channels[out_name] = [0] * NUM_POINTS

        # Time (for delta computation)
        if "Time" in tel.columns:
            time_s = tel["Time"].dt.total_seconds().values
            channels["time"] = np.interp(common_dist, dist, time_s).tolist()
        else:
            channels["time"] = [0.0] * NUM_POINTS

        result["drivers"].append({"channels": channels})

    # Delta time: always compare to driver 0
    t_ref = np.array(result["drivers"][0]["channels"]["time"])
    for i in range(len(tels)):
        t_i = np.array(result["drivers"][i]["channels"]["time"])
        delta = t_i - t_ref  # positive = driver i is slower than driver 0
        result["drivers"][i]["channels"]["delta_time"] = delta.tolist()

    return result


def compute_accelerations(tel: pd.DataFrame, common_dist: np.ndarray) -> dict:
    """
    Compute lateral and longitudinal G-forces from position and speed data.
    Returns dict with 'lateral_g' and 'longitudinal_g' arrays.
    """
    dist = tel["Distance"].values

    # Need X, Y for lateral; Speed for longitudinal
    has_pos = "X" in tel.columns and "Y" in tel.columns
    has_time = "Time" in tel.columns

    if not has_time:
        n = len(common_dist)
        return {
            "lateral_g": [0.0] * n,
            "longitudinal_g": [0.0] * n,
        }

    time_s = tel["Time"].dt.total_seconds().values
    speed_kmh = tel["Speed"].values.astype(float)

    # Interpolate to common distance grid
    t_interp = np.interp(common_dist, dist, time_s)
    spd_interp = np.interp(common_dist, dist, speed_kmh)
    speed_ms = spd_interp / 3.6

    dt = np.gradient(t_interp)
    dt[dt == 0] = 1e-6  # avoid division by zero

    # Longitudinal acceleration (from speed derivative)
    long_acc = np.gradient(speed_ms) / dt / 9.81

    # Lateral acceleration (from heading change rate × speed)
    if has_pos:
        x_raw = tel["X"].values.astype(float)
        y_raw = tel["Y"].values.astype(float)
        x = np.interp(common_dist, dist, x_raw)
        y = np.interp(common_dist, dist, y_raw)

        dx = np.gradient(x)
        dy = np.gradient(y)
        heading = np.arctan2(dy, dx)
        heading = np.unwrap(heading)
        d_heading = np.gradient(heading)
        omega = d_heading / dt
        lat_acc = (speed_ms * omega) / 9.81
    else:
        lat_acc = np.zeros_like(long_acc)

    # Smooth with a 7-point moving average
    kernel = np.ones(7) / 7
    long_acc = np.convolve(long_acc, kernel, mode="same")
    lat_acc = np.convolve(lat_acc, kernel, mode="same")

    # Clip extremes (data artifacts)
    long_acc = np.clip(long_acc, -6, 6)
    lat_acc = np.clip(lat_acc, -6, 6)

    return {
        "lateral_g": np.round(lat_acc, 4).tolist(),
        "longitudinal_g": np.round(long_acc, 4).tolist(),
    }


def compute_faster_segments(speeds: list[list]) -> list[list[bool]]:
    """
    For each distance point, determine which driver is fastest.
    Returns a list of boolean arrays (one for each driver).
    """
    arr = np.array(speeds)
    fastest_idx = np.argmax(arr, axis=0)
    result = []
    for i in range(len(speeds)):
        result.append((fastest_idx == i).tolist())
    return result


def get_track_coords(tel: pd.DataFrame, common_dist: np.ndarray) -> tuple[list, list]:
    """Extract and normalize track X/Y coordinates."""
    if "X" not in tel.columns or "Y" not in tel.columns:
        return [], []

    dist = tel["Distance"].values
    # X/Y are in 1/10 meter units from 2020+ — convert to meters
    scale = 0.1  # 1/10 meter to meter
    x = np.interp(common_dist, dist, tel["X"].values.astype(float)) * scale
    y = np.interp(common_dist, dist, tel["Y"].values.astype(float)) * scale

    return x.tolist(), y.tolist()


def get_circuit_corners(session) -> list[dict]:
    """Get corner info from session circuit info."""
    try:
        ci = session.get_circuit_info()
        corners = ci.corners
        result = []
        for _, row in corners.iterrows():
            result.append({
                "number": int(row.get("Number", 0)),
                "letter": str(row.get("Letter", "")),
                "distance": float(row.get("Distance", 0)),
                "angle": float(row.get("Angle", 0)) if "Angle" in row else 0,
                "x": float(row.get("X", 0)) * 0.1 if "X" in row else 0,
                "y": float(row.get("Y", 0)) * 0.1 if "Y" in row else 0,
            })
        return result
    except Exception:
        return []
