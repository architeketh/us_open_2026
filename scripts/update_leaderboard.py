from __future__ import annotations

import csv
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from html import unescape
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
PLAYERS_FILENAME = os.environ.get("PLAYERS_FILE", "").strip() or "players.txt"
PLAYERS_PATH = DATA_DIR / PLAYERS_FILENAME
LEADERBOARD_JSON_PATH = DATA_DIR / "leaderboard.json"
LEADERBOARD_JS_PATH = DATA_DIR / "leaderboard.js"
SOURCE_URL = os.environ.get("LEADERBOARD_SOURCE_URL", "").strip() or "https://www.usopen.com/2026/scoring.html"
CENTRAL_TIMEZONE = ZoneInfo("America/Chicago")


@dataclass
class PlayerRow:
    name: str
    position: str = "-"
    to_par: str = "E"
    today: str = "-"
    thru: str = "--"
    tee_time: str = "--"
    status: str = "Not started"


@dataclass
class SourcePayload:
    url: str
    text: str
    content_type: str = ""


def normalize_name(value: str) -> str:
    cleaned = value.lower()
    cleaned = (
        cleaned.replace("å", "a")
        .replace("ä", "a")
        .replace("ö", "o")
        .replace("ø", "o")
        .replace("ü", "u")
        .replace("é", "e")
        .replace("ñ", "n")
        .replace(".", "")
        .replace("j.y.", "jy")
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def parse_csv_row(line: str) -> list[str]:
    return next(csv.reader([line]))


def find_column_index(header: list[str], names: list[str]) -> int:
    try:
        return next(index for index, cell in enumerate(header) if cell in names)
    except StopIteration:
        return -1


def load_field_players() -> list[str]:
    lines = [line.strip() for line in PLAYERS_PATH.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]
    if not lines:
      raise RuntimeError(f"{PLAYERS_FILENAME} is empty.")

    header = [cell.upper() for cell in parse_csv_row(lines[0])]
    players: list[str] = []

    if "FIRST NAME" in header and "LAST NAME" in header:
        first_index = header.index("FIRST NAME")
        last_index = header.index("LAST NAME")
        for line in lines[1:]:
            row = parse_csv_row(line)
            if len(row) <= max(first_index, last_index):
                continue
            name = f"{row[first_index]} {row[last_index]}".strip()
            if name:
                players.append(unescape(name))
        return players

    has_header = any(token in {"PLAYER", "NAME", "FIRST NAME", "LAST NAME"} for token in header)
    source_lines = lines[1:] if has_header else lines

    for line in source_lines:
        row = parse_csv_row(line)
        if not row:
            continue
        players.append(unescape(row[0]).strip())

    return players


def maybe_convert_google_sheet_url(url: str) -> str:
    converted = url.strip()
    if "docs.google.com/spreadsheets" not in converted:
        return converted
    if "/pubhtml" in converted:
        converted = converted.replace("/pubhtml", "/pub")
    if "output=csv" in converted:
        return converted
    separator = "&" if "?" in converted else "?"
    return f"{converted}{separator}gid=0&single=true&output=csv"


def fetch_source_payload() -> SourcePayload:
    source_url = maybe_convert_google_sheet_url(SOURCE_URL)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    response = requests.get(source_url, headers=headers, timeout=30)
    response.raise_for_status()
    return SourcePayload(
        url=source_url,
        text=response.text,
        content_type=response.headers.get("content-type", "").lower(),
    )


def dig(obj: Any) -> list[Any]:
    found: list[Any] = []
    if isinstance(obj, dict):
        found.append(obj)
        for value in obj.values():
            found.extend(dig(value))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(dig(item))
    return found


def get_nested_text(obj: Any, *paths: tuple[str, ...]) -> str:
    for path in paths:
        current = obj
        ok = True
        for key in path:
            if not isinstance(current, dict) or key not in current:
                ok = False
                break
            current = current[key]
        if ok and current not in (None, ""):
            return str(current).strip()
    return ""


def looks_like_position(value: str) -> bool:
    text = str(value).strip().upper()
    return bool(re.fullmatch(r"(T?\d+|-|CUT|WD|DQ)", text))


def looks_like_score(value: str) -> bool:
    text = str(value).strip().upper()
    return bool(re.fullmatch(r"(E|[+-]?\d+|-|CUT|WD|DQ)", text))


def looks_like_tee_time(value: str) -> bool:
    text = str(value).strip().upper()
    return bool(re.fullmatch(r"\d{1,2}:\d{2}\s*(AM|PM)", text))


def derive_status(thru_value: str, tee_time_value: str = "--", fallback: str = "Live") -> str:
    text = str(thru_value).strip().upper()
    tee_text = str(tee_time_value).strip().upper()
    if text == "CUT":
        return "Cut"
    if text == "WD":
        return "WD"
    if text == "DQ":
        return "DQ"
    if text == "F":
        return "Finished"
    if tee_text not in ("", "--") and text in ("", "--"):
        return "Tee time posted"
    return fallback


def coerce_row(item: dict[str, Any]) -> PlayerRow | None:
    first_name = get_nested_text(item, ("firstName",), ("player", "firstName"), ("athlete", "firstName"))
    last_name = get_nested_text(item, ("lastName",), ("player", "lastName"), ("athlete", "lastName"))
    name = get_nested_text(
        item,
        ("name",),
        ("displayName",),
        ("player", "displayName"),
        ("athlete", "displayName"),
        ("competitor", "displayName"),
    )
    if not name and (first_name or last_name):
        name = f"{first_name} {last_name}".strip()
    if not name:
        return None

    position = get_nested_text(
        item,
        ("position",),
        ("pos",),
        ("rank",),
        ("place",),
        ("positionDisplay",),
        ("leaderboardPosition",),
        ("playerState", "position"),
    ) or "-"
    to_par = get_nested_text(
        item,
        ("toPar",),
        ("to_par",),
        ("scoreToPar",),
        ("scoreToParDisplay",),
        ("overallScoreToPar",),
        ("totalScoreToPar",),
        ("displayScore",),
        ("score",),
        ("total",),
    ) or "E"
    today = get_nested_text(
        item,
        ("today",),
        ("roundScore",),
        ("currentRoundScore",),
        ("todayToPar",),
        ("roundScoreToPar",),
        ("currentRoundScoreToPar",),
    ) or "-"
    thru = get_nested_text(
        item,
        ("thru",),
        ("through",),
        ("holesCompleted",),
        ("thruDisplay",),
        ("throughDisplay",),
    ) or "--"
    tee_time = get_nested_text(
        item,
        ("teeTime",),
        ("tee_time",),
        ("teetime",),
        ("teeTimeDisplay",),
    ) or "--"
    status = get_nested_text(
        item,
        ("status",),
        ("state",),
        ("roundStatus",),
        ("statusDisplay",),
        ("roundStatusDisplay",),
        ("playerState", "status"),
    ) or "Live"

    # Ignore general player/profile objects that are not actual leaderboard rows.
    has_leaderboard_shape = (
        looks_like_score(to_par) or
        looks_like_position(position) or
        looks_like_score(today) or
        str(thru).strip().upper() not in ("", "--")
    )
    if not has_leaderboard_shape:
        return None

    return PlayerRow(
        name=unescape(name),
        position=position,
        to_par=to_par,
        today=today,
        thru=thru,
        tee_time=tee_time,
        status=status,
    )


def extract_rows_from_json(html: str) -> list[PlayerRow]:
    candidates: list[str] = []
    next_data = re.findall(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, flags=re.S)
    candidates.extend(next_data)
    script_json = re.findall(r"window\.[A-Za-z0-9_]+\s*=\s*(\{.*?\});", html, flags=re.S)
    candidates.extend(script_json)

    rows: list[PlayerRow] = []
    seen: set[str] = set()

    for candidate in candidates:
        try:
            payload = json.loads(candidate.rstrip(";"))
        except Exception:
            continue

        for obj in dig(payload):
            row = coerce_row(obj) if isinstance(obj, dict) else None
            if not row:
                continue
            key = normalize_name(row.name)
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)

    return rows


def extract_rows_from_table(html: str) -> list[PlayerRow]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[PlayerRow] = []
    seen: set[str] = set()

    for table in soup.find_all("table"):
        header_cells = [cell.get_text(" ", strip=True).upper() for cell in table.find_all("th")]
        if not header_cells:
            continue
        if "PLAYER" not in header_cells and "NAME" not in header_cells:
            continue

        for tr in table.find_all("tr"):
            cells = [cell.get_text(" ", strip=True) for cell in tr.find_all(["td", "th"])]
            if len(cells) < 2:
                continue

            header_map = {text: idx for idx, text in enumerate(header_cells)}
            player_idx = header_map.get("PLAYER", header_map.get("NAME"))
            if player_idx is None or player_idx >= len(cells):
                continue

            name = cells[player_idx].strip()
            key = normalize_name(name)
            if not name or key in seen or key in {"player", "name"}:
                continue

            seen.add(key)
            rows.append(
                PlayerRow(
                    name=name,
                    position=cells[header_map["POS"]] if "POS" in header_map and header_map["POS"] < len(cells) else "-",
                    to_par=cells[header_map["TO PAR"]] if "TO PAR" in header_map and header_map["TO PAR"] < len(cells) else "E",
                    today=cells[header_map["TODAY"]] if "TODAY" in header_map and header_map["TODAY"] < len(cells) else "-",
                    thru=cells[header_map["THRU"]] if "THRU" in header_map and header_map["THRU"] < len(cells) else "--",
                    tee_time=cells[header_map["TEE TIME"]] if "TEE TIME" in header_map and header_map["TEE TIME"] < len(cells) else "--",
                    status=cells[header_map["STATUS"]] if "STATUS" in header_map and header_map["STATUS"] < len(cells) else "Live",
                )
            )

    return rows


def looks_like_csv_source(payload: SourcePayload) -> bool:
    text = payload.text.lstrip("\ufeff").strip()
    if "text/csv" in payload.content_type:
        return True
    if payload.url.lower().endswith("output=csv"):
        return True
    first_line = text.splitlines()[0] if text else ""
    header = [cell.upper() for cell in parse_csv_row(first_line)]
    return bool(header) and ("PLAYER" in header or "NAME" in header)


def extract_rows_from_csv(payload: SourcePayload) -> list[PlayerRow]:
    text = payload.text.lstrip("\ufeff").strip()
    if not text:
        return []

    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        return []

    header = [cell.upper() for cell in parse_csv_row(lines[0])]
    player_idx = find_column_index(header, ["PLAYER", "NAME"])
    if player_idx == -1:
        return []

    position_idx = find_column_index(header, ["POS", "POSITION", "PLACE"])
    to_par_idx = find_column_index(header, ["TO PAR", "TO_PAR", "TOPAR", "SCORE", "TOTAL"])
    today_idx = find_column_index(header, ["TODAY", "ROUND", "R1", "ROUND 1"])
    thru_idx = find_column_index(header, ["THRU", "THROUGH"])
    tee_time_idx = find_column_index(header, ["TEE TIME", "TEE_TIME", "TEETIME"])
    status_idx = find_column_index(header, ["STATUS"])

    rows: list[PlayerRow] = []
    seen: set[str] = set()

    for raw_line in lines[1:]:
        row = parse_csv_row(raw_line)
        if player_idx >= len(row):
            continue
        name = unescape(row[player_idx]).strip()
        if not name:
            continue

        key = normalize_name(name)
        if key in seen:
            continue
        seen.add(key)

        raw_thru = row[thru_idx].strip().upper() if 0 <= thru_idx < len(row) and row[thru_idx].strip() else "--"
        raw_tee_time = row[tee_time_idx].strip() if 0 <= tee_time_idx < len(row) and row[tee_time_idx].strip() else "--"
        normalized_tee_time = raw_tee_time
        normalized_thru = raw_thru
        if looks_like_tee_time(raw_thru) and raw_tee_time == "--":
            normalized_tee_time = raw_thru
            normalized_thru = "--"

        fallback_status = row[status_idx].strip() if 0 <= status_idx < len(row) and row[status_idx].strip() else "Live"

        rows.append(
            PlayerRow(
                name=name,
                position=row[position_idx].strip() if 0 <= position_idx < len(row) and row[position_idx].strip() else "-",
                to_par=row[to_par_idx].strip().upper() if 0 <= to_par_idx < len(row) and row[to_par_idx].strip() else "E",
                today=row[today_idx].strip().upper() if 0 <= today_idx < len(row) and row[today_idx].strip() else "-",
                thru=normalized_thru,
                tee_time=normalized_tee_time,
                status=derive_status(normalized_thru, normalized_tee_time, fallback_status),
            )
        )

    return rows


def choose_rows(payload: SourcePayload) -> list[PlayerRow]:
    if looks_like_csv_source(payload):
        rows = extract_rows_from_csv(payload)
        if rows:
            return rows
        raise RuntimeError(
            f"Unable to extract leaderboard rows from CSV source {payload.url}. "
            "Make sure the sheet includes a PLAYER or NAME column."
        )

    rows = extract_rows_from_json(payload.text)
    if rows:
        return rows
    rows = extract_rows_from_table(payload.text)
    if rows:
        return rows
    raise RuntimeError(
        f"Unable to extract leaderboard rows from {payload.url}. "
        "Set the LEADERBOARD_SOURCE_URL repo variable to a source page with visible leaderboard data."
    )


def parse_score(value: str) -> int | None:
    text = str(value).strip().upper()
    if not text:
        return None
    if text == "E":
        return 0
    try:
        return int(text.replace("+", ""))
    except ValueError:
        return None


def compute_leader_text(rows: list[PlayerRow]) -> str:
    scored = [(row, parse_score(row.to_par)) for row in rows]
    valid = [(row, score) for row, score in scored if score is not None]
    if not valid:
        return "Field not started"
    best = min(score for _, score in valid)
    leaders = [row for row, score in valid if score == best][:3]
    return " / ".join(f"{row.name} ({row.to_par})" for row in leaders)


def build_payload(field_players: list[str], source_rows: list[PlayerRow]) -> dict[str, Any]:
    source_lookup = {normalize_name(row.name): row for row in source_rows}
    players = []
    matched_count = 0
    for name in field_players:
        row = source_lookup.get(normalize_name(name))
        if row:
            matched_count += 1
            status = row.status or "Live"
            made_cut = "cut" not in status.lower()
            players.append(
                {
                    "name": name,
                    "position": row.position or "-",
                    "toPar": row.to_par or "E",
                    "today": row.today or "-",
                    "thru": row.thru or "--",
                    "teeTime": row.tee_time or "--",
                    "status": status,
                    "madeCut": made_cut,
                    "isChampion": False,
                    "scoreToPar": parse_score(row.to_par),
                }
            )
        else:
            players.append(
                {
                    "name": name,
                    "position": "-",
                    "toPar": "E",
                    "today": "-",
                    "thru": "--",
                    "teeTime": "--",
                    "status": "Not started",
                    "madeCut": False,
                    "isChampion": False,
                    "scoreToPar": 0,
                }
            )

    timestamp = datetime.now(CENTRAL_TIMEZONE).strftime("%B %d, %Y at %I:%M %p CT")
    return {
        "lastUpdated": f"Auto-updated on {timestamp}",
        "tournamentLeaderText": compute_leader_text(source_rows),
        "players": players,
        "_meta": {
            "sourceUrl": SOURCE_URL,
            "fieldPlayers": len(field_players),
            "sourceRows": len(source_rows),
            "matchedPlayers": matched_count,
        },
    }


def write_payload(payload: dict[str, Any]) -> None:
    json_text = json.dumps(payload, indent=2) + "\n"
    js_text = f"window.US_OPEN_LEADERBOARD = {json.dumps(payload, indent=2)};\n"
    LEADERBOARD_JSON_PATH.write_text(json_text, encoding="utf-8")
    LEADERBOARD_JS_PATH.write_text(js_text, encoding="utf-8")


def main() -> None:
    field_players = load_field_players()
    source_payload = fetch_source_payload()
    print(f"Fetched source: {source_payload.url}")
    print(f"Content-Type: {source_payload.content_type or 'unknown'}")
    rows = choose_rows(source_payload)
    print(f"Parsed source rows: {len(rows)}")
    payload = build_payload(field_players, rows)
    write_payload(payload)
    meta = payload.get("_meta", {})
    print(
        f"Updated leaderboard for {len(payload['players'])} field players from "
        f"{maybe_convert_google_sheet_url(SOURCE_URL)} using {PLAYERS_FILENAME}. "
        f"Matched {meta.get('matchedPlayers', 0)} players."
    )


if __name__ == "__main__":
    main()
