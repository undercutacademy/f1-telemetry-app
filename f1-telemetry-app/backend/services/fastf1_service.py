"""
FastF1 wrapper service. Handles session loading, driver/lap data extraction.
"""
import fastf1
import pandas as pd
import numpy as np
from datetime import datetime
from typing import Optional
from services import cache


# ─── Session loading ──────────────────────────────────────────────────────────

_loaded_sessions: dict = {}


def _session_key(year: int, event, session_type: str) -> str:
    return f"{year}:{event}:{session_type}"


def load_session(year: int, event, session_type: str):
    """Load and cache a FastF1 session object. event can be round int or event name string."""
    key = _session_key(year, str(event), session_type)
    if key in _loaded_sessions:
        return _loaded_sessions[key]

    session = fastf1.get_session(year, event, session_type)
    session.load(telemetry=True, laps=True, weather=False)
    _loaded_sessions[key] = session
    return session


# ─── Years ────────────────────────────────────────────────────────────────────

def get_years() -> list[int]:
    current_year = datetime.now().year
    return list(range(current_year, 2017, -1))


# ─── Events ───────────────────────────────────────────────────────────────────

def get_events(year: int) -> list[dict]:
    cache_key = cache.make_key("events", year)
    cached = cache.get(cache_key)
    if cached:
        return cached

    schedule = fastf1.get_event_schedule(year, include_testing=False)
    events = []
    today = pd.Timestamp.now(tz="UTC")
    for _, row in schedule.iterrows():
        # Use Session1Date (first session of the weekend, e.g. FP1) instead of
        # EventDate (race day) so that weekends where practice/qualifying have
        # already happened are shown even if the race hasn't occurred yet.
        first_session_date = row.get("Session1Date")
        if pd.isna(first_session_date):
            first_session_date = row.get("EventDate")
        if pd.notna(first_session_date):
            if hasattr(first_session_date, "tzinfo") and first_session_date.tzinfo is None:
                first_session_date = first_session_date.tz_localize("UTC")
            if first_session_date > today:
                continue
        events.append({
            "round": int(row["RoundNumber"]),
            "name": str(row["EventName"]),
            "country": str(row.get("Country", "")),
            "location": str(row.get("Location", "")),
            "date": str(row["EventDate"])[:10] if pd.notna(row.get("EventDate")) else "",
            "format": str(row.get("EventFormat", "conventional")),
        })

    events.reverse()

    # Use short TTL for current year so new events appear quickly
    current_year = datetime.now().year
    ttl = 600 if year >= current_year else cache.CACHE_TTL_SECONDS
    cache.set(cache_key, events, ttl=ttl)
    return events


# ─── Sessions ─────────────────────────────────────────────────────────────────

_SESSION_NAMES = {
    "FP1": "Practice 1",
    "FP2": "Practice 2",
    "FP3": "Practice 3",
    "Q": "Qualifying",
    "SQ": "Sprint Qualifying",
    "S": "Sprint",
    "R": "Race",
}

# Alternate names that FastF1 may use in the schedule
_SESSION_NAME_ALIASES = {
    "Sprint Qualifying": ["Sprint Shootout"],
    "Sprint Shootout": ["Sprint Qualifying"],
}

_CONVENTIONAL_SESSIONS = ["R", "Q", "FP3", "FP2", "FP1"]
_SPRINT_SESSIONS = ["R", "S", "SQ", "Q", "FP1"]


def get_sessions(year: int, event) -> list[dict]:
    """event can be round int or event name string."""
    cache_key = cache.make_key("sessions", year, str(event))
    cached = cache.get(cache_key)
    if cached:
        return cached

    try:
        ev = fastf1.get_event(year, event)
        fmt = str(ev.get("EventFormat", "conventional")).lower()
    except Exception:
        fmt = "conventional"

    sessions = _SPRINT_SESSIONS if "sprint" in fmt else _CONVENTIONAL_SESSIONS
    today = pd.Timestamp.now(tz="UTC")

    # Build a map from session name to its date from the event schedule
    session_date_map: dict[str, pd.Timestamp | None] = {}
    try:
        for i in range(1, 6):
            sname = str(ev.get(f"Session{i}", ""))
            sdate = ev.get(f"Session{i}Date")
            if sname:
                session_date_map[sname] = sdate if pd.notna(sdate) else None
    except Exception:
        pass

    result = []
    for s in sessions:
        full_name = _SESSION_NAMES.get(s, s)
        # Check if this session has already happened
        sdate = session_date_map.get(full_name) or session_date_map.get(s)
        # Try alias names (e.g. Sprint Shootout ↔ Sprint Qualifying)
        if sdate is None:
            for alias in _SESSION_NAME_ALIASES.get(full_name, []):
                sdate = session_date_map.get(alias)
                if sdate is not None:
                    break
        available = True
        session_date_str = ""
        if sdate is not None:
            if hasattr(sdate, "tzinfo") and sdate.tzinfo is None:
                sdate = sdate.tz_localize("UTC")
            session_date_str = str(sdate)[:16]
            if sdate > today:
                available = False

        result.append({
            "type": s,
            "name": full_name,
            "date": session_date_str,
            "available": available,
        })

    # Use short TTL for current year so session availability updates quickly
    current_year = datetime.now().year
    ttl = 600 if year >= current_year else cache.CACHE_TTL_SECONDS
    cache.set(cache_key, result, ttl=ttl)
    return result


# ─── Drivers ──────────────────────────────────────────────────────────────────

def get_drivers(year: int, event, session_type: str) -> list[dict]:
    """event can be round int or event name string."""
    cache_key = cache.make_key("drivers", year, str(event), session_type)
    cached = cache.get(cache_key)
    if cached:
        return cached

    session = load_session(year, event, session_type)
    results = session.results

    drivers = []
    for _, row in results.iterrows():
        team_color = str(row.get("TeamColor", "FFFFFF"))
        if team_color and not team_color.startswith("#"):
            team_color = f"#{team_color}"
        drivers.append({
            "abbreviation": str(row["Abbreviation"]),
            "full_name": str(row["FullName"]),
            "number": str(int(row["DriverNumber"])) if pd.notna(row.get("DriverNumber")) else "",
            "team": str(row.get("TeamName", "")),
            "team_color": team_color,
        })

    cache.set(cache_key, drivers)
    return drivers


# ─── Laps ─────────────────────────────────────────────────────────────────────

def _format_laptime(seconds: float) -> str:
    if pd.isna(seconds) or seconds <= 0:
        return "N/A"
    mins = int(seconds // 60)
    secs = seconds % 60
    return f"{mins}:{secs:06.3f}"


def get_laps(year: int, event, session_type: str, driver_abbr: str) -> list[dict]:
    """event can be round int or event name string."""
    cache_key = cache.make_key("laps", year, str(event), session_type, driver_abbr)
    cached = cache.get(cache_key)
    if cached:
        return cached

    session = load_session(year, event, session_type)
    driver_laps = session.laps.pick_driver(driver_abbr)

    if driver_laps.empty:
        return []

    # Find fastest lap
    valid_laps = driver_laps.pick_quicklaps()
    fastest_time = None
    if not valid_laps.empty:
        fastest_lap = valid_laps.pick_fastest()
        if fastest_lap is not None:
            lt = fastest_lap["LapTime"]
            fastest_time = lt.total_seconds() if pd.notna(lt) else None

    result = []
    for _, lap in driver_laps.iterrows():
        lap_time = lap.get("LapTime")
        lap_time_seconds = lap_time.total_seconds() if pd.notna(lap_time) else None

        s1 = lap.get("Sector1Time")
        s2 = lap.get("Sector2Time")
        s3 = lap.get("Sector3Time")

        compound = str(lap.get("Compound", "UNKNOWN"))
        tyre_life = lap.get("TyreLife")

        is_fastest = (
            lap_time_seconds is not None
            and fastest_time is not None
            and abs(lap_time_seconds - fastest_time) < 0.001
        )

        # Check if telemetry is available
        try:
            tel = lap.get_telemetry()
            has_telemetry = tel is not None and not tel.empty and len(tel) > 10
        except Exception:
            has_telemetry = False

        result.append({
            "lap_number": int(lap["LapNumber"]) if pd.notna(lap.get("LapNumber")) else 0,
            "lap_time": _format_laptime(lap_time_seconds) if lap_time_seconds else "N/A",
            "lap_time_seconds": round(lap_time_seconds, 3) if lap_time_seconds else None,
            "sector1": _format_laptime(s1.total_seconds()) if pd.notna(s1) else "N/A",
            "sector2": _format_laptime(s2.total_seconds()) if pd.notna(s2) else "N/A",
            "sector3": _format_laptime(s3.total_seconds()) if pd.notna(s3) else "N/A",
            "compound": compound,
            "tyre_life": int(tyre_life) if pd.notna(tyre_life) else 0,
            "is_personal_best": bool(lap.get("IsPersonalBest", False)),
            "is_fastest": is_fastest,
            "is_valid": has_telemetry,
        })

    cache.set(cache_key, result)
    return result


# ─── Telemetry ────────────────────────────────────────────────────────────────

def get_lap_telemetry(session, driver_abbr: str, lap_number: Optional[int] = None):
    """Return (lap_obj, telemetry_df) for the specified driver/lap."""
    driver_laps = session.laps.pick_driver(driver_abbr)

    if lap_number is None:
        lap = driver_laps.pick_quicklaps().pick_fastest()
    else:
        matching = driver_laps[driver_laps["LapNumber"] == lap_number]
        if matching.empty:
            raise ValueError(f"Lap {lap_number} not found for driver {driver_abbr}")
        lap = matching.iloc[0]

    tel = lap.get_telemetry()
    if tel is None or tel.empty:
        raise ValueError(f"No telemetry available for {driver_abbr} lap {lap_number}")

    tel = tel.add_distance()
    return lap, tel


def get_driver_info(session, driver_abbr: str) -> dict:
    results = session.results
    row = results[results["Abbreviation"] == driver_abbr]
    if row.empty:
        return {"abbreviation": driver_abbr, "full_name": driver_abbr, "team": "", "color": "#FFFFFF"}
    row = row.iloc[0]
    team_color = str(row.get("TeamColor", "FFFFFF"))
    if team_color and not team_color.startswith("#"):
        team_color = f"#{team_color}"
    return {
        "abbreviation": driver_abbr,
        "full_name": str(row.get("FullName", driver_abbr)),
        "number": int(row["DriverNumber"]) if pd.notna(row.get("DriverNumber")) else 0,
        "team": str(row.get("TeamName", "")),
        "color": team_color,
    }
